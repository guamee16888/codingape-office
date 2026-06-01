import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Mac App Store build pipeline is separate from Developer ID distribution", async () => {
  const pkg = JSON.parse(await readProjectFile("package.json"));
  const masScript = await readProjectFile("scripts/build-mac-app-store.sh");
  const developerIdScript = await readProjectFile("scripts/build-mac-distribution.sh");

  assert.equal(pkg.scripts["build:mac-app-store"], "bash scripts/build-mac-app-store.sh");
  assert.equal(pkg.scripts["prepare:mas-runtime"], "bash scripts/prepare-mas-runtime.sh");
  assert.equal(pkg.scripts["build:mac-distribution"], "bash scripts/build-mac-distribution.sh");
  assert.match(masScript, /Mac App Store/);
  assert.match(masScript, /CODEX_OFFICE_MAS_BUNDLE_ID/);
  assert.match(masScript, /CODEX_OFFICE_MAS_PROVISIONING_PROFILE/);
  assert.match(masScript, /CODEX_OFFICE_MAS_RUNTIME_DIR/);
  assert.match(masScript, /mas-runtime-manifest\.json/);
  assert.match(masScript, /TeamIdentifier\.0/);
  assert.match(masScript, /DeveloperCertificates/);
  assert.match(masScript, /application-identifier/);
  assert.match(masScript, /profile does not include the selected app signing certificate/);
  assert.match(masScript, /Apple Distribution \/ Mac App Distribution/);
  assert.match(masScript, /Mac Installer Distribution/);
  assert.match(masScript, /productbuild --component/);
  assert.match(masScript, /mac-app-store-report\.json/);
  assert.doesNotMatch(masScript, /notarytool submit/);
  assert.doesNotMatch(developerIdScript, /CODEX_OFFICE_MAS_BUNDLE_ID/);
});

test("Mac App Store entitlements declare sandbox, selected-folder access, bookmarks, and local networking", async () => {
  const entitlements = await readProjectFile("entitlements/CodingYuanOffice.mas.entitlements");
  const inherited = await readProjectFile("entitlements/CodingYuanOffice.mas.inherit.entitlements");

  assert.match(entitlements, /com\.apple\.security\.app-sandbox/);
  assert.match(entitlements, /com\.apple\.security\.files\.user-selected\.read-write/);
  assert.match(entitlements, /com\.apple\.security\.files\.bookmarks\.app-scope/);
  assert.match(entitlements, /com\.apple\.security\.network\.client/);
  assert.match(entitlements, /com\.apple\.security\.network\.server/);
  assert.match(inherited, /com\.apple\.security\.app-sandbox/);
  assert.match(inherited, /com\.apple\.security\.inherit/);
});

test("MAS runtime preparation stages a manifest-backed runtime bundle", async () => {
  const script = await readProjectFile("scripts/prepare-mas-runtime.sh");

  assert.match(script, /CODEX_OFFICE_MAS_SOURCE_NODE/);
  assert.match(script, /dist\/mas-runtime\/node-runtime/);
  assert.match(script, /otool -L/);
  assert.match(script, /install_name_tool -change/);
  assert.match(script, /codesign --force --sign -/);
  assert.match(script, /mas-runtime-manifest\.json/);
  assert.match(script, /coding-yuan-mas-runtime-v1/);
});

test("MAS blockers document signing, provisioning, runtime, and security-scoped access gaps", async () => {
  const blockers = await readProjectFile("MAS_BLOCKERS.md");

  assert.match(blockers, /Apple Distribution signing identity missing/);
  assert.match(blockers, /Mac Installer Distribution signing identity missing/);
  assert.match(blockers, /Mac App Store provisioning profile missing/);
  assert.match(blockers, /MAS runtime bundle prepared/);
  assert.match(blockers, /npm run prepare:mas-runtime/);
  assert.match(blockers, /security-scoped bookmark/);
  assert.match(blockers, /Project Root Guard/);
  assert.match(blockers, /Human Gate/);
});

test("App Store review materials cover privacy, sandbox access, screenshots, support, and tester records", async () => {
  const pkg = JSON.parse(await readProjectFile("package.json"));
  const checklist = await readProjectFile("docs/app-store/APP_STORE_SUBMISSION_CHECKLIST.md");
  const reviewNotes = await readProjectFile("docs/app-store/REVIEW_NOTES.md");
  const privacy = await readProjectFile("docs/app-store/PRIVACY_DATA_FLOW.md");
  const sandbox = await readProjectFile("docs/app-store/SANDBOX_FILE_ACCESS.md");
  const support = await readProjectFile("docs/app-store/SUPPORT_AND_DIAGNOSTICS.md");
  const screenshots = await readProjectFile("docs/app-store/SCREENSHOT_PLAN.md");
  const screenshotScript = await readProjectFile("scripts/capture-app-store-screenshots.mjs");
  const testflight = await readProjectFile("docs/app-store/TESTFLIGHT_RUNBOOK.md");
  const testerRecord = await readProjectFile("docs/app-store/TESTER_RESULT_RECORD.md");

  assert.equal(pkg.scripts["stage9:capture-app-store-screenshots"], "node scripts/capture-app-store-screenshots.mjs");
  assert.match(checklist, /App Store Connect app record/);
  assert.match(checklist, /Transporter/);
  assert.match(checklist, /npm run prepare:mas-runtime/);
  assert.match(reviewNotes, /local AI coding worker/);
  assert.match(reviewNotes, /does not default-scan/);
  assert.match(reviewNotes, /Human Gate/);
  assert.match(reviewNotes, /Support bundles/);
  assert.match(privacy, /must not be uploaded to third parties/);
  assert.match(privacy, /API keys/);
  assert.match(sandbox, /user-selected\.read-write/);
  assert.match(sandbox, /security-scoped bookmark/);
  assert.match(support, /raw environment variables containing secrets/);
  assert.match(screenshots, /Evidence Pack/);
  assert.match(screenshots, /stage9:capture-app-store-screenshots/);
  assert.match(screenshotScript, /Demo Data/);
  assert.match(screenshotScript, /data\/app-store-screenshots/);
  assert.match(screenshotScript, /demoStep=9&recording=1/);
  assert.match(testflight, /Install succeeds/);
  assert.match(testflight, /support bundle/i);
  assert.match(testerRecord, /Do not fabricate tester results/);
  assert.match(testerRecord, /"testerId"/);
});
