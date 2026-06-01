const RUN_STATUSES = new Set(["completed", "failed", "errored", "timeout", "cancelled", "running"]);
const FEEDBACK_TYPES = new Set(["approve", "reject", "useful", "not_useful", "wrong", "approved", "rejected"]);
const TARGET_TYPES = new Set(["run", "judgement", "suggestion", "report", "eval_case", "failure_case"]);
const ENVIRONMENTS = new Set(["development", "staging", "production", "test"]);
const DELIVERY_CHANNELS = new Set(["email", "webhook", "slack", "discord"]);

export class ValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(payload, key, errors) {
  if (typeof payload[key] !== "string" || payload[key].trim() === "") {
    errors.push(`${key} is required and must be a non-empty string`);
    return "";
  }

  return payload[key].trim();
}

function optionalNumber(payload, key, errors, defaultValue = 0) {
  if (payload[key] === undefined || payload[key] === null) {
    return defaultValue;
  }

  const value = Number(payload[key]);
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${key} must be a non-negative number`);
    return defaultValue;
  }

  return value;
}

export function validateRunPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Run payload must be a JSON object", ["payload must be an object"]);
  }

  const projectId = requiredString(payload, "project_id", errors);
  const agentId = requiredString(payload, "agent_id", errors);
  const model = requiredString(payload, "model", errors);
  const provider = requiredString(payload, "provider", errors);
  const status = requiredString(payload, "status", errors);

  if (payload.input === undefined || payload.input === null || payload.input === "") {
    errors.push("input is required");
  }

  if (payload.tools_used !== undefined && !Array.isArray(payload.tools_used)) {
    errors.push("tools_used must be an array when provided");
  }

  if (status && !RUN_STATUSES.has(status)) {
    errors.push(`status must be one of: ${Array.from(RUN_STATUSES).join(", ")}`);
  }

  if (payload.metadata !== undefined && !isPlainObject(payload.metadata)) {
    errors.push("metadata must be an object when provided");
  }

  const cost = optionalNumber(payload, "cost", errors, 0);
  const latency = optionalNumber(payload, "latency", errors, 0);

  if (errors.length > 0) {
    throw new ValidationError("Invalid run payload", errors);
  }

  return {
    project_id: projectId,
    agent_id: agentId,
    run_id_external: typeof payload.run_id_external === "string" ? payload.run_id_external.trim() : null,
    input: payload.input,
    output: payload.output ?? null,
    model,
    provider,
    tools_used: payload.tools_used ?? [],
    cost,
    latency,
    status,
    metadata: payload.metadata ?? {},
  };
}

export function validateFeedbackPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Feedback payload must be a JSON object", ["payload must be an object"]);
  }

  const projectId = requiredString(payload, "project_id", errors);
  const targetType = requiredString(payload, "target_type", errors);
  const targetId = requiredString(payload, "target_id", errors);
  const feedbackType = requiredString(payload, "feedback_type", errors);

  if (targetType && !TARGET_TYPES.has(targetType)) {
    errors.push(`target_type must be one of: ${Array.from(TARGET_TYPES).join(", ")}`);
  }

  if (feedbackType && !FEEDBACK_TYPES.has(feedbackType)) {
    errors.push(`feedback_type must be one of: ${Array.from(FEEDBACK_TYPES).join(", ")}`);
  }

  if (payload.comment !== undefined && payload.comment !== null && typeof payload.comment !== "string") {
    errors.push("comment must be a string when provided");
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid feedback payload", errors);
  }

  return {
    project_id: projectId,
    target_type: targetType,
    target_id: targetId,
    feedback_type: feedbackType,
    comment: payload.comment ?? null,
  };
}

export function validateProjectPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Project payload must be a JSON object", ["payload must be an object"]);
  }

  const name = requiredString(payload, "name", errors);

  if (payload.description !== undefined && payload.description !== null && typeof payload.description !== "string") {
    errors.push("description must be a string when provided");
  }

  if (payload.org_id !== undefined && payload.org_id !== null && typeof payload.org_id !== "string") {
    errors.push("org_id must be a string when provided");
  }

  if (payload.org_name !== undefined && payload.org_name !== null && typeof payload.org_name !== "string") {
    errors.push("org_name must be a string when provided");
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid project payload", errors);
  }

  return {
    name,
    description: payload.description ?? null,
    org_id: typeof payload.org_id === "string" && payload.org_id.trim() ? payload.org_id.trim() : null,
    org_name: typeof payload.org_name === "string" && payload.org_name.trim() ? payload.org_name.trim() : null,
  };
}

export function validateAgentPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Agent payload must be a JSON object", ["payload must be an object"]);
  }

  const projectId = requiredString(payload, "project_id", errors);
  const name = requiredString(payload, "name", errors);
  const environment = typeof payload.environment === "string" && payload.environment.trim()
    ? payload.environment.trim()
    : "production";

  if (!ENVIRONMENTS.has(environment)) {
    errors.push(`environment must be one of: ${Array.from(ENVIRONMENTS).join(", ")}`);
  }

  if (payload.description !== undefined && payload.description !== null && typeof payload.description !== "string") {
    errors.push("description must be a string when provided");
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid agent payload", errors);
  }

  return {
    project_id: projectId,
    name,
    description: payload.description ?? null,
    environment,
  };
}

export function validateNightlyReportPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Nightly report payload must be a JSON object", ["payload must be an object"]);
  }

  const projectId = requiredString(payload, "project_id", errors);
  const date = typeof payload.date === "string" && payload.date.trim()
    ? payload.date.trim()
    : new Date().toISOString().slice(0, 10);
  const targetAutonomyLevel = typeof payload.target_autonomy_level === "string" && payload.target_autonomy_level.trim()
    ? payload.target_autonomy_level.trim().toUpperCase()
    : "L2";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push("date must use YYYY-MM-DD format");
  }
  if (!["L0", "L1", "L2", "L3", "L4"].includes(targetAutonomyLevel)) {
    errors.push("target_autonomy_level must be one of: L0, L1, L2, L3, L4");
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid nightly report payload", errors);
  }

  const deliverTo = Array.isArray(payload.deliver_to)
    ? payload.deliver_to.map((item) => {
      try {
        return validateReportDeliveryPayload(item);
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push(...error.details.map((detail) => `deliver_to: ${detail}`));
        } else {
          errors.push("deliver_to contains an invalid delivery target");
        }
        return null;
      }
    }).filter(Boolean)
    : [];

  if (errors.length > 0) {
    throw new ValidationError("Invalid nightly report payload", errors);
  }

  return {
    project_id: projectId,
    date,
    target_autonomy_level: targetAutonomyLevel,
    deliver_to: deliverTo,
  };
}

export function validateReportDeliveryPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Report delivery payload must be a JSON object", ["payload must be an object"]);
  }

  const recipient = requiredString(payload, "recipient", errors);
  const channel = typeof payload.channel === "string" && payload.channel.trim()
    ? payload.channel.trim()
    : "email";
  const provider = typeof payload.provider === "string" && payload.provider.trim()
    ? payload.provider.trim()
    : channel === "email" ? "local" : channel;

  if (!DELIVERY_CHANNELS.has(channel)) {
    errors.push(`channel must be one of: ${Array.from(DELIVERY_CHANNELS).join(", ")}`);
  }

  if (channel === "email" && recipient && !recipient.includes("@")) {
    errors.push("recipient must be an email address for email delivery");
  }

  if (["webhook", "slack", "discord"].includes(channel) && recipient) {
    try {
      const url = new URL(recipient);
      if (!["http:", "https:"].includes(url.protocol)) {
        errors.push("recipient must be an http(s) URL for webhook delivery");
      }
    } catch {
      errors.push("recipient must be an http(s) URL for webhook delivery");
    }
  }

  if (payload.subject !== undefined && payload.subject !== null && typeof payload.subject !== "string") {
    errors.push("subject must be a string when provided");
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid report delivery payload", errors);
  }

  return {
    recipient,
    channel,
    provider,
    subject: typeof payload.subject === "string" && payload.subject.trim() ? payload.subject.trim() : null,
  };
}

export function validateReportSubscriptionPayload(payload) {
  const normalized = validateReportDeliveryPayload(payload);

  return {
    recipient: normalized.recipient,
    channel: normalized.channel,
    provider: normalized.provider,
    enabled: payload.enabled === undefined || payload.enabled === null ? true : Boolean(payload.enabled),
  };
}

export function validateEvalRunPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Eval run payload must be a JSON object", ["payload must be an object"]);
  }

  const agentId = requiredString(payload, "agent_id", errors);

  if (payload.eval_case_ids !== undefined && !Array.isArray(payload.eval_case_ids)) {
    errors.push("eval_case_ids must be an array when provided");
  }

  if (Array.isArray(payload.eval_case_ids)) {
    for (const evalCaseId of payload.eval_case_ids) {
      if (typeof evalCaseId !== "string" || !evalCaseId.trim()) {
        errors.push("eval_case_ids must contain non-empty strings");
        break;
      }
    }
  }

  if (payload.candidate_outputs !== undefined) {
    const validArray = Array.isArray(payload.candidate_outputs)
      && payload.candidate_outputs.every((item) => (
        isPlainObject(item)
        && typeof item.eval_case_id === "string"
        && item.eval_case_id.trim()
        && (typeof item.actual_output === "string" || item.actual_output === undefined || item.actual_output === null)
      ));
    const validObject = isPlainObject(payload.candidate_outputs)
      && Object.values(payload.candidate_outputs).every((value) => typeof value === "string" || value === null);

    if (!validArray && !validObject) {
      errors.push("candidate_outputs must be an object map or an array of { eval_case_id, actual_output }");
    }
  }

  if (payload.prompt_version_id !== undefined && payload.prompt_version_id !== null && typeof payload.prompt_version_id !== "string") {
    errors.push("prompt_version_id must be a string when provided");
  }

  if (payload.model_route_policy_id !== undefined && payload.model_route_policy_id !== null && typeof payload.model_route_policy_id !== "string") {
    errors.push("model_route_policy_id must be a string when provided");
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid eval run payload", errors);
  }

  return {
    agent_id: agentId,
    eval_case_ids: Array.isArray(payload.eval_case_ids) ? payload.eval_case_ids.map((item) => item.trim()) : [],
    candidate_outputs: payload.candidate_outputs ?? {},
    prompt_version_id: typeof payload.prompt_version_id === "string" && payload.prompt_version_id.trim() ? payload.prompt_version_id.trim() : null,
    model_route_policy_id: typeof payload.model_route_policy_id === "string" && payload.model_route_policy_id.trim() ? payload.model_route_policy_id.trim() : null,
  };
}

export function validateEvalBacklogReplayPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("Eval backlog replay payload must be a JSON object", ["payload must be an object"]);
  }

  const agentId = requiredString(payload, "agent_id", errors);

  for (const key of ["taxonomy_codes", "backlog_item_ids"]) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) {
      errors.push(`${key} must be an array when provided`);
    }

    if (Array.isArray(payload[key])) {
      for (const item of payload[key]) {
        if (typeof item !== "string" || !item.trim()) {
          errors.push(`${key} must contain non-empty strings`);
          break;
        }
      }
    }
  }

  if (payload.candidate_outputs !== undefined) {
    const validArray = Array.isArray(payload.candidate_outputs)
      && payload.candidate_outputs.every((item) => (
        isPlainObject(item)
        && typeof item.eval_case_id === "string"
        && item.eval_case_id.trim()
        && (typeof item.actual_output === "string" || item.actual_output === undefined || item.actual_output === null)
      ));
    const validObject = isPlainObject(payload.candidate_outputs)
      && Object.values(payload.candidate_outputs).every((value) => typeof value === "string" || value === null);

    if (!validArray && !validObject) {
      errors.push("candidate_outputs must be an object map or an array of { eval_case_id, actual_output }");
    }
  }

  if (payload.candidate_output_mode !== undefined && !["provided_only", "safe_placeholder"].includes(payload.candidate_output_mode)) {
    errors.push("candidate_output_mode must be provided_only or safe_placeholder");
  }

  for (const key of ["prompt_version_id", "model_route_policy_id"]) {
    if (payload[key] !== undefined && payload[key] !== null && typeof payload[key] !== "string") {
      errors.push(`${key} must be a string when provided`);
    }
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid eval backlog replay payload", errors);
  }

  return {
    agent_id: agentId,
    taxonomy_codes: Array.isArray(payload.taxonomy_codes) ? payload.taxonomy_codes.map((item) => item.trim()) : [],
    backlog_item_ids: Array.isArray(payload.backlog_item_ids) ? payload.backlog_item_ids.map((item) => item.trim()) : [],
    candidate_outputs: payload.candidate_outputs ?? {},
    candidate_output_mode: payload.candidate_output_mode || "provided_only",
    prompt_version_id: typeof payload.prompt_version_id === "string" && payload.prompt_version_id.trim() ? payload.prompt_version_id.trim() : null,
    model_route_policy_id: typeof payload.model_route_policy_id === "string" && payload.model_route_policy_id.trim() ? payload.model_route_policy_id.trim() : null,
  };
}

export function validateApiKeyPayload(payload) {
  const errors = [];

  if (!isPlainObject(payload)) {
    throw new ValidationError("API key payload must be a JSON object", ["payload must be an object"]);
  }

  if (payload.name !== undefined && payload.name !== null && typeof payload.name !== "string") {
    errors.push("name must be a string when provided");
  }

  if (errors.length > 0) {
    throw new ValidationError("Invalid API key payload", errors);
  }

  return {
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "Ingestion key",
  };
}
