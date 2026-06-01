export const SANDBOX_DEMO_PROJECT_ID = "coding-yuan-sandbox-demo";
export const SANDBOX_DEMO_PATCH_FILE = "src/worker-signal.js";

export function defaultSandboxDemoDraft() {
  return {
    file: SANDBOX_DEMO_PATCH_FILE,
    content: `export const sandboxSignal = {
  worker: "coding-yuan",
  mode: "controlled-sandbox",
  status: "diff-ready",
  evidence: ["verification", "human-gate", "rollback-snapshot", "diff-preview", "apply-gate"],
  patchPack: "sandbox-review-bundle"
};

export function summarizeSandboxSignal() {
  return \`\${sandboxSignal.worker}:\${sandboxSignal.status}:\${sandboxSignal.evidence.length}:\${sandboxSignal.patchPack}\`;
}
`
  };
}

export function codingLoopDemoProfile(project, body = {}) {
  const isSandboxDemo = project?.id === SANDBOX_DEMO_PROJECT_ID;
  const patchCandidates = Array.isArray(body.patchCandidates) && body.patchCandidates.length
    ? body.patchCandidates
    : isSandboxDemo
      ? [SANDBOX_DEMO_PATCH_FILE]
      : body.patchCandidates;
  const patchDrafts = Array.isArray(body.patchDrafts) && body.patchDrafts.length
    ? body.patchDrafts
    : isSandboxDemo
      ? [defaultSandboxDemoDraft()]
      : body.patchDrafts;

  return {
    autoCloseLoop: isSandboxDemo && body.autoCloseLoop !== false,
    patchCandidates,
    patchDrafts
  };
}

export function sandboxPatchRunnerEnv(env = process.env) {
  return {
    ...env,
    CODEX_OFFICE_ENABLE_WRITE_RUNNER: "true",
    CODEX_OFFICE_PATCH_RUNNER_MODE: "sandbox"
  };
}

export function sandboxApplyGateEnv(env = process.env) {
  return {
    ...env,
    CODEX_OFFICE_ENABLE_APPLY_RUNNER: "false"
  };
}
