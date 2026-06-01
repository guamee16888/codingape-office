PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS ingestion_api_keys (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_api_keys_project ON ingestion_api_keys(project_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  run_id_external TEXT,
  input TEXT NOT NULL,
  output TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  tools_used TEXT NOT NULL,
  cost REAL NOT NULL DEFAULT 0,
  latency REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_created_at ON agent_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_created_at ON agent_runs(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_external ON agent_runs(run_id_external);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_external_unique
  ON agent_runs(project_id, agent_id, run_id_external)
  WHERE run_id_external IS NOT NULL;

CREATE TABLE IF NOT EXISTS run_judgements (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  success_score INTEGER NOT NULL,
  risk_score INTEGER NOT NULL,
  cost_score INTEGER NOT NULL,
  overall_status TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  failure_categories TEXT NOT NULL,
  recommended_actions TEXT NOT NULL,
  needs_human_review INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_run_judgements_run ON run_judgements(agent_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_judgements_agent_run_unique ON run_judgements(agent_run_id);

CREATE TABLE IF NOT EXISTS failure_cases (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  category TEXT NOT NULL,
  taxonomy_code TEXT DEFAULT 'unknown_failure',
  taxonomy_confidence REAL NOT NULL DEFAULT 0,
  taxonomy_evidence_json TEXT NOT NULL DEFAULT '[]',
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  suggested_fix TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id),
  FOREIGN KEY (taxonomy_code) REFERENCES failure_taxonomies(code)
);

CREATE TABLE IF NOT EXISTS failure_taxonomies (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  parent_code TEXT,
  severity_default TEXT NOT NULL DEFAULT 'medium',
  examples TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_failure_taxonomies_parent ON failure_taxonomies(parent_code);

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  source_failure_case_id TEXT,
  input TEXT NOT NULL,
  expected_behavior TEXT NOT NULL,
  test_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (source_failure_case_id) REFERENCES failure_cases(id)
);

CREATE TABLE IF NOT EXISTS cost_events (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id)
);

CREATE TABLE IF NOT EXISTS optimization_suggestions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  expected_impact TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  source_run_judgement_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (source_run_judgement_id) REFERENCES run_judgements(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS reliability_scores (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  source_report_id TEXT,
  period_start TEXT,
  period_end TEXT,
  reliability_score INTEGER NOT NULL,
  autonomy_readiness_score INTEGER NOT NULL,
  cost_efficiency_score INTEGER NOT NULL,
  risk_exposure_score INTEGER NOT NULL,
  regression_stability_score INTEGER NOT NULL,
  human_review_dependency_score INTEGER NOT NULL,
  readiness_status TEXT NOT NULL,
  score_reasons_json TEXT NOT NULL,
  score_version TEXT NOT NULL DEFAULT 'phase1_v1',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (source_report_id) REFERENCES reports(id)
);

CREATE INDEX IF NOT EXISTS idx_reliability_scores_project_created_at ON reliability_scores(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reliability_scores_target ON reliability_scores(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reliability_scores_report ON reliability_scores(source_report_id);

CREATE TABLE IF NOT EXISTS score_snapshots (
  id TEXT PRIMARY KEY,
  reliability_score_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  report_id TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reliability_score_id) REFERENCES reliability_scores(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE INDEX IF NOT EXISTS idx_score_snapshots_project_created_at ON score_snapshots(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_score_snapshots_target ON score_snapshots(target_type, target_id, created_at);

CREATE TABLE IF NOT EXISTS readiness_scoring_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  target_autonomy_level TEXT NOT NULL,
  config_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_readiness_scoring_policies_version
  ON readiness_scoring_policies(version, target_autonomy_level);

CREATE TABLE IF NOT EXISTS readiness_metric_snapshots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  total_runs INTEGER NOT NULL DEFAULT 0,
  success_runs INTEGER NOT NULL DEFAULT 0,
  failure_runs INTEGER NOT NULL DEFAULT 0,
  partial_failure_runs INTEGER NOT NULL DEFAULT 0,
  high_risk_runs INTEGER NOT NULL DEFAULT 0,
  needs_human_review_runs INTEGER NOT NULL DEFAULT 0,
  eval_cases_total INTEGER NOT NULL DEFAULT 0,
  eval_cases_replayed INTEGER NOT NULL DEFAULT 0,
  eval_replay_pass_rate REAL NOT NULL DEFAULT 0,
  eval_coverage_gap_count INTEGER NOT NULL DEFAULT 0,
  open_incident_count INTEGER NOT NULL DEFAULT 0,
  critical_incident_count INTEGER NOT NULL DEFAULT 0,
  policy_high_risk_hits INTEGER NOT NULL DEFAULT 0,
  cost_anomaly_count INTEGER NOT NULL DEFAULT 0,
  avg_cost_per_run REAL NOT NULL DEFAULT 0,
  p95_latency REAL NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_readiness_metric_snapshots_agent ON readiness_metric_snapshots(agent_id, created_at);

CREATE TABLE IF NOT EXISTS readiness_score_snapshots (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  metric_snapshot_id TEXT NOT NULL,
  scoring_policy_id TEXT,
  scoring_policy_version TEXT NOT NULL,
  target_autonomy_level TEXT NOT NULL,
  total_score INTEGER NOT NULL,
  reliability_score INTEGER NOT NULL,
  eval_confidence_score INTEGER NOT NULL,
  risk_control_score INTEGER NOT NULL,
  human_review_dependency_score INTEGER NOT NULL,
  incident_score INTEGER NOT NULL,
  cost_stability_score INTEGER NOT NULL,
  score_reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (metric_snapshot_id) REFERENCES readiness_metric_snapshots(id),
  FOREIGN KEY (scoring_policy_id) REFERENCES readiness_scoring_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_readiness_score_snapshots_agent ON readiness_score_snapshots(agent_id, created_at);

CREATE TABLE IF NOT EXISTS autonomy_gate_results (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  score_snapshot_id TEXT NOT NULL,
  target_autonomy_level TEXT NOT NULL,
  gate_status TEXT NOT NULL,
  blocked_by TEXT NOT NULL,
  hard_blockers_json TEXT NOT NULL,
  score_blockers_json TEXT NOT NULL,
  gate_reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (score_snapshot_id) REFERENCES readiness_score_snapshots(id)
);

CREATE INDEX IF NOT EXISTS idx_autonomy_gate_results_agent ON autonomy_gate_results(agent_id, created_at);

CREATE TABLE IF NOT EXISTS remediation_objectives (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  gate_result_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  current_value TEXT NOT NULL,
  target_value TEXT NOT NULL,
  expected_score_delta INTEGER NOT NULL DEFAULT 0,
  blocks_autonomy INTEGER NOT NULL DEFAULT 1,
  verification_requirements_json TEXT NOT NULL,
  success_criteria_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (gate_result_id) REFERENCES autonomy_gate_results(id)
);

CREATE INDEX IF NOT EXISTS idx_remediation_objectives_gate ON remediation_objectives(gate_result_id);
CREATE INDEX IF NOT EXISTS idx_remediation_objectives_agent_status ON remediation_objectives(agent_id, status, created_at);

CREATE TABLE IF NOT EXISTS remediation_objective_events (
  id TEXT PRIMARY KEY,
  remediation_objective_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  gate_result_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (remediation_objective_id) REFERENCES remediation_objectives(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (gate_result_id) REFERENCES autonomy_gate_results(id)
);

CREATE INDEX IF NOT EXISTS idx_remediation_objective_events_objective
  ON remediation_objective_events(remediation_objective_id, created_at);
CREATE INDEX IF NOT EXISTS idx_remediation_objective_events_project
  ON remediation_objective_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS autonomy_certification_roadmaps (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  gate_result_id TEXT NOT NULL,
  current_score INTEGER NOT NULL,
  target_score INTEGER NOT NULL,
  target_autonomy_level TEXT NOT NULL,
  estimated_score_after_completion INTEGER NOT NULL,
  roadmap_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (gate_result_id) REFERENCES autonomy_gate_results(id)
);

CREATE INDEX IF NOT EXISTS idx_autonomy_certification_roadmaps_agent ON autonomy_certification_roadmaps(agent_id, created_at);

CREATE TABLE IF NOT EXISTS autonomy_gate_recheck_history (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  previous_roadmap_id TEXT,
  new_roadmap_id TEXT NOT NULL,
  previous_score INTEGER,
  new_score INTEGER NOT NULL,
  target_score INTEGER NOT NULL,
  score_delta INTEGER NOT NULL DEFAULT 0,
  previous_gate_status TEXT,
  new_gate_status TEXT NOT NULL,
  previous_blocked_by TEXT,
  new_blocked_by TEXT NOT NULL,
  objective_status_summary_json TEXT NOT NULL,
  recheck_summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (previous_roadmap_id) REFERENCES autonomy_certification_roadmaps(id),
  FOREIGN KEY (new_roadmap_id) REFERENCES autonomy_certification_roadmaps(id)
);

CREATE INDEX IF NOT EXISTS idx_autonomy_gate_recheck_history_agent
  ON autonomy_gate_recheck_history(agent_id, created_at);

CREATE TABLE IF NOT EXISTS certification_review_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  roadmap_id TEXT NOT NULL,
  gate_result_id TEXT,
  audit_evidence_item_id TEXT,
  requested_by_actor_type TEXT NOT NULL,
  requested_by_actor_id TEXT,
  request_status TEXT NOT NULL,
  certification_state TEXT NOT NULL,
  target_autonomy_level TEXT NOT NULL,
  current_score INTEGER NOT NULL,
  target_score INTEGER NOT NULL,
  review_packet_json TEXT NOT NULL,
  required_signoffs_json TEXT NOT NULL,
  reviewer_decision_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (roadmap_id) REFERENCES autonomy_certification_roadmaps(id),
  FOREIGN KEY (gate_result_id) REFERENCES autonomy_gate_results(id),
  FOREIGN KEY (audit_evidence_item_id) REFERENCES audit_evidence_items(id)
);

CREATE INDEX IF NOT EXISTS idx_certification_review_requests_agent
  ON certification_review_requests(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_certification_review_requests_status
  ON certification_review_requests(project_id, request_status, created_at);

CREATE TABLE IF NOT EXISTS certification_review_decisions (
  id TEXT PRIMARY KEY,
  certification_review_request_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  roadmap_id TEXT NOT NULL,
  reviewer_actor_type TEXT NOT NULL,
  reviewer_actor_id TEXT,
  decision TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  decision_summary TEXT NOT NULL,
  decision_rationale TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (certification_review_request_id) REFERENCES certification_review_requests(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (roadmap_id) REFERENCES autonomy_certification_roadmaps(id)
);

CREATE INDEX IF NOT EXISTS idx_certification_review_decisions_request
  ON certification_review_decisions(certification_review_request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_certification_review_decisions_project
  ON certification_review_decisions(project_id, created_at);

CREATE TABLE IF NOT EXISTS certification_evidence_tasks (
  id TEXT PRIMARY KEY,
  certification_review_request_id TEXT NOT NULL,
  certification_review_decision_id TEXT,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  roadmap_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_signal TEXT NOT NULL,
  required_evidence_json TEXT NOT NULL,
  success_criteria_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (certification_review_request_id) REFERENCES certification_review_requests(id),
  FOREIGN KEY (certification_review_decision_id) REFERENCES certification_review_decisions(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (roadmap_id) REFERENCES autonomy_certification_roadmaps(id)
);

CREATE INDEX IF NOT EXISTS idx_certification_evidence_tasks_request
  ON certification_evidence_tasks(certification_review_request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_certification_evidence_tasks_project
  ON certification_evidence_tasks(project_id, status, created_at);

CREATE TABLE IF NOT EXISTS certification_evidence_task_events (
  id TEXT PRIMARY KEY,
  certification_evidence_task_id TEXT NOT NULL,
  certification_review_request_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (certification_evidence_task_id) REFERENCES certification_evidence_tasks(id),
  FOREIGN KEY (certification_review_request_id) REFERENCES certification_review_requests(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_certification_evidence_task_events_task
  ON certification_evidence_task_events(certification_evidence_task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_certification_evidence_task_events_project
  ON certification_evidence_task_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS certification_action_queue (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  autonomy_gate_recheck_history_id TEXT NOT NULL,
  blocker_type TEXT NOT NULL,
  blocker_code TEXT NOT NULL,
  certification_evidence_task_id TEXT,
  recommended_action TEXT NOT NULL,
  priority INTEGER NOT NULL,
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  action_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (autonomy_gate_recheck_history_id) REFERENCES autonomy_gate_recheck_history(id),
  FOREIGN KEY (certification_evidence_task_id) REFERENCES certification_evidence_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_certification_action_queue_project
  ON certification_action_queue(project_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_certification_action_queue_recheck
  ON certification_action_queue(autonomy_gate_recheck_history_id, priority);

CREATE TABLE IF NOT EXISTS certification_action_events (
  id TEXT PRIMARY KEY,
  certification_action_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (certification_action_id) REFERENCES certification_action_queue(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_certification_action_events_action
  ON certification_action_events(certification_action_id, created_at);
CREATE INDEX IF NOT EXISTS idx_certification_action_events_project
  ON certification_action_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS certification_action_effectiveness (
  id TEXT PRIMARY KEY,
  certification_action_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  source_recheck_id TEXT NOT NULL,
  evaluation_recheck_id TEXT NOT NULL,
  blocker_code TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  action_status TEXT NOT NULL,
  evidence_quality_score INTEGER NOT NULL DEFAULT 0,
  evidence_quality_level TEXT NOT NULL DEFAULT 'none',
  previous_score INTEGER,
  new_score INTEGER NOT NULL,
  score_delta INTEGER NOT NULL DEFAULT 0,
  blocker_persisted INTEGER NOT NULL DEFAULT 0,
  effectiveness_status TEXT NOT NULL,
  effectiveness_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (certification_action_id) REFERENCES certification_action_queue(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (source_recheck_id) REFERENCES autonomy_gate_recheck_history(id),
  FOREIGN KEY (evaluation_recheck_id) REFERENCES autonomy_gate_recheck_history(id)
);

CREATE INDEX IF NOT EXISTS idx_certification_action_effectiveness_project
  ON certification_action_effectiveness(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_certification_action_effectiveness_action
  ON certification_action_effectiveness(certification_action_id, evaluation_recheck_id);

CREATE TABLE IF NOT EXISTS objective_metric_validations (
  id TEXT PRIMARY KEY,
  remediation_objective_id TEXT NOT NULL,
  autonomy_gate_recheck_history_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  objective_title TEXT NOT NULL,
  objective_status TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  metric_signal_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (remediation_objective_id) REFERENCES remediation_objectives(id),
  FOREIGN KEY (autonomy_gate_recheck_history_id) REFERENCES autonomy_gate_recheck_history(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_objective_metric_validations_recheck
  ON objective_metric_validations(autonomy_gate_recheck_history_id, created_at);
CREATE INDEX IF NOT EXISTS idx_objective_metric_validations_objective
  ON objective_metric_validations(remediation_objective_id, created_at);

CREATE TABLE IF NOT EXISTS objective_evidence_reviews (
  id TEXT PRIMARY KEY,
  remediation_objective_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  review_status TEXT NOT NULL,
  satisfied_count INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  expired_count INTEGER NOT NULL DEFAULT 0,
  mismatched_count INTEGER NOT NULL DEFAULT 0,
  review_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (remediation_objective_id) REFERENCES remediation_objectives(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_objective_evidence_reviews_objective
  ON objective_evidence_reviews(remediation_objective_id, created_at);
CREATE INDEX IF NOT EXISTS idx_objective_evidence_reviews_project
  ON objective_evidence_reviews(project_id, created_at);

CREATE TABLE IF NOT EXISTS objective_run_closure_assessments (
  id TEXT PRIMARY KEY,
  remediation_objective_id TEXT NOT NULL,
  autonomy_gate_recheck_history_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  objective_title TEXT NOT NULL,
  closure_status TEXT NOT NULL,
  current_value TEXT NOT NULL,
  target_value TEXT NOT NULL,
  metric_evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (remediation_objective_id) REFERENCES remediation_objectives(id),
  FOREIGN KEY (autonomy_gate_recheck_history_id) REFERENCES autonomy_gate_recheck_history(id),
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_objective_run_closure_assessments_recheck
  ON objective_run_closure_assessments(autonomy_gate_recheck_history_id, created_at);
CREATE INDEX IF NOT EXISTS idx_objective_run_closure_assessments_objective
  ON objective_run_closure_assessments(remediation_objective_id, created_at);

CREATE TABLE IF NOT EXISTS learning_insights (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  report_id TEXT,
  insight_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE INDEX IF NOT EXISTS idx_learning_insights_project_created_at ON learning_insights(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_learning_insights_report ON learning_insights(report_id);

CREATE TABLE IF NOT EXISTS learning_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  pattern_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  source_feedback_count INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_rules_project_pattern ON learning_rules(project_id, rule_type, pattern_key);
CREATE INDEX IF NOT EXISTS idx_learning_rules_project_status ON learning_rules(project_id, status);

CREATE TABLE IF NOT EXISTS learning_rule_events (
  id TEXT PRIMARY KEY,
  learning_rule_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (learning_rule_id) REFERENCES learning_rules(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_learning_rule_events_rule
  ON learning_rule_events(learning_rule_id, created_at);
CREATE INDEX IF NOT EXISTS idx_learning_rule_events_project
  ON learning_rule_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS report_deliveries (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  subject TEXT NOT NULL,
  error_message TEXT,
  provider_message_id TEXT,
  metadata TEXT NOT NULL,
  attempted_at TEXT,
  delivered_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_report_deliveries_report ON report_deliveries(report_id);
CREATE INDEX IF NOT EXISTS idx_report_deliveries_project ON report_deliveries(project_id, created_at);

CREATE TABLE IF NOT EXISTS report_subscriptions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  provider TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_report_subscriptions_project ON report_subscriptions(project_id, enabled);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  message TEXT NOT NULL,
  metadata TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_job_events_project_created_at ON job_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_job_events_job_type_created_at ON job_events(job_type, created_at);

CREATE TABLE IF NOT EXISTS user_feedback (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  review_status TEXT NOT NULL DEFAULT 'draft_review',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS policy_rule_events (
  id TEXT PRIMARY KEY,
  policy_rule_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_rule_events_rule
  ON policy_rule_events(policy_rule_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_rule_events_project
  ON policy_rule_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS policy_dry_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  policy_rule_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  match_count INTEGER NOT NULL DEFAULT 0,
  high_risk_match_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft_review',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_dry_runs_project_created_at ON policy_dry_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_dry_runs_report ON policy_dry_runs(report_id);
CREATE INDEX IF NOT EXISTS idx_policy_dry_runs_rule ON policy_dry_runs(policy_rule_id);

CREATE TABLE IF NOT EXISTS policy_dry_run_matches (
  id TEXT PRIMARY KEY,
  policy_dry_run_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL,
  judgement_id TEXT,
  risk_score INTEGER NOT NULL DEFAULT 0,
  overall_status TEXT NOT NULL,
  matched_tools TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_dry_run_id) REFERENCES policy_dry_runs(id),
  FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id),
  FOREIGN KEY (judgement_id) REFERENCES run_judgements(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_dry_run_matches_dry_run ON policy_dry_run_matches(policy_dry_run_id);
CREATE INDEX IF NOT EXISTS idx_policy_dry_run_matches_run ON policy_dry_run_matches(agent_run_id);

CREATE TABLE IF NOT EXISTS policy_review_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  policy_rule_id TEXT NOT NULL,
  policy_dry_run_id TEXT,
  report_id TEXT,
  review_readiness TEXT NOT NULL,
  recommended_review_status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'open',
  task_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id),
  FOREIGN KEY (policy_dry_run_id) REFERENCES policy_dry_runs(id),
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_review_tasks_project
  ON policy_review_tasks(project_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_review_tasks_policy
  ON policy_review_tasks(policy_rule_id, status, created_at);

CREATE TABLE IF NOT EXISTS policy_review_task_events (
  id TEXT PRIMARY KEY,
  policy_review_task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  policy_rule_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_review_task_id) REFERENCES policy_review_tasks(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_review_task_events_task
  ON policy_review_task_events(policy_review_task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_review_task_events_project
  ON policy_review_task_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS policy_rule_review_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  policy_rule_id TEXT NOT NULL,
  policy_review_task_id TEXT NOT NULL,
  from_review_status TEXT NOT NULL,
  recommended_review_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  candidate_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id),
  FOREIGN KEY (policy_review_task_id) REFERENCES policy_review_tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_rule_review_candidates_project
  ON policy_rule_review_candidates(project_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_rule_review_candidates_policy
  ON policy_rule_review_candidates(policy_rule_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_rule_review_candidates_task
  ON policy_rule_review_candidates(policy_review_task_id);

CREATE TABLE IF NOT EXISTS policy_rule_review_candidate_events (
  id TEXT PRIMARY KEY,
  policy_rule_review_candidate_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  policy_rule_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (policy_rule_review_candidate_id) REFERENCES policy_rule_review_candidates(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_rule_review_candidate_events_candidate
  ON policy_rule_review_candidate_events(policy_rule_review_candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_rule_review_candidate_events_project
  ON policy_rule_review_candidate_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS policy_review_work_item_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  policy_rule_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL,
  workbench_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_review_work_item_events_policy
  ON policy_review_work_item_events(policy_rule_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_review_work_item_events_project
  ON policy_review_work_item_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS policy_review_work_item_effectiveness (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  policy_rule_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_readiness_score INTEGER NOT NULL DEFAULT 0,
  current_readiness_score INTEGER NOT NULL DEFAULT 0,
  readiness_score_delta INTEGER NOT NULL DEFAULT 0,
  blocker_cleared INTEGER NOT NULL DEFAULT 0,
  effectiveness_status TEXT NOT NULL,
  effectiveness_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (policy_rule_id) REFERENCES policy_rules(id),
  FOREIGN KEY (source_event_id) REFERENCES policy_review_work_item_events(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_review_work_item_effectiveness_event
  ON policy_review_work_item_effectiveness(source_event_id);
CREATE INDEX IF NOT EXISTS idx_policy_review_work_item_effectiveness_policy
  ON policy_review_work_item_effectiveness(policy_rule_id, created_at);

CREATE TABLE IF NOT EXISTS model_route_policies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  name TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_model_route_policies_project ON model_route_policies(project_id, agent_id, status);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_agent ON workflow_versions(agent_id, version);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  prompt_name TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  prompt_version_id TEXT,
  workflow_version_id TEXT,
  model_route_policy_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(id),
  FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id),
  FOREIGN KEY (model_route_policy_id) REFERENCES model_route_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_versions_agent ON agent_versions(agent_id, version);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  prompt_version_id TEXT,
  model_route_policy_id TEXT,
  eval_case_ids TEXT NOT NULL,
  pass_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  regression_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (prompt_version_id) REFERENCES prompt_versions(id),
  FOREIGN KEY (model_route_policy_id) REFERENCES model_route_policies(id)
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_project_created_at ON eval_runs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_eval_runs_agent_created_at ON eval_runs(agent_id, created_at);

CREATE TABLE IF NOT EXISTS replay_results (
  id TEXT PRIMARY KEY,
  eval_run_id TEXT NOT NULL,
  eval_case_id TEXT NOT NULL,
  status TEXT NOT NULL,
  actual_output TEXT,
  expected_behavior TEXT NOT NULL,
  judge_result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id),
  FOREIGN KEY (eval_case_id) REFERENCES eval_cases(id)
);

CREATE INDEX IF NOT EXISTS idx_replay_results_eval_run ON replay_results(eval_run_id);
CREATE INDEX IF NOT EXISTS idx_replay_results_eval_case ON replay_results(eval_case_id);

CREATE TABLE IF NOT EXISTS incident_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  related_run_ids TEXT NOT NULL,
  root_cause_category TEXT,
  remediation_status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_incident_reports_project_created_at ON incident_reports(project_id, created_at);

CREATE TABLE IF NOT EXISTS incident_remediation_events (
  id TEXT PRIMARY KEY,
  incident_report_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'user',
  actor_id TEXT,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (incident_report_id) REFERENCES incident_reports(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_incident_remediation_events_incident ON incident_remediation_events(incident_report_id, created_at);
CREATE INDEX IF NOT EXISTS idx_incident_remediation_events_project ON incident_remediation_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS audit_evidence_items (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT,
  evidence_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_evidence_items_project ON audit_evidence_items(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_evidence_items_target ON audit_evidence_items(target_type, target_id);

CREATE TABLE IF NOT EXISTS anonymized_benchmark_patterns (
  id TEXT PRIMARY KEY,
  pattern_type TEXT NOT NULL,
  taxonomy_code TEXT,
  industry TEXT,
  agent_type TEXT,
  model_provider TEXT,
  aggregate_stats_json TEXT NOT NULL,
  privacy_level TEXT NOT NULL DEFAULT 'aggregate_only',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_anonymized_benchmark_patterns_type ON anonymized_benchmark_patterns(pattern_type, taxonomy_code);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  project_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
