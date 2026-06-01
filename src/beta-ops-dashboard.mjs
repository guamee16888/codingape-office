const FAILURE_CATEGORIES = [
  {
    id: "install_failed",
    label: "安装失败",
    description: "DMG/zip 打开、拖入 Applications 或 Gatekeeper 失败。",
    severity: "high"
  },
  {
    id: "node_missing",
    label: "Node 缺失",
    description: "测试机无法找到 Node.js 或 npm。",
    severity: "high"
  },
  {
    id: "port_4142_busy",
    label: "4142 端口冲突",
    description: "本地服务端口被其他进程占用。",
    severity: "medium"
  },
  {
    id: "first_apply_blocked",
    label: "第一次 Apply 卡点",
    description: "第一次 Apply 被确认语、写入开关、回滚或 Project Root Guard 阻断。",
    severity: "medium"
  }
];

function normalizeStatus(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function statusIn(value, matches) {
  return matches.includes(normalizeStatus(value));
}

function percent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((Number(numerator || 0) / Number(denominator || 1)) * 100);
}

export function parseCodeSigningIdentities(output = "") {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\) [A-F0-9]{40} "/.test(line))
    .map((line) => {
      const match = line.match(/"([^"]+)"/);
      return {
        raw: line,
        name: match?.[1] || line,
        isDeveloperIdApplication: /Developer ID Application/i.test(match?.[1] || line)
      };
    });
}

