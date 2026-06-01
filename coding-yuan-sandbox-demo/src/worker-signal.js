export const sandboxSignal = {
  worker: "coding-yuan",
  mode: "controlled-sandbox",
  status: "ready",
  evidence: ["verification", "human-gate", "rollback-snapshot"]
};

export function summarizeSandboxSignal() {
  return `${sandboxSignal.worker}:${sandboxSignal.status}:${sandboxSignal.evidence.length}`;
}
