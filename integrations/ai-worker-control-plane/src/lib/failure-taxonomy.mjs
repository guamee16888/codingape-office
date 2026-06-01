const DANGEROUS_TOOL_KEYWORDS = ["delete", "transfer", "payment", "refund", "send_email", "shell", "exec", "admin"];

export const CANONICAL_FAILURE_TAXONOMY = [
  {
    code: "tool_empty_result_hallucination",
    name: "Tool empty result hallucination",
    description: "The agent fabricates or overstates an answer after a tool returns empty, null, partial, or unusable data.",
    parent_code: "hallucination",
    severity_default: "high",
    examples: ["Tool returned no order, but the agent claimed an order status."],
  },
  {
    code: "tool_runtime_error",
    name: "Tool runtime error",
    description: "A tool failed, timed out, threw an exception, or returned an operational error.",
    parent_code: "tool_error",
    severity_default: "medium",
    examples: ["order_lookup timed out", "CRM API returned 500"],
  },
  {
    code: "retrieval_context_missing",
    name: "Retrieval context missing",
    description: "The agent lacked required context, retrieval, documents, or task fields to answer safely.",
    parent_code: "missing_context",
    severity_default: "medium",
    examples: ["No customer ID was provided", "RAG returned no relevant policy."],
  },
  {
    code: "date_boundary_error",
    name: "Date boundary error",
    description: "The agent likely misread relative dates, time zones, reporting windows, or deadline boundaries.",
    parent_code: "prompt_weakness",
    severity_default: "medium",
    examples: ["Yesterday was interpreted in the wrong timezone."],
  },
  {
    code: "prompt_injection_detected",
    name: "Prompt injection detected",
    description: "The run contained jailbreak, instruction override, system prompt extraction, or role-boundary language.",
    parent_code: "policy_risk",
    severity_default: "high",
    examples: ["ignore previous instructions", "reveal the system prompt"],
  },
  {
    code: "unsafe_tool_call",
    name: "Unsafe tool call",
    description: "The agent used or attempted a high-impact tool that can affect customers, money, data, messages, code, or infrastructure.",
    parent_code: "permission_risk",
    severity_default: "high",
    examples: ["send_email_customer", "payment_refund", "shell_exec"],
  },
  {
    code: "cost_overrun_loop",
    name: "Cost overrun loop",
    description: "The run shows expensive, repeated, looping, or inefficient model/tool behavior.",
    parent_code: "cost_anomaly",
    severity_default: "medium",
    examples: ["Repeated model calls with no state progress."],
  },
  {
    code: "permission_escalation_attempt",
    name: "Permission escalation attempt",
    description: "The agent attempted or requested access beyond its intended autonomy boundary.",
    parent_code: "permission_risk",
    severity_default: "high",
    examples: ["Agent attempted admin action without approval."],
  },
  {
    code: "workflow_state_drift",
    name: "Workflow state drift",
    description: "The workflow state, timing, retry behavior, or external system state diverged from what the agent assumed.",
    parent_code: "tool_error",
    severity_default: "medium",
    examples: ["The workflow retried after state changed", "Timeout caused stale state."],
  },
  {
    code: "human_intent_misread",
    name: "Human intent misread",
    description: "The agent likely misunderstood an ambiguous or underspecified user intent.",
    parent_code: "user_input_ambiguous",
    severity_default: "medium",
    examples: ["The user asked to cancel one item, but the agent canceled the whole order."],
  },
  {
    code: "policy_conflict",
    name: "Policy conflict",
    description: "The run exposed a conflict between user request, system rules, project policy, tool policy, or compliance expectations.",
    parent_code: "policy_risk",
    severity_default: "high",
    examples: ["User requested an action that project policy requires human review for."],
  },
  {
    code: "sensitive_data_exposure",
    name: "Sensitive data exposure",
    description: "The run included secrets, credentials, personal data, payment data, or other sensitive information.",
    parent_code: "unsafe_output",
    severity_default: "high",
    examples: ["Output contained token=...", "Prompt included a credit card number."],
  },
  {
    code: "unknown_failure",
    name: "Unknown failure",
    description: "The failure could not be mapped confidently yet and should be reviewed for taxonomy improvement.",
    parent_code: "unknown",
    severity_default: "medium",
    examples: ["The judge returned an unknown failure category."],
  },
];

