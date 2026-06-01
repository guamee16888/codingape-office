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
  headline: "你的 AI 打工公司已完成 8 个任务，并留下可追溯证据。",
  metrics: [
    { label: "任务完成", value: 8 },
    { label: "证据包", value: 8 },
    { label: "验证通过", value: 6 },
    { label: "补丁预检", value: 3 },
    { label: "写入闸门", value: 1 },
    { label: "风险阻断", value: 10 },
    { label: "节省时间", value: 11.4 }
  ],
  shareLine: "今天我的 AI 打工公司完成了 8 个任务。"
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
    title: "完整闭环验证：生成战报卡但不自动写项目",
    verificationStatus: "passed"
  },
  shareLine: "最新闭环已生成沙盒补丁，写入闸门需要确认，项目文件未被自动修改。"
};

test("companyMetricValue reads metric labels case-insensitively", () => {
  assert.equal(companyMetricValue(report, ["任务完成"]), 8);
  assert.equal(companyMetricValue(report, ["节省时间"]), 11.4);
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
  assert.ok(companyReportBullets(report).some((line) => /人工闸门/.test(line)));
  assert.ok(companyReportBullets(report).some((line) => /没有任何高风险写入绕过人工闸门/.test(line)));
});

test("companyReportShareLine creates a screenshot-ready Chinese sentence", () => {
  const line = companyReportShareLine({ metrics: report.metrics });

  assert.match(line, /今天我的 AI 打工公司完成了 8 个任务/);
  assert.match(line, /省了 11\.4h/);
  assert.match(line, /阻断了 10 次风险/);
});

test("buildCompanyShareCard preserves shareLine and headline", () => {
  const card = buildCompanyShareCard(report);

  assert.equal(card.headline, report.headline);
  assert.equal(card.shareLine, report.shareLine);
  assert.equal(card.safetyStamp, "没有写入绕过人工闸门");
  assert.match(card.shareText, /你的 AI 打工公司已完成 8 个任务/);
  assert.match(card.shareText, /没有写入绕过人工闸门/);
  assert.match(card.shareText, /没有任何高风险写入绕过人工闸门/);
  assert.equal(card.metrics.tasksDone, 8);
});

test("company report share card includes latest real loop details", () => {
  const bullets = companyReportBullets(reportWithLatestLoop);
  const card = buildCompanyShareCard(reportWithLatestLoop);

  assert.ok(bullets.some((line) => /最新闭环/.test(line)));
  assert.ok(bullets.some((line) => /沙盒补丁已生成/.test(line)));
  assert.ok(bullets.some((line) => /写入闸门已拦住/.test(line)));
  assert.match(card.shareText, /最新闭环已生成沙盒补丁/);
  assert.match(card.shareText, /项目文件未被自动修改/);
  assert.equal(card.evidenceChain.length, 6);
  assert.deepEqual(card.evidenceChain.map((item) => item.label), ["证据", "方案", "验证", "沙盒补丁", "写入闸门", "项目文件"]);
  assert.ok(card.evidenceChain.some((item) => item.value === "需要人工确认"));
  assert.ok(card.evidenceChain.some((item) => item.value === "未被自动修改"));
  assert.match(card.shareText, /证据：4 条检查/);
  assert.match(card.shareText, /写入闸门：需要人工确认/);
  assert.match(card.shareText, /项目文件：未被自动修改/);
});

test("latestLoopEvidenceChain converts internal statuses into Chinese evidence steps", () => {
  const chain = latestLoopEvidenceChain(reportWithLatestLoop);

  assert.equal(chain.find((item) => item.label === "验证")?.value, "验证通过");
  assert.equal(chain.find((item) => item.label === "沙盒补丁")?.value, "沙盒补丁已生成");
  assert.equal(chain.find((item) => item.label === "写入闸门")?.value, "需要人工确认");
  assert.equal(chain.find((item) => item.label === "项目文件")?.status, "safe");
  assert.equal(latestLoopEvidenceChain({}).length, 0);
});