export function normalizeBetaTesterRun(record = {}, index = 0) {
  const testerId = String(record.testerId || record.tester_id || record.id || `tester-${index + 1}`).trim();
  const explicitFailureTags = Array.isArray(record.failureTags)
    ? record.failureTags
    : String(record.failureTags || record.failure_tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  const installStatus = normalizeStatus(record.installStatus || record.install_status || "unknown");
  const nodeStatus = normalizeStatus(record.nodeStatus || record.node_status || "unknown");
  const portStatus = normalizeStatus(record.portStatus || record.port_status || "unknown");
  const firstOrderStatus = normalizeStatus(record.firstOrderStatus || record.first_order_status || "not_run");
  const firstApplyStatus = normalizeStatus(record.firstApplyStatus || record.first_apply_status || "not_attempted");
  const failureTags = new Set(explicitFailureTags.map(normalizeStatus));

  if (statusIn(installStatus, ["failed", "blocked", "gatekeeper_blocked", "install_failed"])) {
    failureTags.add("install_failed");
  }
  if (statusIn(nodeStatus, ["missing", "failed", "not_found", "node_missing"])) {
    failureTags.add("node_missing");
  }
  if (statusIn(portStatus, ["busy", "conflict", "blocked", "port_4142_busy"])) {
    failureTags.add("port_4142_busy");
  }
  if (statusIn(firstApplyStatus, ["blocked", "failed", "stuck", "first_apply_blocked"])) {
    failureTags.add("first_apply_blocked");
  }

  return {
    id: String(record.id || `${testerId}-${record.recordedAt || record.completedAt || index}`).replace(/\s+/g, "-"),
    testerId,
    testerName: String(record.testerName || record.tester_name || ""),
    channel: String(record.channel || "external_beta"),
    recordedAt: record.recordedAt || record.recorded_at || record.completedAt || record.generatedAt || new Date(0).toISOString(),
    runbookStatus: normalizeStatus(record.runbookStatus || record.runbook_status || "unknown"),
    installStatus,
    nodeStatus,
    portStatus,
    firstOrderStatus,
    firstApplyStatus,
    supportBundlePath: String(record.supportBundlePath || record.support_bundle_path || ""),
    notes: String(record.notes || ""),
    failureTags: [...failureTags].filter(Boolean)
  };
}

export function buildBetaOpsDashboard({
  distributionReport = null,
  codeSigningIdentityOutput = "",
  testerRuns = [],
  supportBundles = [],
  targetTesterMin = 3,
  targetTesterMax = 5
} = {}) {
  const identities = parseCodeSigningIdentities(codeSigningIdentityOutput);
  const hasDeveloperId = identities.some((identity) => identity.isDeveloperIdApplication);
  const normalizedRuns = testerRuns.map(normalizeBetaTesterRun);
  const uniqueTesterIds = [...new Set(normalizedRuns.map((run) => run.testerId).filter(Boolean))];
  const completedRunbookCount = normalizedRuns.filter((run) => statusIn(run.runbookStatus, ["completed", "passed", "success"])).length;
  const firstOrderAttempts = normalizedRuns.filter((run) => !statusIn(run.firstOrderStatus, ["", "not_run", "unknown"])).length;
  const firstOrderSuccesses = normalizedRuns.filter((run) => statusIn(run.firstOrderStatus, ["passed", "completed", "success"])).length;
  const firstApplyAttempts = normalizedRuns.filter((run) => !statusIn(run.firstApplyStatus, ["", "not_attempted", "not_run", "unknown"])).length;
  const firstApplyBlocked = normalizedRuns.filter((run) => run.failureTags.includes("first_apply_blocked")).length;
  const testerBundleCount = new Set(normalizedRuns.map((run) => run.supportBundlePath).filter(Boolean)).size;
  const supportBundleCount = Math.max(testerBundleCount, supportBundles.length);
  const firstOrderSuccessRate = percent(firstOrderSuccesses, firstOrderAttempts);
  const signingStatus = normalizeStatus(distributionReport?.signing?.status || "missing_report");
  const notarizationStatus = normalizeStatus(distributionReport?.notarization?.status || "missing_report");
  const trustedDistribution = hasDeveloperId && signingStatus === "signed" && notarizationStatus === "notarized";
  const failureMetrics = FAILURE_CATEGORIES.map((category) => ({
    ...category,
    count: normalizedRuns.filter((run) => run.failureTags.includes(category.id)).length
  }));
  const blockers = [];
  const nextActions = [];

  if (!hasDeveloperId) {
    blockers.push({
      id: "developer_id_missing",
      title: "Developer ID 证书缺失",
      detail: "当前机器没有 Developer ID Application codesigning identity。"
    });
    nextActions.push({
      title: "配置 Developer ID",
      detail: "在 Apple Developer 账号创建 Developer ID Application 证书，导入 Keychain 后重新运行 npm run build:mac-distribution。"
    });
  }
  if (signingStatus !== "signed" || notarizationStatus !== "notarized") {
    blockers.push({
      id: "notarization_missing",
      title: "尚未完成真实签名公证",
      detail: `signing=${signingStatus}; notarization=${notarizationStatus}`
    });
    nextActions.push({
      title: "完成一次真实公证",
      detail: "配置 CODEX_OFFICE_DEVELOPER_ID_APPLICATION 和 CODEX_OFFICE_NOTARY_PROFILE，要求 signing=signed 且 notarization=notarized。"
    });
  }
  if (uniqueTesterIds.length < targetTesterMin) {
    blockers.push({
      id: "tester_cohort_small",
      title: "外测人数不足",
      detail: `已记录 ${uniqueTesterIds.length}/${targetTesterMin} 位测试者。`
    });
    nextActions.push({
      title: "补齐 3-5 位陌生测试者",
      detail: "让每位测试者按 runbook 完成安装、首次启动、跑第一单，并提交支持包。"
    });
  }
  if (firstOrderAttempts > 0 && firstOrderSuccessRate < 80) {
    blockers.push({
      id: "first_order_success_low",
      title: "第一单成功率不足",
      detail: `first-order 成功率 ${firstOrderSuccessRate}%（目标 >= 80%）。`
    });
  }
  if (supportBundleCount < Math.min(uniqueTesterIds.length, targetTesterMin)) {
    nextActions.push({
      title: "收集支持包",
      detail: `已收集 ${supportBundleCount} 份，目标至少 ${Math.min(uniqueTesterIds.length || targetTesterMin, targetTesterMin)} 份。`
    });
  }
  if (firstApplyBlocked > 0) {
    nextActions.push({
      title: "定位第一次 Apply 卡点",
      detail: `${firstApplyBlocked} 位测试者在第一次 Apply 遇到阻断，优先检查确认语、写入开关、rollback 和 Project Root Guard 文案。`
    });
  }

  const status = blockers.length
    ? "blocked"
    : uniqueTesterIds.length < targetTesterMax
      ? "collecting"
      : "ready";

  return {
    generatedAt: new Date().toISOString(),
    status,
    statusLabel: status === "ready" ? "外测可扩量" : status === "collecting" ? "外测收集中" : "外测阻断",
    summary: trustedDistribution
      ? `已完成可信分发；外测 ${uniqueTesterIds.length}/${targetTesterMin}-${targetTesterMax}，第一单成功率 ${firstOrderSuccessRate}%。`
      : `可信分发未完成；外测 ${uniqueTesterIds.length}/${targetTesterMin}-${targetTesterMax}，第一单成功率 ${firstOrderSuccessRate}%。`,
    targetTesterMin,
    targetTesterMax,
    distribution: {
      trusted: trustedDistribution,
      signingStatus,
      notarizationStatus,
      developerIdReady: hasDeveloperId,
      developerIdIdentities: identities.filter((identity) => identity.isDeveloperIdApplication).map((identity) => identity.name),
      reportGeneratedAt: distributionReport?.generatedAt || "",
      artifacts: distributionReport?.artifacts || {}
    },
    cohort: {
      testerCount: uniqueTesterIds.length,
      testerIds: uniqueTesterIds,
      completedRunbookCount,
      supportBundleCount,
      firstOrderAttempts,
      firstOrderSuccesses,
      firstOrderSuccessRate,
      firstApplyAttempts,
      firstApplyBlocked
    },
    failureMetrics,
    blockers,
    nextActions,
    recentRuns: normalizedRuns.slice(-8).reverse()
  };
}

export { FAILURE_CATEGORIES };
