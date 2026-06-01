export const WORKER_STATES = Object.freeze([
  "idle",
  "assigned",
  "working",
  "running_command",
  "generating_evidence",
  "generating_patch",
  "verifying",
  "reviewing",
  "waiting_approval",
  "blocked",
  "failed",
  "completed",
  "reporting"
]);

export const WORKER_ANIMATIONS = Object.freeze([
  "idle",
  "assigned",
  "working",
  "running_command",
  "reviewing",
  "waiting_approval",
  "blocked",
  "completed",
  "reporting"
]);

export const RUN_PHASE_TO_WORKER_STATE = Object.freeze({
  queued: "assigned",
  assigned: "assigned",
  evidence_collecting: "generating_evidence",
  proposal_generating: "generating_patch",
  verification_running: "verifying",
  verification_failed: "failed",
  judge_review: "reviewing",
  human_gate: "waiting_approval",
  patch_running: "running_command",
  diff_ready: "waiting_approval",
  apply_gate: "blocked",
  apply_blocked: "blocked",
  completed: "reporting",
  failed: "failed"
});

const ROLE_PHASE_STATES = Object.freeze({
  "coding-yuan": {
    queued: "assigned",
    assigned: "assigned",
    evidence_collecting: "generating_evidence",
    proposal_generating: "generating_patch",
    verification_running: "working",
    verification_failed: "failed",
    judge_review: "working",
    human_gate: "waiting_approval",
    patch_running: "running_command",
    diff_ready: "completed",
    apply_gate: "waiting_approval",
    apply_blocked: "waiting_approval",
    completed: "reporting",
    failed: "failed"
  },
  "judge-yuan": {
    queued: "idle",
    assigned: "idle",
    evidence_collecting: "idle",
    proposal_generating: "reviewing",
    verification_running: "verifying",
    verification_failed: "failed",
    judge_review: "reviewing",
    human_gate: "waiting_approval",
    patch_running: "reviewing",
    diff_ready: "waiting_approval",
    apply_gate: "waiting_approval",
    apply_blocked: "waiting_approval",
    completed: "completed",
    failed: "failed"
  },
  "ops-yuan": {
    queued: "idle",
    assigned: "idle",
    evidence_collecting: "idle",
    proposal_generating: "idle",
    verification_running: "idle",
    verification_failed: "blocked",
    judge_review: "idle",
    human_gate: "waiting_approval",
    patch_running: "working",
    diff_ready: "waiting_approval",
    apply_gate: "blocked",
    apply_blocked: "blocked",
    completed: "completed",
    failed: "failed"
  }
});

export const WORKER_LIGHTS = Object.freeze({
  neutral: { key: "neutral", label: "standby", hex: "#d7e1ee", three: 0xd7e1ee },
  cyan: { key: "cyan", label: "working", hex: "#30e0c6", three: 0x30e0c6 },
  green: { key: "green", label: "verified", hex: "#7cff9b", three: 0x7cff9b },
  amber: { key: "amber", label: "waiting approval", hex: "#ffb454", three: 0xffb454 },
  red: { key: "red", label: "blocked", hex: "#ff5c7a", three: 0xff5c7a }
});

const STATE_LIGHT_KEY = Object.freeze({
  idle: "neutral",
  assigned: "cyan",
  working: "cyan",
  running_command: "cyan",
  generating_evidence: "cyan",
  generating_patch: "cyan",
  verifying: "cyan",
  reviewing: "cyan",
  waiting_approval: "amber",
  blocked: "red",
  failed: "red",
  completed: "green",
  reporting: "green"
});

const STATE_ANIMATION = Object.freeze({
  idle: "idle",
  assigned: "assigned",
  working: "working",
  running_command: "running_command",
  generating_evidence: "working",
  generating_patch: "working",
  verifying: "reviewing",
  reviewing: "reviewing",
  waiting_approval: "waiting_approval",
  blocked: "blocked",
  failed: "blocked",
  completed: "completed",
  reporting: "reporting"
});

export const DEFAULT_WORKER_ASSET_MANIFEST = Object.freeze({
  version: "1.0.0",
  maxRecommendedModelSizeMb: 8,
  workers: [
    {
      id: "coding-yuan",
      name: "CodingYuan",
      role: "local coding worker",
      model: "/assets/workers/coding-ape.glb",
      fallbackAvatar: "C",
      accent: "#30e0c6"
    },
    {
      id: "judge-yuan",
      name: "JudgeYuan",
      role: "evidence and gate reviewer",
      model: null,
      fallbackAvatar: "J",
      accent: "#8672c8"
    },
    {
      id: "ops-yuan",
      name: "OpsYuan",
      role: "apply and rollback operator",
      model: null,
      fallbackAvatar: "O",
      accent: "#ffb454"
    }
  ]
});

export function normalizeRunPhase(phase = "queued") {
  const normalized = String(phase || "queued").trim();
  if (normalized === "apply_gate") return "apply_gate";
  return RUN_PHASE_TO_WORKER_STATE[normalized] ? normalized : "assigned";
}

