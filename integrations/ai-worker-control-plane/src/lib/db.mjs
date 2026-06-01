import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backfillFailureCaseTaxonomy, ensureFailureTaxonomySeeded } from "./failure-taxonomy.mjs";

const thisDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(thisDir, "../..");
const schemaPath = resolve(projectRoot, "db/schema.sql");

export function getProjectRoot() {
  return projectRoot;
}

export function getDefaultDbPath() {
  return process.env.AIWC_DB_PATH || resolve(projectRoot, ".data/aiwc.sqlite");
}

export function openDatabase(dbPath = getDefaultDbPath()) {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function migrate(db) {
  const schema = readFileSync(schemaPath, "utf8");
  db.exec(schema);
  applyAdditiveMigrations(db);
  ensureFailureTaxonomySeeded(db);
  backfillFailureCaseTaxonomy(db);
}

function tableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function ensureColumn(db, tableName, columnName, columnSql) {
  if (!tableColumns(db, tableName).includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`);
  }
}

function applyAdditiveMigrations(db) {
  const columns = [
    ["report_deliveries", "retry_count", "INTEGER NOT NULL DEFAULT 0"],
    ["report_deliveries", "next_retry_at", "TEXT"],
    ["report_deliveries", "resolved_at", "TEXT"],
    ["job_events", "retry_count", "INTEGER NOT NULL DEFAULT 0"],
    ["job_events", "next_retry_at", "TEXT"],
    ["job_events", "resolved_at", "TEXT"],
    ["failure_cases", "taxonomy_code", "TEXT DEFAULT 'unknown_failure'"],
    ["failure_cases", "taxonomy_confidence", "REAL NOT NULL DEFAULT 0"],
    ["failure_cases", "taxonomy_evidence_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["policy_rules", "review_status", "TEXT NOT NULL DEFAULT 'draft_review'"],
    ["policy_rules", "updated_at", "TEXT"],
  ];

  for (const [tableName, columnName, columnSql] of columns) {
    ensureColumn(db, tableName, columnName, columnSql);
  }
}


export function withDatabase(fn, options = {}) {
  const db = options.db || openDatabase(options.dbPath);
  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    return fn(db);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function toJson(value) {
  return JSON.stringify(value ?? null);
}

export function fromJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function parseRunRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    tools_used: fromJson(row.tools_used, []),
    metadata: fromJson(row.metadata, {}),
  };
}

export function parseJudgementRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    evidence: fromJson(row.evidence, []),
    failure_categories: fromJson(row.failure_categories, []),
    recommended_actions: fromJson(row.recommended_actions, []),
    raw_json: fromJson(row.raw_json, {}),
    needs_human_review: Boolean(row.needs_human_review),
  };
}