function includesAny(value, needles) {
  const text = String(value || "").toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function toolsText(run) {
  return Array.isArray(run?.tools_used) ? run.tools_used.join(" ") : String(run?.tools_used || "");
}

function combinedText(run, judgement) {
  return [
    run?.input,
    run?.output,
    toolsText(run),
    judgement?.summary,
    ...(judgement?.evidence || []),
  ].filter(Boolean).join("\n").toLowerCase();
}

function taxonomyForCategory(category, run, judgement) {
  const text = combinedText(run, judgement);
  const tools = toolsText(run);

  if (includesAny(text, ["ignore previous", "system prompt", "developer message", "jailbreak"])) {
    return ["prompt_injection_detected", 0.92, "Matched prompt-injection or instruction-boundary language."];
  }

  if (category === "permission_risk" && includesAny(tools, DANGEROUS_TOOL_KEYWORDS)) {
    return ["permission_escalation_attempt", 0.88, "Matched privileged tool use under permission risk."];
  }

  if (includesAny(text, ["password", "secret", "api_key", "token=", "ssn", "credit card"])) {
    return ["sensitive_data_exposure", 0.9, "Matched sensitive data exposure keywords."];
  }

  if (includesAny(tools, DANGEROUS_TOOL_KEYWORDS)) {
    return ["unsafe_tool_call", 0.86, "Matched high-impact tool use."];
  }

  if (category === "tool_error" && includesAny(text, ["empty", "null", "not found", "no result", "fabricat", "hallucinat"])) {
    return ["tool_empty_result_hallucination", 0.82, "Matched empty or missing tool result with possible fabrication risk."];
  }

  if (category === "tool_error") {
    if (includesAny(text, ["timeout", "retry", "stale", "state"])) {
      return ["workflow_state_drift", 0.72, "Matched timeout, retry, stale, or state-drift language."];
    }

    return ["tool_runtime_error", 0.7, "Mapped general tool error to runtime error."];
  }

  if (category === "missing_context" || category === "prompt_weakness") {
    if (includesAny(text, ["yesterday", "tomorrow", "today", "timezone", "deadline", "date"])) {
      return ["date_boundary_error", 0.7, "Matched date, deadline, or timezone boundary language."];
    }

    return ["retrieval_context_missing", 0.76, "Mapped missing context or prompt weakness to retrieval/context gap."];
  }

  if (category === "user_input_ambiguous") {
    return ["human_intent_misread", 0.76, "Mapped ambiguous user input to possible intent misread."];
  }

  if (category === "cost_anomaly") {
    return ["cost_overrun_loop", 0.72, "Mapped cost anomaly to possible overrun or inefficient loop."];
  }

  if (category === "latency_issue") {
    return ["workflow_state_drift", 0.68, "Mapped latency issue to workflow-state or timing drift."];
  }

  if (category === "policy_risk") {
    return ["policy_conflict", 0.74, "Mapped policy risk to policy conflict."];
  }

  if (category === "unsafe_output") {
    return ["sensitive_data_exposure", 0.78, "Mapped unsafe output to sensitive data or unsafe disclosure risk."];
  }

  if (category === "hallucination") {
    return ["tool_empty_result_hallucination", 0.66, "Mapped hallucination to likely missing/empty source evidence."];
  }

  return ["unknown_failure", 0.35, "No confident taxonomy mapping matched."];
}

export function classifyFailureTaxonomy({ category, run, judgement }) {
  const [taxonomy_code, taxonomy_confidence, reason] = taxonomyForCategory(category, run, judgement);
  return {
    taxonomy_code,
    taxonomy_confidence,
    taxonomy_evidence: [reason, `source_category=${category}`],
  };
}

export function ensureFailureTaxonomySeeded(db, { createdAt = "2026-05-22T00:00:00.000Z" } = {}) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO failure_taxonomies (
      id, code, name, description, parent_code, severity_default, examples, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const item of CANONICAL_FAILURE_TAXONOMY) {
    insert.run(
      `taxonomy_${item.code}`,
      item.code,
      item.name,
      item.description,
      item.parent_code,
      item.severity_default,
      JSON.stringify(item.examples),
      createdAt
    );
  }
}

export function backfillFailureCaseTaxonomy(db) {
  const rows = db.prepare(
    `SELECT f.id, f.category, f.description, f.taxonomy_code, r.input, r.output, r.tools_used
     FROM failure_cases f
     JOIN agent_runs r ON r.id = f.agent_run_id
     WHERE f.taxonomy_code IS NULL OR f.taxonomy_code = '' OR f.taxonomy_code = 'unknown_failure'`
  ).all();
  const update = db.prepare(
    `UPDATE failure_cases
     SET taxonomy_code = ?, taxonomy_confidence = ?, taxonomy_evidence_json = ?
     WHERE id = ?`
  );

  for (const row of rows) {
    const run = {
      input: row.input,
      output: row.output,
      tools_used: JSON.parse(row.tools_used || "[]"),
    };
    const classification = classifyFailureTaxonomy({
      category: row.category,
      run,
      judgement: { summary: row.description, evidence: [] },
    });

    update.run(
      classification.taxonomy_code,
      classification.taxonomy_confidence,
      JSON.stringify(classification.taxonomy_evidence),
      row.id
    );
  }
}
