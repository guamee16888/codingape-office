import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildBetaOpsDashboard,
  normalizeBetaTesterRun,
  parseCodeSigningIdentities
} from "../src/beta-ops-dashboard.mjs";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Beta Ops detects Developer ID and trusted notarized distribution", () => {
  const dashboard = buildBetaOpsDashboard({
    codeSigningIdentityOutput: '  1) ABCDEF1234567890ABCDEF1234567890ABCDEF12 "Developer ID Application: GeoAI Factory (TEAMID)"',
    distributionReport: {
      signing: { status: "signed" },
      notarization: { status: "notarized" },
      artifacts: { dmg: "dist/mac-distribution/CodingYuanOffice-0.5.0-beta-mac.dmg" }
    },
    testerRuns: [
      { testerId: "a", runbookStatus: "completed", firstOrderStatus: "passed", supportBundlePath: "a.json" },
      { testerId: "b", runbookStatus: "completed", firstOrderStatus: "passed", supportBundlePath: "b.json" },
      { testerId: "c", runbookStatus: "completed", firstOrderStatus: "passed", supportBundlePath: "c.json" }
    ]
  });

  assert.equal(dashboard.distribution.trusted, true);
  assert.equal(dashboard.cohort.testerCount, 3);
  assert.equal(dashboard.cohort.firstOrderSuccessRate, 100);
  assert.equal(dashboard.blockers.length, 0);
});

test("Beta Ops blocks when Developer ID, notarization, cohort, or first-order success are missing", () => {
  const dashboard = buildBetaOpsDashboard({
    codeSigningIdentityOutput: "     0 valid identities found",
    distributionReport: {
      signing: { status: "skipped" },
      notarization: { status: "skipped" }
    },
    testerRuns: [
      {
        testerId: "a",
        runbookStatus: "failed",
        installStatus: "failed",
        nodeStatus: "missing",
        portStatus: "conflict",
        firstOrderStatus: "failed",
        firstApplyStatus: "blocked"
      }
    ]
  });

  assert.equal(dashboard.status, "blocked");
  assert.ok(dashboard.blockers.some((blocker) => blocker.id === "developer_id_missing"));
  assert.ok(dashboard.blockers.some((blocker) => blocker.id === "notarization_missing"));
  assert.ok(dashboard.blockers.some((blocker) => blocker.id === "tester_cohort_small"));
  assert.ok(dashboard.blockers.some((blocker) => blocker.id === "first_order_success_low"));
  assert.equal(dashboard.failureMetrics.find((metric) => metric.id === "install_failed").count, 1);
  assert.equal(dashboard.failureMetrics.find((metric) => metric.id === "node_missing").count, 1);
  assert.equal(dashboard.failureMetrics.find((metric) => metric.id === "port_4142_busy").count, 1);
  assert.equal(dashboard.failureMetrics.find((metric) => metric.id === "first_apply_blocked").count, 1);
});

test("Beta tester run normalization derives failure tags from statuses", () => {
  const run = normalizeBetaTesterRun({
    tester_id: "tester-01",
    install_status: "gatekeeper_blocked",
    node_status: "not_found",
    port_status: "busy",
    first_apply_status: "stuck"
  });

  assert.deepEqual(run.failureTags.sort(), [
    "first_apply_blocked",
    "install_failed",
    "node_missing",
    "port_4142_busy"
  ]);
});

test("Beta Ops APIs, dashboard UI, and tester recording script are wired", async () => {
  const pkg = JSON.parse(await readProjectFile("package.json"));
  const server = await readProjectFile("server.js");
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");
  const script = await readProjectFile("scripts/record-beta-tester-run.sh");
  const model = await readProjectFile("src/beta-ops-dashboard.mjs");

  assert.equal(pkg.scripts["beta:record-tester"], "bash scripts/record-beta-tester-run.sh");
  assert.match(server, /import \{ buildBetaOpsDashboard \} from "\.\/src\/beta-ops-dashboard\.mjs"/);
  assert.match(server, /const BETA_TESTER_RUNS_FILE/);
  assert.match(server, /function handleBetaOps/);
  assert.match(server, /url\.pathname === "\/api\/beta-ops"/);
  assert.match(html, /class="beta-ops-panel"/);
  assert.match(app, /function renderBetaOpsPanel\(snapshot\)/);
  assert.match(app, /function betaOpsFailureTemplate\(metric = \{\}\)/);
  assert.match(css, /\.beta-ops-panel/);
  assert.match(model, /install_failed/);
  assert.match(script, /tester-runs\.jsonl/);
  assert.match(script, /FIRST_ORDER_STATUS/);
  assert.match(script, /FIRST_APPLY_STATUS/);
});

test("Code signing identity parser extracts Developer ID Application names", () => {
  const identities = parseCodeSigningIdentities(`
  1) ABCDEF1234567890ABCDEF1234567890ABCDEF12 "Apple Development: Test User"
  2) 1234567890ABCDEF1234567890ABCDEF12345678 "Developer ID Application: GeoAI Factory (TEAMID)"
     2 valid identities found
`);

  assert.equal(identities.length, 2);
  assert.equal(identities.filter((identity) => identity.isDeveloperIdApplication).length, 1);
});
