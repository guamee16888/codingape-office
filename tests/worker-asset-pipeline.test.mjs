import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("worker asset pipeline documents Stage-7 model, animation, and fallback rules", async () => {
  const doc = await readProjectFile("docs/3d/WORKER_ASSET_PIPELINE.md");
  const readme = await readProjectFile("public/assets/workers/README.md");

  assert.match(doc, /public\/assets\/workers\/manifest\.json/);
  assert.match(doc, /idle/);
  assert.match(doc, /running_command/);
  assert.match(doc, /waiting_approval/);
  assert.match(doc, /WebGL fails/);
  assert.match(doc, /No copied BAYC/);
  assert.match(readme, /coding-ape\.glb/);
  assert.match(readme, /procedural worker rig/);
});

test("worker asset manifest defines the three core workers and required animations", async () => {
  const manifest = JSON.parse(await readProjectFile("public/assets/workers/manifest.json"));
  const workerIds = manifest.workers.map((worker) => worker.id);

  assert.deepEqual(workerIds, ["coding-yuan", "judge-yuan", "ops-yuan"]);
  assert.equal(manifest.maxRecommendedModelSizeMb, 8);
  for (const worker of manifest.workers) {
    assert.ok(worker.fallbackAvatar);
    for (const animation of manifest.requiredAnimations) {
      assert.equal(worker.animations[animation], animation);
    }
  }
});

test("coding-ape.glb is a real GLB with semantic Stage-8 animation clips", async () => {
  const glb = await readFile(new URL("public/assets/workers/coding-ape.glb", root));
  assert.equal(glb.toString("utf8", 0, 4), "glTF");
  assert.equal(glb.readUInt32LE(4), 2);
  assert.ok(glb.length < 8 * 1024 * 1024);

  const jsonLength = glb.readUInt32LE(12);
  const jsonType = glb.readUInt32LE(16);
  assert.equal(jsonType, 0x4e4f534a);
  const gltf = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
  const clipNames = gltf.animations.map((animation) => animation.name);

  assert.match(gltf.asset.generator, /Stage-8 asset generator/);
  assert.deepEqual(clipNames, [
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
  assert.ok(gltf.nodes.some((node) => node.name === "Head"));
  assert.ok(gltf.nodes.some((node) => node.name === "ConsolePanel"));
});

test("Stage-8 recording and real office verification scripts are wired", async () => {
  const pkg = JSON.parse(await readProjectFile("package.json"));
  const docs = await readProjectFile("docs/3d/STAGE8_VISUAL_VERIFICATION.md");
  const officeVerifyScript = await readProjectFile("scripts/verify-stage8-office-state.mjs");

  assert.equal(pkg.scripts["assets:worker"], "node scripts/generate-coding-ape-glb.mjs");
  assert.equal(pkg.scripts["stage8:record-demo"], "node scripts/record-stage8-demo-video.mjs");
  assert.equal(pkg.scripts["stage8:verify-office"], "node scripts/verify-stage8-office-state.mjs");
  assert.match(docs, /latest-demo-summary\.json/);
  assert.match(docs, /latest-office-state-summary\.json/);
  assert.match(docs, /safe first-order loop/);
  assert.match(docs, /webglFallback: true/);
  assert.match(officeVerifyScript, /renderedTask/);
  assert.match(officeVerifyScript, /Chrome DevTools Protocol|DevTools/);
});
