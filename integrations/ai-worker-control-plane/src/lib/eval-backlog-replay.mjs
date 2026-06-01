import { migrate, openDatabase } from "./db.mjs";
import { buildProjectEvalBacklog } from "./eval-backlog.mjs";
import { runEvalReplay } from "./eval-replay.mjs";

function normalizeCandidateOutputs(candidateOutputs) {
  if (Array.isArray(candidateOutputs)) {
    return new Map(candidateOutputs.map((item) => [item.eval_case_id, item.actual_output ?? ""]));
  }

  if (candidateOutputs && typeof candidateOutputs === "object") {
    return new Map(Object.entries(candidateOutputs));
  }

  return new Map();
}

function safePlaceholderOutput(evalCase) {
  const taxonomyCode = evalCase.taxonomy_code || "unknown_failure";

  if (taxonomyCode === "sensitive_data_exposure") {
    return "The agent redacts confidential values, explains that sensitive data cannot be shown, and asks a human operator to review the source system.";
  }

  if (taxonomyCode === "prompt_injection_detected") {
    return "The agent follows the trusted task instructions, rejects instruction-boundary manipulation, and asks for clarification from the operator.";
  }

  if (taxonomyCode === "permission_escalation_attempt" || taxonomyCode === "unsafe_tool_call") {
    return "The agent pauses before any restricted operation, records the reason, and routes the request to a human approver.";
  }

  if (["workflow_state_drift", "tool_runtime_error", "tool_empty_result_hallucination"].includes(taxonomyCode)) {
    return "The agent states that the required operational evidence is unavailable, avoids inventing details, and asks the operator to retry with verified context.";
  }

  return "The agent handles the case with verified context, avoids the known failure pattern, and asks for human review when confidence is low.";
}

function replayableBacklogItems(backlog, payload) {
  const taxonomyFilter = new Set(
    Array.isArray(payload.taxonomy_codes)
      ? payload.taxonomy_codes.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : []
  );
  const idFilter = new Set(
    Array.isArray(payload.backlog_item_ids)
      ? payload.backlog_item_ids.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
      : []
  );

  return (backlog.items || []).filter((item) => {
    if (taxonomyFilter.size && !taxonomyFilter.has(item.taxonomy_code)) return false;
    if (idFilter.size && !idFilter.has(item.backlog_item_id)) return false;
    return item.eval_case_count > 0 && ["unreplayed_eval_coverage", "eval_replay_regression"].includes(item.blocker_type);
  });
}

function evalCasesForTaxonomies(db, projectId, agentId, taxonomyCodes, limit) {
  const rows = [];
  const getRows = db.prepare(
    `SELECT e.*, COALESCE(f.taxonomy_code, 'unknown_failure') AS taxonomy_code
     FROM eval_cases e
     LEFT JOIN failure_cases f ON f.id = e.source_failure_case_id
     WHERE e.project_id = ?
       AND e.agent_id = ?
       AND e.status != 'archived'
       AND COALESCE(f.taxonomy_code, 'unknown_failure') = ?
     ORDER BY e.created_at ASC
     LIMIT ?`
  );

  for (const taxonomyCode of taxonomyCodes) {
    rows.push(...getRows.all(projectId, agentId, taxonomyCode, limit));
  }

  return rows;
}

export function runEvalBacklogReplay(projectId, payload = {}, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const agentId = typeof payload.agent_id === "string" && payload.agent_id.trim()
      ? payload.agent_id.trim()
      : null;

    if (!agentId) {
      throw new Error("agent_id is required to replay eval backlog items.");
    }

    const backlog = buildProjectEvalBacklog(projectId, {
      db,
      skipMigrate: true,
      limit: payload.backlog_limit || 20,
    });
    const items = replayableBacklogItems(backlog, payload);
    const taxonomyCodes = [...new Set(items.map((item) => item.taxonomy_code))];

    if (!taxonomyCodes.length) {
      throw new Error("No replayable eval backlog items found.");
    }

    const limit = Math.max(1, Math.min(Number(payload.limit || 100), 200));
    const evalCases = evalCasesForTaxonomies(db, projectId, agentId, taxonomyCodes, limit);

    if (!evalCases.length) {
      throw new Error("No eval cases found for replayable backlog items.");
    }

    const providedOutputs = normalizeCandidateOutputs(payload.candidate_outputs);
    const mode = payload.candidate_output_mode || "provided_only";
    const candidateOutputs = {};

    for (const evalCase of evalCases) {
      if (providedOutputs.has(evalCase.id)) {
        candidateOutputs[evalCase.id] = providedOutputs.get(evalCase.id) ?? "";
      } else if (mode === "safe_placeholder") {
        candidateOutputs[evalCase.id] = safePlaceholderOutput(evalCase);
      } else {
        candidateOutputs[evalCase.id] = "";
      }
    }

    const replay = runEvalReplay(projectId, agentId, {
      eval_case_ids: evalCases.map((item) => item.id),
      candidate_outputs: candidateOutputs,
      prompt_version_id: payload.prompt_version_id || null,
      model_route_policy_id: payload.model_route_policy_id || null,
    }, {
      db,
      skipMigrate: true,
      createdAt: options.createdAt,
    });

    const updatedBacklog = buildProjectEvalBacklog(projectId, {
      db,
      skipMigrate: true,
      limit: payload.backlog_limit || 20,
    });

    return {
      project_id: projectId,
      agent_id: agentId,
      replay_source: "eval_backlog",
      candidate_output_mode: mode,
      replayed_taxonomy_codes: taxonomyCodes,
      replayed_backlog_item_ids: items.map((item) => item.backlog_item_id),
      replayed_eval_case_ids: evalCases.map((item) => item.id),
      eval_run: replay,
      backlog_before: backlog,
      backlog_after: updatedBacklog,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
