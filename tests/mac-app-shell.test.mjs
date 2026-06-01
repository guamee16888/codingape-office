import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Mac app shell builds a minimal installable development app", async () => {
  const pkg = JSON.parse(await readProjectFile("package.json"));
  const script = await readProjectFile("scripts/build-mac-app.sh");
  const swift = await readProjectFile("mac-app/CodingYuanOffice.swift");

  assert.equal(pkg.scripts["build:mac-app"], "bash scripts/build-mac-app.sh");
  assert.match(script, /APP_NAME="Coding猿 Office"/);
  assert.match(script, /APP_DIR="\$ROOT_DIR\/dist\/mac\/\$APP_NAME\.app"/);
  assert.match(script, /swiftc/);
  assert.match(script, /repo-root\.txt/);
  assert.match(script, /node-path\.txt/);
  assert.match(script, /Info\.plist/);
  assert.match(swift, /WKWebView/);
  assert.match(swift, /server\.js/);
  assert.ok(swift.includes(String.raw`URL(string: "http://127.0.0.1:\(port)/office")`));
  assert.match(swift, /process\.terminate\(\)/);
  assert.match(swift, /portOwnerDescription\(\)/);
  assert.match(swift, /4142 端口被占用/);
  assert.match(swift, /Node\.js 未找到/);
  assert.match(swift, /renderStartupFailurePage\(\)/);
  assert.match(swift, /WKScriptMessageHandler/);
  assert.match(swift, /codingYuanOffice/);
  assert.match(swift, /NSOpenPanel/);
  assert.match(swift, /withSecurityScope/);
  assert.match(swift, /securityScopedBookmark/);
  assert.match(swift, /restoreSecurityScopedProjectBookmarks\(\)/);
});

test("inspector close button is wired for demo and local office modes", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /function attachInspectorShellHandlers\(\)/);
  assert.match(app, /closeInspectorButton\?\.addEventListener\("click"/);
  assert.match(app, /if \(event\.key === "Escape" && state\.inspectorOpen\) closeInspectorPanel\(\)/);
  assert.match(app, /if \(APP_MODE === AppMode\.publicDemo\)[\s\S]*?renderPublicDemo\(\);[\s\S]*?attachInspectorShellHandlers\(\);[\s\S]*?return;/);
  assert.match(app, /function attachLocalOfficeHandlers\(\)[\s\S]*?attachInspectorShellHandlers\(\);/);
});

test("WebGL deck failure does not abort office shell controls", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /if \(threeDeck\.renderer \|\| threeDeck\.disabled \|\| !elements\.threeDeck\) return;/);
  assert.match(app, /try \{[\s\S]*?threeDeck\.renderer = new THREE\.WebGLRenderer/);
  assert.match(app, /catch \(error\) \{[\s\S]*?threeDeck\.disabled = true;[\s\S]*?return;[\s\S]*?\}/);
  assert.match(app, /function renderWorkerRoomFallback\(snapshot, selectedProject, reason = ""\)/);
  assert.match(app, /webglFallbackModel\(/);
});