export function workerStateForRunPhase(phase, workerId = "coding-yuan", options = {}) {
  if (!options.hasActiveTask && !phase) return "idle";
  const normalized = normalizeRunPhase(phase);
  const roleState = ROLE_PHASE_STATES[workerId]?.[normalized];
  return roleState || RUN_PHASE_TO_WORKER_STATE[normalized] || "idle";
}

export function workerLightForState(state = "idle") {
  const key = STATE_LIGHT_KEY[state] || "neutral";
  return WORKER_LIGHTS[key];
}

export function workerAnimationForState(state = "idle") {
  return STATE_ANIMATION[state] || "idle";
}

export function fallbackWorkerAvatar(worker = {}) {
  if (worker.fallbackAvatar) return worker.fallbackAvatar;
  if (worker.mark) return worker.mark;
  if (worker.id === "judge-yuan") return "J";
  if (worker.id === "ops-yuan") return "O";
  return "C";
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

export class WorkerAssetRegistry {
  constructor(manifest = DEFAULT_WORKER_ASSET_MANIFEST) {
    this.manifest = manifest || DEFAULT_WORKER_ASSET_MANIFEST;
    this.workers = new Map((this.manifest.workers || []).map((worker) => [worker.id, worker]));
  }

  static async load(fetcher = globalThis.fetch, url = "/assets/workers/manifest.json") {
    const response = await fetcher(url, { cache: "no-store" });
    if (!response?.ok) return new WorkerAssetRegistry();
    return new WorkerAssetRegistry(await response.json());
  }

  workerSpec(workerId = "coding-yuan") {
    return this.workers.get(workerId) || this.workers.get("coding-yuan") || DEFAULT_WORKER_ASSET_MANIFEST.workers[0];
  }

  modelCandidatesFor(workerId = "coding-yuan") {
    const spec = this.workerSpec(workerId);
    const preferred = workerId === "coding-yuan" ? ["/assets/workers/coding-ape.glb"] : [];
    const variants = Array.isArray(spec.modelCandidates) ? spec.modelCandidates : [];
    return uniqueValues([...preferred, spec.model, ...variants]);
  }

  fallbackFor(worker = {}) {
    const spec = this.workerSpec(worker.id);
    return {
      avatar: fallbackWorkerAvatar({ ...spec, ...worker }),
      accent: worker.accent || spec.accent || "#30e0c6",
      role: worker.domain || spec.role || "local worker"
    };
  }
}

export class WorkerMotionController {
  describe({ phase, workerId, hasActiveTask = true } = {}) {
    const state = workerStateForRunPhase(phase, workerId, { hasActiveTask });
    const light = workerLightForState(state);
    return {
      animation: workerAnimationForState(state),
      light,
      state
    };
  }
}

export class WorkerAvatar3D {
  constructor(worker = {}, registry = new WorkerAssetRegistry()) {
    this.worker = worker;
    this.registry = registry;
  }

  model({ phase, hasActiveTask = true } = {}) {
    const motion = new WorkerMotionController().describe({
      phase,
      workerId: this.worker.id,
      hasActiveTask
    });
    return {
      ...motion,
      fallback: this.registry.fallbackFor(this.worker),
      modelCandidates: this.registry.modelCandidatesFor(this.worker.id),
      workerId: this.worker.id
    };
  }
}

export class WorkerStation3D {
  constructor(worker = {}, registry = new WorkerAssetRegistry()) {
    this.worker = worker;
    this.avatar = new WorkerAvatar3D(worker, registry);
  }

  model({ phase, runId = "no active run", risk = "low", gateStatus = "pending" } = {}) {
    return {
      ...this.avatar.model({ phase, hasActiveTask: runId !== "no active run" }),
      gateStatus,
      risk,
      runId
    };
  }
}

export class WorkerRoomScene {
  constructor(registry = new WorkerAssetRegistry()) {
    this.registry = registry;
  }

  model({ workers = [], phase = "queued", runId = "no active run", risk = "low", gateStatus = "pending" } = {}) {
    return workers.map((worker) =>
      new WorkerStation3D(worker, this.registry).model({
        phase,
        runId,
        risk: worker.risk || risk,
        gateStatus
      })
    );
  }
}

export class WorkerAvatarRuntime {
  constructor({ manifest } = {}) {
    this.registry = new WorkerAssetRegistry(manifest);
    this.motion = new WorkerMotionController();
  }

  station({ worker = {}, phase, runId, risk, gateStatus } = {}) {
    return new WorkerStation3D(worker, this.registry).model({ phase, runId, risk, gateStatus });
  }

  room(input = {}) {
    return new WorkerRoomScene(this.registry).model(input);
  }
}

export function webglFallbackModel({ workers = [], phase = "queued", runId = "no active run", reason = "" } = {}) {
  const runtime = new WorkerAvatarRuntime();
  return {
    available: false,
    reason: reason || "WebGL unavailable",
    workers: runtime.room({ workers, phase, runId })
  };
}
