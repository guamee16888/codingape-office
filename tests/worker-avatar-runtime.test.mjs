import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WorkerAssetRegistry,
  WorkerAvatarRuntime,
  webglFallbackModel,
  workerAnimationForState,
  workerLightForState,
  workerStateForRunPhase
} from "../public/worker-avatar-runtime.js";

test("workerStateForRunPhase maps real run phases into Stage-7 worker states", () => {
  assert.equal(workerStateForRunPhase("evidence_collecting", "coding-yuan"), "generating_evidence");
  assert.equal(workerStateForRunPhase("proposal_generating", "coding-yuan"), "generating_patch");
  assert.equal(workerStateForRunPhase("verification_running", "judge-yuan"), "verifying");
  assert.equal(workerStateForRunPhase("judge_review", "judge-yuan"), "reviewing");
  assert.equal(workerStateForRunPhase("human_gate", "judge-yuan"), "waiting_approval");
  assert.equal(workerStateForRunPhase("patch_running", "coding-yuan"), "running_command");
  assert.equal(workerStateForRunPhase("apply_blocked", "ops-yuan"), "blocked");
  assert.equal(workerStateForRunPhase("completed", "coding-yuan"), "reporting");
});

test("worker lights follow product safety semantics", () => {
  assert.equal(workerLightForState("working").key, "cyan");
  assert.equal(workerLightForState("verifying").key, "cyan");
  assert.equal(workerLightForState("waiting_approval").key, "amber");
  assert.equal(workerLightForState("blocked").key, "red");
  assert.equal(workerLightForState("failed").key, "red");
  assert.equal(workerLightForState("completed").key, "green");
  assert.equal(workerLightForState("reporting").key, "green");
});

test("animation fallback uses required asset animation names", () => {
  assert.equal(workerAnimationForState("generating_evidence"), "working");
  assert.equal(workerAnimationForState("generating_patch"), "working");
  assert.equal(workerAnimationForState("verifying"), "reviewing");
  assert.equal(workerAnimationForState("failed"), "blocked");
});

test("WorkerAssetRegistry prefers coding-ape.glb when it exists later", () => {
  const registry = new WorkerAssetRegistry({
    workers: [
      {
        id: "coding-yuan",
        model: "/assets/workers/other.glb",
        fallbackAvatar: "猿"
      }
    ]
  });

  assert.deepEqual(registry.modelCandidatesFor("coding-yuan"), [
    "/assets/workers/coding-ape.glb",
    "/assets/workers/other.glb"
  ]);
});

test("WorkerAvatarRuntime and WebGL fallback expose usable station models", () => {
  const runtime = new WorkerAvatarRuntime();
  const station = runtime.station({
    worker: { id: "ops-yuan", mark: "运", risk: "medium" },
    phase: "apply_blocked",
    runId: "task_1",
    gateStatus: "requires_confirmation"
  });

  assert.equal(station.state, "blocked");
  assert.equal(station.light.key, "red");
  assert.equal(station.runId, "task_1");

  const fallback = webglFallbackModel({
    workers: [{ id: "coding-yuan", mark: "猿" }],
    phase: "proposal_generating",
    runId: "task_2",
    reason: "WebGL unavailable"
  });

  assert.equal(fallback.available, false);
  assert.equal(fallback.reason, "WebGL unavailable");
  assert.equal(fallback.workers[0].state, "generating_patch");
});
