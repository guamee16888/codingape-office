import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("AppMode routes public home, public demo, and local office", async () => {
  const app = await readProjectFile("public/app.js");
  const server = await readProjectFile("server.js");

  assert.match(app, /publicHome:\s*"public_home"/);
  assert.match(app, /publicBeta:\s*"public_beta"/);
  assert.match(app, /publicDemo:\s*"public_demo"/);
  assert.match(app, /localOffice:\s*"local_office"/);
  assert.match(app, /if \(clean === "\/beta"\) return AppMode\.publicBeta/);
  assert.match(app, /if \(clean === "\/demo"\) return AppMode\.publicDemo/);
  assert.match(app, /if \(clean === "\/office"\) return AppMode\.localOffice/);
  assert.match(server, /const ENTRY_ROUTES = new Set\(\["\/", "\/beta", "\/beta\/", "\/demo", "\/demo\/", "\/office", "\/office\/"\]\)/);
  assert.match(server, /function entryHtmlForPath\(pathname = "\/"\)/);
  assert.match(server, /stripHtmlRegion\(html, "app-shell"\)/);
});

test("public beta page explains download, safety, limits, support, and demo", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(html, /id="betaPage"/);
  assert.match(html, /Mac Beta Download And First Test/);
  assert.match(html, /Safety Promise/);
  assert.match(html, /Beta Limits/);
  assert.match(html, /Support And Feedback/);
  assert.match(html, /3-minute Demo/);
  assert.match(app, /function renderPublicBeta\(\)/);
  assert.match(app, /if \(APP_MODE === AppMode\.publicBeta\)[\s\S]*?renderPublicBeta\(\);[\s\S]*?return;/);
  assert.match(css, /body\[data-app-mode="public_beta"\] \.app-shell/);
});

test("public home is a beta landing page instead of an empty console", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(html, /Your local AI coding worker for Mac\. Evidence first, diff second, writes only after approval\./);
  assert.match(html, /Join Mac Beta/);
  assert.match(html, /Watch Demo/);
  assert.match(app, /if \(APP_MODE === AppMode\.publicHome\)[\s\S]*?renderPublicHome\(\);[\s\S]*?return;/);
  assert.match(css, /html\[data-app-mode="public_home"\] \.app-shell/);
});

test("public demo uses seeded Demo Data without starting the local office connection", async () => {
  const app = await readProjectFile("public/app.js");
  const html = await readProjectFile("public/index.html");

  assert.match(app, /function seededDemoSnapshot\(stepIndex = DEMO_REPLAY_STEPS\.length - 1\)/);
  assert.match(html, /id="demoReplayPauseButton"/);
  assert.match(html, /id="demoReplayRestartButton"/);
  assert.match(app, /const DEMO_REPLAY_STEPS = Object\.freeze/);
  assert.match(app, /function scheduleDemoReplay\(\)/);
  assert.match(app, /Demo Data · Evidence Pack/);
  assert.match(app, /Demo Data · Verification/);
  assert.match(app, /Demo Data · Human Gate/);
  assert.match(app, /Demo Data · Diff Preview/);
  assert.match(app, /Demo Data · Apply Gate/);
  assert.match(app, /Demo Data · Company Report/);
  assert.match(app, /if \(APP_MODE === AppMode\.publicDemo\)[\s\S]*?renderPublicDemo\(\);[\s\S]*?return;/);
  assert.match(app, /attachLocalOfficeHandlers\(\);[\s\S]*?await fetchStatus\(\);[\s\S]*?connectEvents\(\);/);
});

test("local office exposes project root selector and explicit apply controls", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");

  assert.match(html, /projectRootForm/);
  assert.match(html, /Project root/);
  assert.match(html, /chooseProjectFolderButton/);
  assert.match(app, /chooseProjectFolderWithMacAppBridge/);
  assert.match(app, /__codingYuanNativeFolderPickerResult/);
  assert.match(app, /securityScopedBookmark/);
  assert.match(app, /\/api\/native\/folder-picker/);
  assert.match(app, /X-Codex-Office-Local/);
  assert.match(app, /showDirectoryPicker/);
  assert.match(app, /\/api\/local-projects/);
  assert.match(app, /data-apply-local-write-switch/);
  assert.match(app, /data-apply-confirmation/);
  assert.match(app, /Company Report/);
});
