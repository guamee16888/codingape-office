import { fromJson, migrate, openDatabase, parseJudgementRow, parseRunRow } from "./db.mjs";

function limitValue(value, fallback = 50) {
  return Math.max(1, Math.min(Number(value || fallback), 200));
}

function parseSuggestionRow(row) {
  return row ? { ...row } : null;
}

function parseEvalCaseRow(row) {
  return row ? { ...row } : null;
}

function parseFailureCaseRow(row) {
  return row ? { ...row, taxonomy_evidence_json: fromJson(row.taxonomy_evidence_json, []) } : null;
}

function parseCostEventRow(row) {
  return row ? { ...row } : null;
}

export function listProjectRuns(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.agentId) {
      clauses.push("agent_id = ?");
      params.push(options.agentId);
    }

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    if (options.from) {
      clauses.push("created_at >= ?");
      params.push(options.from);
    }

    if (options.to) {
      clauses.push("created_at < ?");
      params.push(options.to);
    }

    const limit = limitValue(options.limit);
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM agent_runs
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseRunRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getRunTrace(runId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const run = parseRunRow(db.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId));
    if (!run) {
      return null;
    }

    const judgement = parseJudgementRow(db.prepare("SELECT * FROM run_judgements WHERE agent_run_id = ?").get(runId));
    const failureCases = db.prepare("SELECT * FROM failure_cases WHERE agent_run_id = ? ORDER BY created_at ASC").all(runId).map(parseFailureCaseRow);
    const costEvents = db.prepare("SELECT * FROM cost_events WHERE agent_run_id = ? ORDER BY created_at ASC").all(runId).map(parseCostEventRow);
    const suggestions = judgement
      ? db.prepare("SELECT * FROM optimization_suggestions WHERE source_run_judgement_id = ? ORDER BY created_at ASC").all(judgement.id).map(parseSuggestionRow)
      : [];
    const evalCases = db.prepare(
      `SELECT e.*
       FROM eval_cases e
       LEFT JOIN failure_cases f ON f.id = e.source_failure_case_id
       WHERE f.agent_run_id = ?
       ORDER BY e.created_at ASC`
    ).all(runId).map(parseEvalCaseRow);

    return {
      run,
      judgement,
      failure_cases: failureCases,
      cost_events: costEvents,
      suggestions,
      eval_cases: evalCases,
    };
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getRunJudgementByRunId(runId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    return parseJudgementRow(db.prepare("SELECT * FROM run_judgements WHERE agent_run_id = ?").get(runId));
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectSuggestions(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.type) {
      clauses.push("type = ?");
      params.push(options.type);
    }

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    if (options.agentId) {
      clauses.push("agent_id = ?");
      params.push(options.agentId);
    }

    const limit = limitValue(options.limit);
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM optimization_suggestions
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseSuggestionRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectEvalCases(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.agentId) {
      clauses.push("agent_id = ?");
      params.push(options.agentId);
    }

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    const limit = limitValue(options.limit);
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM eval_cases
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(...params).map(parseEvalCaseRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectFailureCases(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["r.project_id = ?"];
    const params = [projectId];

    if (options.category) {
      clauses.push("f.category = ?");
      params.push(options.category);
    }

    if (options.taxonomyCode) {
      clauses.push("f.taxonomy_code = ?");
      params.push(options.taxonomyCode);
    }

    if (options.severity) {
      clauses.push("f.severity = ?");
      params.push(options.severity);
    }

    const limit = limitValue(options.limit);
    params.push(limit);

    return db.prepare(
      `SELECT f.*
       FROM failure_cases f
       JOIN agent_runs r ON r.id = f.agent_run_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY f.created_at DESC
       LIMIT ?`
    ).all(...params).map(parseFailureCaseRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
