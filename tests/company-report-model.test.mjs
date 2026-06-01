import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCompanyShareCard,
  companyMetricValue,
  companyReportBullets,
  companyReportMetrics,
  companyReportShareLine,
  latestLoopEvidenceChain
} from "../public/company-report-model.js";

const report = {
  headline: "Your AI worker office completed 8 tasks with traceable evidence.",
  metrics: [
    { label: "tasks done", value: 8 },
    { label: "evidence packs", value: 8 },
    { label: "verified", value: 6 },
    { label: "patch runs", value: 3 },
    { label: "apply gates", value: 1 },
    { label: "risks gated", value: 10 },
    { label: "hours saved", value: 11.4 }
  ],
  shareLine: "My AI worker office completed 8 tasks today."
};

const reportWithLatestLoop = {
  ...report,
  latestLoop: {
    applyStatus: "requires_confirmation",
    checks: 4,
    evidenceCapturedAt: "2026-05-26T10:00:00.000Z",
    patchRunStatus: "sandbox_written",
    proposalCreatedAt: "2026-05-26T10:01:00.000Z",
    taskId: "task_latest",
    title: "Full-loop check: generate report card without auto-writing project files",
    verificationStatus: "passed"
  },
  shareLine: "Latest loop generated a sandbox patch; Apply Gate needs confirmation, and project files were not auto-modified."
};

test("companyMetricValue reads metric labels case-insensitively", () => {
  assert.equal(companyMetricValue(report, ["tasks done"]), 8);
  assert.equal(companyMetricValue(report, ["hours saved"]), 11.4);
  assert.equal(companyMetricValue(report, ["missing"], "fallback"), "fallback");
});

test("companyReportMetrics normalizes share-card metrics", () => {
  const metrics = companyReportMetrics(report);

  assert.equal(metrics.tasksDone, 8);
  assert.equal(metrics.evidencePacks, 8);
  assert.equal(metrics.verified, 6);
  assert.equal(metrics.patchRuns, 3);
  assert.equal(metrics.applyGates, 1);
  assert.equal(metrics.risksGated, 10);
  assert.equal(metrics.hoursSaved, "11.4h");
});

test("companyReportBullets keeps safety as a first-class report line", () => {
  assert.ok(companyReportBullets(report).some((line) => /Human Gate/.test(line)));
  assert.ok(companyReportBullets(report).some((line) => /No high-risk write bypassed the Human Gate/.test(line)));
});

test("companyReportShareLine creates a screenshot-ready English sentence", () => {
  const line = companyReportShareLine({ metrics: report.metrics });

  assert.match(line, /completed 8 tasks today/);
  assert.match(line, /saved 11\.4h/);
  assert.match(line, /blocked 10 risks/);
});

test("buildCompanyShareCard preserves shareLine and headline", () => {
  const card = buildCompanyShareCard(report);

  assert.equal(card.headline, report.headline);
  assert.equal(card.shareLine, report.shareLine);
  assert.equal(card.safetyStamp, "No write bypassed the Human Gate");
  assert.match(card.shareText, /Your AI worker office completed 8 tasks/);
  assert.match(card.shareText, /No write bypassed the Human Gate/);
  assert.match(card.shareText, /No high-risk write bypassed the Human Gate/);
  assert.equal(card.metrics.tasksDone, 8);
});

test("company report share card includes latest real loop details", () => {
  const bullets = companyReportBullets(reportWithLatestLoop);
  const card = buildCompanyShareCard(reportWithLatestLoop);

  assert.ok(bullets.some((line) => /Latest loop/.test(line)));
  assert.ok(bullets.some((line) => /Sandbox patch generated/.test(line)));
  assert.ok(bullets.some((line) => /Apply Gate is holding/.test(line)));
  assert.match(card.shareText, /Latest loop generated a sandbox patch/);
  assert.match(card.shareText, /project files were not auto-modified/);
  assert.equal(card.evidenceChain.length, 6);
  assert.deepEqual(card.evidenceChain.map((item) => item.label), ["Evidence", "Proposal", "Verification", "Sandbox Patch", "Apply Gate", "Project Files"]);
  assert.ok(card.evidenceChain.some((item) => item.value === "Needs human confirmation"));
  assert.ok(card.evidenceChain.some((item) => item.value === "Not auto-modified"));
  assert.match(card.shareText, /Evidence：4 checks/);
  assert.match(card.shareText, /Apply Gate：Needs human confirmation/);
  assert.match(card.shareText, /Project Files：Not auto-modified/);
});

test("latestLoopEvidenceChain converts internal statuses into English evidence steps", () => {
  const chain = latestLoopEvidenceChain(reportWithLatestLoop);

  assert.equal(chain.find((item) => item.label === "Verification")?.value, "Verification passed");
  assert.equal(chain.find((item) => item.label === "Sandbox Patch")?.value, "Sandbox patch generated");
  assert.equal(chain.find((item) => item.label === "Apply Gate")?.value, "Needs human confirmation");
  assert.equal(chain.find((item) => item.label === "Project Files")?.status, "safe");
  assert.equal(latestLoopEvidenceChain({}).length, 0);
});
