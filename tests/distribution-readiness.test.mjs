import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Mac app build bundles the local office payload and writes user-safe runtime paths", async () => {
  const buildScript = await readProjectFile("scripts/build-mac-app.sh");
  const swift = await readProjectFile("mac-app/CodingYuanOffice.swift");

  assert.match(buildScript, /APP_PAYLOAD_DIR="\$RESOURCES_DIR\/app"/);
  assert.match(buildScript, /--exclude "data"/);
  assert.match(buildScript, /--exclude "tests"/);
  assert.match(buildScript, /--exclude "\.env"/);
  assert.match(buildScript, /--exclude "secrets"/);
  assert.match(buildScript, /--exclude "\*\*\/node_modules"/);
  assert.match(buildScript, /printf '%s\\n' "\$APP_PAYLOAD_DIR" > "\$RESOURCES_DIR\/repo-root\.txt"/);
  assert.match(buildScript, /CODEX_OFFICE_NODE_PATH_IN_APP/);
  assert.match(swift, /process\.currentDirectoryURL = URL\(fileURLWithPath: bundledResourceText\("repo-root"\)/);
  assert.match(swift, /CODEX_OFFICE_DATA_DIR/);
  assert.match(swift, /Application Support/);
  assert.match(swift, /CodingYuanOffice/);
  assert.match(swift, /service\.out\.log/);
  assert.match(swift, /service\.err\.log/);
});

test("distribution script creates zip and dmg with optional Developer ID notarization", async () => {
  const pkg = JSON.parse(await readProjectFile("package.json"));
  const script = await readProjectFile("scripts/build-mac-distribution.sh");

  assert.equal(pkg.scripts["build:mac-distribution"], "bash scripts/build-mac-distribution.sh");
  assert.match(script, /CODEX_OFFICE_DEVELOPER_ID_APPLICATION/);
  assert.match(script, /codesign --force --deep --options runtime --timestamp --sign/);
  assert.match(script, /notarytool submit "\$DMG_PATH" --wait/);
  assert.match(script, /stapler staple "\$DMG_PATH"/);
  assert.match(script, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(script, /hdiutil create -volname/);
  assert.match(script, /distribution-report\.json/);
  assert.match(script, /CODEX_OFFICE_REQUIRE_SIGNING/);
  assert.match(script, /CODEX_OFFICE_REQUIRE_NOTARIZATION/);
});

test("external tester runbook covers install, trust, logs, support, and the first order", async () => {
  const pkg = JSON.parse(await readProjectFile("package.json"));
  const runbook = await readProjectFile("docs/BETA_EXTERNAL_TESTER_RUNBOOK.md");

  assert.equal(pkg.scripts["beta:diagnostics"], "bash scripts/collect-beta-diagnostics.sh");
  assert.equal(pkg.scripts["beta:first-order"], "bash scripts/ten-minute-first-order-trial.sh");
  assert.match(runbook, /Developer ID/);
  assert.match(runbook, /公证/);
  assert.match(runbook, /CodingYuanOffice-0\.5\.0-beta-mac\.zip/);
  assert.match(runbook, /CodingYuanOffice-0\.5\.0-beta-mac\.dmg/);
  assert.match(runbook, /First Run Onboarding/);
  assert.match(runbook, /跑第一单/);
  assert.match(runbook, /Project Root Guard/);
  assert.match(runbook, /Human Gate/);
  assert.match(runbook, /Apply Gate/);
  assert.match(runbook, /~\/Library\/Logs\/CodingYuanOffice\/service\.out\.log/);
  assert.match(runbook, /~\/Library\/Logs\/DiagnosticReports\/CodingYuanOffice\*\.crash/);
  assert.match(runbook, /~\/Library\/Application Support\/CodingYuan Office\/data\/support-bundles/);
});

test("diagnostics and ten-minute trial scripts preserve human-gated apply", async () => {
  const diagnostics = await readProjectFile("scripts/collect-beta-diagnostics.sh");
  const firstOrder = await readProjectFile("scripts/ten-minute-first-order-trial.sh");

  assert.match(diagnostics, /\/api\/support-bundle/);
  assert.match(diagnostics, /x-codex-office-local: support-bundle/);
  assert.match(diagnostics, /service\.err\.log/);
  assert.match(diagnostics, /DiagnosticReports/);
  assert.match(firstOrder, /safeFirstOrder/);
  assert.match(firstOrder, /给 README 增加一个 Coding猿 Beta 测试段落/);
  assert.match(firstOrder, /\/api\/local-projects/);
  assert.match(firstOrder, /\/coding-loop/);
  assert.match(firstOrder, /Project files are still protected until you explicitly confirm Apply Approved Patch/);
});
