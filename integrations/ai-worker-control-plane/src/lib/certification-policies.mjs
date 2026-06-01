export const READINESS_POLICY_VERSION = "readiness_policy_v0.1";

export const AUTONOMY_LEVELS = {
  L0: { label: "Observe Only", target_score: 0 },
  L1: { label: "Human Draft", target_score: 40 },
  L2: { label: "Supervised Execution", target_score: 60 },
  L3: { label: "Limited Autonomy", target_score: 80 },
  L4: { label: "Full Autonomy Candidate", target_score: 90 },
};

export const READINESS_SCORE_POLICY_CONFIG = {
  weights: {
    reliability_score: 25,
    eval_confidence_score: 20,
    risk_control_score: 20,
    human_review_dependency_score: 15,
    incident_score: 10,
    cost_stability_score: 10,
  },
  targets: {
    recent_success_rate: 0.90,
    eval_replay_pass_rate: 1,
    eval_coverage_gap_count: 0,
    high_risk_runs: 0,
    needs_human_review_rate: 0.15,
    open_incident_count: 0,
    cost_anomaly_count: 0,
  },
};

const PRODUCTION_EVIDENCE_POLICIES = {
  L0: {
    min_production_candidate_runs: 0,
    require_api_key_authentication: false,
    require_signature_verification: false,
    allow_console_sample_runs: true,
    stability_window_days: 0,
  },
  L1: {
    min_production_candidate_runs: 1,
    require_api_key_authentication: true,
    require_signature_verification: false,
    allow_console_sample_runs: false,
    stability_window_days: 0,
  },
  L2: {
    min_production_candidate_runs: 3,
    require_api_key_authentication: true,
    require_signature_verification: true,
    allow_console_sample_runs: false,
    stability_window_days: 1,
  },
  L3: {
    min_production_candidate_runs: 50,
    require_api_key_authentication: true,
    require_signature_verification: true,
    allow_console_sample_runs: false,
    stability_window_days: 7,
  },
  L4: {
    min_production_candidate_runs: 200,
    require_api_key_authentication: true,
    require_signature_verification: true,
    allow_console_sample_runs: false,
    stability_window_days: 14,
  },
};

export function productionCertificationPolicyForLevel(targetAutonomyLevel = "L2") {
  const level = normalizeAutonomyLevel(targetAutonomyLevel);
  return {
    version: "production_evidence_policy_v0.1",
    target_autonomy_level: level,
    ...(PRODUCTION_EVIDENCE_POLICIES[level] || PRODUCTION_EVIDENCE_POLICIES.L2),
  };
}

export function readinessPolicyConfigForLevel(targetAutonomyLevel = "L2") {
  const level = normalizeAutonomyLevel(targetAutonomyLevel);
  return {
    ...READINESS_SCORE_POLICY_CONFIG,
    target_level: AUTONOMY_LEVELS[level],
    production_certification_policy: productionCertificationPolicyForLevel(level),
  };
}

export function normalizeAutonomyLevel(targetAutonomyLevel = "L2") {
  const level = String(targetAutonomyLevel || "L2").trim().toUpperCase();
  return AUTONOMY_LEVELS[level] ? level : "L2";
}
