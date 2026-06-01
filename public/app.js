import * as THREE from "./vendor/three.module.min.js";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "./vendor/utils/SkeletonUtils.js";
import { buildCompanyShareCard, companyMetricValue } from "./company-report-model.js";
import {
  diffFileChangeKind,
  diffReviewRisk,
  summarizeUnifiedDiff,
  unifiedDiffSections
} from "./diff-renderer.js";
import {
  affectedFilesFromTask,
  gateApprovalChecklistFromTask,
  gateModelFromTask,
  gateRiskExplanation,
  gateVerdictFromTask
} from "./gate-model.js";
import { missionDirectorForTask } from "./mission-director.js";
import {
  inspectorTabForTimelineEvent,
  missionModeFromTimelineEvent,
  significantTimelineEvents,
  timelineEventKey,
  taskIdFromTimelineEvent,
  timelineReplaySummary
} from "./timeline-router.js";
import { selectStationEvent, workerStationModel } from "./worker-station-model.js";
import {
  COMPACT_MISSION_FLOW_NODES,
  PREMIUM_MISSION_FLOW_NODES,
  compactFlowStatusForNode,
  flowStatusForNode,
  latestTaskForProject as latestTaskFromList,
  missionModeFromTask,
  missionProgress,
  premiumMissionFlowNodeId,
  runPhaseFromTask,
  taskEventTime,
  taskHasEvidencePath,
  visibleMissionFlowNodeId
} from "./ui-state-map.js";
import {
  WorkerAssetRegistry,
  webglFallbackModel,
  workerLightForState,
  workerStateForRunPhase
} from "./worker-avatar-runtime.js";

const AppMode = Object.freeze({
  publicHome: "public_home",
  publicBeta: "public_beta",
  publicDemo: "public_demo",
  localOffice: "local_office"
});

function appModeFromPath(pathname = window.location.pathname) {
  const clean = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (clean === "/beta") return AppMode.publicBeta;
  if (clean === "/demo") return AppMode.publicDemo;
  if (clean === "/office") return AppMode.localOffice;
  return AppMode.publicHome;
}

const APP_MODE = appModeFromPath();
document.body.dataset.appMode = APP_MODE;

const state = {
  snapshot: null,
  selectedId: null,
  selectedEventId: null,
  selectedReplayEvent: null,
  selectedReplaySummary: null,
  selectionLocked: false,
  filter: "all",
  inspectorTab: "mission",
  inspectorOpen: false,
  demoReplay: {
    paused: false,
    stepIndex: 0
  },
  liveRun: {
    error: "",
    message: "",
    startedAt: 0,
    status: "idle"
  },
  taskInsight: null
};
let inspectorShellHandlersAttached = false;

const WORKER_ASSET_MANIFEST_URL = "/assets/workers/manifest.json";
const FIRST_ORDER_TITLE = "Add a Codingape pilot note to README";
const FIRST_REAL_ORDER_TEMPLATES = {
  readme_usage: {
    title: "Add a Codingape pilot note to README",
    files: ["README.md"]
  },
  fix_test: {
    title: "Fix one failing test",
    files: ["test", "src"]
  },
  input_validation: {
    title: "Add input validation to a specified function",
    files: ["src"]
  }
};

const elements = {
  publicHome: document.querySelector("#publicHome"),
  betaPage: document.querySelector("#betaPage"),
  demoModeBanner: document.querySelector("#demoModeBanner"),
  demoReplayControls: document.querySelector("#demoReplayControls"),
  demoReplayPauseButton: document.querySelector("#demoReplayPauseButton"),
  demoReplayRestartButton: document.querySelector("#demoReplayRestartButton"),
  demoReplayStatus: document.querySelector("#demoReplayStatus"),
  deskGrid: document.querySelector("#deskGrid"),
  workerGrid: document.querySelector("#workerGrid"),
  workerUniverseSignal: document.querySelector("#workerUniverseSignal"),
  detailPanel: document.querySelector(".detail-panel"),
  openInspectorButton: document.querySelector("#openInspectorButton"),
  closeInspectorButton: document.querySelector("#closeInspectorButton"),
  deckViewport: document.querySelector(".deck-viewport"),
  roomTitle: document.querySelector(".room-headline h2"),
  missionDirectorRibbon: document.querySelector("#missionDirectorRibbon"),
  directorWorker: document.querySelector("#directorWorker"),
  directorSafety: document.querySelector("#directorSafety"),
  directorNext: document.querySelector("#directorNext"),
  missionProofStrip: document.querySelector("#missionProofStrip"),
  proofEvidence: document.querySelector("#proofEvidence"),
  proofHumanGate: document.querySelector("#proofHumanGate"),
  proofApplyGate: document.querySelector("#proofApplyGate"),
  proofProgress: document.querySelector("#proofProgress"),
  inspectorShellMode: document.querySelector("#inspectorShellMode"),
  inspectorShellTitle: document.querySelector("#inspectorShellTitle"),
  workfeedList: document.querySelector("#workfeedList"),
  workfeedSignal: document.querySelector("#workfeedSignal"),
  launchStage: document.querySelector("#launchStage"),
  readinessScore: document.querySelector("#readinessScore"),
  readinessLevel: document.querySelector("#readinessLevel"),
  readinessVerdict: document.querySelector("#readinessVerdict"),
  readinessSummary: document.querySelector("#readinessSummary"),
  readinessBar: document.querySelector("#readinessBar"),
  serviceHealthStatus: document.querySelector("#serviceHealthStatus"),
  serviceHealthSummary: document.querySelector("#serviceHealthSummary"),
  serviceHealthList: document.querySelector("#serviceHealthList"),
  operationalStatus: document.querySelector("#operationalStatus"),
  operationalScore: document.querySelector("#operationalScore"),
  operationalSummary: document.querySelector("#operationalSummary"),
  operationalChecklist: document.querySelector("#operationalChecklist"),
  operationalNextActions: document.querySelector("#operationalNextActions"),
  aiwcHealthStatus: document.querySelector("#aiwcHealthStatus"),
  aiwcConfigList: document.querySelector("#aiwcConfigList"),
  testAiwcHealthButton: document.querySelector("#testAiwcHealthButton"),
  aiwcHealthDetail: document.querySelector("#aiwcHealthDetail"),
  firstRunStatus: document.querySelector("#firstRunStatus"),
  firstRunSummary: document.querySelector("#firstRunSummary"),
  firstRunList: document.querySelector("#firstRunList"),
  supportCenterStatus: document.querySelector("#supportCenterStatus"),
  generateSupportBundleButton: document.querySelector("#generateSupportBundleButton"),
  openSupportBundleDirectoryButton: document.querySelector("#openSupportBundleDirectoryButton"),
  copyDiagnosticSummaryButton: document.querySelector("#copyDiagnosticSummaryButton"),
  copyRestartHintButton: document.querySelector("#copyRestartHintButton"),
  supportBundleStatus: document.querySelector("#supportBundleStatus"),
  betaOpsStatus: document.querySelector("#betaOpsStatus"),
  betaOpsSummary: document.querySelector("#betaOpsSummary"),
  betaOpsTesterCount: document.querySelector("#betaOpsTesterCount"),
  betaOpsFirstOrderRate: document.querySelector("#betaOpsFirstOrderRate"),
  betaOpsSupportCount: document.querySelector("#betaOpsSupportCount"),
  betaOpsTrustList: document.querySelector("#betaOpsTrustList"),
  betaOpsFailureList: document.querySelector("#betaOpsFailureList"),
  betaOpsNextActions: document.querySelector("#betaOpsNextActions"),
  restartHintText: document.querySelector("#restartHintText"),
  recentErrorCount: document.querySelector("#recentErrorCount"),
  recentErrorList: document.querySelector("#recentErrorList"),
  blockerCount: document.querySelector("#blockerCount"),
  blockerList: document.querySelector("#blockerList"),
  companyReportStamp: document.querySelector("#companyReportStamp"),
  companyReportHeadline: document.querySelector("#companyReportHeadline"),
  companyMetrics: document.querySelector("#companyMetrics"),
  companyShareCard: document.querySelector("#companyShareCard"),
  companyShareLine: document.querySelector("#companyShareLine"),
  companyShareMetrics: document.querySelector("#companyShareMetrics"),
  companyShareBullets: document.querySelector("#companyShareBullets"),
  companyShareButton: document.querySelector("#companyShareButton"),
  latestEvidenceStatus: document.querySelector("#latestEvidenceStatus"),
  latestEvidenceSummary: document.querySelector("#latestEvidenceSummary"),
  runCodingLoopHeroButton: document.querySelector("#runCodingLoopHeroButton"),
  viewDossierButton: document.querySelector("#viewDossierButton"),
  deckCanvas: document.querySelector("#deckCanvas"),
  threeDeck: document.querySelector("#threeDeck"),
  workerRoomFallback: document.querySelector("#workerRoomFallback"),
  sceneLabels: document.querySelector("#sceneLabels"),
  sceneFocus: document.querySelector("#sceneFocus"),
  sceneTotal: document.querySelector("#sceneTotal"),
  sceneWorking: document.querySelector("#sceneWorking"),
  sceneDraft: document.querySelector("#sceneDraft"),
  sceneReady: document.querySelector("#sceneReady"),
  roomLatestEvent: document.querySelector("#roomLatestEvent"),
  roomMissions: document.querySelector("#roomMissions"),
  roomSaved: document.querySelector("#roomSaved"),
  roomBlocked: document.querySelector("#roomBlocked"),
  commandProject: document.querySelector("#commandProject"),
  commandRun: document.querySelector("#commandRun"),
  commandPhase: document.querySelector("#commandPhase"),
  commandRisk: document.querySelector("#commandRisk"),
  commandIngestion: document.querySelector("#commandIngestion"),
  commandPublicHealth: document.querySelector("#commandPublicHealth"),
  commandReadiness: document.querySelector("#commandReadiness"),
  commandMode: document.querySelector("#commandMode"),
  missionComposer: document.querySelector("#missionComposer"),
  missionProjectSelect: document.querySelector("#missionProjectSelect"),
  missionModeSelect: document.querySelector("#missionModeSelect"),
  missionInput: document.querySelector("#missionInput"),
  assignMissionButton: document.querySelector("#assignMissionButton"),
  projectRootForm: document.querySelector("#projectRootForm"),
  projectRootInput: document.querySelector("#projectRootInput"),
  chooseProjectFolderButton: document.querySelector("#chooseProjectFolderButton"),
  saveProjectRootButton: document.querySelector("#saveProjectRootButton"),
  projectRootStatus: document.querySelector("#projectRootStatus"),
  firstRunOnboarding: document.querySelector("#firstRunOnboarding"),
  onboardingSummary: document.querySelector("#onboardingSummary"),
  onboardingStepList: document.querySelector("#onboardingStepList"),
  onboardingByoKey: document.querySelector("#onboardingByoKey"),
  onboardingChooseProjectButton: document.querySelector("#onboardingChooseProjectButton"),
  onboardingRunSelfCheckButton: document.querySelector("#onboardingRunSelfCheckButton"),
  onboardingFirstOrderButton: document.querySelector("#onboardingFirstOrderButton"),
  onboardingEnterOfficeButton: document.querySelector("#onboardingEnterOfficeButton"),
  onboardingStatus: document.querySelector("#onboardingStatus"),
  localJudgeStatus: document.querySelector("#localJudgeStatus"),
  localJudgeSummary: document.querySelector("#localJudgeSummary"),
  localJudgeProvider: document.querySelector("#localJudgeProvider"),
  localJudgeModel: document.querySelector("#localJudgeModel"),
  localJudgeLatest: document.querySelector("#localJudgeLatest"),
  localJudgeCommand: document.querySelector("#localJudgeCommand"),
  testLocalJudgeButton: document.querySelector("#testLocalJudgeButton"),
  copyLocalJudgeCommandButton: document.querySelector("#copyLocalJudgeCommandButton"),
  modelProviderForm: document.querySelector("#modelProviderForm"),
  modelProviderMode: document.querySelector("#modelProviderMode"),
  modelProviderSelect: document.querySelector("#modelProviderSelect"),
  modelProviderEndpoint: document.querySelector("#modelProviderEndpoint"),
  modelProviderModel: document.querySelector("#modelProviderModel"),
  modelProviderApiKey: document.querySelector("#modelProviderApiKey"),
  testModelProviderButton: document.querySelector("#testModelProviderButton"),
  modelProviderNotice: document.querySelector("#modelProviderNotice"),
  firstRealOrderStatus: document.querySelector("#firstRealOrderStatus"),
  firstRealOrderSummary: document.querySelector("#firstRealOrderSummary"),
  firstRealOrderTemplate: document.querySelector("#firstRealOrderTemplate"),
  previewAiContextButton: document.querySelector("#previewAiContextButton"),
  runFirstRealOrderButton: document.querySelector("#runFirstRealOrderButton"),
  contextPreviewPanel: document.querySelector("#contextPreviewPanel"),
  contextPreviewList: document.querySelector("#contextPreviewList"),
  contextPreviewMeta: document.querySelector("#contextPreviewMeta"),
  pilotFeedbackPanel: document.querySelector("#pilotFeedbackPanel"),
  pilotFeedbackForm: document.querySelector("#pilotFeedbackForm"),
  pilotTesterId: document.querySelector("#pilotTesterId"),
  pilotUnderstoodTool: document.querySelector("#pilotUnderstoodTool"),
  pilotNoAutoWrite: document.querySelector("#pilotNoAutoWrite"),
  pilotBlockedAt: document.querySelector("#pilotBlockedAt"),
  pilotTrustRealProject: document.querySelector("#pilotTrustRealProject"),
  pilotFeedbackScore: document.querySelector("#pilotFeedbackScore"),
  pilotWillingToPay: document.querySelector("#pilotWillingToPay"),
  pilotFeedbackNotes: document.querySelector("#pilotFeedbackNotes"),
  pilotFeedbackStatus: document.querySelector("#pilotFeedbackStatus"),
  commandProgressBar: document.querySelector("#commandProgressBar"),
  commandProgressSteps: document.querySelector("#commandProgressSteps"),
  commandRunReceipt: document.querySelector("#commandRunReceipt"),
  coreWorkerStations: document.querySelector("#coreWorkerStations"),
  missionFlowRail: document.querySelector("#missionFlowRail"),
  missionFlowStatus: document.querySelector("#missionFlowStatus"),
  newMissionButton: document.querySelector("#newMissionButton"),
  runFirstOrderButton: document.querySelector("#runFirstOrderButton"),
  stageTitle: document.querySelector("#stageTitle"),
  lastUpdated: document.querySelector("#lastUpdated"),
  refreshButton: document.querySelector("#refreshButton"),
  pulseScore: document.querySelector("#pulseScore"),
  pulseCaption: document.querySelector("#pulseCaption"),
  statRunning: document.querySelector("#statRunning"),
  statActive: document.querySelector("#statActive"),
  statDraft: document.querySelector("#statDraft"),
  statReady: document.querySelector("#statReady"),
  emptyDetail: document.querySelector("#emptyDetail"),
  projectDetail: document.querySelector("#projectDetail"),
  detailAccent: document.querySelector("#detailAccent"),
  detailRole: document.querySelector("#detailRole"),
  detailName: document.querySelector("#detailName"),
  detailStatus: document.querySelector("#detailStatus"),
  detailFolder: document.querySelector("#detailFolder"),
  detailBranch: document.querySelector("#detailBranch"),
  detailPorts: document.querySelector("#detailPorts"),
  detailTouch: document.querySelector("#detailTouch"),
  detailWorker: document.querySelector("#detailWorker"),
  detailRisk: document.querySelector("#detailRisk"),
  detailTask: document.querySelector("#detailTask"),
  detailNextAction: document.querySelector("#detailNextAction"),
  missionStatusGrid: document.querySelector("#missionStatusGrid"),
  missionProgressBar: document.querySelector("#missionProgressBar"),
  detailControlStatus: document.querySelector("#detailControlStatus"),
  queueReviewButton: document.querySelector("#queueReviewButton"),
  markBlockedButton: document.querySelector("#markBlockedButton"),
  runCodingLoopButton: document.querySelector("#runCodingLoopButton"),
  taskCount: document.querySelector("#taskCount"),
  taskQueueList: document.querySelector("#taskQueueList"),
  taskInsightTitle: document.querySelector("#taskInsightTitle"),
  taskInsightStatus: document.querySelector("#taskInsightStatus"),
  taskInsightBody: document.querySelector("#taskInsightBody"),
  eventReplayPanel: document.querySelector("#eventReplayPanel"),
  eventReplayTitle: document.querySelector("#eventReplayTitle"),
  eventReplayStatus: document.querySelector("#eventReplayStatus"),
  eventReplayBody: document.querySelector("#eventReplayBody"),
  gateInsightTitle: document.querySelector("#gateInsightTitle"),
  gateInsightStatus: document.querySelector("#gateInsightStatus"),
  gateInsightBody: document.querySelector("#gateInsightBody"),
  approvalCount: document.querySelector("#approvalCount"),
  approvalList: document.querySelector("#approvalList"),
  recentFiles: document.querySelector("#recentFiles"),
  changeCount: document.querySelector("#changeCount"),
  gitChanges: document.querySelector("#gitChanges"),
  scriptCloud: document.querySelector("#scriptCloud")
};

let deckAnimationFrame = null;
let demoReplayTimer = null;
let liveRunPollTimer = null;
const threeDeck = {
  avatar: {
    animations: [],
    assetRegistry: null,
    failed: false,
    loader: null,
    promise: null,
    template: null
  },
  camera: null,
  group: null,
  labels: new Map(),
  nodeObjects: new Map(),
  pointer: new THREE.Vector2(),
  raycaster: new THREE.Raycaster(),
  renderer: null,
  scene: null,
  mixers: [],
  signalPulses: [],
  phaseTransferPulses: [],
  selectedRing: null,
  disabled: false,
  disabledReason: "",
  isDragging: false,
  lastPointerX: 0,
  dragDelta: 0,
  lastAnimationTime: 0,
  rotationTarget: -0.35
};

const accentColors = {
  coral: 0xe95f51,
  cyan: 0x2f8fbe,
  gold: 0xd9a12a,
  ink: 0x4d5870,
  mint: 0x58b86b,
  rose: 0xd85883,
  teal: 0x16a79f,
  violet: 0x8672c8
};

function preloadCodingYuanModel() {
  if (threeDeck.avatar.promise || threeDeck.avatar.failed || threeDeck.avatar.template) {
    return threeDeck.avatar.promise;
  }

  threeDeck.avatar.loader = threeDeck.avatar.loader || new GLTFLoader();
  threeDeck.avatar.promise = fetch(WORKER_ASSET_MANIFEST_URL, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) return null;
      return response.json();
    })
    .then((manifest) => {
      const registry = new WorkerAssetRegistry(manifest);
      threeDeck.avatar.assetRegistry = registry;
      const modelUrls = registry.modelCandidatesFor("coding-yuan");
      if (!modelUrls.length) return null;

      return new Promise((resolve) => {
        const loadCandidate = (index = 0) => {
          const modelUrl = modelUrls[index];
          if (!modelUrl) {
            threeDeck.avatar.failed = true;
            resolve(null);
            return;
          }
          threeDeck.avatar.loader.load(
            modelUrl,
            (gltf) => {
              threeDeck.avatar.template = gltf.scene;
              threeDeck.avatar.animations = gltf.animations || [];
              normalizeCodingYuanModel(threeDeck.avatar.template);
              if (state.snapshot) updateThreeDeck(state.snapshot);
              resolve(gltf);
            },
            undefined,
            () => {
              loadCandidate(index + 1);
            }
          );
        };
        loadCandidate();
      });
    })
    .catch(() => {
      threeDeck.avatar.failed = true;
      return null;
    });

  return threeDeck.avatar.promise;
}

function normalizeCodingYuanModel(model) {
  model.traverse((object) => {
    if (object.isMesh || object.isSkinnedMesh) {
      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = false;
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          material.transparent = material.transparent || material.opacity < 1;
          material.needsUpdate = true;
        }
      }
    }
  });
}

function createCodingYuanModelRig(project, color, lift, index, context = {}) {
  if (!threeDeck.avatar.template) return null;

  const phase = context.phase || "assigned";
  const workerId = context.workerId || project.workerId || "coding-yuan";
  const active = Boolean(context.activeNode) || project.status.key === "active" || project.status.key === "running";
  const profile = workerLifeProfile(workerId, phase, project.status.key);
  const rig = new THREE.Group();
  const model = cloneSkeleton(threeDeck.avatar.template);
  model.userData.projectId = project.id;
  model.traverse((object) => {
    object.userData.projectId = project.id;
  });

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = 0.84 / Math.max(size.x || 1, size.y || 1, size.z || 1);
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  model.rotation.y = Math.PI;
  rig.add(model);

  rig.position.set(0, 0.52 + lift, -0.08);
  rig.scale.setScalar(active ? 1.12 : 1.02);
  rig.userData.projectId = project.id;
  rig.userData.baseY = rig.position.y;
  rig.userData.phase = index * 0.62;
  rig.userData.missionPhase = phase;
  rig.userData.workerId = workerId;
  rig.userData.status = project.status.key;
  rig.userData.active = active;
  rig.userData.profile = profile;
  rig.userData.model = model;

  const mixer = threeDeck.avatar.animations.length ? new THREE.AnimationMixer(model) : null;
  if (mixer) {
    const clip = chooseCodingYuanClip(project.status.key);
    mixer.clipAction(clip).reset().play();
    threeDeck.mixers.push({ mixer, rig, projectId: project.id });
  }

  const glow = new THREE.PointLight(color, active ? 0.46 : 0.16, 1.2);
  glow.position.set(0, 0.48, -0.22);
  rig.add(glow);
  rig.userData.modelGlow = glow;

  return rig;
}

function chooseCodingYuanClip(status) {
  const animations = threeDeck.avatar.animations;
  const preferred = {
    active: /typing|work|scan|idle/i,
    draft: /scan|idle|look/i,
    idle: /idle/i,
    ready: /idle|ready/i,
    running: /typing|work|run|scan|idle/i
  };
  return animations.find((clip) => preferred[status]?.test(clip.name)) || animations[0];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const STATUS_LABELS_ZH = {
  active: "进行中",
  applied: "已写入",
  apply_blocked: "写入已阻断",
  approved: "已批准",
  assigned: "已分配",
  blocked: "已阻断",
  blocked_by_default: "默认阻断",
  blocked_by_policy: "策略阻断",
  captured: "已采集",
  clean: "干净",
  checked: "已检查",
  completed: "已完成",
  complete: "已完成",
  danger: "高风险",
  diff_ready: "差异已生成",
  draft: "草稿",
  dry_run: "预演",
  dry_run_ready: "预演就绪",
  enabled: "已启用",
  disabled: "已关闭",
  failed: "失败",
  generating_evidence: "采集证据",
  generating_patch: "生成补丁",
  gate: "闸门",
  gate_pending: "等待闸门",
  held: "已挂起",
  high: "高风险",
  human_gate: "人工闸门",
  idle: "待命",
  info: "信息",
  low: "低风险",
  live_runtime: "运行中",
  medium: "需复核",
  missing: "缺失",
  next: "下一步",
  none: "无",
  not_autonomous: "暂不自治",
  not_required: "不需要",
  not_run: "未运行",
  ok: "正常",
  partial: "部分完成",
  passed: "通过",
  pending: "等待中",
  queued: "排队中",
  ready: "就绪",
  requires_confirmation: "需要确认",
  requires: "需要",
  reporting: "生成战报",
  reviewed: "已复核",
  reviewing: "审核中",
  rework: "需返工",
  rework_requested: "已要求返工",
  running: "运行中",
  sandbox: "沙盒",
  sandbox_ready: "沙盒就绪",
  sandbox_written: "沙盒已写入",
  supervised_only: "仅监督模式",
  success: "成功",
  verified: "已验证",
  verifying: "验证中",
  waiting: "等待中",
  waiting_approval: "等待审批",
  warning: "警告",
  working: "工作中"
};

const EVENT_TYPE_LABELS_ZH = {
  apply_gate_pending: "写入闸门待确认",
  apply_proposal_applied: "补丁已写入",
  approval_gate: "审批闸门",
  file_touch: "文件活动",
  git_signal: "代码变更信号",
  human_gate_approved: "人工审批通过",
  human_gate_rework: "要求返工",
  judge_review: "审核复核",
  patch_plan: "补丁方案",
  project_root_guard_blocked: "项目根目录守卫阻断",
  patch_run_blocked: "沙盒补丁被阻断",
  patch_run_ready: "沙盒补丁已生成",
  runtime: "运行监控",
  task_blocked: "任务阻断",
  task_completed: "任务完成",
  task_evidence: "证据采集",
  task_queued: "任务排队",
  task_running: "任务运行",
  verification_blocked: "验证阻断",
  verification_failed: "验证失败",
  verification_passed: "验证通过"
};

const TAB_LABELS_ZH = {
  evidence: "证据",
  gate: "闸门",
  mission: "任务"
};

const WORKER_DOMAIN_ZH = {
  Engineering: "工程",
  Governance: "治理",
  Runtime: "运行",
  Security: "安全",
  Markets: "市场",
  Intel: "情报",
  Quant: "量化",
  Research: "研究",
  Content: "内容",
  Operator: "操作"
};

const WORKER_NAME_ZH = {
  "Coding猿": "编程猿",
  "Judge猿": "审核猿",
  "Ops猿": "运维猿",
  "Quant猿": "量化猿",
  "Security猿": "安全猿",
  "Hunter猿": "情报猿",
  "coding-yuan": "编程猿",
  "judge-yuan": "审核猿",
  "ops-yuan": "运维猿"
};

const PROJECT_NAME_ZH = {
  "Ai Worker Control Plane": "智能打工猿控制平面",
  "Ai Export Compliance Agent": "AI 出口合规智能体",
  "Ai Face Swap Mvp": "AI 换脸 MVP",
  "Binance Futures Trader": "币安合约交易台",
  "Cloudflare Edgetunnel Pages": "云边缘隧道页面",
  "Cloudflare Edgetunnel Test": "云边缘隧道测试",
  "Friend Points Betting Pro Client": "朋友积分竞猜专业版客户端",
  "Friend Points Betting Pro": "朋友积分竞猜专业版",
  "Gmgn Anomaly Radar": "链上异常雷达",
  "Huangguan Clean Replica Api": "皇冠清理副本接口",
  "Coding Yuan Sandbox Demo": "编程猿沙盒演示",
  "coding-yuan-sandbox-demo": "编程猿沙盒演示",
  "Stock Quant Ai": "股票量化智能体",
  "Reserve Wallet Generator": "备用钱包生成器",
  "Sol Light Trader": "索拉纳轻量交易台",
  "Paperclipai": "回形针 AI",
  "Paperclip AI": "回形针 AI",
  "Domain Check Results": "域名检查结果"
};

const EXACT_TEXT_ZH = {
  "3-猿 demo: Coding猿 captures evidence, Judge猿 reviews, Ops猿 keeps apply gated for Coding Yuan Sandbox Demo":
    "三猿演示：编程猿采集证据，审核猿审核，运维猿守住写入闸门（编程猿沙盒演示）",
  "AI Worker Control Plane": "智能打工猿控制平面",
  "Ai Worker Control Plane": "智能打工猿控制平面",
  "Coding Yuan Sandbox Demo": "编程猿沙盒演示",
  "coding-yuan-sandbox-demo": "编程猿沙盒演示",
  "Apply runner is disabled": "写入执行器默认关闭",
  "Apply runner is disabled by default.": "写入执行器默认关闭。",
  "No project files were modified.": "没有修改项目文件。",
  "Project files are unchanged.": "项目文件未被改动。",
  "Patch runner wrote sandbox patch artifacts only; project code was not modified.":
    "补丁执行器只生成沙盒补丁产物，没有改动项目代码。",
  "Apply runner did not write project code because confirmation, environment, rollback, or drift checks are not satisfied.":
    "写入执行器没有写入项目代码，因为确认语、环境开关、回滚快照或漂移检查尚未全部满足。",
  "Operator demo approval covers sandbox patch artifacts only; direct project apply remains blocked.":
    "演示审批只覆盖沙盒补丁产物；真实写入仍然被阻断。",
  "Patch runner ready": "补丁执行器就绪",
  "Patch runner blocked": "补丁执行器已阻断",
  "Sandbox patch package ready": "沙盒补丁包已生成",
  "Sandbox patch blocked": "沙盒补丁已阻断",
  "Apply gate checked": "写入闸门已检查",
  "Proposal applied": "补丁已写入",
  "No evidence attached to this event": "这个事件没有附加证据",
  "No signals yet": "暂无信号",
  "No worker events yet": "暂无员工事件",
  "No queued worker tasks": "暂无排队任务",
  "No human gates open": "暂无人工闸门",
  "No recent files": "暂无最近文件",
  "No git changes": "暂无 Git 变更",
  "No package scripts": "暂无脚本",
  "Waiting for signals": "等待信号",
  "Waiting for mission": "等待任务",
  "Waiting for evidence-backed work.": "等待有证据支撑的真实任务。",
  "Workspace Core": "工作区核心",
  "Workspace": "工作区",
  "Worker": "员工",
  "Human gate": "人工闸门",
  "Current mission": "当前任务",
  "No active run": "暂无运行",
  "No run active": "暂无运行",
  "Idle": "待命",
  "Standing by": "待命",
  "Assign a concrete task": "分配一个明确任务",
  "Assign a mission": "分配一个任务",
  "Review before autonomy increases.": "提升自治等级前需要复核。",
  "No metric": "暂无指标",
  "No report yet.": "暂无战报。",
  "test": "测试",
  "check": "检查",
  "none": "无"
};

Object.assign(EXACT_TEXT_ZH, {
  "Sandbox queued · Human-gated apply": "沙盒排队 · 写入需人工闸门",
  "Sandbox assigned · Evidence first": "沙盒已分配 · 先采集证据",
  "Read-only evidence capture": "只读证据采集",
  "Patch blueprint · Sandbox only": "补丁蓝图 · 仅沙盒",
  "Verification running · No deploy": "验证运行中 · 不部署",
  "Verification failed · Rework required": "验证失败 · 需要返工",
  "Judge review · Evidence-backed": "Judge猿审核 · 证据支撑",
  "Human Gate · Approval required": "人工闸门 · 需要审批",
  "Patch preflight · Sandbox package": "补丁预检 · 沙盒包",
  "Sandbox diff ready · Review only": "沙盒差异已生成 · 仅供审核",
  "Apply Gate blocked · Explicit approval required": "写入闸门已阻断 · 需要明确审批",
  "Mission complete · Evidence archived": "任务完成 · 证据已归档",
  "Mission failed · Human review required": "任务失败 · 需要人工复核",
  "Apply runner armed · exact confirmation still required": "写入执行器已准备 · 仍需要精确确认",
  "Assign the mission to Coding猿 and start read-only evidence capture.": "把任务分配给 Coding猿，并开始只读证据采集。",
  "Start evidence capture before any patch planning.": "先采集证据，再规划补丁。",
  "Let Coding猿 finish command logs and repository evidence.": "让 Coding猿 完成命令日志和仓库证据采集。",
  "Review the proposed patch plan before verification.": "验证前先复核补丁方案。",
  "Wait for the allowed verification script to finish.": "等待白名单验证脚本完成。",
  "Open Evidence, inspect the failed check, then request rework.": "打开证据，查看失败检查，然后要求返工。",
  "Review Judge猿's evidence summary and risk notes.": "复核 Judge猿 的证据摘要和风险说明。",
  "Open Gate, inspect what will happen, then approve or request rework.": "打开闸门，确认会发生什么，再批准或要求返工。",
  "Let Coding猿 package the sandbox patch and rollback snapshot.": "让 Coding猿 打包沙盒补丁和回滚快照。",
  "Open Evidence and inspect the Diff Preview before Apply Gate.": "进入写入闸门前，先打开证据并检查差异预览。",
  "Open Gate and keep blocked unless you explicitly approve the apply path.": "打开闸门；除非你明确批准写入路径，否则保持阻断。",
  "Review the final evidence pack and company report.": "复核最终证据包和公司战报。",
  "Inspect the failure evidence and keep risky actions blocked.": "检查失败证据，并保持高风险动作阻断。",
  "Queued": "排队中",
  "Assigned": "已分配",
  "Collecting evidence": "采集证据中",
  "Planning patch": "生成补丁方案",
  "Running verification": "验证运行中",
  "Verification failed": "验证失败",
  "Judge review": "审核中",
  "Waiting human gate": "等待人工确认",
  "Patch preflight": "补丁预检",
  "Diff ready": "差异已生成",
  "Apply blocked": "写入已阻断",
  "Completed": "已完成",
  "Failed": "失败",
  "Mission queued": "任务排队中",
  "Coding猿 is reading the mission": "Coding猿正在读取任务",
  "Coding猿 is capturing evidence": "Coding猿正在采集证据",
  "Coding猿 is drafting a patch plan": "Coding猿正在起草补丁方案",
  "Judge猿 is checking test evidence": "Judge猿正在检查测试证据",
  "Judge猿 rejected the evidence": "Judge猿驳回了证据",
  "Judge猿 is reviewing the pack": "Judge猿正在审核证据包",
  "Judge猿 is waiting for you": "Judge猿正在等待你确认",
  "Coding猿 is packaging the sandbox patch": "Coding猿正在打包沙盒补丁",
  "Coding猿 has a diff ready": "Coding猿已准备好差异",
  "Ops猿 is holding the safety gate": "Ops猿正在守住安全闸门",
  "Coding猿 is reporting back": "Coding猿正在汇报",
  "Ops猿 is isolating the failure": "Ops猿正在隔离失败",
  "No command has run yet.": "还没有执行任何命令。",
  "The work is still in planning, with no project writes.": "任务仍处于规划阶段，没有写入项目文件。",
  "Only read-only checks should run in this phase.": "这个阶段只允许运行只读检查。",
  "The plan is evidence only; project files remain unchanged.": "方案只是证据，项目文件保持不变。",
  "Verification cannot deploy, restart, or perform external side effects.": "验证不会部署、重启，也不会产生外部副作用。",
  "Failed verification prevents patch progression.": "验证失败会阻止补丁继续推进。",
  "The run is still behind Human Gate.": "这次运行仍受人工闸门保护。",
  "No sandbox patch run can proceed without human approval.": "没有人工审批，沙盒补丁运行不能继续。",
  "Patch runner writes review artifacts only, not project files.": "补丁执行器只写审核产物，不写项目文件。",
  "Completion is backed by recorded evidence.": "完成状态有已记录证据支撑。",
  "Failed work remains blocked from direct apply.": "失败任务仍然禁止直接写入。",
  "Coding猿 is waiting for assignment": "Coding猿正在等待分配",
  "Coding猿 is preparing the workbench": "Coding猿正在准备工作台",
  "Coding猿 is collecting logs": "Coding猿正在采集日志",
  "Coding猿 is turning evidence into a patch plan": "Coding猿正在把证据转成补丁方案",
  "Judge猿 is validating the evidence pack": "Judge猿正在验证证据包",
  "Judge猿 is holding the run": "Judge猿正在暂停这次运行",
  "Judge猿 is comparing evidence and policy": "Judge猿正在比对证据和策略",
  "Judge猿 is pointing at the approval console": "Judge猿正在提示你审批",
  "Coding猿 is writing the sandbox bundle": "Coding猿正在写入沙盒包",
  "Coding猿 is presenting the patch dossier": "Coding猿正在展示补丁档案",
  "Ops猿 is blocking direct apply": "Ops猿正在阻断直接写入",
  "Coding猿 is filing the report": "Coding猿正在归档报告",
  "Ops猿 is preserving failure evidence": "Ops猿正在保存失败证据",
  "Mission Inspector": "任务检查台",
  "Evidence Inspector": "证据检查台",
  "Gate Inspector": "闸门检查台",
  "Capturing command evidence": "采集命令证据",
  "Drafting patch blueprint": "起草补丁蓝图",
  "Running allowed verification": "运行白名单验证",
  "Packaging sandbox patch": "打包沙盒补丁",
  "Sandbox diff is ready": "沙盒差异已就绪",
  "Waiting for human apply decision": "等待人工写入决定",
  "Waiting for human approval": "等待人工审批",
  "Explaining apply gate blockers": "解释写入闸门阻断原因",
  "Reviewing evidence pack": "审核证据包",
  "Checking test evidence": "检查测试证据",
  "Apply gate blocked by policy": "写入闸门被策略阻断",
  "Rollback snapshot ready": "回滚快照就绪",
  "Watching patch preflight": "监控补丁预检",
  "No mission selected": "未选择任务",
  "Choose a mission with evidence before approving any action.": "批准任何动作前，请先选择带证据的任务。",
  "No run": "暂无运行",
  "Blocked by default": "默认阻断",
  "Applied after gate checks": "闸门检查后已写入",
  "This run passed the apply gate and wrote project files under approval.": "本次运行通过写入闸门，并在审批下写入了项目文件。",
  "Applied": "已写入",
  "Evidence is ready, but project writes still require exact human confirmation.": "证据已就绪，但写项目文件仍需要精确人工确认。",
  "No direct writes": "没有直接写入",
  "Review writes": "复核写入",
  "Requires confirmation": "需要确认",
  "Sandbox patch ready": "沙盒补丁已就绪",
  "Review the diff and run the apply gate before any project write.": "写入任何项目文件前，请先审核差异并运行写入闸门。",
  "Sandbox only": "仅沙盒",
  "Not cleared": "未放行",
  "Human decision needed": "需要人工决定",
  "Judge猿 needs a human decision before patch preflight can continue.": "补丁预检继续前，Judge猿需要人工决定。",
  "Waiting": "等待中",
  "Blocked": "已阻断",
  "Gate holding": "闸门保持中",
  "The run remains in supervised mode until the next evidence gate passes.": "在下一个证据闸门通过前，这次运行保持监督模式。",
  "Supervised": "受监督"
});

Object.assign(EXACT_TEXT_ZH, {
  Apply: "写入",
  "Apply Gate": "写入闸门",
  "Attached Evidence": "关联证据",
  Candidates: "候选文件",
  Checks: "检查",
  Control: "控制",
  Drafts: "草稿",
  Evidence: "证据",
  Files: "文件",
  Gate: "闸门",
  Human: "人工闸门",
  Judge: "审核",
  Latest: "最新",
  Manifest: "清单",
  Mode: "模式",
  Patch: "补丁",
  Plan: "方案",
  Progress: "进度",
  Queue: "队列",
  Risk: "风险",
  Rollback: "回滚",
  Route: "路由",
  Run: "运行",
  Runner: "执行器",
  Safety: "安全",
  Score: "分数",
  Severity: "级别",
  Source: "来源",
  Status: "状态",
  Task: "任务",
  Verify: "验证",
  Worker: "员工",
  Working: "工作中",
  Ready: "就绪",
  Draft: "草稿",
  Running: "运行中",
  "Engineering": "工程",
  "Governance": "治理",
  "Runtime": "运行"
});

Object.assign(EXACT_TEXT_ZH, {
  "Agent Systems": "智能体系统",
  "Market Desk": "市场工作台",
  "Launch crew": "核心员工",
  "Next hire": "即将入职",
  "Available": "可接单",
  "Human gate": "人工闸门",
  "Review": "复核",
  "Markets": "市场",
  "Intel": "情报",
  "Apply proposal gate": "写入提案闸门",
  "Ready for supervised customer-style evidence review.": "已准备好进行客户式监督证据审核。",
  "AIWC run-log ingestion is not configured": "运行日志接入尚未配置",
  "Review or hold each high-risk action before increasing autonomy.": "提升自治等级前，请复核或挂起每个高风险动作。",
  "Evidence packs": "证据包",
  "Apply gates": "写入闸门",
  "Hours saved": "节省小时",
  "Tasks done": "完成任务",
  "Patch plans": "补丁方案",
  "Patch runs": "补丁运行",
  "Risks gated": "闸门阻断风险",
  "Approved": "已批准",
  "Verified": "已验证"
});

function zhStatus(value) {
  const raw = String(value || "");
  const normalized = raw.toLowerCase().replaceAll(" ", "_");
  return STATUS_LABELS_ZH[normalized] || EXACT_TEXT_ZH[raw] || raw.replaceAll("_", " ");
}

function zhEventType(type) {
  return EVENT_TYPE_LABELS_ZH[type] || zhStatus(type || "event");
}

function zhTab(tab) {
  return TAB_LABELS_ZH[tab] || zhStatus(tab);
}

function zhText(value = "") {
  let text = String(value || "");
  if (!text) return text;
  if (PROJECT_NAME_ZH[text]) text = PROJECT_NAME_ZH[text];
  if (WORKER_NAME_ZH[text]) text = WORKER_NAME_ZH[text];
  if (EXACT_TEXT_ZH[text]) text = EXACT_TEXT_ZH[text];

  text = text
    .replace(/3-猿 demo: Coding猿 captures evidence, Judge猿 reviews, Ops猿 keeps apply gated for (Coding Yuan Sandbox Demo|Coding猿沙盒演示|编程猿沙盒演示)/gi, "三猿演示：编程猿采集证据，审核猿审核，运维猿守住写入闸门（编程猿沙盒演示）")
    .replace(/^Coding猿 close-loop: inspect (.+), capture evidence, and draft review plan$/i, (_, name) => `编程猿闭环：检查${zhText(name)}、采集证据并生成复核方案`)
    .replace(/Coding猿 close-loop: inspect ([^,\n]+), capture evidence, and draft review plan/gi, (_, name) => `编程猿闭环：检查${zhText(name)}、采集证据并生成复核方案`)
    .replace(/^Patch plan for (.+)$/i, (_, name) => `${zhText(name)}补丁方案`)
    .replace(/^Coding猿 can now move from evidence capture to a human-reviewed patch plan\.$/i, "编程猿已从证据采集推进到人工复核补丁方案。")
    .replace(/^(\d+) changed file signal found$/i, "$1 个变更文件信号已发现")
    .replace(/^Verification scripts available: (.+)$/i, (_, scripts) => `可用验证脚本：${zhText(scripts).replaceAll("test", "测试").replaceAll("check", "检查")}`)
    .replace(/^(\d+) sandbox patch draft ready for diff preview$/i, "$1 份沙盒补丁草稿已可预览差异")
    .replace(/^Inspect changed files and separate intentional work from unrelated workspace noise$/i, "检查变更文件，并把本次目标变更与无关工作区噪音分开。")
    .replace(/^Create a minimal patch scoped to the selected project and task$/i, "创建只覆盖所选项目和任务的最小补丁。")
    .replace(/^Run approved verification: (.+)$/i, (_, scripts) => `运行已批准验证：${zhText(scripts).replaceAll("test", "测试").replaceAll("check", "检查")}`)
    .replace(/^Attach evidence output and changed-file summary to the task trail$/i, "把证据输出和变更文件摘要附加到任务轨迹。")
    .replace(/^This is a plan artifact only\. It does not modify files or execute project scripts\.$/i, "这只是方案产物，不会修改文件，也不会执行项目脚本。")
    .replace(/Diff Preview\s*验证/gi, "差异预览验证")
    .replace(/Diff Preview/gi, "差异预览")
    .replace(/^Send confirmation "(.+)" to apply sandbox files to the project\.$/i, "发送精确确认语“$1”后，才允许把沙盒文件写入项目。")
    .replace(/^Exact apply confirmation is required$/i, "需要精确写入确认")
    .replace(/Your AI company completed (\d+) tasks with traceable evidence\./gi, "你的 AI 打工公司完成了 $1 个有证据记录的任务。")
    .replace(/Your AI company is staged for the first real work loop\./gi, "你的 AI 打工公司已准备好进入第一次真实工作闭环。")
    .replace(/Today my AI worker company completed (\d+) tasks\./gi, "今天我的 AI 打工公司完成了 $1 个任务。")
    .replace(/Today my AI worker company completed (\d+) tasks?, produced (\d+) evidence packs?, passed (\d+) verification runs?, approved (\d+) supervised results?, ran (\d+) controlled patch preflights?, checked (\d+) apply gates?, and blocked (\d+) risks?\./gi, "今天我的 AI 打工公司完成了 $1 个任务，生成了 $2 份证据包，通过了 $3 次验证，批准了 $4 个受监督结果，完成了 $5 次受控补丁预检，检查了 $6 次写入闸门，并阻断了 $7 个风险。")
    .replace(/Today my AI worker company completed (\d+) missions, produced (\d+) evidence packs, and gated (\d+) risks\./gi, "今天我的 AI 打工公司完成了 $1 个任务，生成了 $2 份证据包，并阻断了 $3 个风险。")
    .replace(/^Review (.+), summarize risk, and attach evidence$/i, (_, name) => `复核${zhText(name)}，总结风险并附上证据`)
    .replace(/^(Coding猿|Judge猿|Ops猿|Quant猿|Security猿|Hunter猿|编程猿|审核猿|运维猿|量化猿|安全猿|情报猿) is working through (\d+) local changes? in (.+)$/i, (_, worker, count, name) => `${zhText(worker)}正在处理${zhText(name)}里的 ${count} 个本地变更`)
    .replace(/^(Coding猿|Judge猿|Ops猿|Quant猿|Security猿|Hunter猿|编程猿|审核猿|运维猿|量化猿|安全猿|情报猿) is packaging (\d+) pending changes? for review$/i, (_, worker, count) => `${zhText(worker)}正在打包 ${count} 个待复核变更`)
    .replace(/^(Coding猿|Judge猿|Ops猿|Quant猿|Security猿|Hunter猿|编程猿|审核猿|运维猿|量化猿|安全猿|情报猿) is standing by for the next assignment$/i, (_, worker) => `${zhText(worker)}正在等待下一次分配`)
    .replace(/^Waiting on reviews, approvals, and release evidence$/i, "等待审核、审批和发布证据")
    .replace(/^Ask the human before deploy, trade, wallet, restart, or production writes$/i, "部署、交易、钱包、重启或生产写入前必须询问人类")
    .replace(/^Review the diff and create an evidence summary$/i, "复核差异并生成证据摘要")
    .replace(/^(\d+) git change signal$/i, "$1 个 Git 变更信号")
    .replace(/^(\d+) recent file signal$/i, "$1 个最近文件信号")
    .replace(/^Recent touch: /i, "最近改动：")
    .replace(/^(.+) · medium risk patch plan$/i, (_, name) => `${zhText(name)} · 中风险补丁方案`)
    .replace(/^(.+) · (\d+) read-only checks$/i, (_, name, count) => `${zhText(name)} · ${count} 项只读检查`)
    .replace(/^(.+) · test$/i, (_, name) => `${zhText(name)} · 测试脚本`)
    .replace(/^Evidence runner only captured read-only signals\. It did not run deploy, trade, restart, install, or write commands\.$/i, "证据执行器只采集只读信号，没有运行部署、交易、重启、安装或写入命令。")
    .replace(/^Evidence runner only captured read-only signals\./i, "证据执行器只采集只读信号。")
    .replace(/Coding猿 completed (\d+) missions?\./gi, "编程猿完成了 $1 个任务。")
    .replace(/Judge猿 reviewed (\d+) evidence packs?\./gi, "审核猿复核了 $1 份证据包。")
    .replace(/Ops猿 gated (\d+) risks?\./gi, "运维猿阻断了 $1 个风险。")
    .replace(/The company saved about ([\\d.]+h) of operator time\./gi, "公司约节省了 $1 人工时间。")
    .replace(/All high-risk project writes stayed behind Human Gate\./gi, "所有高风险项目写入都留在人工闸门之后。")
    .replace(/Ai Worker Control Plane/gi, "智能打工猿控制平面")
    .replace(/Huangguan Clean Replica Api/gi, "皇冠清理副本接口")
    .replace(/Stock Quant Ai/gi, "股票量化智能体")
    .replace(/Ai Export Compliance Agent/gi, "AI 出口合规智能体")
    .replace(/Ai Face Swap Mvp/gi, "AI 换脸 MVP")
    .replace(/Binance Futures Trader/gi, "币安合约交易台")
    .replace(/Cloudflare Edgetunnel Pages/gi, "云边缘隧道页面")
    .replace(/Cloudflare Edgetunnel Test/gi, "云边缘隧道测试")
    .replace(/Friend Points Betting Pro Client/gi, "朋友积分竞猜专业版客户端")
    .replace(/Friend Points Betting Pro/gi, "朋友积分竞猜专业版")
    .replace(/Gmgn Anomaly Radar/gi, "链上异常雷达")
    .replace(/Sol Light Trader/gi, "索拉纳轻量交易台")
    .replace(/(\d+) high-risk human gates/gi, "$1 个高风险人工闸门")
    .replace(/(\d+) local change need evidence/gi, "$1 个本地变更需要证据")
    .replace(/(\d+) local changes/gi, "$1 个本地变更")
    .replace(/read-only signals/gi, "只读信号")
    .replace(/deploy, trade, restart, install, or write commands/gi, "部署、交易、重启、安装或写入命令")
    .replace(/(\d+) local changes need evidence/gi, "$1 个本地变更需要证据")
    .replace(/^3-猿 demo: Coding猿 captures evidence, Judge猿 reviews, Ops猿 keeps apply gated for (.+)$/i, "三猿演示：编程猿采集证据，审核猿审核，运维猿守住写入闸门（$1）")
    .replace(/^Sandbox patch package ready: /i, "沙盒补丁包已生成：")
    .replace(/^Sandbox patch blocked: /i, "沙盒补丁已阻断：")
    .replace(/^Patch runner ready: /i, "补丁执行器就绪：")
    .replace(/^Patch runner blocked: /i, "补丁执行器已阻断：")
    .replace(/^Apply gate checked: /i, "写入闸门已检查：")
    .replace(/^Proposal applied: /i, "提案已写入：")
    .replace(/^Ops猿 checked apply gate: /i, "Ops猿完成写入闸门检查：")
    .replace(/^Judge猿 approved sandbox preflight: /i, "Judge猿批准沙盒预检：")
    .replace(/^Mission queued: /i, "任务已排队：")
    .replace(/^Mission failed: /i, "任务失败：")
    .replace(/^Mission complete: /i, "任务完成：")
    .replace(/^Verification passed: /i, "验证通过：")
    .replace(/^Verification failed: /i, "验证失败：")
    .replace(/^Verification running: /i, "验证运行中：")
    .replace(/^Verification gated: /i, "验证已被闸门拦住：")
    .replace(/^Verification 通过: /i, "验证通过：")
    .replace(/^Verification 失败: /i, "验证失败：")
    .replace(/^Completed: /i, "已完成：")
    .replace(/^Running: /i, "运行中：")
    .replace(/^Queued: /i, "排队中：")
    .replace(/^Blocked: /i, "已阻断：")
    .replace(/\bjudge review\b/gi, "审核复核")
    .replace(/\breview ready\b/gi, "复核就绪")
    .replace(/\breview 就绪/gi, "复核就绪")
    .replace(/\bmedium risk patch plan\b/gi, "中风险补丁方案")
    .replace(/\bhigh risk patch plan\b/gi, "高风险补丁方案")
    .replace(/\blow risk patch plan\b/gi, "低风险补丁方案")
    .replace(/\brisk patch plan\b/gi, "风险补丁方案")
    .replace(/\bread-only checks\b/gi, "项只读检查")
    .replace(/\bevidence:/gi, "证据：")
    .replace(/\bevidence\b/gi, "证据")
    .replace(/\bVerification\b/gi, "验证")
    .replaceAll("Coding Yuan Sandbox Demo", "Coding猿沙盒演示")
    .replaceAll("coding-yuan-sandbox-demo", "编程猿沙盒演示")
    .replaceAll("AIWC", "AI 打工猿控制台")
    .replaceAll("L3 trusted operator", "L3 可信操作员")
    .replaceAll("Apply runner is disabled", "写入执行器默认关闭")
    .replaceAll("Set CODEX_OFFICE_ENABLE_APPLY_RUNNER=true only after approving direct project file writes.", "只有明确批准直接项目写入后，才可启用写入执行器。")
    .replaceAll("Apply runner did not write project code because confirmation, environment, rollback, or drift checks are not satisfied.", "写入执行器没有写入项目代码，因为确认语、环境开关、回滚快照或漂移检查尚未全部满足。")
    .replaceAll("Apply runner is enabled but still requires exact confirmation.", "写入执行器已启用，但仍需要精确确认。")
    .replaceAll("Project files were written after gate checks.", "项目文件只在闸门检查后写入。")
    .replaceAll("No project files are modified without explicit human approval.", "没有明确人工审批，不会修改项目文件。")
    .replaceAll("No project files are modified without explicit approval.", "没有明确审批，不会修改项目文件。")
    .replaceAll("No project files were modified.", "没有修改项目文件。")
    .replaceAll("Project files are unchanged.", "项目文件未被改动。")
    .replaceAll("Sandbox patch generated.", "沙盒补丁已生成。")
    .replaceAll("Sandbox artifact only", "仅沙盒产物")
    .replaceAll("Rollback snapshot ready", "回滚快照就绪")
    .replaceAll("Rollback snapshot is available.", "回滚快照可用。")
    .replaceAll("Rollback snapshot is missing.", "缺少回滚快照。")
    .replaceAll("Apply requires exact human confirmation", "写入需要精确人工确认")
    .replaceAll("Apply requires explicit approval", "写入需要明确审批")
    .replaceAll("Exact confirmation required", "需要精确确认")
    .replaceAll("Patch runner wrote sandbox patch artifacts only; project code was not modified.", "补丁执行器只生成沙盒补丁产物，没有改动项目代码。")
    .replaceAll("Operator demo approval covers sandbox patch artifacts only; direct project apply remains blocked.", "演示审批只覆盖沙盒补丁产物；真实写入仍然被阻断。")
    .replaceAll("local sandbox", "本地沙盒")
    .replaceAll("enabled", "已启用")
    .replaceAll("disabled", "已关闭")
    .replaceAll("Idle", "待命")
    .replaceAll("ready", "就绪")
    .replaceAll("pending", "等待中")
    .replaceAll("captured", "已采集")
    .replaceAll("requires confirmation", "需要确认")
    .replaceAll("sandbox written", "沙盒已写入")
    .replaceAll("passed", "通过")
    .replaceAll("blocked", "已阻断")
    .replaceAll("Coding猿", "编程猿")
    .replaceAll("Judge猿", "审核猿")
    .replaceAll("Ops猿", "运维猿")
    .replaceAll("Quant猿", "量化猿")
    .replaceAll("Security猿", "安全猿")
    .replaceAll("Hunter猿", "情报猿");

  return text;
}

function zhWorkerName(value = "", id = "") {
  return WORKER_NAME_ZH[value] || WORKER_NAME_ZH[id] || zhText(value || id || "员工");
}

function zhEvidenceRef(value = "") {
  const text = String(value || "");
  const parts = text.split("/").filter(Boolean);
  const file = parts.at(-1) || text;
  const parent = parts.at(-2) || "";
  const compact = file
    .replace(/^task_/, "")
    .replace(/\.json$/i, "")
    .replace(/manifest$/i, "清单");
  const displayId = compact === "清单" && parent
    ? `${formatRunId(parent)} 清单`
    : compact;
  const kind = text.includes("data/proposals/")
    ? "补丁方案"
    : text.includes("data/verifications/")
      ? "验证结果"
      : text.includes("data/patch-runs/")
        ? "沙盒补丁包"
        : text.includes("data/patch-applies/")
          ? "写入闸门清单"
          : text.includes("data/patch-sandbox/")
            ? "沙盒清单"
            : text.includes("data/patch-snapshots/")
              ? "回滚快照"
              : text.includes("data/evidence/")
                ? "运行证据"
                : "";
  return kind ? `${kind}：${displayId}` : zhText(text);
}

function formatRunId(value = "") {
  const raw = String(value || "").trim();
  if (!raw || raw === "no active run") return "暂无运行";
  const compact = raw.startsWith("task_")
    ? raw.split("_").filter(Boolean).at(-1) || raw.slice(-6)
    : raw.slice(-8);
  return `运行 #${compact}`;
}

function formatApprovalId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "审批 #待生成";
  const compact = raw.toLowerCase().includes("task_")
    ? raw.split("_").filter(Boolean).at(-1) || raw.slice(-6)
    : raw.slice(-6);
  return `审批 #${compact}`;
}

function compactHash(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "无哈希";
  return raw.length > 18 ? `${raw.slice(0, 10)}...${raw.slice(-6)}` : raw;
}

function confirmationLockHtml(value = "") {
  const phrase = String(value || "").trim() || "暂无确认语";
  return `
    <div class="confirmation-lock">
      <span>必须逐字输入</span>
      <code>${escapeHtml(phrase)}</code>
      <small>当前页面只展示确认文本，不会替你确认或写入项目文件。</small>
    </div>
  `;
}

function zhEventTitle(event) {
  const title = zhText(event?.title || "");
  const redundantPrefixes = {
    apply_gate_pending: /^写入闸门已检查：/,
    human_gate_approved: /^人工审批通过：|^Judge猿批准沙盒预检：/,
    patch_run_ready: /^沙盒补丁包已生成：|^补丁执行器就绪：/,
    patch_run_blocked: /^沙盒补丁已阻断：|^补丁执行器已阻断：/,
    task_completed: /^已完成：/,
    task_running: /^运行中：/,
    task_queued: /^排队中：/,
    task_blocked: /^已阻断：/
  };
  return title.replace(redundantPrefixes[event?.type] || /^$/, "").trim() || title;
}

function relativeTime(timestamp) {
  if (!timestamp) return "--";
  const value = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  if (!Number.isFinite(value)) return "--";
  const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}小时前`;
  const days = Math.round(hours / 24);
  return `${days}天前`;
}

function sortedProjects(projects) {
  const order = { running: 0, active: 1, draft: 2, ready: 3, idle: 4 };
  return [...projects].sort((a, b) => {
    const statusDelta = (order[a.status.key] ?? 9) - (order[b.status.key] ?? 9);
    if (statusDelta) return statusDelta;
    return (b.activity.latest || 0) - (a.activity.latest || 0);
  });
}

function statusCaption(project) {
  const changes = project.repo.changeCount;
  const ports = project.runningPorts.length;
  if (ports) return `${ports} 个端口在线`;
  if (changes) return `${changes} 个文件信号`;
  if (project.packages.length) return `${project.packages.length} 个包`;
  return "安静目录";
}

function riskLabel(risk) {
  const labels = {
    high: "人工闸门",
    low: "低风险",
    medium: "需复核"
  };
  return labels[risk] || "需复核";
}

function preferredProject(snapshot) {
  const projects = sortedProjects(snapshot?.projects || []);
  const selectedLocalProject = snapshot?.localProjects?.selectedProjectId
    ? projects.find((project) => project.id === snapshot.localProjects.selectedProjectId)
    : null;
  if (selectedLocalProject) return selectedLocalProject;
  const tasks = snapshot?.tasks || [];
  const latestEvidenceTaskId = snapshot?.launch?.latestEvidence?.taskId;
  const latestEvidenceTask = latestEvidenceTaskId
    ? tasks.find((task) => task.id === latestEvidenceTaskId)
    : null;
  const showcaseTask =
    latestEvidenceTask ||
    [...tasks]
      .filter((task) =>
        task.projectId === "coding-yuan-sandbox-demo" &&
        (task.result?.applyStatus || task.result?.patchRunStatus || task.applyRun || task.patchRun)
      )
      .sort((a, b) => taskEventTime(b) - taskEventTime(a))[0];
  const showcaseProject = showcaseTask
    ? projects.find((project) => project.id === showcaseTask.projectId)
    : projects.find((project) => project.id === "coding-yuan-sandbox-demo");
  return showcaseProject || projects[0] || null;
}

function latestClosedLoopCandidateTask(snapshot = state.snapshot) {
  return [...(snapshot?.tasks || [])]
    .filter((task) =>
      task.result?.applyStatus ||
      task.result?.patchRunStatus ||
      task.applyRun ||
      task.patchRun ||
      taskHasEvidencePath(task, "data/patch-applies/") ||
      taskHasEvidencePath(task, "data/patch-runs/")
    )
    .sort((a, b) => taskEventTime(b) - taskEventTime(a))[0] || null;
}

function latestClosedLoopTaskId(snapshot = state.snapshot) {
  return snapshot?.launch?.latestEvidence?.taskId || latestClosedLoopCandidateTask(snapshot)?.id || "";
}

function latestClosedLoopTask(snapshot = state.snapshot) {
  const taskId = latestClosedLoopTaskId(snapshot);
  return (snapshot?.tasks || []).find((task) => task.id === taskId) || latestClosedLoopCandidateTask(snapshot);
}

function isLatestClosedLoopProject(project, snapshot = state.snapshot) {
  const task = latestClosedLoopTask(snapshot);
  return Boolean(project?.id && task?.projectId && project.id === task.projectId);
}

function eventEvidenceRefs(event) {
  return Array.isArray(event?.evidence) ? event.evidence.join(" ") : "";
}

function isLatestClosedLoopEvent(event, snapshot = state.snapshot) {
  const taskId = latestClosedLoopTaskId(snapshot);
  if (!taskId || !event) return false;
  return taskIdFromTimelineEvent(event) === taskId || eventEvidenceRefs(event).includes(taskId);
}

function missionRibbonEvent(snapshot, project = currentProject() || preferredProject(snapshot)) {
  const events = snapshot?.events || [];
  const latestClosedTaskId = latestClosedLoopTaskId(snapshot);
  const latestTask = project?.id ? latestTaskForProject(snapshot, project.id) : null;
  const focusTaskId = isLatestClosedLoopProject(project, snapshot) ? latestClosedTaskId : latestTask?.id;
  return (
    events.find((event) => focusTaskId && (taskIdFromTimelineEvent(event) === focusTaskId || eventEvidenceRefs(event).includes(focusTaskId))) ||
    events.find((event) => project?.id && event.projectId === project.id) ||
    events[0] ||
    null
  );
}

function currentProject() {
  return state.snapshot?.projects?.find((project) => project.id === state.selectedId) || null;
}

function latestTaskForProject(snapshot, projectId) {
  const tasks = snapshot?.tasks || [];
  return latestTaskFromList(tasks, projectId) || latestTaskFromList(tasks) || null;
}

function taskById(taskId, snapshot = state.snapshot) {
  return (snapshot?.tasks || []).find((task) => task.id === taskId) || null;
}

function runPhaseLabel(phase) {
  const labels = {
    apply_blocked: "写入已阻断",
    apply_gate: "写入闸门",
    assigned: "已分配",
    completed: "已完成",
    diff_ready: "差异已生成",
    evidence_collecting: "采集证据中",
    failed: "失败",
    human_gate: "等待人工确认",
    judge_review: "审核中",
    patch_running: "沙盒补丁预检",
    proposal_generating: "生成补丁方案",
    queued: "排队中",
    rollback_ready: "回滚快照就绪",
    verification_failed: "验证失败",
    verification_passed: "验证通过",
    verification_running: "验证运行中"
  };
  return labels[phase] || "就绪";
}

function approvalStatusLabel(status) {
  const labels = {
    approved: "已批准",
    changes_requested: "需返工",
    held: "已挂起",
    pending: "待审批",
    reviewed: "已复核"
  };
  return labels[status] || zhStatus(status) || "待审批";
}

function taskStatusLabel(status) {
  const labels = {
    blocked: "已阻断",
    completed: "证据已生成",
    queued: "排队中",
    running: "运行中"
  };
  return labels[status] || zhStatus(status) || "排队中";
}

function objectiveStatusLabel(status) {
  const labels = {
    active: "进行中",
    blocked: "已阻断",
    complete: "已完成",
    next: "下一步"
  };
  return labels[status] || zhStatus(status) || "下一步";
}

function verdictLabel(verdict) {
  const labels = {
    certification_candidate: "可申请认证",
    not_autonomous: "暂不自治",
    supervised_only: "仅监督模式"
  };
  return labels[verdict] || "暂不自治";
}

function verificationStatusLabel(status) {
  const labels = {
    blocked: "验证被闸门阻断",
    failed: "验证失败",
    not_run: "等待验证",
    passed: "验证通过"
  };
  return labels[status] || "等待验证";
}

function verificationStatusFromSummary(verification) {
  if (!verification) return "not_run";
  if (verification.status) return verification.status;
  if (verification.result?.ok) return "passed";
  return verification.script ? "failed" : "blocked";
}

function patchRunStatusLabel(status) {
  const labels = {
    blocked: "补丁被阻断",
    dry_run: "补丁预演",
    not_run: "等待补丁",
    sandbox_written: "沙盒已写入"
  };
  return labels[status] || "等待补丁";
}

function applyRunStatusLabel(status) {
  const labels = {
    applied: "补丁已写入",
    blocked: "写入已阻断",
    not_run: "等待写入检查",
    requires_confirmation: "写入需确认"
  };
  return labels[status] || "等待写入检查";
}

async function postJson(url, payload, options = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `请求失败：${response.status}`);
  }
  return response.json();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `请求失败：${response.status}`);
  }
  return response.json();
}

async function saveLocalProjectRoot({
  path,
  name,
  quiet = false,
  securityScopedBookmark = "",
  authorizationSource = "local_path"
} = {}) {
  const rootPath = String(path || "").trim();
  if (!rootPath) {
    if (!quiet) setControlStatus("请先输入 project root");
    return null;
  }

  if (!quiet) setControlStatus("正在保存 project root...");
  const result = await postJson("/api/local-projects", {
    path: rootPath,
    name,
    securityScopedBookmark,
    authorizationSource,
    selected: true
  });
  if (result.project?.id) {
    state.selectedId = result.project.id;
    state.selectionLocked = true;
  }
  if (!quiet) {
    setControlStatus("project root 已保存");
    if (elements.projectRootStatus) elements.projectRootStatus.textContent = `已绑定：${zhText(result.project?.name || name || "本地项目")}`;
  }
  await fetchStatus();
  return result;
}

function projectNameFromPath(path = "") {
  return String(path || "").split("/").filter(Boolean).at(-1) || "本地项目";
}

function chooseProjectFolderWithMacAppBridge() {
  const handler = window.webkit?.messageHandlers?.codingYuanOffice;
  if (!handler) return null;

  return new Promise((resolve, reject) => {
    const requestId = `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      delete window.__codingYuanNativeFolderPickerCallbacks?.[requestId];
      reject(new Error("Native folder picker timed out."));
    }, 120000);

    window.__codingYuanNativeFolderPickerCallbacks = window.__codingYuanNativeFolderPickerCallbacks || {};
    window.__codingYuanNativeFolderPickerCallbacks[requestId] = (payload = {}) => {
      window.clearTimeout(timeout);
      delete window.__codingYuanNativeFolderPickerCallbacks[requestId];
      if (payload.ok && payload.path) {
        resolve(payload);
      } else {
        reject(new Error(payload.error || "Folder picker was cancelled."));
      }
    };

    handler.postMessage({
      action: "chooseProjectFolder",
      requestId
    });
  });
}

window.__codingYuanNativeFolderPickerResult = (requestId, payload) => {
  const callback = window.__codingYuanNativeFolderPickerCallbacks?.[requestId];
  if (callback) callback(payload);
};

async function chooseProjectFolder() {
  setControlStatus("正在打开项目文件夹选择器...");
  if (elements.projectRootStatus) {
    elements.projectRootStatus.textContent = "等待选择文件夹";
  }

  try {
    const result = await chooseProjectFolderWithMacAppBridge();
    if (result?.path) {
      if (elements.projectRootInput) elements.projectRootInput.value = result.path;
      await saveLocalProjectRoot({
        path: result.path,
        name: result.name || projectNameFromPath(result.path),
        securityScopedBookmark: result.securityScopedBookmark || "",
        authorizationSource: result.authorizationSource || "mac_app_security_scoped_bookmark"
      });
      setControlStatus("已通过 Mac App 沙盒授权绑定项目");
      return;
    }
  } catch (error) {
    if (/cancelled|canceled|取消/i.test(String(error?.message || ""))) {
      setControlStatus("已取消选择文件夹");
      if (elements.projectRootStatus) elements.projectRootStatus.textContent = "未更改";
      return;
    }
  }

  try {
    const result = await postJson("/api/native/folder-picker", {}, {
      headers: {
        "X-Codex-Office-Local": "native-folder-picker"
      }
    });
    if (result?.path) {
      if (elements.projectRootInput) elements.projectRootInput.value = result.path;
      await saveLocalProjectRoot({
        path: result.path,
        name: result.name || projectNameFromPath(result.path),
        authorizationSource: "local_backend_picker"
      });
      setControlStatus("已通过 macOS 文件夹选择器绑定项目");
      return;
    }
  } catch (error) {
    if (/cancelled|canceled|取消/i.test(String(error?.message || ""))) {
      setControlStatus("已取消选择文件夹");
      if (elements.projectRootStatus) elements.projectRootStatus.textContent = "未更改";
      return;
    }
  }

  if ("showDirectoryPicker" in window) {
    try {
      const handle = await window.showDirectoryPicker({ mode: "read" });
      const name = handle?.name || "Selected folder";
      if (elements.projectRootInput) {
        elements.projectRootInput.placeholder = `/Users/you/path/to/${name}`;
        elements.projectRootInput.focus();
      }
      if (elements.projectRootStatus) {
        elements.projectRootStatus.textContent = `已选择：${name}，请粘贴 Mac 绝对路径完成绑定`;
      }
      setControlStatus("浏览器已拿到文件夹名称；当前 Node 后端仍需要绝对路径");
      return;
    } catch (error) {
      if (/abort|cancel/i.test(String(error?.name || error?.message || ""))) {
        setControlStatus("已取消选择文件夹");
        return;
      }
    }
  }

  if (elements.projectRootInput) elements.projectRootInput.focus();
  if (elements.projectRootStatus) {
    elements.projectRootStatus.textContent = "请输入或粘贴 Mac 项目绝对路径";
  }
  setControlStatus("当前浏览器不能提供真实路径，请粘贴项目绝对路径");
}

function setControlStatus(message) {
  if (!elements.detailControlStatus) return;
  elements.detailControlStatus.textContent = zhText(message);
}

function demoRunErrorMessage(error) {
  const message = String(error?.message || error || "");
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "演示接口暂时连不上。原业务没有被影响，请刷新后重试。";
  }
  if (/Project not found/i.test(message)) {
    return "没有找到演示项目。请先刷新工作区，再运行三猿演示。";
  }
  if (/Task is already running/i.test(message)) {
    return "已有任务正在运行，请等它结束后再试。";
  }
  if (/timeout/i.test(message)) {
    return "演示运行超时。安全闸门仍保持阻断，可以刷新后重试。";
  }
  return zhText(message || "演示运行失败。安全闸门仍保持阻断。");
}

function uiErrorMessage(error, fallback = "操作失败") {
  return zhText(String(error?.message || error || fallback || "操作失败"));
}

function setLiveRunStatus(status, message = "", error = "", patch = {}) {
  state.liveRun = {
    ...state.liveRun,
    ...patch,
    error,
    message,
    startedAt: status === "running" ? Date.now() : state.liveRun.startedAt,
    status
  };
  if (status === "running") {
    startLiveRunPolling();
  } else {
    stopLiveRunPolling();
  }
  renderLiveRunState();
}

function liveRunTask(snapshot = state.snapshot) {
  const live = state.liveRun || {};
  const tasks = snapshot?.tasks || [];
  if (!tasks.length) return null;
  if (live.runId) return tasks.find((task) => task.id === live.runId) || null;
  const projectTask = latestTaskForProject(snapshot, live.projectId || state.selectedId);
  if (!projectTask) return null;
  const isFresh = live.startedAt ? taskEventTime(projectTask) >= live.startedAt - 1000 : true;
  return isFresh ? projectTask : null;
}

function syncLiveRunFromSnapshot(snapshot) {
  if (state.liveRun?.status !== "running") return;
  const task = liveRunTask(snapshot);
  if (!task) return;
  state.liveRun = {
    ...state.liveRun,
    message: zhText(task.title || state.liveRun.message),
    projectId: task.projectId || state.liveRun.projectId,
    runId: task.id || state.liveRun.runId
  };
  if (task.projectId) {
    state.selectedId = task.projectId;
  }
}

function liveRunElapsedLabel() {
  if (!state.liveRun.startedAt) return "刚刚开始";
  const seconds = Math.max(1, Math.round((Date.now() - state.liveRun.startedAt) / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`;
}

function renderCommandProgress(task, director = null) {
  if (!elements.commandProgressBar || !elements.commandProgressSteps) return;
  const phase = director?.phase || runPhaseFromTask(task);
  const progress = typeof director?.progress === "number" ? director.progress : missionProgress(task);
  const focusNode = visibleMissionFlowNodeId(director?.focusNode || phase);
  const nodes = COMPACT_MISSION_FLOW_NODES;

  elements.commandProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  elements.commandProgressSteps.innerHTML = nodes.map((node) => {
    const status = compactFlowStatusForNode(task, node);
    const active = node.id === focusNode ? " is-active" : "";
    return `<span class="status-${escapeHtml(status)}${active}">${escapeHtml(node.label)}</span>`;
  }).join("");
}

function setCommandRunReceipt(status, message) {
  if (!elements.commandRunReceipt) return;
  elements.commandRunReceipt.dataset.status = status || "idle";
  elements.commandRunReceipt.textContent = zhText(message || "待命：运行后会显示真实运行编号、阶段和闸门状态。");
}

function completedRunReceiptMessage(live = {}, task = null) {
  const runLabel = task?.id ? `${formatRunId(task.id)} · ` : "";
  const mode = live.mode || missionModeFromTask(task);
  const messages = {
    review_only: "证据包已刷新；本次未生成补丁，也未进入写入闸门",
    proposal: "证据和方案已刷新；本次未运行验证，也未进入写入闸门",
    verify: "证据、方案和验证已刷新；本次未进入写入闸门",
    sandbox_patch: "证据、沙盒补丁和写入闸门已刷新"
  };
  return `闭环完成 · ${runLabel}${messages[mode] || "运行证据已刷新"}`;
}

function startLiveRunPolling() {
  if (liveRunPollTimer || typeof window === "undefined") return;
  liveRunPollTimer = window.setInterval(() => {
    if (state.liveRun?.status !== "running") {
      stopLiveRunPolling();
      return;
    }
    fetchStatus().catch(() => {});
  }, 700);
}

function stopLiveRunPolling() {
  if (!liveRunPollTimer || typeof window === "undefined") return;
  window.clearInterval(liveRunPollTimer);
  liveRunPollTimer = null;
}

function renderLiveRunState() {
  const live = state.liveRun || { status: "idle" };
  const isRunning = live.status === "running";
  const isFailed = live.status === "failed";
  const isDone = live.status === "completed";
  const selectedMode = isRunning ? live.mode : selectedMissionMode();
  const buttonStates = [
    [elements.newMissionButton, "运行当前任务", "编程猿工作中"],
    [elements.assignMissionButton, missionModeActionLabel(selectedMode), missionModeRunningLabel(selectedMode)],
    [elements.runCodingLoopButton, "运行闭环", "闭环运行中"],
    [elements.runCodingLoopHeroButton, "运行三猿演示", "三猿工作中"]
  ].filter(([button]) => Boolean(button));

  for (const [button, idleLabel, runningLabel] of buttonStates) {
    button.disabled = isRunning;
    button.classList.toggle("is-running", isRunning);
    button.textContent = isRunning ? runningLabel : idleLabel;
    button.setAttribute("aria-busy", isRunning ? "true" : "false");
  }

  if (elements.deckViewport) {
    elements.deckViewport.dataset.liveRun = live.status || "idle";
    elements.deckViewport.dataset.liveMode = live.mode || "";
    const task = liveRunTask() || latestTaskForProject(state.snapshot, state.selectedId);
    if (task) {
      elements.deckViewport.dataset.livePhase = runPhaseFromTask(task);
    } else if (!isRunning && !isDone) {
      delete elements.deckViewport.dataset.livePhase;
    }
  }

  if (isRunning) {
    const task = liveRunTask();
    if (task) {
      const phase = runPhaseFromTask(task);
      const director = missionDirectorForTask(task, {
        applyRunnerEnabled: Boolean(state.snapshot?.autonomy?.metrics?.applyRunnerEnabled),
        project: currentProject() || preferredProject(state.snapshot)
      });
      if (elements.deckViewport) elements.deckViewport.dataset.livePhase = phase;
      if (elements.commandMode) {
        elements.commandMode.textContent = `${missionModeLabel(live.mode)} · ${runPhaseLabel(phase)} · ${liveRunElapsedLabel()}`;
      }
      if (elements.commandPhase) elements.commandPhase.textContent = `阶段：${runPhaseLabel(phase)}`;
      if (elements.commandRun) elements.commandRun.textContent = `运行：${formatRunId(task.id)}`;
      setCommandRunReceipt("running", `真实运行已接入 · ${formatRunId(task.id)} · ${runPhaseLabel(phase)} · ${liveRunElapsedLabel()}`);
      renderCommandProgress(task, director);
      return;
    }

    const message = live.message || "三猿闭环正在后台真实执行，完成后会自动打开证据。";
    if (elements.stageTitle) elements.stageTitle.textContent = message;
    if (elements.roomTitle) elements.roomTitle.textContent = "三猿闭环运行中";
    if (elements.commandMode) elements.commandMode.textContent = `${missionModeLabel(live.mode)} · 真实接口运行中 · ${liveRunElapsedLabel()}`;
    if (elements.commandPhase) elements.commandPhase.textContent = "阶段：创建运行";
    if (elements.commandRun) elements.commandRun.textContent = "运行：等待编号";
    setCommandRunReceipt("running", `已提交后端 · 等待真实事件 · ${liveRunElapsedLabel()}`);
    renderCommandProgress(null, { focusNode: "task", progress: 6, phase: "queued" });
    if (elements.latestEvidenceStatus) elements.latestEvidenceStatus.textContent = "后台执行中";
    if (elements.latestEvidenceSummary) {
      elements.latestEvidenceSummary.textContent = "正在等待后端返回证据包、验证结果、沙盒补丁和写入闸门清单。";
    }
    if (elements.directorWorker) elements.directorWorker.textContent = "编程猿正在接单";
    if (elements.directorSafety) elements.directorSafety.textContent = "沙盒模式已开启，写入仍由人工闸门保护。";
    if (elements.directorNext) elements.directorNext.textContent = "等待后端完成证据闭环。";
    return;
  }

  if (isFailed) {
    const message = live.error || "演示运行失败。安全闸门仍保持阻断。";
    if (elements.commandMode) elements.commandMode.textContent = "演示失败 · 安全保持阻断";
    if (elements.latestEvidenceStatus) elements.latestEvidenceStatus.textContent = "运行失败";
    if (elements.latestEvidenceSummary) elements.latestEvidenceSummary.textContent = message;
    if (elements.directorSafety) elements.directorSafety.textContent = "失败不会写入项目文件。";
    if (elements.directorNext) elements.directorNext.textContent = "刷新状态或重新运行演示。";
    setCommandRunReceipt("failed", `运行失败 · ${message}`);
    renderCommandProgress(liveRunTask(), { focusNode: "apply", progress: 100, phase: "failed" });
    return;
  }

  if (isDone) {
    const task = liveRunTask() || latestTaskForProject(state.snapshot, live.projectId || state.selectedId);
    if (elements.deckViewport && task) elements.deckViewport.dataset.livePhase = runPhaseFromTask(task);
    if (elements.commandMode) elements.commandMode.textContent = live.message || "三猿闭环已完成 · 写入闸门保持可审计";
    if (elements.latestEvidenceStatus) elements.latestEvidenceStatus.textContent = "闭环完成";
    setCommandRunReceipt("completed", completedRunReceiptMessage(live, task));
    renderCommandProgress(task, task ? missionDirectorForTask(task, {
      applyRunnerEnabled: Boolean(state.snapshot?.autonomy?.metrics?.applyRunnerEnabled),
      project: currentProject() || preferredProject(state.snapshot)
    }) : { focusNode: "apply", progress: 100, phase: "completed" });
  }

  if (!isRunning && !isFailed && !isDone) {
    setCommandRunReceipt("idle", "待命：运行后会显示真实运行编号、阶段和闸门状态。");
  }
}

function workerTemplate(worker) {
  const live = worker.status === "running" || worker.status === "working";
  const empty = worker.projectCount ? "" : " is-empty";
  const selected = worker.projectIds?.includes(state.selectedId) ? " is-selected" : "";
  const launchTier = worker.launchTier === "core" ? " is-core" : " is-bench";
  const queue = String(worker.queue || 0).padStart(2, "0");
  const task = worker.currentTask || "待命";
  const domain = WORKER_DOMAIN_ZH[worker.domain] || zhText(worker.domain);
  const launchLabel = worker.launchLabel === "Core" || worker.launchLabel === "Launch crew"
    ? "核心"
    : worker.launchLabel === "Bench" || worker.launchLabel === "Next hire"
      ? "待上线"
      : zhText(worker.launchLabel || "员工");

  return `
    <button class="worker-card worker-${escapeHtml(worker.status)}${live ? " is-live" : ""}${empty}${selected}${launchTier} accent-${escapeHtml(worker.accent)}" data-worker-id="${escapeHtml(worker.id)}" type="button">
      <span class="worker-avatar">${escapeHtml(worker.mark)}</span>
      <div class="worker-copy">
        <strong>${escapeHtml(zhWorkerName(worker.name, worker.id))} <span>${escapeHtml(launchLabel)}</span></strong>
        <small>${escapeHtml(domain)} · ${escapeHtml(zhStatus(worker.statusLabel || worker.status))} · ${escapeHtml(riskLabel(worker.risk))}</small>
        <em>${escapeHtml(zhText(task))}</em>
      </div>
      <b>${escapeHtml(queue)}</b>
    </button>
  `;
}

function approvalTemplate(approval) {
  const disabled = approval.status !== "pending" ? " disabled" : "";
  const approveLabel = approval.gateType === "close_loop" ? "批准" : "已复核";
  const holdLabel = approval.gateType === "close_loop" ? "返工" : "挂起";
  const holdAction = approval.gateType === "close_loop" ? "changes_requested" : "held";
  return `
    <article class="approval-item risk-${escapeHtml(approval.risk || "high")} status-${escapeHtml(approval.status || "pending")}" data-approval-id="${escapeHtml(approval.id)}" data-gate-type="${escapeHtml(approval.gateType || "project_risk")}">
      <div>
        <span>${escapeHtml(zhWorkerName(approval.workerName, approval.workerId || "judge-yuan"))} · ${escapeHtml(approvalStatusLabel(approval.status))}</span>
        <strong>${escapeHtml(zhText(approval.title))}</strong>
        <small>${escapeHtml(zhText(approval.projectName || approval.reason || "人工闸门"))}</small>
      </div>
      <div class="approval-actions">
        <button type="button" data-approval-action="approved"${disabled}>${escapeHtml(approveLabel)}</button>
        <button type="button" data-approval-action="${escapeHtml(holdAction)}"${disabled}>${escapeHtml(holdLabel)}</button>
      </div>
    </article>
  `;
}

function taskTemplate(task) {
  const runnable = task.status === "queued" || task.status === "blocked";
  const runDisabled = runnable ? "" : " disabled";
  const mode = missionModeFromTask(task);
  const canVerifyMode = mode === "verify" || mode === "sandbox_patch";
  const canPatchMode = mode === "sandbox_patch";
  const hasEvidence = task.evidence?.some((item) => String(item).startsWith("data/evidence/"));
  const hasProposal = Boolean(task.proposal || task.evidence?.some((item) => String(item).startsWith("data/proposals/")));
  const hasVerification = task.evidence?.some((item) => String(item).startsWith("data/verifications/")) || task.verification;
  const hasPatchRun = task.evidence?.some((item) => String(item).startsWith("data/patch-runs/")) || task.patchRun;
  const evidenceDisabled = hasEvidence ? "" : " disabled";
  const proposalDisabled = hasEvidence && !hasProposal ? "" : " disabled";
  const verificationDisabled = canVerifyMode && hasEvidence && !hasVerification ? "" : " disabled";
  const patchDisabled = canPatchMode && hasProposal ? "" : " disabled";
  const applyDisabled = canPatchMode && hasPatchRun ? "" : " disabled";
  const patchLabel = canPatchMode ? "沙盒补丁" : "本次不补丁";
  const applyLabel = canPatchMode ? "写入闸门" : "本次不写入";
  const verifyLabel = canVerifyMode ? "验证" : "本次不验证";
  const evidence = task.evidence?.[0] ? `<small>${escapeHtml(zhEvidenceRef(task.evidence[0]))}</small>` : "";
  const phase = runPhaseFromTask(task);
  const progress = missionProgress(task);
  const gate = task.result?.applyStatus
    ? applyRunStatusLabel(task.result.applyStatus)
    : task.result?.humanGateStatus
      ? humanGateStatusLabel(task.result.humanGateStatus)
      : "闸门待确认";
  return `
    <article class="task-item status-${escapeHtml(task.status || "queued")} risk-${escapeHtml(task.risk || "low")}" data-task-id="${escapeHtml(task.id)}">
      <div>
        <span>${escapeHtml(zhWorkerName(task.workerName, task.workerId))} · ${escapeHtml(taskStatusLabel(task.status))}</span>
        <strong>${escapeHtml(zhText(task.title))}</strong>
        ${evidence}
        <div class="task-phase-strip">
          <b>${escapeHtml(runPhaseLabel(phase))}</b>
          <em>${escapeHtml(gate)}</em>
          <i>${escapeHtml(String(progress))}%</i>
        </div>
      </div>
      <div class="task-actions">
        <button type="button" data-task-action="run"${runDisabled}>采集</button>
        <button type="button" data-task-action="verify"${verificationDisabled}>${escapeHtml(verifyLabel)}</button>
        <button type="button" data-task-action="view"${evidenceDisabled}>打开证据</button>
        <button type="button" data-task-action="plan"${proposalDisabled}>方案</button>
        <button type="button" data-task-action="patch"${patchDisabled}>${escapeHtml(patchLabel)}</button>
        <button type="button" data-task-action="apply"${applyDisabled}>${escapeHtml(applyLabel)}</button>
      </div>
    </article>
  `;
}

function renderWorkers(snapshot) {
  const workers = snapshot.workers || [];
  const visibleWorkers = workers.filter((worker) =>
    worker.launchTier === "core" || ["coding-yuan", "judge-yuan", "ops-yuan"].includes(worker.id)
  ).slice(0, 3);
  const activeQueues = visibleWorkers.reduce((total, worker) => total + (worker.queue || 0), 0);
  const gated = visibleWorkers.filter((worker) => worker.risk === "high").length;

  elements.workerUniverseSignal.textContent =
    `${visibleWorkers.length} 个核心员工 · ${activeQueues} 个队列${gated ? ` · ${gated} 个被闸门保护` : ""}`;
  elements.workerGrid.innerHTML = visibleWorkers.map(workerTemplate).join("");

  elements.workerGrid.querySelectorAll(".worker-card").forEach((card) => {
    card.addEventListener("click", () => {
      const worker = visibleWorkers.find((candidate) => candidate.id === card.dataset.workerId);
      if (worker?.currentProjectId) {
        state.selectedId = worker.currentProjectId;
        state.selectionLocked = true;
        render();
      }
    });
  });
}

function eventSnapshot(event) {
  if (!event) return null;
  return {
    ...event,
    id: event.id || timelineEventKey(event),
    evidence: Array.isArray(event.evidence) ? [...event.evidence] : []
  };
}

function eventTemplate(event) {
  const eventKey = timelineEventKey(event);
  const selected = eventKey && eventKey === state.selectedEventId ? " is-selected" : "";
  const latestClosedLoop = isLatestClosedLoopEvent(event) ? " is-latest-closed-loop" : "";
  const taskId = taskIdFromTimelineEvent(event);
  const eventType = zhEventType(event.type || "event");
  const eventTime = relativeTime(event.timestamp);
  const eventMode = missionModeFromTimelineEvent(event);
  return `
    <button class="feed-event risk-${escapeHtml(event.risk || "low")}${selected}${latestClosedLoop}" data-event-id="${escapeHtml(eventKey)}" data-event-type="${escapeHtml(event.type || "")}" data-project-id="${escapeHtml(event.projectId || "")}" data-task-id="${escapeHtml(taskId)}" type="button">
      <i class="feed-event-pin" aria-hidden="true"></i>
      <span>${escapeHtml(zhWorkerName(event.workerName, event.workerId))} · ${escapeHtml(eventType)}</span>
      ${eventMode ? `<mark class="feed-mode-badge">${escapeHtml(missionModeLabel(eventMode))}</mark>` : ""}
      ${latestClosedLoop ? `<mark class="latest-loop-badge">最新闭环</mark>` : ""}
      <strong>${escapeHtml(zhEventTitle(event))}</strong>
      <small>${escapeHtml(zhText(event.detail || "工作区"))}</small>
      <em>${escapeHtml(eventTime)}</em>
    </button>
  `;
}

function selectedTimelineEvent(snapshot) {
  if (!state.selectedEventId) return state.selectedReplayEvent;
  return (snapshot?.events || []).find((event) => timelineEventKey(event) === state.selectedEventId) || state.selectedReplayEvent;
}

function selectedReplayFocus(snapshot) {
  const event = selectedTimelineEvent(snapshot);
  return event ? timelineReplaySummary(event) : state.selectedReplaySummary;
}

function timelineEvidenceList(event) {
  const evidence = Array.isArray(event?.evidence) ? event.evidence.slice(0, 5) : [];
  return evidence.length ? evidence.map(zhEvidenceRef) : ["这个事件没有附加证据"];
}

function renderEventReplay(snapshot) {
  if (!elements.eventReplayPanel) return;
  const event = selectedTimelineEvent(snapshot);
  const replay = event ? timelineReplaySummary(event) : state.selectedReplaySummary;
  if (!event || !replay) {
    elements.eventReplayPanel.hidden = true;
    return;
  }

  elements.eventReplayPanel.hidden = false;
  elements.eventReplayPanel.className = `event-replay-panel severity-${escapeHtml(replay.severity)}`;
  elements.eventReplayTitle.textContent = "时间线回放";
  elements.eventReplayStatus.textContent = zhTab(replay.inspectorTab);
  elements.eventReplayBody.innerHTML = `
    <div class="event-replay-main">
      <span>${escapeHtml(zhWorkerName(event.workerName, event.workerId))} · ${escapeHtml(zhEventType(replay.type))}</span>
      <strong>${escapeHtml(zhEventTitle(event))}</strong>
      <small>${escapeHtml(zhText(event.detail || "工作区"))} · ${escapeHtml(relativeTime(event.timestamp))}</small>
    </div>
    <div class="event-replay-grid">
      <div><span>路由</span><strong>${escapeHtml(zhTab(replay.inspectorTab))}</strong></div>
      <div><span>任务</span><strong>${escapeHtml(replay.taskId || "无")}</strong></div>
      <div><span>聚焦员工</span><strong>${escapeHtml(zhText(replay.focusWorkerId || "无"))}</strong></div>
      <div><span>流程节点</span><strong>${escapeHtml(zhStatus(replay.focusNode || "无"))}</strong></div>
      <div><span>证据</span><strong>${escapeHtml(String(replay.evidenceCount))}</strong></div>
      <div><span>级别</span><strong>${escapeHtml(zhStatus(replay.severity))}</strong></div>
    </div>
    <div class="event-replay-evidence">
      <span>关联证据</span>
      ${insightList(timelineEvidenceList(event))}
    </div>
  `;
}

function renderWorkfeed(snapshot) {
  const events = snapshot.events || [];
  const project = currentProject() || preferredProject(snapshot);
  const task = latestTaskFromList(snapshot.tasks || [], project?.id || "");
  const mode = missionModeFromTask(task);
  const keyEvents = significantTimelineEvents(events, { limit: 8, taskId: task?.id || "", mode });
  elements.workfeedSignal.textContent = keyEvents.length
    ? `${keyEvents.length} 个关键事件 · 当前任务 ${task?.id || "未锁定"}`
    : "暂无信号";
  elements.workfeedList.innerHTML = keyEvents.length
    ? keyEvents.map(eventTemplate).join("")
    : `<div class="feed-empty">暂无员工事件</div>`;

  elements.workfeedList.querySelectorAll(".feed-event").forEach((eventButton) => {
    eventButton.addEventListener("click", () => {
      const event = events.find((candidate) => timelineEventKey(candidate) === eventButton.dataset.eventId);
      openTimelineReplay(event);
    });
  });
}

function renderReplaySurfaces() {
  if (!state.snapshot) return;
  const project = currentProject() || preferredProject(state.snapshot);
  renderWorkfeed(state.snapshot);
  renderEventReplay(state.snapshot);
  renderMissionFlow(state.snapshot, project);
  renderCoreWorkerStations(state.snapshot, project);
}

function openTimelineReplay(event) {
  if (!event) return;
  const snapshot = eventSnapshot(event);
  const replay = timelineReplaySummary(snapshot);
  state.selectedEventId = timelineEventKey(snapshot);
  state.selectedReplayEvent = snapshot;
  state.selectedReplaySummary = replay;
  state.inspectorTab = replay.inspectorTab;
  state.inspectorOpen = true;
  if (replay.projectId) {
    state.selectedId = replay.projectId;
  }
  state.taskInsight = null;
  render();
  if (replay.inspectorTab === "evidence" && replay.taskId) {
    viewTaskEvidence(replay.taskId);
  } else if (replay.inspectorTab === "gate" && replay.taskId) {
    viewTaskGateEvidence(replay.taskId);
  }
}

function renderApprovalQueue(snapshot, selectedProject) {
  const approvals = snapshot.approvals || [];
  const projectApprovals = selectedProject
    ? approvals.filter((approval) => approval.projectId === selectedProject.id)
    : [];
  const visibleApprovals = [
    ...projectApprovals,
    ...approvals.filter((approval) => !projectApprovals.includes(approval))
  ].slice(0, 5);
  const pendingCount = approvals.filter((approval) => approval.status === "pending").length;

  elements.approvalCount.textContent = String(pendingCount);
  elements.approvalList.innerHTML = visibleApprovals.length
    ? visibleApprovals.map(approvalTemplate).join("")
    : `<div class="approval-empty">暂无人工闸门</div>`;
}

function renderTaskQueue(snapshot, selectedProject) {
  const tasks = snapshot.tasks || [];
  const projectTasks = selectedProject
    ? tasks.filter((task) => task.projectId === selectedProject.id)
    : [];
  const visibleTasks = [
    ...projectTasks,
    ...tasks.filter((task) => !projectTasks.includes(task))
  ].slice(0, 5);

  elements.taskCount.textContent = String(tasks.length);
  elements.taskQueueList.innerHTML = visibleTasks.length
    ? visibleTasks.map(taskTemplate).join("")
    : `<div class="task-empty">暂无排队任务</div>`;
}

function insightList(items = []) {
  return items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(zhText(item))}</li>`).join("")}</ul>`
    : `<p>暂未采集到信号。</p>`;
}

function renderTaskInsight() {
  const selectedProject = currentProject() || preferredProject(state.snapshot);
  const task = latestTaskForProject(state.snapshot, selectedProject?.id);
  const insight = state.taskInsight;
  const isEvidenceInsight =
    insight?.context === "evidence" && (!insight.taskId || insight.taskId === task?.id);

  if (!isEvidenceInsight) {
    elements.taskInsightTitle.textContent = "证据包";
    elements.taskInsightStatus.textContent = task ? evidencePackStatusLabel(task) : "待命";
    elements.taskInsightBody.innerHTML = evidencePackOverviewHtml(task);
    syncApplyGateControls(elements.taskInsightBody);
    return;
  }

  elements.taskInsightTitle.textContent = zhText(insight.title);
  elements.taskInsightStatus.textContent = zhText(insight.status);
  elements.taskInsightBody.innerHTML = insight.html;
  syncApplyGateControls(elements.taskInsightBody);
}

function scrollInspectorToEvidenceFocus(focus = "top") {
  const runScroll = () => {
    const panel = elements.detailPanel;
    const target =
      focus === "diff"
        ? elements.taskInsightBody.querySelector(".diff-dossier")
        : elements.taskInsightBody.querySelector(".evidence-audit-pack, .task-insight-body > *");
    if (!panel || !target) return;

    const panelRect = panel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = Math.max(0, panel.scrollTop + targetRect.top - panelRect.top - 92);
    panel.scrollTo({ top: nextTop, behavior: "smooth" });
  };

  window.requestAnimationFrame(runScroll);
}

function scrollInspectorToGateFocus() {
  const runScroll = () => {
    const panel = elements.detailPanel;
    const target = elements.gateInsightBody?.querySelector(".apply-run-card, .human-gate-card, .gate-command-center");
    if (!panel || !target) return;

    const panelRect = panel.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = Math.max(0, panel.scrollTop + targetRect.top - panelRect.top - 92);
    panel.scrollTo({ top: nextTop, behavior: "smooth" });
  };

  window.requestAnimationFrame(runScroll);
}

function navigateGateSurface(action, taskId) {
  if (!taskId) return;
  if (action === "evidence") {
    state.inspectorTab = "evidence";
    state.inspectorOpen = true;
    setInspectorOpen(true);
    renderInspectorTabs();
    viewTaskEvidence(taskId, { focus: "diff" });
    return;
  }

  if (action === "gate") {
    state.inspectorTab = "gate";
    state.inspectorOpen = true;
    setInspectorOpen(true);
    viewTaskGateEvidence(taskId, { focus: "gate" });
  }
}

function evidencePackStatusLabel(task) {
  if (!task) return "待命";
  if (task.result?.applyStatus) return applyRunStatusLabel(task.result.applyStatus);
  if (task.result?.patchRunStatus) return patchRunStatusLabel(task.result.patchRunStatus);
  if (task.result?.humanGateStatus) return humanGateStatusLabel(task.result.humanGateStatus);
  if (task.result?.verificationStatus) return verificationStatusLabel(task.result.verificationStatus);
  if (task.proposal || taskHasEvidencePath(task, "data/proposals/")) return "方案已就绪";
  if (taskHasEvidencePath(task, "data/evidence/")) return "已采集";
  return "等待中";
}

function evidenceSectionStatus(task, section) {
  if (!task) return "missing";
  const result = task.result || {};
  const has = (prefix) => taskHasEvidencePath(task, prefix);
  const statuses = {
    command: has("data/evidence/") ? "ready" : "missing",
    diff: result.patchRunStatus === "sandbox_written" ? "ready" : has("data/patch-runs/") ? "partial" : "missing",
    test:
      result.verificationStatus === "passed"
        ? "verified"
        : result.verificationStatus === "failed"
          ? "failed"
          : has("data/verifications/")
            ? "partial"
            : "missing",
    proposal: task.proposal || has("data/proposals/") ? "ready" : "missing",
    rollback: result.patchRunStatus === "sandbox_written" ? "ready" : has("data/patch-runs/") ? "partial" : "missing",
    apply:
      result.applyStatus === "requires_confirmation" || result.applyStatus === "blocked"
        ? "blocked"
        : result.applyStatus === "applied"
          ? "verified"
          : task.applyRun || has("data/patch-applies/")
            ? "ready"
            : "missing"
  };
  return statuses[section] || "missing";
}

function evidenceSectionRow(task, section, label, detail) {
  const status = evidenceSectionStatus(task, section);
  return `
    <div class="evidence-section-row status-${escapeHtml(status)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(zhStatus(status))}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function evidencePackOverviewHtml(task) {
  if (!task) {
    return `
      <p>选择或创建一个任务，就会生成只读证据包。</p>
      <div class="evidence-audit-pack is-empty">
        <div class="audit-pack-header">
          <span>证据编号</span>
          <strong>暂无运行</strong>
          <small>命令日志、差异、测试、回滚和写入闸门证据会显示在这里。</small>
        </div>
      </div>
    `;
  }

  const phase = runPhaseFromTask(task);
  const readOnly = taskHasEvidencePath(task, "data/evidence/") ? "只读证据已采集" : "等待采集";
  const integrity = task.result?.applyPath || task.applyRun
    ? "写入清单已采集"
    : task.result?.patchRunPath || task.patchRun
      ? "沙盒清单已采集"
      : "等待清单";
  const sectionDefs = [
    ["command", "命令日志", "只读工作区信号"],
    ["proposal", "补丁方案", "审核猿可审核的变更计划"],
    ["test", "验证结果", "白名单测试/检查证据"],
    ["diff", "差异预览", "沙盒补丁差异"],
    ["rollback", "回滚快照", "写入前还原点"],
    ["apply", "写入闸门清单", "人工闸门保护的写入边界"]
  ];
  const readySections = sectionDefs.filter(([section]) =>
    ["ready", "verified", "blocked"].includes(evidenceSectionStatus(task, section))
  ).length;
  const writeGuard = task.result?.applyStatus === "applied"
    ? "审批后已写入"
    : task.result?.applyStatus === "requires_confirmation" || task.result?.applyStatus === "blocked"
      ? "写入闸门阻断"
      : "默认阻断";
  const sections = sectionDefs
    .map(([section, label, detail]) => evidenceSectionRow(task, section, label, detail))
    .join("");
  const diffReady = ["ready", "verified", "blocked"].includes(evidenceSectionStatus(task, "diff"));

  return `
    <div class="evidence-audit-pack">
      <div class="audit-pack-header">
        <span>证据编号</span>
        <strong>${escapeHtml(task.id)}</strong>
        <small>${escapeHtml(zhText(task.title || "当前任务"))}</small>
      </div>
      <div class="evidence-pack-hero">
        <div>
          <span>完整度</span>
          <strong>${escapeHtml(String(readySections))}/6</strong>
          <small>命令、方案、验证、差异、回滚、写入闸门</small>
        </div>
        <div>
          <span>写入红线</span>
          <strong>${escapeHtml(writeGuard)}</strong>
          <small>没有明确人工确认，不会改项目文件</small>
        </div>
        <div>
          <span>可信来源</span>
          <strong>本地沙盒</strong>
          <small>证据来自当前工作区的受控运行</small>
        </div>
      </div>
      <div class="audit-pack-meta">
        <div><span>来源</span><strong>本地沙盒</strong></div>
        <div><span>阶段</span><strong>${escapeHtml(runPhaseLabel(phase))}</strong></div>
        <div><span>脱敏</span><strong>已启用</strong></div>
        <div><span>完整性</span><strong>${escapeHtml(integrity)}</strong></div>
      </div>
      <div class="evidence-section-list">
        ${sections}
      </div>
      <div class="audit-pack-footer">
        <span>${escapeHtml(readOnly)}</span>
        <button type="button" data-evidence-action="open" data-task-id="${escapeHtml(task.id)}">${diffReady ? "查看差异预览" : "打开完整证据"}</button>
      </div>
    </div>
  `;
}

function safetyContractHtml() {
  return `
    <div class="gate-contract-grid">
      <div>
        <span>允许发生</span>
        <strong>只做沙盒审核</strong>
        <small>查看生成的补丁包、清单、验证结果和回滚快照。</small>
      </div>
      <div>
        <span>不会自动发生</span>
        <strong>不会偷偷写项目</strong>
        <small>不会部署、重启、调用外部副作用接口、触发钱包/交易或生产写入。</small>
      </div>
    </div>
  `;
}

function gateImpactPanelHtml(task) {
  const checklist = gateApprovalChecklistFromTask(task);

  return `
    <div class="gate-approval-desk">
      <div class="gate-approval-head">
        <span>审批台</span>
        <strong>先复核证据，再决定是否继续</strong>
        <small>当前页面只展示和检查闸门，不会自动执行项目写入。</small>
      </div>
      <div class="gate-impact-column">
        <span>候选文件</span>
        ${insightList(checklist.affectedFiles)}
      </div>
      <div class="gate-impact-column">
        <span>会发生什么</span>
        ${insightList(checklist.willHappen)}
      </div>
      <div class="gate-impact-column">
        <span>不会自动发生什么</span>
        ${insightList(checklist.willNotHappen)}
      </div>
      <div class="gate-impact-column is-blockers">
        <span>仍被阻断</span>
        ${insightList(checklist.blockers)}
      </div>
      ${checklist.requiredConfirmation ? `
        <div class="gate-confirmation-strip">
          <span>如果未来要写入，需要精确确认语</span>
          <strong>${escapeHtml(checklist.requiredConfirmation)}</strong>
          <small>这是受控写入口令，不是当前页面的自动执行指令。</small>
        </div>
      ` : ""}
    </div>
  `;
}

function gateOperatorDecisionHtml(task) {
  if (!task) return "";
  const model = gateModelFromTask(task);
  const checklist = gateApprovalChecklistFromTask(task);
  const verdict = gateVerdictFromTask(task);
  const recommendation = model.applyStatus === "applied"
    ? "已在闸门检查后写入，继续保留证据和回滚记录"
    : model.applyStatus === "requires_confirmation" || model.applyStatus === "blocked"
      ? "建议先查看差异；不确定就保持阻断"
      : model.patchStatus === "sandbox_written"
        ? "先运行写入闸门预检，不进入真实写入"
        : model.humanGateStatus === "pending"
          ? "等待人工判断：批准沙盒结果或要求返工"
          : "继续补齐证据链，再进入下一道闸门";
  const scopeItems = [
    `${model.affectedFiles.length || 0} 个候选文件`,
    model.hasRollback ? "回滚快照可用" : "回滚快照待生成",
    model.applyRunnerEnabled ? "写入执行器已启用但仍需确认" : "写入执行器保持关闭"
  ];
  const safetyItems = [
    "不会自动修改项目文件",
    "不会自动部署、重启或触发外部副作用",
    "不会绕过人工闸门和精确确认语"
  ];

  return `
    <div class="gate-operator-brief tone-${escapeHtml(verdict.tone)}">
      <div class="gate-operator-main">
        <span>操作员审批结论</span>
        <strong>${escapeHtml(recommendation)}</strong>
        <small>这不是自动执行指令；它只帮助你判断下一步该看证据、要求返工，还是继续保持阻断。</small>
      </div>
      <div class="gate-decision-grid">
        <div>
          <span>允许范围</span>
          ${insightList(checklist.willHappen.slice(0, 3))}
        </div>
        <div>
          <span>安全红线</span>
          ${insightList(safetyItems)}
        </div>
        <div>
          <span>执行条件</span>
          ${insightList(scopeItems)}
        </div>
        <div class="is-confirmation">
          <span>精确确认语</span>
          <strong>${escapeHtml(checklist.requiredConfirmation || "当前不允许写入")}</strong>
          <small>只有未来进入受控写入路径时才使用；当前页面不会替你确认。</small>
        </div>
      </div>
    </div>
  `;
}

function gateActionDockHtml(task) {
  if (!task?.id) return "";
  const model = gateModelFromTask(task);
  const applyDisabled = model.canRunApplyGate ? "" : " disabled";
  const reworkDisabled = model.humanGateStatus === "pending" ? "" : " disabled";

  return `
    <div class="gate-decision-actions">
      <div class="gate-decision-header">
        <span>写入闸门决策</span>
        <strong>先看差异；不确定就保持阻断</strong>
        <small>这里不会直接修改项目文件，只帮你选择下一步审查路径。</small>
      </div>
      <div class="gate-action-dock">
        <button class="gate-primary-action" type="button" data-gate-nav="evidence" data-task-id="${escapeHtml(task.id)}"${model.canReviewPatch ? "" : " disabled"}>
          <span>查看差异</span>
          <small>查看沙盒补丁和文件影响</small>
        </button>
        <button class="gate-rework-action" type="button" data-gate-action="changes_requested" data-task-id="${escapeHtml(task.id)}"${reworkDisabled}>
          <span>要求返工</span>
          <small>退回编程猿重新生成方案</small>
        </button>
        <button class="gate-safe-action" type="button" data-gate-action="keep_blocked" data-task-id="${escapeHtml(task.id)}">
          <span>保持阻断</span>
          <small>不做任何项目写入</small>
        </button>
      </div>
    </div>
    <div class="gate-preflight-action">
      <div>
        <span>次级检查</span>
        <strong>写入闸门预检，不写项目文件</strong>
        <small>只生成/刷新闸门清单，用来判断是否具备进入人工确认路径。</small>
      </div>
      <button type="button" data-apply-gate-action="check" data-task-id="${escapeHtml(task.id)}"${applyDisabled}>运行预检</button>
    </div>
  `;
}

function gateDecisionSummaryHtml(task) {
  if (!task) {
    return `
      <p>还没有选中任务。选择一个带证据的任务，就可以查看人工闸门和写入闸门。</p>
      ${safetyContractHtml()}
    `;
  }

  const phase = runPhaseFromTask(task);
  const verdict = gateVerdictFromTask(task);
  const verificationStatus = task.result?.verificationStatus || (task.verification ? "passed" : "not_run");
  const humanStatus = task.result?.humanGateStatus || "pending";
  const patchStatus = task.result?.patchRunStatus || "not_run";
  const applyStatus = task.result?.applyStatus || "not_run";
  const nextAction = applyStatus === "requires_confirmation" || applyStatus === "blocked"
    ? "先看 Diff；不确定就保持阻断"
    : patchStatus === "sandbox_written"
      ? "运行写入闸门检查，仍不写项目文件"
      : "先生成沙盒补丁和回滚快照";
  const proofCards = [
    {
      label: "证据",
      value: verdict.proofLabel,
      detail: verificationStatusLabel(verificationStatus)
    },
    {
      label: "风险",
      value: verdict.riskLabel,
      detail: gateRiskExplanation(task)
    },
    {
      label: "写入",
      value: verdict.applyLabel,
      detail: applyRunStatusLabel(applyStatus)
    }
  ];

  return `
    ${gateOperatorDecisionHtml(task)}
    <div class="gate-command-center tone-${escapeHtml(verdict.tone)}">
      <div class="gate-blocker-hero">
        <span>当前卡点</span>
        <strong>${escapeHtml(zhText(verdict.headline))}</strong>
        <small>${escapeHtml(zhText(verdict.subline))}</small>
      </div>
      <div class="gate-verdict-head">
        <span>下一步</span>
        <strong>${escapeHtml(nextAction)}</strong>
        <small>这里是最后一道门：确认前不会改项目文件。</small>
      </div>
      <div class="gate-proof-cards" aria-label="Gate proof summary">
        ${proofCards.map((card) => `
          <div>
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(zhText(card.value))}</strong>
            <small>${escapeHtml(zhText(card.detail))}</small>
          </div>
        `).join("")}
      </div>
    </div>
    <div class="gate-redline">
      <span>不会自动发生</span>
      <strong>不会修改项目文件</strong>
      <small>不会部署、重启、调用外部副作用接口、触发钱包/交易或生产写入。</small>
    </div>
    <div class="gate-run-id">
      <span>当前任务</span>
      <strong>${escapeHtml(zhText(task.title || "当前任务"))}</strong>
      <small>${escapeHtml(task.id)}</small>
    </div>
    <div class="insight-grid gate-status-grid is-compact">
      <div><span>阶段</span><strong>${escapeHtml(runPhaseLabel(phase))}</strong></div>
      <div><span>人工闸门</span><strong>${escapeHtml(humanGateStatusLabel(humanStatus))}</strong></div>
      <div><span>补丁</span><strong>${escapeHtml(patchRunStatusLabel(patchStatus))}</strong></div>
      <div><span>写入闸门</span><strong>${escapeHtml(applyRunStatusLabel(applyStatus))}</strong></div>
    </div>
    ${gateImpactPanelHtml(task)}
    ${gateActionDockHtml(task)}
    ${safetyContractHtml()}
  `;
}

function missionFlowFocusInsight(task, nodeId, director) {
  const phase = runPhaseFromTask(task);
  const status = flowStatusForNode(task, { id: nodeId });
  const statusLabel = zhStatus(status);
  const taskTitle = zhText(task?.title || "当前任务");
  const runId = task?.id || "暂无运行";
  const mode = missionModeFromTask(task);
  const focusCopy = {
    task: {
      context: "mission",
      title: "任务入口",
      status: statusLabel,
      headline: "任务先进入编程猿工作台",
      body: "这里确认任务目标、项目范围和当前运行编号。还没有证据前，不应该进入补丁或写入步骤。",
      next: director?.nextAction || "先让编程猿采集只读证据。"
    },
    evidence: {
      context: "evidence",
      title: "证据焦点",
      status: statusLabel,
      headline: "先看证据，再谈补丁",
      body: "证据包会汇总命令日志、补丁方案、差异预览、回滚快照和写入闸门清单。",
      next: "打开证据包，确认差异和验证结果是否足够支撑下一步。"
    },
    proposal: {
      context: "evidence",
      title: "方案焦点",
      status: statusLabel,
      headline: "补丁方案必须由证据支撑",
      body: "Patch Proposal 只是可审计草稿，不会直接写入项目。它需要验证、审核和人工闸门继续推进。",
      next: "复核变更范围和风险说明，再进入 Verification。"
    },
    verification: {
      context: "evidence",
      title: "验证焦点",
      status: statusLabel,
      headline: "审核猿正在判断这次运行是否可信",
      body: "验证只允许受控检查，不会部署、重启或调用外部副作用接口。失败会阻止补丁继续推进。",
      next: "查看验证输出；如果失败，要求编程猿返工。"
    },
    judge: {
      context: "gate",
      title: "审核焦点",
      status: statusLabel,
      headline: "审核猿负责把证据送到人工闸门",
      body: "人工闸门会解释会发生什么、不会发生什么、候选文件和仍被阻断的动作。",
      next: "先读审核结论，再选择批准、返工或保持阻断。"
    },
    human: {
      context: "gate",
      title: "人工闸门焦点",
      status: statusLabel,
      headline: "需要你明确决定是否继续",
      body: "Human Gate 会把证据、风险、候选文件和不会发生的动作摆在同一处，批准前不会进入补丁预检。",
      next: "确认你理解 diff 和风险；不确定就要求返工。"
    },
    patch: {
      context: "evidence",
      title: "补丁预检焦点",
      status: statusLabel,
      headline: "补丁只进入沙盒和回滚准备",
      body: "Patch Run 生成沙盒补丁、统一 diff 和 rollback snapshot，不直接修改项目文件。",
      next: "等待 Diff Preview 和 rollback snapshot 全部就绪。"
    },
    diff: {
      context: "evidence",
      title: "Diff Preview 焦点",
      status: statusLabel,
      headline: "先看差异，再考虑写入",
      body: "Diff Preview 是 Apply Gate 前的主要审计材料，必须能解释每个目标文件为什么要改。",
      next: "打开闸门清单，确认所有目标文件仍在授权 project root 内。"
    },
    apply: {
      context: "gate",
      title: "写入闸门焦点",
      status: statusLabel,
      headline: "写入闸门正在保护项目文件",
      body: "即使沙盒补丁和差异已经生成，系统也不会自动修改项目文件。写入路径必须经过人工闸门、回滚快照和精确确认语。",
      next: "查看差异和闸门清单；不确定时保持阻断。"
    },
    report: {
      context: "evidence",
      title: "战报焦点",
      status: statusLabel,
      headline: "最终报告必须能被用户和团队复核",
      body: "Company Report 汇总做了什么、证据、diff、验证结果、写入状态和可回滚位置。",
      next: "复核报告，必要时生成支持包。"
    }
  };
  const modeFocusCopy = {
    review_only: {
      evidence: {
        ...focusCopy.evidence,
        headline: "本次只看只读证据",
        body: "证据包只包含只读命令、仓库状态和变更信号；本次不会生成补丁方案、验证结果或写入闸门清单。",
        next: "复核证据；如果要继续，再切换到方案、验证或完整沙盒闭环模式。"
      },
      judge: {
        context: "evidence",
        title: "审核边界",
        status: "本次不审",
        headline: "审核猿本次保持待命",
        body: "只采集证据模式不会进入方案审查，也不会要求你批准人工闸门。",
        next: "需要审核时，下一次切到“只生成方案”或“审查 + 验证”。"
      },
      apply: {
        context: "gate",
        title: "写入边界",
        status: "本次不写",
        headline: "本次不进入写入闸门",
        body: "没有沙盒补丁包，也没有写入闸门清单；项目文件不会被修改。",
        next: "需要闸门清单时，下一次切到“完整沙盒闭环”。"
      }
    },
    proposal: {
      evidence: {
        ...focusCopy.evidence,
        headline: "证据正在支撑方案",
        body: "本次会采集证据并生成方案草稿，但不会运行验证脚本、不会生成沙盒补丁包。",
        next: "复核方案；需要验证时切到“审查 + 验证”。"
      },
      judge: {
        context: "evidence",
        title: "方案审查",
        status: statusLabel,
        headline: "审核猿只做旁路方案审查",
        body: "审核猿会说明风险和建议，但本次不会把方案推入人工写入闸门。",
        next: "确认方案方向；需要沙盒补丁时切到“完整沙盒闭环”。"
      },
      apply: {
        context: "gate",
        title: "写入边界",
        status: "本次不写",
        headline: "方案模式不进入写入闸门",
        body: "这次没有验证结果、沙盒补丁包或回滚快照，因此不会运行写入预检。",
        next: "需要写入闸门时，先切到完整沙盒闭环。"
      }
    },
    verify: {
      evidence: {
        ...focusCopy.evidence,
        headline: "证据、方案和验证结果已集中",
        body: "本次会走到验证结果，不会生成沙盒补丁包，也不会进入写入预检。",
        next: "复核验证输出；需要补丁包时切到“完整沙盒闭环”。"
      },
      judge: {
        context: "evidence",
        title: "验证审查",
        status: statusLabel,
        headline: "审核猿只判断验证是否可信",
        body: "验证模式不会要求人工批准写入；它只告诉你方案是否具备继续进入沙盒闭环的条件。",
        next: "验证通过后，再决定是否开启完整沙盒闭环。"
      },
      apply: {
        context: "gate",
        title: "写入边界",
        status: "本次不写",
        headline: "验证模式不进入写入闸门",
        body: "这次没有沙盒补丁包和写入闸门清单；项目文件保持不变。",
        next: "需要闸门清单时，下一次切到“完整沙盒闭环”。"
      }
    }
  };
  const copy = modeFocusCopy[mode]?.[nodeId] || focusCopy[nodeId] || focusCopy.task;
  return {
    context: copy.context,
    taskId: task?.id,
    title: copy.title,
    status: copy.status,
    html: `
      <div class="flow-focus-card status-${escapeHtml(status)} phase-${escapeHtml(phase)}">
        <span>流程焦点</span>
        <strong>${escapeHtml(copy.headline)}</strong>
        <p>${escapeHtml(copy.body)}</p>
        <div class="flow-focus-grid">
          <div><span>当前任务</span><strong>${escapeHtml(taskTitle)}</strong></div>
          <div><span>运行编号</span><strong>${escapeHtml(runId)}</strong></div>
          <div><span>当前阶段</span><strong>${escapeHtml(runPhaseLabel(phase))}</strong></div>
          <div><span>节点状态</span><strong>${escapeHtml(copy.status)}</strong></div>
        </div>
        <div class="flow-focus-next">
          <span>建议下一步</span>
          <strong>${escapeHtml(copy.next)}</strong>
        </div>
        <small>安全红线：没有明确人工批准，不会修改项目文件。</small>
      </div>
    `
  };
}

function timelineEventForFlowNode(snapshot, task, nodeId) {
  const eventTypes = {
    task: ["task_queued", "task_running"],
    evidence: ["task_evidence"],
    proposal: ["patch_plan"],
    verification: ["verification_passed", "verification_failed", "verification_blocked"],
    judge: ["judge_review"],
    human: ["human_gate_approved", "human_gate_rework"],
    patch: ["patch_run_ready", "patch_run_blocked"],
    diff: ["patch_run_ready"],
    apply: ["apply_gate_pending", "apply_proposal_applied"],
    report: ["task_completed"]
  }[nodeId] || [];
  const taskId = task?.id || "";
  return (snapshot?.events || [])
    .filter((event) => {
      if (taskId && taskIdFromTimelineEvent(event) !== taskId) return false;
      return eventTypes.includes(event.type);
    })
    .sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""))[0] || null;
}

function setMissionFlowFocus(nodeId, task, director) {
  const insight = missionFlowFocusInsight(task, nodeId, director);
  const event = timelineEventForFlowNode(state.snapshot, task, nodeId);
  if (event) {
    state.selectedEventId = timelineEventKey(event);
    state.selectedReplayEvent = eventSnapshot(event);
    state.selectedReplaySummary = timelineReplaySummary(event);
  }
  if (insight.context !== "mission") {
    state.taskInsight = insight;
  } else {
    state.taskInsight = null;
  }
  state.inspectorTab = insight.context === "gate"
    ? "gate"
    : insight.context === "evidence"
      ? "evidence"
      : "mission";
  state.inspectorOpen = true;
  setControlStatus(`${zhText(insight.title)} · ${zhText(insight.status)}`);
  setInspectorOpen(true);
  renderTaskInsight();
  renderGateInspector(state.snapshot, currentProject());
  renderInspectorTabs();
}

function applyGateFallbackHtml(task) {
  if (!task?.id) {
    return "";
  }

  const hasPatchRun = Boolean(task.patchRun || taskHasEvidencePath(task, "data/patch-runs/"));
  const disabled = hasPatchRun ? "" : " disabled";
  const applyPath = task.result?.applyPath || task.applyRun || "暂无写入闸门清单";
  const requiredConfirmation = `APPLY ${task.id}`;

  return `
    <h4>写入闸门</h4>
    <div class="apply-run-card status-${escapeHtml(task.result?.applyStatus || "not_run")}">
      <div class="insight-grid">
        <div><span>状态</span><strong>${escapeHtml(applyRunStatusLabel(task.result?.applyStatus || "not_run"))}</strong></div>
        <div><span>执行器</span><strong>默认关闭</strong></div>
        <div><span>清单</span><strong>${escapeHtml(task.applyRun ? "已采集" : "等待中")}</strong></div>
        <div><span>项目写入</span><strong>人工闸门保护</strong></div>
      </div>
      <p>写入闸门只检查沙盒补丁是否具备进入写入审批的条件，不会偷偷修改项目文件。</p>
      <h4>所需确认语</h4>
      ${confirmationLockHtml(requiredConfirmation)}
      <h4>当前清单</h4>
      ${insightList([zhEvidenceRef(applyPath)])}
      <div class="human-gate-actions apply-gate-actions">
        <button type="button" data-apply-gate-action="check" data-task-id="${escapeHtml(task.id)}"${disabled}>运行写入预检</button>
        <button type="button" data-gate-action="keep_blocked" data-task-id="${escapeHtml(task.id)}">保持写入阻断</button>
      </div>
    </div>
  `;
}

function modeBoundaryGateHtml(task) {
  if (!task?.id) {
    return `
      <p>还没有选中任务。完整沙盒闭环模式下才会出现人工闸门和写入闸门。</p>
      ${safetyContractHtml()}
    `;
  }

  const mode = missionModeFromTask(task);
  if (mode === "sandbox_patch") return "";
  const labels = {
    review_only: {
      status: "证据模式",
      title: "本次只做只读证据采集",
      body: "这次运行不会生成方案、不会运行验证、不会进入人工闸门或写入闸门。"
    },
    proposal: {
      status: "方案模式",
      title: "本次只做方案和旁路审查",
      body: "这次运行不会运行验证、不会生成沙盒补丁包、不会进入写入闸门。"
    },
    verify: {
      status: "验证模式",
      title: "本次只做到审查与验证",
      body: "这次运行不会生成沙盒补丁包，也不会运行写入预检。项目文件保持不变。"
    }
  };
  const copy = labels[mode] || labels.review_only;

  return `
    <div class="mode-boundary-card">
      <span>当前不是完整沙盒闭环</span>
      <strong>${escapeHtml(copy.title)}</strong>
      <p>${escapeHtml(copy.body)}</p>
      <div class="insight-grid">
        <div><span>运行模式</span><strong>${escapeHtml(missionModeLabel(mode))}</strong></div>
        <div><span>闸门状态</span><strong>${escapeHtml(copy.status)}</strong></div>
        <div><span>当前任务</span><strong>${escapeHtml(task.id)}</strong></div>
        <div><span>项目写入</span><strong>不会发生</strong></div>
      </div>
      <h4>要继续进入闸门，需要下一次切换到</h4>
      ${insightList(["完整沙盒闭环", "先生成沙盒补丁包", "再生成写入闸门清单", "仍然需要人工确认，不会自动修改项目文件"])}
    </div>
    ${safetyContractHtml()}
  `;
}

function renderGateInspector(snapshot, selectedProject) {
  if (!elements.gateInsightBody) return;

  const task = latestTaskForProject(snapshot, selectedProject?.id);
  const mode = missionModeFromTask(task);
  const isFullCloseLoop = mode === "sandbox_patch";
  const activeInsight =
    isFullCloseLoop && state.taskInsight?.context === "gate" && (!state.taskInsight.taskId || state.taskInsight.taskId === task?.id)
      ? state.taskInsight
      : null;

  elements.gateInsightTitle.textContent = zhText(activeInsight?.title || (isFullCloseLoop ? "人工闸门" : "模式边界"));
  elements.gateInsightStatus.textContent =
    zhText(activeInsight?.status || (task ? (isFullCloseLoop ? applyRunStatusLabel(task.result?.applyStatus || "not_run") : "本次不进入写入") : "受保护"));
  elements.gateInsightBody.innerHTML = `
    ${isFullCloseLoop ? gateDecisionSummaryHtml(task) : ""}
    ${isFullCloseLoop ? humanGateInsightHtml(task) : ""}
    ${activeInsight ? activeInsight.html : isFullCloseLoop ? applyGateFallbackHtml(task) : modeBoundaryGateHtml(task)}
  `;
  syncApplyGateControls(elements.gateInsightBody);
}

function renderMissionSummary(snapshot, selectedProject) {
  if (!elements.missionStatusGrid || !elements.missionProgressBar) return;
  const task = latestTaskForProject(snapshot, selectedProject?.id);
  const director = missionDirectorForTask(task, {
    applyRunnerEnabled: Boolean(snapshot.autonomy?.metrics?.applyRunnerEnabled),
    project: selectedProject
  });

  if (!task) {
    elements.missionStatusGrid.innerHTML = `
      <div><span>运行</span><strong>无</strong></div>
      <div><span>阶段</span><strong>就绪</strong></div>
      <div><span>证据</span><strong>缺失</strong></div>
      <div><span>闸门</span><strong>不需要</strong></div>
      <div><span>焦点</span><strong>待命</strong></div>
      <div><span>安全</span><strong>暂无运行</strong></div>
    `;
    elements.missionProgressBar.style.width = "0%";
    return;
  }

  elements.missionStatusGrid.innerHTML = `
    <div><span>运行</span><strong>${escapeHtml(task.id)}</strong></div>
    <div><span>阶段</span><strong>${escapeHtml(zhText(director.phaseLabel))}</strong></div>
    <div><span>证据</span><strong>${escapeHtml(zhStatus(director.evidenceStatus))}</strong></div>
    <div><span>闸门</span><strong>${escapeHtml(zhStatus(director.gateStatus))}</strong></div>
    <div><span>焦点</span><strong>${escapeHtml(zhText(director.workerSignal))}</strong></div>
    <div><span>安全</span><strong>${escapeHtml(zhText(director.safetyLine))}</strong></div>
  `;
  elements.missionProgressBar.style.width = `${director.progress}%`;
}

function missionFlowNodeTemplate(task, node, director, replayFocus) {
  const status = flowStatusForNode(task, node);
  const isFocus = premiumMissionFlowNodeId(director?.focusNode) === node.id;
  const isReplayFocus = premiumMissionFlowNodeId(replayFocus?.focusNode) === node.id;
  const caption = missionFlowNodeCaption(task, node, status, isFocus, isReplayFocus);
  return `
    <button class="mission-flow-node status-${escapeHtml(status)} ${isFocus ? "is-focus" : ""} ${isReplayFocus ? "is-replay-focus" : ""}" data-flow-node="${escapeHtml(node.id)}" data-replay-focus="${isReplayFocus ? "true" : "false"}" type="button" ${isFocus || isReplayFocus ? 'aria-current="step"' : ""}>
      <span></span>
      <strong>${escapeHtml(node.label)}</strong>
      <small>${escapeHtml(caption)}</small>
    </button>
  `;
}

function missionFlowNodeCaption(task, node, status, isFocus = false, isReplayFocus = false) {
  if (isReplayFocus) return "回放";
  const mode = missionModeFromTask(task);
  const nodeId = typeof node === "string" ? node : node?.id;
  const modeHints = {
    review_only: {
      task: "接单",
      evidence: status === "passed" ? "只读完成" : "只做证据",
      verification: "本次不跑",
      judge: "本次不审",
      apply: "本次不写"
    },
    proposal: {
      task: "接单",
      evidence: status === "passed" ? "方案就绪" : "采集+方案",
      verification: "本次不跑",
      judge: status === "running" || status === "waiting_human" ? "旁路审查" : "方案审查",
      apply: "本次不写"
    },
    verify: {
      task: "接单",
      evidence: "证据+方案",
      verification: status === "passed" ? "验证通过" : isFocus ? "验证中" : "验证",
      judge: status === "waiting_human" ? "待复核" : "审核",
      apply: "本次不写"
    },
    sandbox_patch: {
      apply: status === "blocked" ? "安全阻断" : status === "waiting_human" ? "待确认" : "受闸门保护"
    }
  };
  return modeHints[mode]?.[nodeId] || (isFocus ? "当前" : zhStatus(status));
}

function renderMissionFlow(snapshot, selectedProject) {
  const task = latestTaskForProject(snapshot, selectedProject?.id);
  const replayFocus = selectedReplayFocus(snapshot);
  const director = missionDirectorForTask(task, {
    applyRunnerEnabled: Boolean(snapshot.autonomy?.metrics?.applyRunnerEnabled),
    project: selectedProject
  });
  const nodes = PREMIUM_MISSION_FLOW_NODES;
  const replayNodeId = premiumMissionFlowNodeId(replayFocus?.focusNode);
  const replayNode = nodes.find((node) => node.id === replayNodeId);

  if (elements.missionFlowStatus) {
    elements.missionFlowStatus.textContent = replayFocus?.focusNode
      ? `回放：${replayNode?.label || zhStatus(replayFocus.focusNode)} · ${replayFocus.taskId || "事件"}`
      : task
      ? `${zhText(director.phaseLabel)} · ${director.progress}% · ${formatRunId(task.id)}`
      : "等待任务证据";
  }
  if (elements.missionFlowRail) {
    elements.missionFlowRail.classList.add("is-premium");
    elements.missionFlowRail.innerHTML = nodes.map((node) => missionFlowNodeTemplate(task, node, director, replayFocus)).join("");
    elements.missionFlowRail.querySelectorAll("[data-flow-node]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.flowNode;
        setMissionFlowFocus(target, task, director);
      });
    });
  }
}

function stationTelemetryTemplate(items) {
  return items.map((item) => `
    <div class="station-telemetry-item status-${escapeHtml(item.status)}">
      <span>${escapeHtml(zhText(item.label))}</span>
      <strong>${escapeHtml(zhStatus(item.value))}</strong>
    </div>
  `).join("");
}

function latestEventForStation(snapshot, worker, selectedProject, task) {
  return selectStationEvent(snapshot?.events || [], worker, selectedProject, task);
}

function coreWorkerStationTemplate(worker, task, event, replayFocus) {
  const model = workerStationModel(worker, task, event);
  const director = missionDirectorForTask(task);
  const isFocus = director.focusWorkerId === worker?.id;
  const isReplayFocus = replayFocus?.focusWorkerId === worker?.id;
  const phaseLabel = runPhaseLabel(model.phase);
  const roleLabel = WORKER_DOMAIN_ZH[worker?.domain] || zhText(worker?.domain || "员工");
  const eventText = model.eventTitle
    ? `${zhEventType(model.eventType)}：${zhEventTitle({ type: model.eventType, title: model.eventTitle })}`
    : "暂无工位事件";
  const eventKey = timelineEventKey(event);
  const eventControl = eventKey
    ? `<button class="station-event" type="button" data-station-event-id="${escapeHtml(eventKey)}" data-station-route="${escapeHtml(inspectorTabForTimelineEvent(event))}">${escapeHtml(eventText)}</button>`
    : `<div class="station-event">${escapeHtml(eventText)}</div>`;
  return `
    <article class="core-station state-${escapeHtml(model.state)} runtime-${escapeHtml(model.runtimeState)} light-${escapeHtml(model.light.key)} phase-${escapeHtml(model.phase)} accent-${escapeHtml(worker?.accent || "teal")} ${isFocus ? "is-focus" : ""} ${isReplayFocus ? "is-replay-focus" : ""}" data-state="${escapeHtml(model.state)}" data-runtime-state="${escapeHtml(model.runtimeState)}" data-animation="${escapeHtml(model.animation)}" data-light="${escapeHtml(model.light.key)}" data-phase="${escapeHtml(model.phase)}" data-phase-label="${escapeHtml(phaseLabel)}" data-focus="${isFocus ? "true" : "false"}" data-replay-focus="${isReplayFocus ? "true" : "false"}">
      <div class="station-avatar">${escapeHtml(model.mark)}</div>
      <div>
        <span>${escapeHtml(isReplayFocus ? "回放焦点" : roleLabel)} · ${escapeHtml(zhStatus(model.runtimeState))}</span>
        <strong>${escapeHtml(zhWorkerName(model.name, model.id))}</strong>
        <small>${escapeHtml(zhText(model.action))}</small>
      </div>
      <em>${escapeHtml(formatRunId(model.runId))}</em>
      <div class="station-meta">
        <span>运行 <strong>${escapeHtml(formatRunId(model.runId))}</strong></span>
        <span>风险 <strong>${escapeHtml(zhStatus(model.riskLevel))}</strong></span>
        <span>闸门 <strong>${escapeHtml(zhStatus(model.gateStatus))}</strong></span>
      </div>
      <div class="station-progress" aria-hidden="true"><i style="width: ${escapeHtml(String(model.progress))}%"></i></div>
      <div class="station-telemetry">${stationTelemetryTemplate(model.telemetry)}</div>
      ${eventControl}
    </article>
  `;
}

function renderCoreWorkerStations(snapshot, selectedProject) {
  if (!elements.coreWorkerStations) return;
  const task = latestTaskForProject(snapshot, selectedProject?.id);
  const replayFocus = selectedReplayFocus(snapshot);
  const coreIds = ["coding-yuan", "judge-yuan", "ops-yuan"];
  const workers = coreIds.map((id) => snapshot.workers?.find((worker) => worker.id === id));
  elements.coreWorkerStations.innerHTML = workers
    .map((worker) => coreWorkerStationTemplate(worker, task, latestEventForStation(snapshot, worker, selectedProject, task), replayFocus))
    .join("");
  elements.coreWorkerStations.querySelectorAll("[data-station-event-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = snapshot.events?.find((candidate) => timelineEventKey(candidate) === button.dataset.stationEventId);
      openTimelineReplay(event);
    });
  });
}

function renderWorkerRoomFallback(snapshot, selectedProject, reason = "") {
  if (!elements.workerRoomFallback) return;
  if (!threeDeck.disabled) {
    elements.workerRoomFallback.hidden = true;
    elements.workerRoomFallback.innerHTML = "";
    return;
  }
  const task = latestTaskForProject(snapshot, selectedProject?.id);
  const coreIds = ["coding-yuan", "judge-yuan", "ops-yuan"];
  const workers = coreIds
    .map((id) => snapshot?.workers?.find((worker) => worker.id === id))
    .filter(Boolean);
  const fallback = webglFallbackModel({
    workers,
    phase: runPhaseFromTask(task),
    runId: task?.id || "no active run",
    reason: reason || threeDeck.disabledReason
  });
  elements.workerRoomFallback.hidden = false;
  elements.workerRoomFallback.innerHTML = workers.map((worker) => {
    const model = workerStationModel(worker, task, latestEventForStation(snapshot, worker, selectedProject, task));
    const fallbackWorker = fallback.workers.find((entry) => entry.workerId === worker.id);
    const roleLabel = WORKER_DOMAIN_ZH[worker.domain] || zhText(worker.domain || fallbackWorker?.fallback?.role || "员工");
    return `
      <article class="fallback-worker-card light-${escapeHtml(model.light.key)}" data-runtime-state="${escapeHtml(model.runtimeState)}">
        <b>${escapeHtml(model.fallbackAvatar)}</b>
        <div>
          <span>${escapeHtml(roleLabel)} · ${escapeHtml(zhStatus(model.runtimeState))}</span>
          <strong>${escapeHtml(zhWorkerName(model.name, model.id))}</strong>
          <small>${escapeHtml(zhText(model.action))}</small>
        </div>
        <small>${escapeHtml(formatRunId(model.runId))} · 闸门 ${escapeHtml(zhStatus(model.gateStatus))}</small>
      </article>
    `;
  }).join("");
}

function renderInspectorTabs() {
  setInspectorOpen(state.inspectorOpen);
  document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.inspectorTab === state.inspectorTab);
  });
  document.querySelectorAll("[data-inspector-pane]").forEach((pane) => {
    pane.classList.toggle("is-active", pane.dataset.inspectorPane === state.inspectorTab);
  });
}

function setInspectorOpen(open) {
  state.inspectorOpen = Boolean(open);
  elements.detailPanel?.classList.toggle("is-open", state.inspectorOpen);
  elements.openInspectorButton?.classList.toggle("is-active", state.inspectorOpen);
  elements.openInspectorButton?.setAttribute("aria-expanded", String(state.inspectorOpen));
}

function closeInspectorPanel() {
  state.inspectorOpen = false;
  setInspectorOpen(false);
}

function openInspectorPanel() {
  const project = currentProject() || preferredProject(state.snapshot);
  const task = latestTaskForProject(state.snapshot, project?.id);
  state.inspectorTab = missionDirectorForTask(task, {
    applyRunnerEnabled: Boolean(state.snapshot?.autonomy?.metrics?.applyRunnerEnabled),
    project
  }).inspectorTab;
  setInspectorOpen(true);
  renderInspectorTabs();
}

function attachInspectorShellHandlers() {
  if (inspectorShellHandlersAttached) return;
  inspectorShellHandlersAttached = true;
  elements.openInspectorButton?.addEventListener("click", openInspectorPanel);
  elements.closeInspectorButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeInspectorPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.inspectorOpen) closeInspectorPanel();
  });
}

function blockerTemplate(blocker) {
  return `
    <article class="blocker-item severity-${escapeHtml(blocker.severity || "medium")}">
      <span>${escapeHtml(zhWorkerName(blocker.owner || "审核猿"))}</span>
      <strong>${escapeHtml(zhText(blocker.title))}</strong>
      <small>${escapeHtml(zhText(blocker.remediation || "提升自治等级前需要复核。"))}</small>
    </article>
  `;
}

function objectiveTemplate(objective) {
  return `
    <div class="objective-row status-${escapeHtml(objective.status || "next")}">
      <span>${escapeHtml(objectiveStatusLabel(objective.status))}</span>
      <strong>${escapeHtml(zhText(objective.label))}</strong>
      <small>${escapeHtml(zhText(objective.metric || ""))}</small>
    </div>
  `;
}

function companyMetricClass(label = "") {
  const text = String(label).toLowerCase();
  if (/任务|completed|missions|tasks/.test(text)) return "metric-tasks";
  if (/证据|evidence/.test(text)) return "metric-evidence";
  if (/验证|verified|verification/.test(text)) return "metric-verified";
  if (/补丁|patch/.test(text)) return "metric-patch";
  if (/闸门|apply|gate/.test(text)) return "metric-gate";
  if (/阻断|risk|blocked/.test(text)) return "metric-risk";
  if (/节省|saved|hours/.test(text)) return "metric-saved";
  return "metric-generic";
}

function metricTemplate(metric) {
  const metricClass = companyMetricClass(metric.label);
  return `
    <div class="company-metric ${escapeHtml(metricClass)}">
      <span>${escapeHtml(zhText(metric.label))}</span>
      <strong>${escapeHtml(String(metric.value))}</strong>
    </div>
  `;
}

function shareMetricTemplate(label, value) {
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function renderCompanyShareCard(companyReport) {
  if (!elements.companyShareCard) return;
  const card = buildCompanyShareCard(companyReport);
  const metrics = card.metrics;
  const latestLoop = companyReport.latestLoop || {};
  const evidenceChainHtml = card.evidenceChain?.length
    ? `
      <div class="company-evidence-chain" aria-label="最新真实闭环证据链">
        ${card.evidenceChain
          .map((item) => `
            <div class="chain-step chain-${escapeHtml(item.status)}">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `)
          .join("")}
      </div>
    `
    : "";
  const latestLoopHtml = latestLoop.taskId
    ? `
      <div class="company-latest-loop">
        <span>最新真实闭环</span>
        <strong>${escapeHtml(zhText(latestLoop.title || latestLoop.taskId))}</strong>
        <small>证据链由最新一次真实运行生成；沙盒补丁、写入闸门和项目文件状态分开记录。</small>
        ${evidenceChainHtml}
      </div>
    `
    : "";
  elements.companyShareLine.innerHTML = `
    <strong>${escapeHtml(zhText(card.shareLine))}</strong>
    <span>${escapeHtml(card.safetyStamp)}</span>
    ${latestLoopHtml}
  `;
  elements.companyShareMetrics.innerHTML = [
    shareMetricTemplate("任务", metrics.tasksDone),
    shareMetricTemplate("证据", metrics.evidencePacks),
    shareMetricTemplate("验证", metrics.verified),
    shareMetricTemplate("补丁", metrics.patchRuns),
    shareMetricTemplate("闸门", metrics.applyGates),
    shareMetricTemplate("节省", metrics.hoursSaved),
    shareMetricTemplate("阻断", metrics.risksGated)
  ].join("");
  elements.companyShareBullets.innerHTML = card.bullets
    .map((bullet) => `<li>${escapeHtml(zhText(bullet))}</li>`)
    .join("");
}

async function copyCompanyShareReport() {
  const companyReport = state.snapshot?.companyReport || {};
  const card = buildCompanyShareCard(companyReport);
  elements.companyShareCard?.classList.add("is-framed", "is-copy-ready");
  elements.companyShareCard?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("clipboard_unavailable");
    }
    await navigator.clipboard.writeText(card.shareText);
    setControlStatus("战报文案已复制");
  } catch {
    setControlStatus("分享卡已高亮，可手动复制战报文案");
  }

  window.setTimeout(() => {
    elements.companyShareCard?.classList.remove("is-copy-ready");
  }, 2200);
}

function localJudgeProviderLabel(provider) {
  const labels = {
    anthropic: "Anthropic",
    gemini: "Gemini",
    lm_studio: "LM Studio",
    ollama: "Ollama",
    openai: "OpenAI",
    openai_compatible: "OpenAI-compatible",
    disabled: "未启用"
  };
  return labels[provider] || zhText(provider || "未启用");
}

function modelProviderModeLabel(mode) {
  const labels = {
    demo_only: "Demo Only",
    byo_key: "BYO API Key",
    local_model: "Local Model"
  };
  return labels[mode] || labels.demo_only;
}

function localJudgeStartupCommand(localJudge = state.snapshot?.localJudge || {}) {
  const provider = localJudge.provider && localJudge.provider !== "disabled" ? localJudge.provider : "ollama";
  const model = localJudge.model || "huihui_ai/qwen3-abliterated:8b";
  const baseUrl = provider === "openai_compatible"
    ? " \\\nCODEX_OFFICE_LOCAL_LLM_BASE_URL=http://127.0.0.1:1234/v1"
    : "";

  return [
    `CODEX_OFFICE_LOCAL_LLM_PROVIDER=${provider}`,
    `CODEX_OFFICE_LOCAL_LLM_MODEL=${model}`,
    "CODEX_OFFICE_LOCAL_LLM_TIMEOUT_MS=25000",
    "PORT=4142 npm run dev"
  ].join(" \\\n").replace(" \\\nCODEX_OFFICE_LOCAL_LLM_MODEL", `${baseUrl} \\\nCODEX_OFFICE_LOCAL_LLM_MODEL`);
}

function missionInputTitle(project) {
  const raw = elements.missionInput?.value?.trim() || "";
  if (raw) return raw.slice(0, 180);
  return `检查${zhText(project?.name || "当前项目")}，采集证据、生成复核方案，并由运维猿守住写入闸门`;
}

function missionModeLabel(mode) {
  const labels = {
    review_only: "只采集证据",
    proposal: "只生成方案",
    verify: "审查 + 验证",
    sandbox_patch: "完整沙盒闭环"
  };
  return labels[mode] || labels.sandbox_patch;
}

function missionModeActionLabel(mode) {
  const labels = {
    review_only: "采集证据",
    proposal: "生成方案",
    verify: "审查验证",
    sandbox_patch: "运行闭环"
  };
  return labels[mode] || labels.sandbox_patch;
}

function missionModeRunningLabel(mode) {
  const labels = {
    review_only: "证据采集中",
    proposal: "方案生成中",
    verify: "审查验证中",
    sandbox_patch: "闭环运行中"
  };
  return labels[mode] || labels.sandbox_patch;
}

function selectedMissionMode() {
  return elements.missionModeSelect?.value || "sandbox_patch";
}

function missionSelectedProject(snapshot = state.snapshot) {
  const selectedId = elements.missionProjectSelect?.value || state.selectedId;
  return snapshot?.projects?.find((project) => project.id === selectedId) || currentProject() || preferredProject(snapshot);
}

function renderProjectRootSelector(snapshot, selectedProject) {
  if (!elements.projectRootInput || !elements.projectRootStatus) return;
  const selectedPath = snapshot?.localProjects?.selectedPath || "";
  if (document.activeElement !== elements.projectRootInput) {
    elements.projectRootInput.value = selectedPath;
  }
  elements.projectRootStatus.textContent = snapshot?.localProjects?.selectedPath
    ? `当前授权项目：${zhText(snapshot.localProjects.selectedName || selectedProject?.name || "本地项目")} · ${selectedPath}`
    : "必须先选择 project root，之后才会运行证据、diff 或 apply";
}

function renderMissionComposer(snapshot) {
  if (!elements.missionProjectSelect) return;
  const projects = sortedProjects(snapshot.projects || []);
  const selectedProject = missionSelectedProject(snapshot);
  const isRunning = state.liveRun?.status === "running";
  const options = projects.length
    ? projects
      .slice(0, 40)
      .map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(zhText(project.name))}</option>`)
      .join("")
    : `<option value="">先选择本地项目目录</option>`;

  if (elements.missionProjectSelect.innerHTML !== options) {
    elements.missionProjectSelect.innerHTML = options;
  }
  if (selectedProject?.id) {
    elements.missionProjectSelect.value = selectedProject.id;
  }
  elements.missionProjectSelect.disabled = !projects.length || isRunning;
  if (elements.assignMissionButton && !isRunning) {
    elements.assignMissionButton.textContent = missionModeActionLabel(selectedMissionMode());
    elements.assignMissionButton.disabled = !projects.length;
  }
  if (elements.newMissionButton) elements.newMissionButton.disabled = !projects.length || isRunning;
  if (elements.runFirstOrderButton) elements.runFirstOrderButton.disabled = !projects.length || isRunning;
  if (elements.runCodingLoopButton) elements.runCodingLoopButton.disabled = !projects.length || isRunning;
  if (elements.runCodingLoopHeroButton) elements.runCodingLoopHeroButton.disabled = !projects.length || isRunning;
  renderProjectRootSelector(snapshot, selectedProject);
}

function closedLoopResultStatus(mode, result, verificationStatus) {
  if (mode === "review_only") return "证据已采集";
  if (mode === "proposal") return result.proposal ? "方案已生成" : "等待方案";
  if (mode === "verify") return verificationStatusLabel(verificationStatus);
  if (result.applyRun) return applyRunStatusLabel(result.applyRun.status);
  if (result.patchRun) return patchRunStatusLabel(result.patchRun.status);
  return verificationStatusLabel(verificationStatus);
}

function latestEvidenceSummaryForMode(mode, hasApplyGate = false) {
  const summaries = {
    review_only: "已完成只读证据采集；没有生成补丁，也没有修改项目文件。",
    proposal: "已生成可复核方案；没有运行沙盒补丁，也没有修改项目文件。",
    verify: "已完成方案和验证；写入仍需人工闸门确认。",
    sandbox_patch: hasApplyGate
      ? "沙盒补丁、回滚快照和写入闸门清单已就绪，项目文件保持不变。"
      : "完整闭环已运行；项目写入仍受人工闸门保护。"
  };
  return summaries[mode] || summaries.sandbox_patch;
}

function missionModeBriefHtml(mode) {
  const briefs = {
    review_only: {
      title: "模式：只采集证据",
      done: ["读取项目状态", "采集只读命令输出", "生成证据包"],
      blocked: ["不生成补丁方案", "不运行验证脚本", "不修改项目文件"]
    },
    proposal: {
      title: "模式：只生成方案",
      done: ["采集证据", "生成补丁方案", "交给审核猿旁路审查"],
      blocked: ["不运行验证脚本", "不生成沙盒补丁", "不修改项目文件"]
    },
    verify: {
      title: "模式：审查 + 验证",
      done: ["采集证据", "生成方案", "运行白名单验证"],
      blocked: ["不生成沙盒写入包", "不绕过人工闸门", "不修改项目文件"]
    },
    sandbox_patch: {
      title: "模式：完整沙盒闭环",
      done: ["采集证据", "生成方案", "验证通过后生成沙盒补丁和写入闸门清单"],
      blocked: ["真实项目文件保持不变", "写入闸门默认阻断", "没有明确人工确认不会 apply"]
    }
  };
  const brief = briefs[mode] || briefs.sandbox_patch;
  return `
    <div class="mission-mode-brief">
      <div>
        <span>当前运行模式</span>
        <strong>${escapeHtml(brief.title)}</strong>
      </div>
      <div>
        <span>这次会做</span>
        ${insightList(brief.done)}
      </div>
      <div>
        <span>这次不会做</span>
        ${insightList(brief.blocked)}
      </div>
    </div>
  `;
}

function missionModeNextStepHtml(mode, task = null) {
  const runId = task?.id || "当前运行";
  const nextSteps = {
    review_only: {
      title: "本次停在证据包",
      status: "只读完成",
      next: "如果证据够清楚，下一次可切到“只生成方案”或“审查 + 验证”。",
      blocked: ["不会生成补丁方案", "不会要求人工闸门", "不会进入写入闸门"]
    },
    proposal: {
      title: "本次停在方案审查",
      status: "方案就绪",
      next: "如果要验证方案，请下一次切到“审查 + 验证”；如果要沙盒补丁，请切到“完整沙盒闭环”。",
      blocked: ["不会运行验证脚本", "不会生成沙盒补丁包", "不会进入写入闸门"]
    },
    verify: {
      title: "本次停在验证结果",
      status: "验证闭环",
      next: "如果验证结果可接受，下一次再切到“完整沙盒闭环”生成沙盒补丁和闸门清单。",
      blocked: ["不会生成沙盒补丁包", "不会运行写入预检", "不会修改项目文件"]
    }
  };
  const copy = nextSteps[mode];
  if (!copy) return "";

  return `
    <div class="mission-mode-next">
      <span>模式边界</span>
      <strong>${escapeHtml(copy.title)}</strong>
      <p>${escapeHtml(copy.next)}</p>
      <div class="insight-grid">
        <div><span>运行</span><strong>${escapeHtml(runId)}</strong></div>
        <div><span>状态</span><strong>${escapeHtml(copy.status)}</strong></div>
      </div>
      <h4>这次不会继续做</h4>
      ${insightList(copy.blocked)}
    </div>
  `;
}

function closedLoopWarReportHtml(result = {}) {
  const task = result.task || {};
  const evidence = result.evidence || {};
  const proposal = result.proposal || {};
  const verification = result.verification || {};
  const patchRun = result.patchRun || {};
  const applyRun = result.applyRun || {};
  const verificationStatus = verificationStatusFromSummary(verification);
  const patchStatus = patchRun.status || task.result?.patchRunStatus || "not_run";
  const applyStatus = applyRun.status || task.result?.applyStatus || "not_run";
  const evidenceCount = evidence.commands?.length || task.evidence?.length || 0;
  const changedFiles = evidence.commands?.find((entry) => entry.command === "git diff --name-only")?.output
    ?.split("\n")
    .filter(Boolean)
    .length || patchRun.allowedFiles?.length || 0;
  const sandboxFiles = patchRun.sandboxFiles?.length || patchRun.draftsAppliedToSandbox || 0;
  const blockedActions = applyRun.blockers?.length || (["blocked", "requires_confirmation"].includes(applyStatus) ? 1 : 0);
  const headline = applyStatus === "requires_confirmation" || applyStatus === "blocked"
    ? "闭环完成，写入闸门仍在保护项目"
    : patchStatus === "sandbox_written"
      ? "沙盒补丁已生成，等待写入闸门"
      : "闭环证据已归档";

  return `
    <div class="closed-loop-war-report">
      <div class="war-report-head">
        <span>完整沙盒闭环战报</span>
        <strong>${escapeHtml(headline)}</strong>
        <small>${escapeHtml(zhText(task.title || "编程猿闭环任务"))}</small>
      </div>
      <div class="war-report-metrics">
        <div><span>只读检查</span><strong>${escapeHtml(String(evidenceCount))}</strong></div>
        <div><span>变更信号</span><strong>${escapeHtml(String(changedFiles))}</strong></div>
        <div><span>验证</span><strong>${escapeHtml(verificationStatusLabel(verificationStatus))}</strong></div>
        <div><span>沙盒文件</span><strong>${escapeHtml(String(sandboxFiles))}</strong></div>
        <div><span>写入闸门</span><strong>${escapeHtml(applyRunStatusLabel(applyStatus))}</strong></div>
        <div><span>阻断动作</span><strong>${escapeHtml(String(blockedActions))}</strong></div>
      </div>
      <div class="war-report-chain">
        <span>任务</span>
        <span>证据</span>
        <span>方案</span>
        <span>验证</span>
        <span>人工闸门</span>
        <span>沙盒补丁</span>
        <span>写入阻断</span>
      </div>
      <div class="war-report-redline">
        <strong>项目文件未被自动修改</strong>
        <span>本次产物是证据包、方案、验证结果、沙盒补丁和写入闸门清单；真实写入仍需要你明确批准。</span>
      </div>
      <div class="war-report-actions">
        <button type="button" data-gate-nav="evidence" data-task-id="${escapeHtml(task.id || "")}"${task.id ? "" : " disabled"}>查看证据与差异</button>
        <button type="button" data-gate-nav="gate" data-task-id="${escapeHtml(task.id || "")}"${task.id ? "" : " disabled"}>查看写入闸门</button>
      </div>
    </div>
  `;
}

function taskCompanyReportHtml(taskReport) {
  if (!taskReport?.reportPath) return "";
  const preview = String(taskReport.markdown || "")
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 8)
    .join("\n");
  return `
    <div class="task-company-report-card">
      <span>Company Report</span>
      <strong>${escapeHtml(zhEvidenceRef(taskReport.reportPath))}</strong>
      <pre>${escapeHtml(preview || "报告已生成。")}</pre>
    </div>
  `;
}

function codingLoopResultInsight(mode, result, verificationStatus) {
  if (mode === "review_only") {
    return {
      context: "evidence",
      title: "只读证据采集",
      html: `${missionModeBriefHtml(mode)}${evidenceInsightHtml(result.evidence)}${taskCompanyReportHtml(result.taskReport)}${missionModeNextStepHtml(mode, result.task)}`
    };
  }

  if (mode === "proposal") {
    return {
      context: "evidence",
      title: "编程猿方案草稿",
      html: `${missionModeBriefHtml(mode)}${evidenceInsightHtml(result.evidence, result.proposal)}${proposalInsightHtml(result.proposal)}${missionModeNextStepHtml(mode, result.task)}${taskCompanyReportHtml(result.taskReport)}`
    };
  }

  if (mode === "verify") {
    return {
      context: "evidence",
      title: "审查与验证结果",
      html: `${missionModeBriefHtml(mode)}${evidenceInsightHtml(result.evidence, result.proposal)}${proposalInsightHtml(result.proposal)}${verificationInsightHtml(result.verification)}${missionModeNextStepHtml(mode, result.task)}${taskCompanyReportHtml(result.taskReport)}`
    };
  }

  const hasApplyGate = Boolean(result.applyRun);
  return {
    context: hasApplyGate ? "gate" : "evidence",
    title: hasApplyGate ? "三猿闭环演示" : "编程猿闭环",
    html: hasApplyGate
      ? `${missionModeBriefHtml(mode)}${closedLoopWarReportHtml(result)}${humanGateInsightHtml(result.task)}${applyRunInsightHtml(result.applyRun)}${taskCompanyReportHtml(result.taskReport)}`
      : `${missionModeBriefHtml(mode)}${closedLoopWarReportHtml(result)}${evidenceInsightHtml(result.evidence, result.proposal)}${result.proposal ? proposalInsightHtml(result.proposal) : ""}${verificationInsightHtml(result.verification)}${humanGateInsightHtml(result.task)}${result.patchRun ? patchRunInsightHtml(result.patchRun) : ""}${result.applyRun ? applyRunInsightHtml(result.applyRun) : ""}${taskCompanyReportHtml(result.taskReport)}`
  };
}

function renderLocalJudgePanel(snapshot) {
  if (!elements.localJudgeStatus) return;
  const localJudge = snapshot.localJudge || {};
  const modelProvider = snapshot.modelProvider || {};
  const providerMode = modelProvider.providerMode || "demo_only";
  if (elements.modelProviderMode && document.activeElement !== elements.modelProviderMode) {
    elements.modelProviderMode.value = providerMode;
  }
  if (elements.modelProviderSelect && document.activeElement !== elements.modelProviderSelect) {
    elements.modelProviderSelect.value = modelProvider.provider || "openai";
  }
  if (elements.modelProviderEndpoint && document.activeElement !== elements.modelProviderEndpoint) {
    elements.modelProviderEndpoint.value = modelProvider.endpoint || "";
  }
  if (elements.modelProviderModel && document.activeElement !== elements.modelProviderModel) {
    elements.modelProviderModel.value = modelProvider.model || "";
  }
  if (elements.modelProviderApiKey && document.activeElement !== elements.modelProviderApiKey) {
    elements.modelProviderApiKey.placeholder = modelProvider.apiKeyConfigured
      ? "已配置，界面不会显示密钥"
      : "只保存在本机 gitignored 配置";
  }
  if (elements.modelProviderNotice) {
    elements.modelProviderNotice.textContent = modelProvider.safetyNotice || "为了生成代码修改，Coding猿 可能会把与任务相关的代码片段发送给你选择的模型服务商。不会默认上传整个项目。确认前不会写入代码。";
  }
  if (elements.firstRealOrderStatus) {
    elements.firstRealOrderStatus.textContent = providerMode === "demo_only"
      ? "Demo Only"
      : modelProvider.apiKeyConfigured || providerMode === "local_model"
        ? "模型就绪"
        : "等待模型";
  }
  if (elements.firstRealOrderSummary && providerMode === "demo_only") {
    elements.firstRealOrderSummary.textContent = "没有模型配置时只会跑 Demo Only；真实 AI 小任务需要 BYO Key 或 Local Model。";
  }
  const enabled = Boolean(localJudge.enabled);
  const latestStatus = localJudge.latestStatus || "none";
  const ready = enabled && latestStatus === "ready";
  const failed = enabled && latestStatus === "failed";

  elements.localJudgeStatus.textContent = providerMode === "demo_only"
    ? "Demo Only"
    : ready
    ? "已接入"
    : failed
      ? "需重试"
      : enabled || modelProvider.apiKeyConfigured || providerMode === "local_model"
        ? "已配置"
        : "未启用";
  elements.localJudgeStatus.className = ready ? "is-ready" : failed ? "is-warning" : "";
  elements.localJudgeProvider.textContent = `${modelProviderModeLabel(providerMode)} · ${localJudgeProviderLabel(modelProvider.provider || localJudge.provider)}`;
  elements.localJudgeModel.textContent = modelProvider.model || (enabled ? zhText(localJudge.model || "未指定") : "未配置");
  elements.localJudgeLatest.textContent = localJudgeStatusLabel(latestStatus);
  elements.localJudgeSummary.textContent = ready
    ? `最近一次审查：${zhText(localJudge.latestSummary || "本地模型已完成审查。")}`
    : failed
      ? `最近一次审查失败：${zhText(localJudge.latestSummary || "请测试连接或调高超时时间。")}`
      : providerMode === "demo_only"
        ? "Demo Only 不调用模型，仍可跑本地安全演示。要生成真实代码修改，请配置 BYO Key 或本地模型。"
        : "模型已配置；Coding猿 会先生成修改方案和沙盒 diff，确认前不会写入代码。";
  elements.localJudgeCommand.textContent = localJudgeStartupCommand(localJudge);
}

function modelProviderPayload() {
  return {
    providerMode: elements.modelProviderMode?.value || "demo_only",
    provider: elements.modelProviderSelect?.value || "openai",
    endpoint: elements.modelProviderEndpoint?.value || "",
    model: elements.modelProviderModel?.value || "",
    apiKey: elements.modelProviderApiKey?.value || ""
  };
}

async function saveModelProviderSettings(event) {
  event?.preventDefault();
  if (elements.modelProviderForm) {
    elements.modelProviderForm.classList.add("is-saving");
  }
  setControlStatus("正在保存模型设置...");
  try {
    const result = await postJson("/api/model-provider/settings", modelProviderPayload());
    if (elements.modelProviderApiKey) elements.modelProviderApiKey.value = "";
    state.snapshot = {
      ...(state.snapshot || {}),
      modelProvider: result.modelProvider
    };
    renderLocalJudgePanel(state.snapshot);
    setControlStatus("模型设置已保存，密钥不会显示在界面或支持包里");
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "模型设置保存失败"));
  } finally {
    elements.modelProviderForm?.classList.remove("is-saving");
  }
}

async function testModelProvider() {
  if (!elements.testModelProviderButton) return;
  elements.testModelProviderButton.disabled = true;
  elements.testModelProviderButton.textContent = "测试中";
  setControlStatus("Testing model connection...");
  try {
    const result = await postJson("/api/model-provider/test", modelProviderPayload());
    const status = result.result || {};
    if (elements.modelProviderApiKey) elements.modelProviderApiKey.value = "";
    elements.localJudgeStatus.textContent = status.ok ? "连接正常" : "连接失败";
    elements.localJudgeStatus.className = status.ok ? "is-ready" : "is-warning";
    elements.localJudgeSummary.textContent = status.ok
      ? `模型连接正常：${localJudgeProviderLabel(status.provider)} · ${zhText(status.model || "默认模型")}`
      : zhText(status.error || "模型连接失败；Demo Only 仍可运行。");
    setControlStatus(status.ok ? "模型连接正常" : "模型连接失败，仍可使用 Demo Only");
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "模型连接测试失败"));
  } finally {
    elements.testModelProviderButton.disabled = false;
    elements.testModelProviderButton.textContent = "测试连接";
  }
}

function selectedFirstRealOrderTemplate() {
  return FIRST_REAL_ORDER_TEMPLATES[elements.firstRealOrderTemplate?.value] || FIRST_REAL_ORDER_TEMPLATES.readme_usage;
}

function renderContextPreview(preview = null) {
  if (!elements.contextPreviewPanel || !elements.contextPreviewList || !elements.contextPreviewMeta) return;
  if (!preview) {
    elements.contextPreviewList.innerHTML = "";
    elements.contextPreviewMeta.textContent = "还没有写入项目。";
    return;
  }
  const files = preview.files || [];
  const skipped = preview.skippedFiles || [];
  elements.contextPreviewPanel.classList.toggle("is-blocked", preview.status !== "ready");
  elements.contextPreviewList.innerHTML = [
    ...files.map((file) => `
      <li>
        <strong>${escapeHtml(file.path)}</strong>
        <span>${escapeHtml(String(file.chars || 0))} chars · ${escapeHtml(zhText(file.reason || "task"))}${file.truncated ? " · 已截断" : ""}</span>
      </li>
    `),
    ...skipped.slice(0, 6).map((file) => `
      <li class="is-skipped">
        <strong>${escapeHtml(file.file || "unknown")}</strong>
        <span>已跳过：${escapeHtml(zhText(file.reason || "安全策略"))}</span>
      </li>
    `)
  ].join("") || "<li><strong>无文件片段</strong><span>模型未配置或上下文不足。</span></li>";
  elements.contextPreviewMeta.textContent = [
    preview.notice || "Coding猿 只会把与任务相关的代码片段发送给你选择的模型，不会默认上传整个项目。",
    preview.hasGitDiff ? "包含 git diff 摘要。" : "不包含 git diff。",
    preview.includesTestLogs ? "包含测试日志。" : "不包含测试日志。",
    "还没有写入项目。"
  ].join(" ");
}

async function previewAiContextForFirstRealOrder(options = {}) {
  const project = missionSelectedProject(state.snapshot);
  if (!project) {
    const message = "请先选择一个本地项目目录。";
    setControlStatus(message);
    if (elements.firstRealOrderStatus) elements.firstRealOrderStatus.textContent = "无授权项目";
    return null;
  }
  const template = options.template || selectedFirstRealOrderTemplate();
  if (elements.firstRealOrderStatus) elements.firstRealOrderStatus.textContent = "预览中";
  try {
    const result = await postJson(`/api/projects/${encodeURIComponent(project.id)}/ai-context-preview`, {
      title: template.title,
      userFiles: template.files
    });
    const preview = result.contextPreview;
    renderContextPreview(preview);
    if (elements.firstRealOrderStatus) {
      elements.firstRealOrderStatus.textContent = preview.providerMode === "demo_only"
        ? "Demo Only"
        : preview.ok
          ? "上下文就绪"
          : "上下文阻断";
    }
    if (elements.firstRealOrderSummary) {
      elements.firstRealOrderSummary.textContent = preview.providerMode === "demo_only"
        ? "Demo Only is active: no AI call will be made, and only the safety loop is shown. Configure BYO API Key or Local Model to generate real diffs."
        : preview.ok
          ? "The files that may be sent to the model are listed. Next: plan, diff, verification, and Human Gate."
          : "The real AI task is blocked for now. Fix model configuration or context issues first.";
    }
    return preview;
  } catch (error) {
    const message = uiErrorMessage(error, "上下文预览失败");
    setControlStatus(message);
    if (elements.firstRealOrderStatus) elements.firstRealOrderStatus.textContent = "预览失败";
    return null;
  }
}

async function runFirstRealOrder() {
  const template = selectedFirstRealOrderTemplate();
  const preview = await previewAiContextForFirstRealOrder({ template });
  if (!preview) return;
  if (preview.providerMode === "demo_only") {
    if (elements.missionModeSelect) elements.missionModeSelect.value = "sandbox_patch";
    if (elements.missionInput) elements.missionInput.value = FIRST_ORDER_TITLE;
    setControlStatus("Demo Only does not call AI; it only shows the safety loop. Configure BYO API Key or Local Model to generate real diffs.");
    await runFirstOrder();
    return;
  }
  if (!preview.ok) {
    setControlStatus("The real AI task cannot start yet. Fix model configuration or context blockers first.");
    return;
  }
  if (elements.missionModeSelect) elements.missionModeSelect.value = "sandbox_patch";
  if (elements.missionInput) elements.missionInput.value = template.title;
  setControlStatus("Real AI task started: preview context, then generate plan and diff.");
  await runCodingLoop({
    mode: "sandbox_patch",
    title: template.title,
    patchCandidates: template.files
  });
  revealPilotFeedbackPanel("First task finished. You can export the pilot feedback JSON.");
}

function revealPilotFeedbackPanel(message = "After the first task, export the pilot feedback JSON.") {
  if (!elements.pilotFeedbackPanel) return;
  elements.pilotFeedbackPanel.hidden = false;
  if (elements.pilotFeedbackStatus) elements.pilotFeedbackStatus.textContent = message;
}

function pilotFeedbackPayload() {
  return {
    testerId: elements.pilotTesterId?.value || "",
    understoodTool: elements.pilotUnderstoodTool?.value || "unspecified",
    understoodNoAutoWrite: elements.pilotNoAutoWrite?.value || "unspecified",
    blockedAt: elements.pilotBlockedAt?.value || "",
    trustRealProject: elements.pilotTrustRealProject?.value || "unspecified",
    feedbackScore: elements.pilotFeedbackScore?.value || "",
    willingToPay: elements.pilotWillingToPay?.value || "",
    notes: elements.pilotFeedbackNotes?.value || "",
    firstTaskStatus: state.taskInsight?.status || state.liveRun?.status || "unknown",
    diffVisible: state.taskInsight?.html?.includes("diff") || state.inspectorTab === "diff" ? "yes" : "unsure",
    humanGateUnderstood: elements.pilotNoAutoWrite?.value || "unspecified",
    applyClicked: "unsure",
    rollbackAvailable: state.taskInsight?.html?.includes("Rollback") || state.taskInsight?.html?.includes("回滚") ? "yes" : "unsure",
    supportBundleGenerated: elements.supportBundleStatus?.textContent?.includes("已生成") ? "yes" : "unsure",
    blockerCategory: elements.pilotBlockedAt?.value || ""
  };
}

async function submitPilotFeedback(event) {
  event.preventDefault();
  if (!elements.pilotFeedbackForm) return;
  const button = elements.pilotFeedbackForm.querySelector("button[type='submit']");
  if (button) {
    button.disabled = true;
    button.textContent = "Exporting";
  }
  if (elements.pilotFeedbackStatus) elements.pilotFeedbackStatus.textContent = "Exporting redacted pilot feedback JSON...";
  try {
    const result = await postJson("/api/pilot/feedback", pilotFeedbackPayload(), {
      headers: {
        "X-Codex-Office-Local": "pilot-feedback"
      }
    });
    const feedback = result.feedback || {};
    if (elements.pilotFeedbackStatus) {
      elements.pilotFeedbackStatus.textContent = `Exported: ${feedback.feedbackPath || "data/pilot-feedback"}`;
    }
    setControlStatus("Pilot feedback exported without API keys or source contents.");
    await fetchStatus();
  } catch (error) {
    const message = uiErrorMessage(error, "Pilot feedback export failed");
    if (elements.pilotFeedbackStatus) elements.pilotFeedbackStatus.textContent = message;
    setControlStatus(message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Export Pilot Feedback JSON";
    }
  }
}

async function testLocalJudgeConnection() {
  if (!elements.testLocalJudgeButton) return;
  elements.testLocalJudgeButton.disabled = true;
  elements.testLocalJudgeButton.textContent = "检测中";
  setControlStatus("正在检测本地审核猿");

  try {
    const result = await apiFetch("/api/local-judge/status");
    const ok = result.ok;
    elements.localJudgeStatus.textContent = ok ? "连接正常" : "连接失败";
    elements.localJudgeStatus.className = ok ? "is-ready" : "is-warning";
    elements.localJudgeSummary.textContent = ok
      ? `已连接 ${localJudgeProviderLabel(result.provider)}，可用模型：${(result.models || []).slice(0, 3).join("、") || zhText(result.model)}`
      : zhText(result.error || "本地模型服务未响应。");
    setControlStatus(ok ? "本地审核猿连接正常" : "本地审核猿连接失败");
  } catch (error) {
    elements.localJudgeStatus.textContent = "连接失败";
    elements.localJudgeStatus.className = "is-warning";
    elements.localJudgeSummary.textContent = zhText(error?.message || "检测失败");
    setControlStatus("本地审核猿检测失败");
  } finally {
    elements.testLocalJudgeButton.disabled = false;
    elements.testLocalJudgeButton.textContent = "测试连接";
  }
}

async function copyLocalJudgeCommand() {
  const command = elements.localJudgeCommand?.textContent || localJudgeStartupCommand();
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
    await navigator.clipboard.writeText(command);
    setControlStatus("本地模型启动命令已复制");
  } catch {
    setControlStatus("启动命令已显示，可手动复制");
  }
}

function serviceHealthTone(status) {
  if (["online", "managed"].includes(status)) return "ready";
  if (status === "configured") return "configured";
  if (["manual", "missing"].includes(status)) return "warning";
  return "neutral";
}

function serviceHealthCardTemplate(item = {}) {
  const tone = serviceHealthTone(item.status);
  const urlLine = item.url ? `<small>${escapeHtml(item.url)}</small>` : "";
  return `
    <div class="service-health-item tone-${tone}">
      <div>
        <span>${escapeHtml(item.label || "服务")}</span>
        <strong>${escapeHtml(item.statusLabel || "未知")}</strong>
      </div>
      <p>${escapeHtml(zhText(item.detail || "等待下一次状态刷新。"))}</p>
      ${urlLine}
    </div>
  `;
}

function renderServiceHealthPanel(snapshot) {
  if (!elements.serviceHealthList) return;
  const health = snapshot.serviceHealth || {};
  const items = [health.local, health.publicEntry, health.tunnel, health.daemon].filter(Boolean);
  const warnings = items.filter((item) => ["manual", "missing"].includes(item.status));
  const managed = items.filter((item) => ["online", "managed", "configured"].includes(item.status));

  elements.serviceHealthStatus.textContent = warnings.length ? "需留意" : "已托管";
  elements.serviceHealthStatus.className = warnings.length ? "is-warning" : "is-ready";
  elements.serviceHealthSummary.textContent = warnings.length
    ? "公网或后台守护还有待确认，但主服务仍保持旁路可见。"
    : `本地服务、公网入口、Cloudflare 隧道和后台守护已确认 ${managed.length}/${items.length}。`;
  elements.serviceHealthList.innerHTML = items.length
    ? items.map(serviceHealthCardTemplate).join("")
    : `<div class="service-health-item tone-warning"><strong>暂无健康快照</strong><p>请刷新页面或检查服务进程。</p></div>`;
}

function operationalStatusTone(status) {
  if (status === "operational") return "is-ready";
  if (status === "beta_ready") return "is-beta";
  return "is-warning";
}

function operationalCheckTemplate(check = {}) {
  const statusLabel = check.status === "passed" ? "已通过" : check.critical ? "阻断" : "建议";
  return `
    <div class="ops-check-row status-${escapeHtml(check.status || "unknown")}">
      <span>${escapeHtml(statusLabel)}</span>
      <strong>${escapeHtml(zhText(check.label || "检查项"))}</strong>
    </div>
  `;
}

function operationalActionTemplate(action = {}) {
  return `
    <div class="ops-next-action">
      <strong>${escapeHtml(zhText(action.title || "下一步"))}</strong>
      <span>${escapeHtml(zhText(action.detail || "继续补齐运营条件。"))}</span>
    </div>
  `;
}

function compactStatusLabel(status) {
  if (status === "passed" || status === "ready" || status === "connected") return "通过";
  if (status === "blocked") return "阻断";
  if (status === "warning" || status === "ready_with_warnings") return "提示";
  if (status === "failed") return "失败";
  return "等待";
}

function aiwcConfigTemplate(item = {}) {
  const value = item.configured
    ? item.secret
      ? "已配置，已隐藏"
      : item.displayValue || "已配置"
    : "缺失";
  return `
    <div class="aiwc-config-item ${item.configured ? "is-configured" : "is-missing"}">
      <span>${escapeHtml(item.key || "AIWC_CONFIG")}</span>
      <strong>${escapeHtml(zhText(item.label || "配置项"))}</strong>
      <small>${escapeHtml(value)}</small>
    </div>
  `;
}

function renderOperationalReadinessPanel(snapshot) {
  if (!elements.operationalStatus) return;
  const readiness = snapshot.operationalReadiness || {};
  const aiwc = snapshot.aiwc || {};
  const checks = readiness.checks || [];
  const nextActions = readiness.nextActions || [];

  elements.operationalStatus.textContent = zhText(readiness.statusLabel || "未可运营");
  elements.operationalStatus.className = operationalStatusTone(readiness.status);
  elements.operationalScore.textContent = String(readiness.score ?? "--").padStart(2, "0");
  elements.operationalSummary.textContent = zhText(readiness.summary || "正在确认真实闭环、回滚、报告和支持能力。");
  elements.operationalChecklist.innerHTML = checks.length
    ? checks.slice(0, 6).map(operationalCheckTemplate).join("")
    : `<div class="ops-check-row status-blocked"><span>等待</span><strong>暂无运营快照</strong></div>`;
  elements.operationalNextActions.innerHTML = nextActions.length
    ? nextActions.slice(0, 3).map(operationalActionTemplate).join("")
    : `<div class="ops-next-action"><strong>无硬阻断</strong><span>继续用真实任务验证 beta 运营质量。</span></div>`;
  if (elements.aiwcHealthStatus) {
    elements.aiwcHealthStatus.textContent = zhText(aiwc.statusLabel || "未测试");
    elements.aiwcHealthStatus.className = aiwc.ok ? "is-ready" : aiwc.configured ? "is-warning" : "is-missing";
  }
  if (elements.aiwcConfigList) {
    elements.aiwcConfigList.innerHTML = (aiwc.items || []).length
      ? aiwc.items.map(aiwcConfigTemplate).join("")
      : `<div class="aiwc-config-item is-missing"><span>AIWC</span><strong>配置未加载</strong><small>等待状态刷新</small></div>`;
  }
  if (elements.aiwcHealthDetail) {
    const missing = aiwc.missing?.length ? `缺失：${aiwc.missing.join("、")}。` : "";
    elements.aiwcHealthDetail.textContent = `${missing}${zhText(aiwc.detail || "AIWC 失败只作为 warning，不阻断本地 beta。")}`;
  }
}

function firstRunCheckTemplate(check = {}) {
  return `
    <div class="first-run-item status-${escapeHtml(check.status || "waiting")}">
      <span>${escapeHtml(compactStatusLabel(check.status))}</span>
      <strong>${escapeHtml(zhText(check.label || "检查项"))}</strong>
      <small>${escapeHtml(zhText(check.detail || ""))}</small>
    </div>
  `;
}

function renderFirstRunChecklist(snapshot) {
  if (!elements.firstRunList) return;
  const checklist = snapshot.firstRunChecklist || {};
  const checks = checklist.checks || [];

  elements.firstRunStatus.textContent = zhText(checklist.statusLabel || "检测中");
  elements.firstRunStatus.className = checklist.status === "ready" ? "is-ready" : checklist.status === "blocked" ? "is-warning" : "is-beta";
  elements.firstRunSummary.textContent = zhText(checklist.summary || "检查本机启动、项目目录和基础执行器。");
  elements.firstRunList.innerHTML = checks.length
    ? checks.map(firstRunCheckTemplate).join("")
    : `<div class="first-run-item status-warning"><span>等待</span><strong>暂无检查</strong><small>刷新后会显示首次运行检查。</small></div>`;
}

function onboardingStepTemplate(step = {}) {
  return `
    <div class="onboarding-step status-${escapeHtml(step.status || "waiting")}">
      <span>${escapeHtml(compactStatusLabel(step.status))}</span>
      <strong>${escapeHtml(zhText(step.label || "步骤"))}</strong>
      <small>${escapeHtml(zhText(step.detail || ""))}</small>
    </div>
  `;
}

function renderFirstRunOnboarding(snapshot) {
  if (!elements.firstRunOnboarding || APP_MODE !== AppMode.localOffice) return;
  const onboarding = snapshot.onboarding || {};
  const required = Boolean(onboarding.required);
  elements.firstRunOnboarding.hidden = !required;
  document.body.classList.toggle("is-onboarding", required);
  if (!required) return;

  const steps = onboarding.steps || [];
  elements.onboardingSummary.textContent = zhText(onboarding.summary || "Codingape Office is your local AI coding worker for Mac. It shows evidence and diffs before any code write.");
  elements.onboardingStepList.innerHTML = steps.length
    ? steps.map(onboardingStepTemplate).join("")
    : `<div class="onboarding-step status-blocked"><span>等待</span><strong>选择本地项目目录</strong><small>首次启动需要授权 project root。</small></div>`;
  const hasProject = Boolean(snapshot.localProjects?.selectedPath);
  if (elements.onboardingFirstOrderButton) elements.onboardingFirstOrderButton.disabled = !hasProject;
  if (elements.onboardingEnterOfficeButton) elements.onboardingEnterOfficeButton.disabled = !hasProject;
  if (elements.onboardingStatus) {
    elements.onboardingStatus.textContent = hasProject
      ? "Project authorized. You can run the first task; Demo Only will not call AI."
      : "Choose a local project folder; the system will not scan the full disk by default.";
  }
}

function recentErrorTemplate(error = {}) {
  const time = error.timestamp ? new Date(error.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
  return `
    <div class="recent-error-item severity-${escapeHtml(error.severity || "warning")}">
      <span>${escapeHtml(time)}</span>
      <strong>${escapeHtml(zhText(error.title || "运行提示"))}</strong>
      <small>${escapeHtml(zhText(error.detail || "暂无详情"))}</small>
    </div>
  `;
}

function recoveryItemTemplate(item = {}) {
  return `
    <div class="recovery-item severity-${escapeHtml(item.severity || "warning")}">
      <strong>${escapeHtml(zhText(item.title || "恢复建议"))}</strong>
      <p>${escapeHtml(zhText(item.detail || ""))}</p>
      <small>${escapeHtml(zhText(item.fix || "生成支持包并联系 beta 支持。"))}</small>
    </div>
  `;
}

function renderSupportCenter(snapshot) {
  if (!elements.recentErrorList) return;
  const support = snapshot.supportCenter || {};
  const errors = support.recentErrors || [];
  const recovery = support.recoveryGuide || [];

  elements.supportCenterStatus.textContent = errors.length ? "有提示" : "正常";
  elements.supportCenterStatus.className = errors.length ? "is-warning" : "is-ready";
  elements.recentErrorCount.textContent = String(errors.length);
  elements.restartHintText.textContent = support.restartHint || "launchctl kickstart -k gui/$(id -u)/com.geoaifactory.codex-office";
  elements.recentErrorList.innerHTML = errors.length
    ? `${errors.slice(0, 20).map(recentErrorTemplate).join("")}${recovery.length ? `<div class="recovery-guide">${recovery.map(recoveryItemTemplate).join("")}</div>` : ""}`
    : `<div class="recent-error-item severity-info"><span>--</span><strong>暂无错误</strong><small>最近 20 条错误会显示在这里。</small></div>`;
  if (!errors.length && recovery.length) {
    elements.recentErrorList.innerHTML += `<div class="recovery-guide">${recovery.map(recoveryItemTemplate).join("")}</div>`;
  }
}

function betaOpsStatusTone(status) {
  if (status === "ready") return "is-ready";
  if (status === "collecting") return "is-beta";
  return "is-warning";
}

function betaOpsTrustTemplate(item = {}) {
  return `
    <div class="beta-ops-row status-${escapeHtml(item.status || "unknown")}">
      <span>${escapeHtml(compactStatusLabel(item.status))}</span>
      <strong>${escapeHtml(zhText(item.label || "可信分发"))}</strong>
      <small>${escapeHtml(zhText(item.detail || ""))}</small>
    </div>
  `;
}

function betaOpsFailureTemplate(metric = {}) {
  return `
    <div class="beta-ops-row severity-${escapeHtml(metric.severity || "medium")}">
      <span>${escapeHtml(String(metric.count || 0))}</span>
      <strong>${escapeHtml(zhText(metric.label || "卡点"))}</strong>
      <small>${escapeHtml(zhText(metric.description || ""))}</small>
    </div>
  `;
}

function renderBetaOpsPanel(snapshot) {
  if (!elements.betaOpsStatus) return;
  const betaOps = snapshot.betaOps || {};
  const cohort = betaOps.cohort || {};
  const distribution = betaOps.distribution || {};
  const firstOrderRate = cohort.firstOrderSuccessRate ?? 0;
  const targetMin = betaOps.targetTesterMin || 3;
  const targetMax = betaOps.targetTesterMax || 5;
  const trustItems = [
    {
      label: "Developer ID",
      status: distribution.developerIdReady ? "passed" : "blocked",
      detail: distribution.developerIdReady ? "已检测到 Developer ID Application。" : "本机没有 Developer ID Application 证书。"
    },
    {
      label: "签名",
      status: distribution.signingStatus === "signed" ? "passed" : "blocked",
      detail: `signing=${distribution.signingStatus || "missing"}`
    },
    {
      label: "公证",
      status: distribution.notarizationStatus === "notarized" ? "passed" : "blocked",
      detail: `notarization=${distribution.notarizationStatus || "missing"}`
    }
  ];

  elements.betaOpsStatus.textContent = zhText(betaOps.statusLabel || "Pilot blocked");
  elements.betaOpsStatus.className = betaOpsStatusTone(betaOps.status);
  elements.betaOpsSummary.textContent = zhText(betaOps.summary || "Waiting for trusted distribution and 3-5 external tester records.");
  elements.betaOpsTesterCount.textContent = `${cohort.testerCount || 0}/${targetMin}-${targetMax}`;
  elements.betaOpsFirstOrderRate.textContent = `${firstOrderRate}%`;
  elements.betaOpsSupportCount.textContent = String(cohort.supportBundleCount || 0);
  elements.betaOpsTrustList.innerHTML = trustItems.map(betaOpsTrustTemplate).join("");
  elements.betaOpsFailureList.innerHTML = (betaOps.failureMetrics || []).length
    ? betaOps.failureMetrics.map(betaOpsFailureTemplate).join("")
    : `<div class="beta-ops-row severity-medium"><span>0</span><strong>暂无卡点</strong><small>记录测试者结果后会自动量化。</small></div>`;
  elements.betaOpsNextActions.innerHTML = (betaOps.nextActions || []).length
    ? betaOps.nextActions.slice(0, 4).map(operationalActionTemplate).join("")
    : `<div class="ops-next-action"><strong>Pilot can expand</strong><span>Keep growing the cohort and monitor first-task success rate.</span></div>`;
}

function renderRoomOpsRibbon(snapshot) {
  if (!elements.roomLatestEvent) return;
  const companyReport = snapshot.companyReport || {};
  const project = currentProject() || preferredProject(snapshot);
  const latestEvent = missionRibbonEvent(snapshot, project);
  const completed = companyMetricValue(companyReport, ["completed", "tasks done", "missions", "任务完成", "完成任务"], "0");
  const savedValue = companyMetricValue(companyReport, ["hours saved", "saved", "节省时间", "节省"], "0");
  const saved = String(savedValue).includes("小时") ? savedValue : `${savedValue}小时`;
  const blocked =
    companyMetricValue(companyReport, ["risk blocked", "risks blocked", "risks gated", "apply blocks", "blocked", "风险阻断", "阻断"], "0");

  elements.roomLatestEvent.textContent = latestEvent
    ? `${zhWorkerName(latestEvent.workerName, latestEvent.workerId)} · ${zhEventTitle(latestEvent)}`
    : "等待信号";
  elements.roomMissions.textContent = String(completed);
  elements.roomSaved.textContent = String(saved);
  elements.roomBlocked.textContent = String(blocked);
}

function renderOperatorConsole(snapshot) {
  const autonomy = snapshot.autonomy || {};
  const companyReport = snapshot.companyReport || {};
  const launch = snapshot.launch || {};
  const latest = launch.latestEvidence || {};
  const project = currentProject() || preferredProject(snapshot);
  const activeTask = latestTaskForProject(snapshot, project?.id);
  const director = missionDirectorForTask(activeTask, {
    applyRunnerEnabled: Boolean(autonomy.metrics?.applyRunnerEnabled),
    project
  });
  const blockers = autonomy.hardBlockers || [];
  const objectives = autonomy.objectives || [];
  const score = Number(autonomy.score || 0);

  elements.launchStage.textContent = zhText(launch.currentStage || "等待首次运行");
  elements.readinessScore.textContent = String(score).padStart(2, "0");
  elements.readinessLevel.textContent = zhText(autonomy.level || "L1 演示就绪度");
  elements.readinessVerdict.textContent = verdictLabel(autonomy.verdict);
  elements.readinessSummary.textContent = zhText(autonomy.summary || "等待有证据支撑的真实任务。");
  elements.readinessBar.style.width = `${Math.max(0, Math.min(100, score))}%`;
  elements.blockerCount.textContent = String(blockers.length);
  elements.blockerList.innerHTML = blockers.length
    ? blockers.slice(0, 4).map(blockerTemplate).join("")
    : objectives.slice(0, 4).map(objectiveTemplate).join("");
  elements.companyReportStamp.textContent = companyReport.generatedAt
    ? new Date(companyReport.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "实时";
  elements.companyReportHeadline.textContent = zhText(companyReport.headline || "暂无战报。");
  elements.companyMetrics.innerHTML = (companyReport.metrics || []).map(metricTemplate).join("");
  renderCompanyShareCard(companyReport);
  renderLocalJudgePanel(snapshot);
  renderServiceHealthPanel(snapshot);
  renderOperationalReadinessPanel(snapshot);
  renderFirstRunChecklist(snapshot);
  renderFirstRunOnboarding(snapshot);
  renderSupportCenter(snapshot);
  renderBetaOpsPanel(snapshot);
  elements.latestEvidenceStatus.textContent = latest.taskId
    ? latest.applyStatus && latest.applyStatus !== "not_run"
      ? applyRunStatusLabel(latest.applyStatus)
      : latest.patchRunStatus && latest.patchRunStatus !== "not_run"
      ? patchRunStatusLabel(latest.patchRunStatus)
      : latest.gateStatus && latest.gateStatus !== "pending"
      ? humanGateStatusLabel(latest.gateStatus)
      : latest.verificationStatus && latest.verificationStatus !== "not_run"
      ? verificationStatusLabel(latest.verificationStatus)
      : latest.proposalRisk
      ? `${riskLabel(latest.proposalRisk)} · Judge猿就绪`
      : "证据已采集"
    : "暂无证据";
  elements.latestEvidenceSummary.textContent = latest.taskId
    ? `${zhText(latest.title)} · ${latest.checks || 0} 项检查 · ${latest.changedFiles?.length || 0} 个文件`
    : "运行一次带证据的真实闭环，让这个办公室真正动起来。";
  if (elements.stageTitle) {
    elements.stageTitle.textContent = zhText(director.roomTitle || director.taskTitle || `${snapshot.projects?.length || 0} 个工作区节点`);
  }
  if (elements.roomTitle) {
    elements.roomTitle.textContent = zhText(director.roomTitle);
  }
  if (elements.deckViewport) {
    elements.deckViewport.dataset.missionState = director.sceneState;
    elements.deckViewport.dataset.focusWorker = director.focusWorkerId;
  }
  if (elements.missionDirectorRibbon) {
    elements.missionDirectorRibbon.dataset.missionState = director.sceneState;
  }
  if (elements.missionProofStrip) {
    elements.missionProofStrip.dataset.missionState = director.sceneState;
  }
  if (elements.directorWorker) elements.directorWorker.textContent = zhText(director.workerSignal);
  if (elements.directorSafety) elements.directorSafety.textContent = zhText(director.safetyLine);
  if (elements.directorNext) elements.directorNext.textContent = zhText(director.nextAction);
  if (elements.proofEvidence) elements.proofEvidence.textContent = director.evidenceCompleteness.label;
  if (elements.proofHumanGate) elements.proofHumanGate.textContent = zhStatus(director.humanGateStatus);
  if (elements.proofApplyGate) elements.proofApplyGate.textContent = zhStatus(director.applyGateStatus);
  if (elements.proofProgress) elements.proofProgress.textContent = `${director.progress}%`;
  if (elements.inspectorShellMode) elements.inspectorShellMode.textContent = `自动 · ${zhText(director.phaseLabel)}`;
  if (elements.inspectorShellTitle) elements.inspectorShellTitle.textContent = zhText(director.inspectorTitle);
  if (elements.commandProject) elements.commandProject.textContent = `项目：${zhText(project?.name || "工作区")}`;
  if (elements.commandRun) elements.commandRun.textContent = formatRunId(director.runId || latest.taskId);
  if (elements.commandPhase) elements.commandPhase.textContent = `阶段：${zhText(director.phaseLabel)}`;
  if (elements.commandRisk) {
    const risk = activeTask?.risk || project?.risk?.key || "low";
    elements.commandRisk.textContent = risk === "high" ? "人工闸门" : risk === "medium" ? "需复核" : "低风险";
    elements.commandRisk.className = `command-badge risk-${risk}`;
  }
  if (elements.commandIngestion) {
    const localJudge = state.snapshot?.localJudge || {};
    const connected = Boolean(autonomy.metrics?.aiwcConfigured);
    const judgeReady = localJudge.enabled && localJudge.latestStatus === "ready";
    const judgeFailed = localJudge.enabled && localJudge.latestStatus === "failed";
    elements.commandIngestion.textContent = judgeReady
      ? `审核猿模型：${zhText(localJudge.model || "已连接")}`
      : judgeFailed
        ? "审核猿模型需重试"
        : localJudge.enabled
          ? `审核猿模型：${zhText(localJudge.model || "待审查")}`
          : connected
            ? "记录已连接"
            : "本地记录";
    elements.commandIngestion.title = localJudge.enabled
      ? `本地模型：${zhText(localJudge.provider)} · ${zhText(localJudge.model)} · 最近：${localJudgeStatusLabel(localJudge.latestStatus)}`
      : "未启用本地模型审查";
    elements.commandIngestion.className = `command-badge ${judgeReady || connected ? "is-live" : ""}${judgeFailed ? " risk-medium" : ""}`;
  }
  if (elements.commandReadiness) elements.commandReadiness.textContent = `${score}/100`;
  if (elements.commandMode) {
    elements.commandMode.textContent = zhText(director.commandMode);
  }
  renderCommandProgress(activeTask, director);
}

function evidenceInsightHtml(evidence, proposal = null) {
  const status = evidence.commands?.find((entry) => entry.command === "git status --short")?.output || "clean";
  const diffStat = evidence.commands?.find((entry) => entry.command === "git diff --stat")?.output || "暂无差异统计";
  const changedFiles = evidence.commands?.find((entry) => entry.command === "git diff --name-only")?.output
    ?.split("\n")
    .filter(Boolean)
    .slice(0, 8) || [];
  const verification = evidence.recommendedVerification || [];
  const proposalLine = proposal?.summary ? `<p>${escapeHtml(zhText(proposal.summary))}</p>` : "";

  return `
    <p>${escapeHtml(zhText(evidence.note || "只读证据已采集。"))}</p>
    <div class="insight-grid">
      <div><span>状态</span><strong>${escapeHtml(status === "clean" ? "干净" : "有变更")}</strong></div>
      <div><span>检查</span><strong>${escapeHtml(String(evidence.commands?.length || 0))}</strong></div>
    </div>
    <h4>变更文件</h4>
    ${insightList(changedFiles)}
    <h4>验证建议</h4>
    ${insightList(verification)}
    <h4>差异统计</h4>
    <pre>${escapeHtml(diffStat.slice(0, 900))}</pre>
    ${proposalLine}
  `;
}

function verificationInsightHtml(verification) {
  if (!verification) {
    return `
      <h4>验证结果</h4>
      <p>还没有采集验证证据。</p>
    `;
  }

  const result = verification.result || {};
  const status = verificationStatusFromSummary(verification);
  return `
    <h4>验证结果</h4>
    <div class="insight-grid">
      <div><span>状态</span><strong>${escapeHtml(verificationStatusLabel(status))}</strong></div>
      <div><span>脚本</span><strong>${escapeHtml(verification.script || "未知")}</strong></div>
    </div>
    <pre>${escapeHtml(String(result.output || verification.note || "").slice(0, 1200))}</pre>
  `;
}

function diffChangeKindLabel(kind) {
  const labels = {
    added: "新增文件",
    expanded: "新增为主",
    modified: "修改文件",
    reduced: "删除为主",
    removed: "删除文件"
  };
  return labels[kind] || "修改文件";
}

function diffReviewRiskLabel(risk) {
  const labels = {
    high: "高复核",
    low: "低复核",
    medium: "中复核"
  };
  return labels[risk] || "低复核";
}

function diffAuditBriefHtml({ summary, maxRisk, reviewVerdict, projectFileState, rollbackState }) {
  const changedScope = summary.files.length
    ? `${summary.files.length} 个文件 · +${summary.added} / -${summary.removed}`
    : "没有检测到文件差异";
  const largestFile = [...summary.files].sort((a, b) => (b.added + b.removed) - (a.added + a.removed))[0];
  const riskReason = maxRisk === "high"
    ? "存在高复核文件或大范围变化，需要先人工逐项检查。"
    : maxRisk === "medium"
      ? "存在中等复核变化，建议先看文件列表和关键差异。"
      : "差异范围较小，但仍需人工确认后才能进入写入路径。";
  const nextDecision = projectFileState === "项目文件未修改" && rollbackState === "回滚快照已就绪"
    ? "可继续查看写入闸门，但默认保持阻断。"
    : "先补齐沙盒补丁、回滚快照或运行模式证据。";

  return `
    <div class="diff-audit-brief risk-${escapeHtml(maxRisk)}">
      <section>
        <span>改了什么</span>
        <strong>${escapeHtml(changedScope)}</strong>
        <small>${escapeHtml(largestFile ? `最大变化：${largestFile.after || largestFile.before}` : "没有可展示的最大变化文件。")}</small>
      </section>
      <section>
        <span>风险在哪</span>
        <strong>${escapeHtml(diffReviewRiskLabel(maxRisk))}</strong>
        <small>${escapeHtml(riskReason)}</small>
      </section>
      <section>
        <span>能否继续</span>
        <strong>${escapeHtml(reviewVerdict)}</strong>
        <small>${escapeHtml(nextDecision)}</small>
      </section>
    </div>
  `;
}

function diffReviewChecklistHtml({ patchRun, summary, maxRisk }) {
  const checks = [
    {
      label: "是不是只在沙盒",
      value: patchRun?.mode === "sandbox" ? "是，项目文件未改" : "需要确认运行模式",
      tone: patchRun?.mode === "sandbox" ? "safe" : "warn",
      detail: patchRun?.mode === "sandbox"
        ? "当前差异来自沙盒补丁包，不代表已经写入工作区。"
        : "先确认补丁运行模式，再决定是否进入下一道闸门。"
    },
    {
      label: "有没有回滚点",
      value: patchRun?.rollbackSnapshotPath ? "有，快照可追溯" : "缺少回滚快照",
      tone: patchRun?.rollbackSnapshotPath ? "safe" : "warn",
      detail: patchRun?.rollbackSnapshotPath
        ? "未来进入写入路径前，已有还原依据可供审计。"
        : "缺少回滚快照时，不应该继续推进写入路径。"
    },
    {
      label: "能不能自动写入",
      value: "不能，仍需人工确认",
      tone: "blocked",
      detail: "查看差异不会触发项目写入；写入闸门默认保持阻断。"
    },
    {
      label: "先看哪里",
      value: summary.files.length ? "先看高变化文件" : "先补齐差异证据",
      tone: maxRisk === "high" ? "warn" : "safe",
      detail: summary.files.length
        ? "按文件列表逐项复核，再决定保持阻断还是要求返工。"
        : "没有差异时，先回到证据包确认补丁是否生成。"
    }
  ];

  return `
    <div class="diff-review-checklist" aria-label="差异复核三问">
      <div class="diff-review-checklist-head">
        <span>差异复核三问</span>
        <strong>先确认沙盒、回滚和人工闸门，再看代码细节</strong>
      </div>
      ${checks.map((check) => `
        <div class="diff-review-check is-${escapeHtml(check.tone)}">
          <span>${escapeHtml(check.label)}</span>
          <strong>${escapeHtml(check.value)}</strong>
          <small>${escapeHtml(check.detail)}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function diffDossierHtml(patchRun, diffPreview) {
  const summary = summarizeUnifiedDiff(diffPreview);
  const sections = unifiedDiffSections(diffPreview);
  const taskId = patchRun?.taskId || "";
  const fileRows = summary.files.length
    ? summary.files.map((file) => {
        const kind = diffFileChangeKind(file);
        const risk = diffReviewRisk(file);
        return `
        <div class="diff-file-row is-${escapeHtml(kind)} risk-${escapeHtml(risk)}">
          <span>${escapeHtml(file.after || file.before || "未知文件")}</span>
          <strong>${escapeHtml(diffChangeKindLabel(kind))} · +${escapeHtml(String(file.added))} / -${escapeHtml(String(file.removed))}</strong>
          <small>${escapeHtml(diffReviewRiskLabel(risk))} · ${escapeHtml(String(file.hunks))} 段 · 沙盒审核</small>
        </div>
      `;
      }).join("")
    : `<div class="diff-file-row is-empty"><span>未采集到变更文件</span><strong>+0 / -0</strong><small>0 段</small></div>`;
  const sectionRows = sections.length
    ? sections.map((section) => {
        const kind = diffFileChangeKind(section);
        const risk = diffReviewRisk(section);
        const rows = section.rows.map((row) => `
          <div class="diff-line type-${escapeHtml(row.type)}">
            <span>${escapeHtml(String(row.lineNumber).padStart(3, "0"))}</span>
            <code>${escapeHtml(row.content || " ")}</code>
          </div>
        `).join("");
        const truncated = section.truncated
          ? `<div class="diff-truncated">差异预览已截断。请打开补丁产物查看完整内容。</div>`
          : "";
        return `
          <section class="diff-file-section">
            <div class="diff-file-section-head">
              <div>
                <span>审核文件</span>
        <strong>${escapeHtml(section.after || section.before || "未知文件")}</strong>
              </div>
              <div class="diff-file-section-stats">
                <span>${escapeHtml(diffChangeKindLabel(kind))}</span>
                <span>${escapeHtml(diffReviewRiskLabel(risk))}</span>
                <span>+${escapeHtml(String(section.added))}</span>
                <span>-${escapeHtml(String(section.removed))}</span>
                <span>${escapeHtml(String(section.hunks))} 段</span>
              </div>
            </div>
            <div class="diff-viewer" aria-label="统一差异预览：${escapeHtml(section.after || section.before || "文件")}">
              ${rows || `<div class="diff-line type-empty"><span>000</span><code>未采集到补丁差异。</code></div>`}
              ${truncated}
            </div>
          </section>
        `;
      }).join("")
    : `
      <section class="diff-file-section">
        <div class="diff-viewer" aria-label="统一差异预览">
          <div class="diff-line type-empty"><span>000</span><code>未采集到补丁差异。</code></div>
        </div>
      </section>
    `;
  const sandboxNote = patchRun?.mode === "sandbox"
    ? "沙盒补丁已生成，项目文件未被改动。"
    : "补丁运行证据已采集，写入前请复核执行模式。";
  const maxRisk = summary.files.some((file) => diffReviewRisk(file) === "high")
    ? "high"
    : summary.files.some((file) => diffReviewRisk(file) === "medium")
      ? "medium"
      : "low";
  const reviewFacts = [
    patchRun?.mode === "sandbox" ? "仅沙盒产物" : "审核产物",
    patchRun?.rollbackSnapshotPath ? "回滚快照就绪" : "缺少回滚快照",
    "写入需要精确人工确认"
  ];
  const reviewVerdict = maxRisk === "high"
    ? "需要重点复核"
    : maxRisk === "medium"
      ? "建议人工复核"
      : "可进入闸门复核";
  const projectFileState = patchRun?.mode === "sandbox" ? "项目文件未修改" : "检查运行模式";
  const rollbackState = patchRun?.rollbackSnapshotPath ? "回滚快照已就绪" : "缺少回滚快照";
  const writeCondition = "必须经过人工闸门和精确确认语";

  return `
    <div class="diff-dossier diff-review-shell">
      <div class="diff-dossier-head diff-review-hero">
        <div>
          <span>补丁审核</span>
          <strong>${escapeHtml(summary.files.length ? `${summary.files.length} 个审核文件` : "暂无差异")}</strong>
          <small>${escapeHtml(sandboxNote)}</small>
        </div>
        <div class="diff-score-grid">
          <div><span>文件</span><strong>${escapeHtml(String(summary.files.length))}</strong></div>
          <div><span>新增</span><strong>+${escapeHtml(String(summary.added))}</strong></div>
          <div><span>删除</span><strong>-${escapeHtml(String(summary.removed))}</strong></div>
          <div><span>复核</span><strong>${escapeHtml(diffReviewRiskLabel(maxRisk))}</strong></div>
        </div>
      </div>
      <div class="diff-review-safety">
        <span class="is-redline">红线：不会自动写入项目文件</span>
        ${reviewFacts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}
      </div>
      <div class="diff-review-verdict risk-${escapeHtml(maxRisk)}">
        <div>
          <span>审查结论</span>
          <strong>${escapeHtml(reviewVerdict)}</strong>
          <small>${escapeHtml(diffReviewRiskLabel(maxRisk))} · ${escapeHtml(summary.files.length ? `${summary.files.length} 个文件待复核` : "没有差异文件")}</small>
        </div>
        <div>
          <span>项目文件</span>
          <strong>${escapeHtml(projectFileState)}</strong>
          <small>当前展示的是补丁审核产物，不是自动写入结果。</small>
        </div>
        <div>
          <span>回滚</span>
          <strong>${escapeHtml(rollbackState)}</strong>
          <small>写入路径必须先具备可追溯还原点。</small>
        </div>
        <div>
          <span>写入条件</span>
          <strong>${escapeHtml(writeCondition)}</strong>
          <small>不满足条件时，保持写入阻断。</small>
        </div>
      </div>
      ${diffAuditBriefHtml({ summary, maxRisk, reviewVerdict, projectFileState, rollbackState })}
      ${diffReviewChecklistHtml({ patchRun, summary, maxRisk })}
      <div class="diff-review-actions">
        <button type="button" data-review-action="back_gate" data-task-id="${escapeHtml(taskId)}"${taskId ? "" : " disabled"}>返回闸门</button>
        <button type="button" data-review-action="keep_blocked" data-task-id="${escapeHtml(taskId)}"${taskId ? "" : " disabled"}>保持写入阻断</button>
        <button type="button" data-review-action="request_rework" data-task-id="${escapeHtml(taskId)}"${taskId ? "" : " disabled"}>要求返工</button>
      </div>
      <div class="diff-dossier-body">
        <div class="diff-file-list">
          ${fileRows}
        </div>
        <div class="diff-review-code">
          ${sectionRows}
        </div>
      </div>
    </div>
  `;
}

function patchRunInsightHtml(patchRun) {
  if (!patchRun) {
    return `
      <h4>受控补丁执行器</h4>
      <p>还没有采集补丁运行证据。</p>
    `;
  }

  const blockers = (patchRun.blockers || []).map((blocker) => `${zhText(blocker.title)}：${zhText(blocker.detail)}`);
  const files = patchRun.allowedFiles?.length ? patchRun.allowedFiles : ["暂无允许文件"];
  const rollbackFiles = (patchRun.rollbackFiles || []).map((file) =>
    file.existed
      ? `${file.file} · 快照 ${file.bytes} 字节`
      : `${file.file} · 新文件`
  );
  const sandboxFiles = (patchRun.sandboxFiles || []).map((file) =>
    `${file.changed ? "已变更" : "未变更"} · ${file.file} · 建议内容 ${file.proposedBytes || 0} 字节${file.sandboxPath ? ` · ${file.sandboxPath}` : ""}`
  );
  const artifacts = [
    patchRun.rollbackSnapshotPath ? zhEvidenceRef(patchRun.rollbackSnapshotPath) : "",
    patchRun.sandboxPath ? zhEvidenceRef(patchRun.sandboxPath) : "",
    patchRun.sandboxManifestPath ? zhEvidenceRef(patchRun.sandboxManifestPath) : "",
    patchRun.diffPath ? zhEvidenceRef(patchRun.diffPath) : ""
  ].filter(Boolean);
  const diffPreview = String(patchRun.diffPreview || "").trim();

  return `
    <h4>受控补丁执行器</h4>
    <div class="patch-run-card status-${escapeHtml(patchRun.status || "blocked")}">
      <div class="insight-grid">
        <div><span>状态</span><strong>${escapeHtml(patchRunStatusLabel(patchRun.status))}</strong></div>
        <div><span>模式</span><strong>${escapeHtml(zhStatus(patchRun.mode || "dry_run"))}</strong></div>
        <div><span>草稿</span><strong>${escapeHtml(String(patchRun.draftsAppliedToSandbox || 0))}</strong></div>
        <div><span>差异</span><strong>${escapeHtml(patchRun.diffPath ? "预览就绪" : "暂无差异")}</strong></div>
      </div>
      <p>${escapeHtml(zhText(patchRun.note || "补丁执行证据已采集。"))}</p>
      <h4>允许文件</h4>
      ${insightList(files)}
      <h4>回滚快照</h4>
      ${insightList(rollbackFiles)}
      <h4>沙盒补丁包</h4>
      ${insightList([...artifacts, ...sandboxFiles])}
      <h4>阻断原因</h4>
      ${insightList(blockers)}
      ${diffDossierHtml(patchRun, diffPreview)}
      <h4>安全预览</h4>
      <pre>${escapeHtml(String(patchRun.preview || "").slice(0, 1200))}</pre>
    </div>
  `;
}

function applyGateApprovalDeskHtml(applyRun) {
  const blockers = applyRun.blockers?.length
    ? applyRun.blockers.map((blocker) => `${zhText(blocker.title)}：${zhText(blocker.detail)}`)
    : ["没有发现额外阻断项，但真实写入仍需要人工确认。"];
  const candidateFiles = applyRun.candidateFiles?.length
    ? applyRun.candidateFiles.map((file) => `${file.file} · ${file.bytes || 0} 字节 · 候选哈希 ${compactHash(file.proposedSha256)}`)
    : ["暂无候选写入文件"];
  const confirmation = applyRun.requiredConfirmation || "当前不允许写入";
  const status = applyRunStatusLabel(applyRun.status);
  const writeState = applyRun.appliedFiles?.length
    ? `已写入 ${applyRun.appliedFiles.length} 个文件`
    : "项目文件未修改";

  return `
    <div class="apply-approval-desk status-${escapeHtml(applyRun.status || "blocked")}">
      <div class="apply-approval-head">
        <span>写入审批三件套</span>
        <strong>${escapeHtml(status)} · ${escapeHtml(writeState)}</strong>
        <small>先看阻断原因、确认语和影响文件；不确定时保持写入阻断。</small>
      </div>
      <div class="apply-approval-grid">
        <section class="apply-approval-card is-blocker">
          <span>为什么被阻断</span>
          <strong>${escapeHtml(blockers[0])}</strong>
          ${insightList(blockers.slice(1))}
        </section>
        <section class="apply-approval-card is-confirmation">
          <span>需要输入什么</span>
          <code>${escapeHtml(confirmation)}</code>
          <small>当前页面不会替你输入，也不会自动执行写入。</small>
        </section>
        <section class="apply-approval-card is-files">
          <span>会影响哪些文件</span>
          <strong>${escapeHtml(`${candidateFiles.length} 个候选项`)}</strong>
          ${insightList(candidateFiles.slice(0, 5))}
        </section>
      </div>
    </div>
  `;
}

function applyRunInsightHtml(applyRun) {
  if (!applyRun) {
    return `
      <h4>写入提案闸门</h4>
      <p>还没有采集写入闸门证据。</p>
    `;
  }

  const blockers = (applyRun.blockers || []).map((blocker) => `${zhText(blocker.title)}：${zhText(blocker.detail)}`);
  const appliedFiles = (applyRun.appliedFiles || []).map((file) =>
    `${file.file} · ${file.bytes || 0} 字节 · 写入后哈希 ${compactHash(file.afterSha256)}`
  );
  const candidateFiles = (applyRun.candidateFiles || []).map((file) =>
    `${file.file} · ${file.bytes || 0} 字节 · 候选哈希 ${compactHash(file.proposedSha256)}`
  );
  const artifacts = [
    applyRun.applyPath ? zhEvidenceRef(applyRun.applyPath) : "",
    applyRun.sandboxManifestPath ? zhEvidenceRef(applyRun.sandboxManifestPath) : "",
    applyRun.rollbackSnapshotPath ? zhEvidenceRef(applyRun.rollbackSnapshotPath) : ""
  ].filter(Boolean);
  const gate = applyRun.applyGate || {};
  const facts = gate.requiredFacts || {};
  const factRows = [
    ["patch diff ready", facts.diffReady],
    ["verification result exists", facts.verificationResultExists],
    ["rollback snapshot ready", facts.rollbackSnapshotReady],
    ["human approval granted", facts.humanApprovalGranted],
    ["target files inside project root", facts.allTargetFilesInsideProjectRoot]
  ];
  const canApplyApprovedPatch = Boolean(gate.canApply && applyRun.status === "requires_confirmation");
  const applyButtonDisabled = " disabled";
  const rollbackOption = applyRun.rollbackOption || {};
  const rollbackHtml = rollbackOption.available
    ? `
      <div class="rollback-option">
        <span>Rollback option</span>
        <strong>${escapeHtml(zhEvidenceRef(rollbackOption.rollbackSnapshotPath || applyRun.rollbackSnapshotPath || "rollback snapshot"))}</strong>
        <small>${escapeHtml(zhText(rollbackOption.note || "失败时可以回滚到快照。"))}</small>
        <button type="button" data-rollback-action="restore" data-task-id="${escapeHtml(applyRun.taskId || "")}">回滚到这个快照</button>
      </div>
    `
    : `
      <div class="rollback-option is-disabled">
        <span>Rollback option</span>
        <strong>尚不可用</strong>
        <small>${escapeHtml(zhText(rollbackOption.note || "需要先生成回滚快照。"))}</small>
      </div>
    `;
  const safetyFacts = [
    applyRun.applyRunnerEnabled ? "写入执行器已启用，仍需要页面开关和精确确认语。" : "写入执行器等待本地写入开关。",
    applyRun.appliedFiles?.length ? "项目文件只在闸门检查后写入。" : "当前没有修改任何项目文件。",
    applyRun.rollbackSnapshotPath ? "回滚快照可用。" : "缺少回滚快照。",
    applyRun.requiredConfirmation ? `需要精确确认：${applyRun.requiredConfirmation}` : "未采集确认语。"
  ];

  return `
    <h4>写入提案闸门</h4>
    <div class="apply-run-card status-${escapeHtml(applyRun.status || "blocked")}">
      ${applyGateApprovalDeskHtml(applyRun)}
      <div class="insight-grid">
        <div><span>状态</span><strong>${escapeHtml(applyRunStatusLabel(applyRun.status))}</strong></div>
        <div><span>执行器</span><strong>${escapeHtml(applyRun.applyRunnerEnabled ? "已启用" : "已关闭")}</strong></div>
        <div><span>候选文件</span><strong>${escapeHtml(String((applyRun.candidateFiles || []).length))}</strong></div>
        <div><span>已写入</span><strong>${escapeHtml(String((applyRun.appliedFiles || []).length))}</strong></div>
      </div>
      <p>${escapeHtml(zhText(applyRun.note || "写入闸门证据已采集。"))}</p>
      <div class="apply-safety-strip">
        ${safetyFacts.map((fact) => `<div>${escapeHtml(zhText(fact))}</div>`).join("")}
      </div>
      <div class="apply-gate-v1-card status-${escapeHtml(gate.status || "blocked")}">
        <div>
          <span>Apply Gate v1</span>
          <strong>${escapeHtml(gate.canApply ? "条件已满足" : "默认阻断")}</strong>
          <small>Apply Approved Patch 只在 diff、验证、回滚、人工批准和项目根目录守卫全部满足后可点击。</small>
        </div>
        <div class="apply-gate-facts">
          ${factRows.map(([label, ok]) => `<span class="${ok ? "is-ok" : "is-blocked"}">${escapeHtml(label)} · ${ok ? "ready" : "blocked"}</span>`).join("")}
        </div>
        <div class="apply-confirm-controls">
          <label>
            <input type="checkbox" data-apply-local-write-switch data-task-id="${escapeHtml(applyRun.taskId || "")}" />
            <span>允许本地写入</span>
          </label>
          <input type="text" data-apply-confirmation data-task-id="${escapeHtml(applyRun.taskId || "")}" placeholder="${escapeHtml(applyRun.requiredConfirmation || "APPLY task")}" autocomplete="off" />
        </div>
        <button type="button" data-apply-gate-action="apply" data-task-id="${escapeHtml(applyRun.taskId || "")}" data-apply-ready="${canApplyApprovedPatch ? "true" : "false"}" data-required-confirmation="${escapeHtml(applyRun.requiredConfirmation || "")}"${applyButtonDisabled}>Apply Approved Patch</button>
      </div>
      ${rollbackHtml}
      <h4>所需确认语</h4>
      ${confirmationLockHtml(applyRun.requiredConfirmation)}
      <h4>产物</h4>
      ${insightList(artifacts)}
      <h4>候选文件</h4>
      ${insightList(candidateFiles)}
      <h4>已写入文件</h4>
      ${insightList(appliedFiles)}
      <h4>阻断原因</h4>
      ${insightList(blockers)}
    </div>
  `;
}

function syncApplyGateControls(root = document) {
  root.querySelectorAll("[data-apply-gate-action='apply']").forEach((button) => {
    const taskId = button.dataset.taskId || "";
    const escapedTaskId = CSS.escape(taskId);
    const confirmation = root.querySelector(`[data-apply-confirmation][data-task-id="${escapedTaskId}"]`);
    const writeSwitch = root.querySelector(`[data-apply-local-write-switch][data-task-id="${escapedTaskId}"]`);
    const required = button.dataset.requiredConfirmation || "";
    const ready = button.dataset.applyReady === "true";
    const confirmed = Boolean(required && confirmation?.value === required);
    const switched = Boolean(writeSwitch?.checked);
    button.disabled = !(ready && confirmed && switched);
  });
}

function applyGateFormState(taskId) {
  for (const root of [elements.taskInsightBody, elements.gateInsightBody].filter(Boolean)) {
    const escapedTaskId = CSS.escape(taskId);
    const confirmation = root.querySelector(`[data-apply-confirmation][data-task-id="${escapedTaskId}"]`);
    const writeSwitch = root.querySelector(`[data-apply-local-write-switch][data-task-id="${escapedTaskId}"]`);
    if (confirmation || writeSwitch) {
      return {
        confirmation: confirmation?.value || "",
        localWriteEnabled: Boolean(writeSwitch?.checked)
      };
    }
  }
  return {
    confirmation: "",
    localWriteEnabled: false
  };
}

function rollbackInsightHtml(rollback) {
  if (!rollback) {
    return `
      <h4>Rollback Manager</h4>
      <p>还没有回滚报告。</p>
    `;
  }
  const restoredFiles = (rollback.restoredFiles || []).map((file) => `${file.file} · ${file.bytes || 0} 字节`);
  const removedFiles = (rollback.removedFiles || []).map((file) => `${file.file} · 已移除新文件`);
  const blockers = (rollback.blockers || []).map((blocker) => `${zhText(blocker.title)}：${zhText(blocker.detail)}`);
  return `
    <h4>Rollback Manager</h4>
    <div class="apply-run-card status-${escapeHtml(rollback.status || "blocked")}">
      <div class="insight-grid">
        <div><span>状态</span><strong>${escapeHtml(rollback.status === "rolled_back" ? "已回滚" : "回滚阻断")}</strong></div>
        <div><span>恢复文件</span><strong>${escapeHtml(String((rollback.restoredFiles || []).length))}</strong></div>
        <div><span>移除新文件</span><strong>${escapeHtml(String((rollback.removedFiles || []).length))}</strong></div>
        <div><span>报告</span><strong>${escapeHtml(zhEvidenceRef(rollback.rollbackReportPath || "rollback report"))}</strong></div>
      </div>
      <p>${escapeHtml(zhText(rollback.note || "回滚报告已生成。"))}</p>
      <h4>恢复文件</h4>
      ${insightList(restoredFiles)}
      <h4>移除文件</h4>
      ${insightList(removedFiles)}
      <h4>阻断原因</h4>
      ${insightList(blockers)}
    </div>
  `;
}

function humanGateStatusLabel(status) {
  const labels = {
    approved: "人工已批准",
    changes_requested: "已要求返工",
    held: "闸门挂起",
    pending: "等待审批",
    reviewed: "已复核"
  };
  return labels[status] || "等待审批";
}

function humanGateInsightHtml(task, humanGate = null) {
  if (!task?.id || !task.proposal || missionModeFromTask(task) !== "sandbox_patch") {
    return "";
  }

  const gate = humanGate || {
    approvalId: `approval_close_loop_${task.id}`,
    status: task.result?.humanGateStatus || "pending",
    note: task.result?.humanGateNote || ""
  };
  const disabled = gate.status && gate.status !== "pending" ? " disabled" : "";
  return `
    <h4>人工闸门</h4>
    <div class="human-gate-card status-${escapeHtml(gate.status || "pending")}">
      <div>
        <span>${escapeHtml(formatApprovalId(gate.approvalId || `approval_close_loop_${task.id}`))}</span>
        <strong>${escapeHtml(humanGateStatusLabel(gate.status || "pending"))}</strong>
        <small>${escapeHtml(zhText(gate.note || "Judge猿正在等待你的人工决定，批准后才会成为受监督的有效结果。"))}</small>
      </div>
      <div class="human-gate-actions">
        <button type="button" data-gate-action="approved" data-task-id="${escapeHtml(task.id)}"${disabled}>批准结果</button>
        <button type="button" data-gate-action="changes_requested" data-task-id="${escapeHtml(task.id)}"${disabled}>要求返工</button>
      </div>
    </div>
  `;
}

function dossierInsightHtml(dossier) {
  const latest = dossier.latestEvidence || {};
  const objectives = (dossier.objectives || [])
    .slice(0, 5)
    .map((objective) => `${objectiveStatusLabel(objective.status)} · ${zhText(objective.label)} · ${zhText(objective.metric || "暂无指标")}`);

  return `
    <p>${escapeHtml(zhText(dossier.companyReport?.headline || "认证档案已基于实时证据生成。"))}</p>
    <div class="insight-grid">
      <div><span>分数</span><strong>${escapeHtml(String(dossier.score || 0))}/100</strong></div>
      <div><span>结论</span><strong>${escapeHtml(verdictLabel(dossier.verdict))}</strong></div>
      <div><span>阶段</span><strong>${escapeHtml(zhText(dossier.level || "L1 演示就绪度"))}</strong></div>
      <div><span>最新</span><strong>${escapeHtml(verificationStatusLabel(latest.verificationStatus))}</strong></div>
      <div><span>闸门</span><strong>${escapeHtml(humanGateStatusLabel(latest.gateStatus || "pending"))}</strong></div>
      <div><span>补丁</span><strong>${escapeHtml(patchRunStatusLabel(latest.patchRunStatus || "not_run"))}</strong></div>
      <div><span>写入</span><strong>${escapeHtml(applyRunStatusLabel(latest.applyStatus || "not_run"))}</strong></div>
    </div>
    <h4>路线图目标</h4>
    ${insightList(objectives)}
    <h4>档案 Markdown</h4>
    <pre class="dossier-markdown">${escapeHtml(dossier.markdown || "")}</pre>
  `;
}

function localJudgeStatusLabel(status) {
  const labels = {
    ready: "本地模型已审查",
    skipped: "未连接本地模型",
    failed: "本地模型审查失败"
  };
  return labels[status] || "规则审查";
}

function localJudgeVerdictLabel(verdict) {
  const labels = {
    approve: "建议放行到人工闸门",
    caution: "谨慎推进",
    rework: "建议返工",
    blocked: "建议阻断"
  };
  return labels[verdict] || zhText(verdict || "谨慎推进");
}

function localJudgeReviewHtml(proposal) {
  const reviewState = proposal.localJudgeReview || {};
  const review = reviewState.review || {};
  const provider = reviewState.provider === "ollama"
    ? "Ollama"
    : reviewState.provider === "openai_compatible"
      ? "LM Studio / OpenAI 兼容"
      : "未启用";
  const model = reviewState.model || "未配置";
  const status = proposal.localJudgeReviewStatus || "skipped";

  if (status !== "ready") {
    return `
      <h4>本地模型审查</h4>
      <div class="local-judge-card status-${escapeHtml(status)}">
        <span>${escapeHtml(localJudgeStatusLabel(status))}</span>
        <strong>当前使用规则审查</strong>
        <p>${escapeHtml(zhText(reviewState.error || reviewState.note || "未连接 Ollama / LM Studio，本次方案继续由规则审查和人工闸门保护。"))}</p>
      </div>
    `;
  }

  return `
    <h4>本地模型审查</h4>
    <div class="local-judge-card status-ready">
      <span>${escapeHtml(provider)} · ${escapeHtml(model)}</span>
      <strong>${escapeHtml(localJudgeVerdictLabel(review.verdict))}</strong>
      <p>${escapeHtml(zhText(review.summary || "本地模型已完成旁路审查。"))}</p>
      <div class="local-judge-columns">
        <div>
          <em>风险提示</em>
          ${insightList(review.risks?.length ? review.risks : ["未发现额外高风险，但仍需要人工闸门。"])}
        </div>
        <div>
          <em>模型建议</em>
          ${insightList(review.recommendations?.length ? review.recommendations : ["继续查看证据、差异和写入闸门预检。"])}
        </div>
      </div>
      <small>${escapeHtml(zhText(reviewState.note || "本地模型审查不会自动修改项目文件。"))}</small>
    </div>
  `;
}

function proposalInsightHtml(proposal) {
  const aiPatch = proposal.aiPatch || {};
  const aiFailureHtml = aiPatch.status === "blocked" || aiPatch.blockers?.length
    ? `
      <h4>AI Patch 失败原因</h4>
      ${insightList((aiPatch.blockers || []).map((blocker) => {
        const id = blocker.id || "";
        if (/diff_missing|diff_headers|diff_hunk|diff_file/i.test(id)) return "模型没有返回有效 diff 或 patch 格式错误";
        if (/sensitive/i.test(id)) return "patch 触碰敏感文件，已阻断";
        if (/outside|root|path/i.test(id)) return "路径越过 project root，已阻断";
        if (/verification_failed/i.test(id)) return "verification 失败，retry 后仍失败";
        if (/model|provider|api_key|demo/i.test(id)) return "模型未配置或连接失败";
        if (/context/i.test(id)) return "context 不足，无法生成可靠 patch";
        return blocker.title || "AI patch 未通过安全策略";
      }))}
    `
    : "";
  return `
    <p>${escapeHtml(zhText(proposal.summary))}</p>
    <div class="insight-grid">
      <div><span>风险</span><strong>${escapeHtml(riskLabel(proposal.risk))}</strong></div>
      <div><span>文件</span><strong>${escapeHtml(String(proposal.changedFiles?.length || 0))}</strong></div>
    </div>
    ${localJudgeReviewHtml(proposal)}
    <h4>观察</h4>
    ${insightList(proposal.observations)}
    ${aiFailureHtml}
    <h4>建议步骤</h4>
    ${insightList(proposal.recommendedSteps)}
    <h4>人工闸门</h4>
    ${insightList(proposal.gatedActions)}
  `;
}

function renderSummary(snapshot) {
  const counts = snapshot.counts || {};
  const projects = snapshot.projects || [];
  const running = counts.running || 0;
  const active = counts.active || 0;
  const draft = counts.draft || 0;
  const ready = counts.ready || 0;
  const pulse = snapshot.autonomy?.score ?? Math.min(99, running * 24 + active * 14 + draft * 5 + ready * 2);

  elements.stageTitle.textContent = `${projects.length} 个工作区节点`;
  elements.lastUpdated.textContent = new Date(snapshot.generatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  elements.pulseScore.textContent = String(pulse).padStart(2, "0");
  elements.pulseCaption.textContent = zhText(snapshot.autonomy?.level || (running || active ? "遥测信号正在流动" : "工作区保持稳定"));
  elements.statRunning.textContent = running;
  elements.statActive.textContent = active;
  elements.statDraft.textContent = draft;
  elements.statReady.textContent = ready;
  elements.sceneTotal.textContent = projects.length;
  elements.sceneWorking.textContent = active;
  elements.sceneDraft.textContent = draft;
  elements.sceneReady.textContent = ready;
}

function deskTemplate(project) {
  const selected = project.id === state.selectedId ? " is-selected" : "";
  const hidden = state.filter !== "all" && project.status.key !== state.filter ? " is-hidden" : "";
  const latestClosedLoop = isLatestClosedLoopProject(project) ? " is-latest-closed-loop" : "";
  const ports = project.inferredPorts.length ? project.inferredPorts.join(", ") : "none";
  const scripts = project.packages.reduce((count, pkg) => count + Object.keys(pkg.scripts || {}).length, 0);

  return `
    <button class="desk-card accent-${escapeHtml(project.accent)} status-${escapeHtml(project.status.key)}${selected}${hidden}${latestClosedLoop}" data-id="${escapeHtml(project.id)}" type="button">
      <div class="desk-popover">
        <strong>${escapeHtml(zhText(project.name))}</strong>
        <p>${escapeHtml(project.path)}</p>
        <div class="popover-stats">
        <span>${escapeHtml(zhStatus(project.status.label))}</span>
        <span>${project.repo.changeCount} 个变更</span>
          <span>${ports}</span>
        </div>
      </div>
      <div class="desk-room">
        <span class="node-track"></span>
        <span class="node-platform"></span>
        <span class="node-core">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <span class="node-agent">
          <b></b>
          <i></i>
          <span class="agent-console" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </span>
        <span class="node-beacon"></span>
      </div>
      <div class="desk-meta">
        <span class="desk-kicker">
          ${escapeHtml(zhWorkerName(project.workerName, project.workerId || "coding-yuan"))} · ${escapeHtml(zhText(project.role))}
          ${latestClosedLoop ? `<mark class="latest-loop-badge">最新闭环</mark>` : ""}
        </span>
        <span class="desk-title">${escapeHtml(zhText(project.name))}</span>
        <span class="desk-subline">
          <span class="status-dot"></span>
          <span>${escapeHtml(zhStatus(project.status.label))} · ${escapeHtml(statusCaption(project))} · ${scripts} 个脚本</span>
        </span>
      </div>
    </button>
  `;
}

function renderDesks(snapshot) {
  elements.deskGrid.innerHTML = sortedProjects(snapshot.projects || []).map(deskTemplate).join("");

  elements.deskGrid.querySelectorAll(".desk-card").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedId = card.dataset.id;
      state.selectionLocked = true;
      render();
    });
  });

  requestDeckDraw();
}

function renderList(element, items, emptyText, formatter = (item) => item) {
  const values = items.length ? items : [{ muted: true, text: emptyText }];
  element.innerHTML = values
    .map((item) => {
      const text = typeof item === "string" ? item : item.text;
      const muted = typeof item === "object" && item.muted ? " class=\"is-muted\"" : "";
      return `<li${muted}>${escapeHtml(formatter(text))}</li>`;
    })
    .join("");
}

function renderScripts(project) {
  const scripts = [];
  for (const pkg of project.packages) {
    for (const key of Object.keys(pkg.scripts || {})) scripts.push(key);
  }

  const uniqueScripts = [...new Set(scripts)].slice(0, 14);
  elements.scriptCloud.innerHTML = uniqueScripts.length
    ? uniqueScripts.map((script) => `<span>${escapeHtml(script)}</span>`).join("")
    : `<span>暂无脚本</span>`;
}

function renderDetail(snapshot) {
  const project =
    snapshot.projects.find((candidate) => candidate.id === state.selectedId) ||
    preferredProject(snapshot);
  const worker = snapshot.workers?.find((candidate) => candidate.id === project?.workerId);
  const activeTask = latestTaskForProject(snapshot, project?.id);
  const director = missionDirectorForTask(activeTask, {
    applyRunnerEnabled: Boolean(snapshot.autonomy?.metrics?.applyRunnerEnabled),
    project
  });

  if (!project) {
    elements.emptyDetail.hidden = false;
    elements.projectDetail.hidden = true;
    return;
  }

  state.selectedId = project.id;
  elements.emptyDetail.hidden = true;
  elements.projectDetail.hidden = false;
  elements.detailAccent.className = `detail-avatar accent-${project.accent}`;
  elements.detailRole.textContent = zhText(project.role);
  elements.detailName.textContent = zhText(project.name);
  elements.detailStatus.textContent = zhText(project.status.label);
  elements.detailFolder.textContent = zhText(project.folder);
  elements.detailBranch.textContent = project.repo.branch || project.repo.kind;
  elements.detailPorts.textContent =
    project.runningPorts.length
      ? `${project.runningPorts.join(", ")} 在线`
      : project.inferredPorts.length
        ? project.inferredPorts.join(", ")
        : "--";
  elements.detailTouch.textContent = relativeTime(project.activity.latest);
  elements.detailWorker.textContent = worker
    ? `${zhWorkerName(worker.name, worker.id)} · ${WORKER_DOMAIN_ZH[worker.domain] || zhText(worker.domain)}`
    : zhText(project.workerName || project.role);
  elements.detailRisk.textContent = riskLabel(project.risk?.key);
  elements.detailRisk.className = `risk-${project.risk?.key || "low"}`;
  elements.detailTask.textContent = zhText(activeTask?.title || project.task?.current || "待命");
  elements.detailNextAction.textContent = zhText(director.nextAction || project.task?.nextAction || "分配一个明确任务");
  renderMissionSummary(snapshot, project);
  setControlStatus("就绪");
  elements.changeCount.textContent = `${project.repo.changeCount}`;
  renderTaskQueue(snapshot, project);
  renderTaskInsight();
  renderApprovalQueue(snapshot, project);
  renderGateInspector(snapshot, project);
  renderEventReplay(snapshot);
  renderMissionFlow(snapshot, project);
  renderCoreWorkerStations(snapshot, project);
  renderInspectorTabs();

  renderList(
    elements.recentFiles,
    project.activity.recentFiles.map((file) => `${file.path} · ${relativeTime(file.mtime)}`),
    "暂无最近文件"
  );
  renderList(elements.gitChanges, project.repo.changes, "暂无 Git 变更");
  renderScripts(project);
}

function render() {
  if (!state.snapshot) return;
  renderMissionComposer(state.snapshot);
  renderSummary(state.snapshot);
  renderRoomOpsRibbon(state.snapshot);
  renderOperatorConsole(state.snapshot);
  renderWorkers(state.snapshot);
  renderWorkfeed(state.snapshot);
  renderDesks(state.snapshot);
  renderDetail(state.snapshot);
  updateThreeDeck(state.snapshot);
  renderLiveRunState();

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.filter);
  });
}

function visibleProjects(snapshot) {
  const projects = sortedProjects(snapshot.projects || []);
  return state.filter === "all"
    ? projects
    : projects.filter((project) => project.status.key === state.filter);
}

function initThreeDeck() {
  if (threeDeck.renderer || threeDeck.disabled || !elements.threeDeck) return;

  threeDeck.scene = new THREE.Scene();
  threeDeck.scene.fog = new THREE.Fog(0xf4f2ed, 9, 24);
  threeDeck.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  threeDeck.camera.position.set(0, 6.6, 12.5);
  threeDeck.camera.lookAt(0, 0, 0);

  try {
    threeDeck.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas: elements.threeDeck,
      preserveDrawingBuffer: true
    });
  } catch (error) {
    threeDeck.disabled = true;
    threeDeck.disabledReason = error?.message || "WebGL unavailable";
    elements.threeDeck.hidden = true;
    elements.sceneLabels.innerHTML = "";
    if (elements.deckViewport) elements.deckViewport.dataset.webgl = "fallback";
    return;
  }
  if (elements.deckViewport) elements.deckViewport.dataset.webgl = "three";
  threeDeck.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  threeDeck.renderer.outputColorSpace = THREE.SRGBColorSpace;

  const ambient = new THREE.HemisphereLight(0xffffff, 0x20242c, 1.85);
  threeDeck.scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
  keyLight.position.set(-4, 7, 6);
  threeDeck.scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x16a79f, 1.1);
  rimLight.position.set(5, 4, -5);
  threeDeck.scene.add(rimLight);

  const grid = new THREE.GridHelper(15, 24, 0xd0d4cf, 0xe1e5e1);
  grid.position.y = -0.04;
  threeDeck.scene.add(grid);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(7.4, 96),
    new THREE.MeshStandardMaterial({
      color: 0xf8f7f0,
      metalness: 0.04,
      roughness: 0.72,
      transparent: true,
      opacity: 0.72
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  threeDeck.scene.add(floor);

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.96, 0.22, 56),
    new THREE.MeshStandardMaterial({
      color: 0x15171d,
      emissive: 0x073331,
      emissiveIntensity: 0.22,
      metalness: 0.42,
      roughness: 0.38
    })
  );
  core.position.y = 0.08;
  threeDeck.scene.add(core);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.12, 0.016, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0x16a79f, transparent: true, opacity: 0.56 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.24;
  threeDeck.scene.add(ring);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(5.9, 0.01, 8, 160),
    new THREE.MeshBasicMaterial({ color: 0xd9a12a, transparent: true, opacity: 0.24 })
  );
  outerRing.rotation.x = Math.PI / 2;
  outerRing.position.y = 0.05;
  threeDeck.scene.add(outerRing);

  threeDeck.group = new THREE.Group();
  threeDeck.scene.add(threeDeck.group);

  threeDeck.selectedRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.024, 8, 72),
    new THREE.MeshBasicMaterial({ color: 0xfff7e8, transparent: true, opacity: 0.9 })
  );
  threeDeck.selectedRing.rotation.x = Math.PI / 2;
  threeDeck.selectedRing.visible = false;
  threeDeck.scene.add(threeDeck.selectedRing);

  elements.threeDeck.addEventListener("pointerdown", handleThreePointerDown);
  elements.threeDeck.addEventListener("pointermove", handleThreePointerMove);
  elements.threeDeck.addEventListener("pointerup", handleThreePointerUp);
  elements.threeDeck.addEventListener("pointerleave", () => {
    threeDeck.isDragging = false;
  });

  resizeThreeDeck();
  preloadCodingYuanModel();
  animateThreeDeck();
}

function updateThreeDeck(snapshot) {
  initThreeDeck();
  const selectedProject = currentProject() || preferredProject(snapshot);
  if (!threeDeck.group) {
    renderWorkerRoomFallback(snapshot, selectedProject, threeDeck.disabledReason);
    return;
  }
  renderWorkerRoomFallback(snapshot, selectedProject);

  clearThreeGroup(threeDeck.group);
  threeDeck.nodeObjects.clear();
  threeDeck.mixers = [];
  threeDeck.signalPulses = [];
  threeDeck.phaseTransferPulses = [];
  elements.sceneLabels.innerHTML = "";
  threeDeck.labels.clear();

  const projects = visibleProjects(snapshot);
  const count = Math.max(1, projects.length);
  const radius = count > 9 ? 4.72 : 4.08;

  projects.forEach((project, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * radius * 1.05;
    const z = Math.sin(angle) * radius * 0.72;
    const task = latestTaskFromList(snapshot?.tasks || [], project.id);
    const director = task
      ? missionDirectorForTask(task, {
          applyRunnerEnabled: Boolean(snapshot.autonomy?.metrics?.applyRunnerEnabled),
          project
        })
      : null;
    const group = createProjectNode(project, index, { director, task });
    group.position.set(x, 0, z);
    group.rotation.y = -angle + Math.PI / 2;
    threeDeck.group.add(group);
    threeDeck.nodeObjects.set(project.id, group);

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.12, 0),
      new THREE.Vector3(x, 0.12, z)
    ]);
    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({
        color: accentColors[project.accent] || accentColors.teal,
        transparent: true,
        opacity: project.status.key === "active" || project.status.key === "running" ? 0.42 : 0.18
      })
    );
    threeDeck.group.add(line);

    const label = document.createElement("button");
    label.className = "scene-label";
    label.type = "button";
    label.dataset.id = project.id;
    label.dataset.pinned = project.status.key === "active" || project.status.key === "running" || index < 1
      ? "true"
      : "false";
    label.style.opacity = "0";
    label.style.visibility = "hidden";
    label.innerHTML = `<strong>${escapeHtml(zhText(project.name))}</strong><span>${escapeHtml(zhText(project.status.label))}</span>`;
    label.addEventListener("click", () => {
      state.selectedId = project.id;
      state.selectionLocked = true;
      render();
    });
    elements.sceneLabels.append(label);
    threeDeck.labels.set(project.id, label);
  });

  createSignalArcs(projects);

  focusThreeSelection();
}

function phaseTransferRouteForPhase(phase, mode = "sandbox_patch") {
  if (mode === "review_only") return null;
  if (mode === "proposal") {
    return {
      sourceWorkerId: "coding-yuan",
      targetWorkerId: "judge-yuan",
      color: 0x7aa7ff,
      blocked: false,
      label: "方案交给审核猿旁路审查"
    };
  }
  if (mode === "verify") {
    return {
      sourceWorkerId: "coding-yuan",
      targetWorkerId: "judge-yuan",
      color: 0x7cff9b,
      blocked: false,
      label: "证据交给审核猿验证"
    };
  }
  const codingPhases = ["queued", "assigned", "evidence_collecting", "proposal_generating", "patch_running", "diff_ready"];
  const judgePhases = ["verification_running", "verification_passed", "verification_failed", "judge_review", "human_gate"];
  const opsPhases = ["rollback_ready", "apply_gate", "apply_blocked", "failed"];
  if (opsPhases.includes(phase)) {
    return {
      sourceWorkerId: "judge-yuan",
      targetWorkerId: "ops-yuan",
      color: phase === "apply_blocked" || phase === "failed" ? 0xffb454 : 0x7cff9b,
      blocked: phase === "apply_blocked" || phase === "failed",
      label: "写入闸门由运维猿拦截"
    };
  }
  if (judgePhases.includes(phase)) {
    return {
      sourceWorkerId: "coding-yuan",
      targetWorkerId: "judge-yuan",
      color: phase === "verification_failed" ? 0xff5c7a : 0x7cff9b,
      blocked: phase === "verification_failed",
      label: "证据交给审核猿验证"
    };
  }
  if (codingPhases.includes(phase)) {
    return {
      sourceWorkerId: "coding-yuan",
      targetWorkerId: "coding-yuan",
      color: 0x30e0c6,
      blocked: false,
      label: "编程猿正在沙盒内工作"
    };
  }
  return {
    sourceWorkerId: "coding-yuan",
    targetWorkerId: "judge-yuan",
    color: 0x7aa7ff,
    blocked: false,
    label: "任务等待下一步确认"
  };
}

function workerPhaseAnchor(workerId, lift) {
  const y = 0.72 + lift;
  const anchors = {
    "coding-yuan": new THREE.Vector3(-0.46, y, 0.18),
    "judge-yuan": new THREE.Vector3(0, y + 0.08, -0.06),
    "ops-yuan": new THREE.Vector3(0.48, y, 0.18)
  };
  return anchors[workerId] || anchors["coding-yuan"];
}

function workerDispatchState(workerId, phase, mode = "sandbox_patch", focusWorkerId = "") {
  if (mode === "review_only") {
    return workerId === "coding-yuan" ? "active" : "standby";
  }
  if (mode === "proposal") {
    if (workerId === "ops-yuan") return "standby";
    return workerId === "judge-yuan" || workerId === focusWorkerId ? "active" : "support";
  }
  if (mode === "verify") {
    if (workerId === "ops-yuan") return "standby";
    return workerId === "judge-yuan" ? "active" : "support";
  }
  if (workerId === "ops-yuan" && ["apply_blocked", "failed"].includes(phase)) return "blocked";
  if (workerId === focusWorkerId) return "active";
  if (workerId === "judge-yuan" && ["verification_running", "judge_review", "human_gate"].includes(phase)) return "active";
  if (workerId === "coding-yuan" && ["evidence_collecting", "proposal_generating", "patch_running", "diff_ready"].includes(phase)) return "active";
  return "support";
}

function createWorkerDispatchMarkers(group, phase, lift, mode, focusWorkerId) {
  const workerColors = {
    "coding-yuan": 0x30e0c6,
    "judge-yuan": 0x8672c8,
    "ops-yuan": 0xffb454
  };
  const markers = [];
  for (const workerId of ["coding-yuan", "judge-yuan", "ops-yuan"]) {
    const state = workerDispatchState(workerId, phase, mode, focusWorkerId);
    const runtimeState = workerStateForRunPhase(phase, workerId, { hasActiveTask: true });
    const lightRule = workerLightForState(runtimeState);
    const color = lightRule.three || workerColors[workerId];
    const anchor = workerPhaseAnchor(workerId, lift);
    const marker = new THREE.Group();
    marker.position.copy(anchor);
    marker.userData.workerId = workerId;
    marker.userData.dispatchState = state;
    marker.userData.runtimeState = runtimeState;
    marker.userData.lightKey = lightRule.key;
    marker.userData.baseY = marker.position.y;
    marker.userData.phase = markers.length * 0.82;

    const disk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.105, 0.13, 0.018, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: state === "standby" ? 0.16 : state === "support" ? 0.32 : 0.72
      })
    );
    disk.rotation.x = Math.PI / 2;
    marker.add(disk);

    const pulse = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.008, 8, 42),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: state === "standby" ? 0.1 : state === "blocked" ? 0.72 : 0.42
      })
    );
    pulse.rotation.x = Math.PI / 2;
    marker.add(pulse);

    const light = new THREE.PointLight(color, state === "standby" ? 0.08 : state === "blocked" ? 0.72 : 0.34, 0.8);
    light.position.set(0, 0.08, 0);
    marker.add(light);

    marker.userData.disk = disk;
    marker.userData.pulse = pulse;
    marker.userData.light = light;
    group.add(marker);
    markers.push(marker);
  }
  group.userData.dispatchMarkers = markers;
}

function createMissionPhaseTransferPath(group, project, phase, lift, activeNode, mode = "sandbox_patch") {
  if (!activeNode || !phase || ["completed"].includes(phase)) return;
  const route = phaseTransferRouteForPhase(phase, mode);
  if (!route) return;
  const from = workerPhaseAnchor(route.sourceWorkerId, lift);
  const to = workerPhaseAnchor(route.targetWorkerId, lift);
  const isLoop = route.sourceWorkerId === route.targetWorkerId;
  const control = from.clone().lerp(to, 0.5);
  control.y += route.blocked ? 0.34 : 0.24;
  control.z -= isLoop ? 0.38 : 0.16;

  const curve = isLoop
    ? new THREE.CatmullRomCurve3([
        from,
        new THREE.Vector3(from.x - 0.18, from.y + 0.18, from.z - 0.26),
        new THREE.Vector3(from.x + 0.18, from.y + 0.18, from.z - 0.26),
        from.clone()
      ], true)
    : new THREE.QuadraticBezierCurve3(from, control, to);
  const points = curve.getPoints(36);
  const material = new THREE.LineBasicMaterial({
    color: route.color,
    transparent: true,
    opacity: route.blocked ? 0.72 : 0.48
  });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
  line.userData.phaseTransfer = true;
  line.userData.blocked = route.blocked;
  line.userData.route = route;
  group.add(line);

  const pulse = new THREE.Mesh(
    new THREE.SphereGeometry(route.blocked ? 0.058 : 0.048, 18, 18),
    new THREE.MeshBasicMaterial({
      color: route.color,
      transparent: true,
      opacity: route.blocked ? 0.96 : 0.86
    })
  );
  pulse.userData.curve = curve;
  pulse.userData.phase = phase;
  pulse.userData.blocked = route.blocked;
  pulse.userData.targetWorkerId = route.targetWorkerId;
  pulse.userData.speed = route.blocked ? 0.00014 : 0.0002;
  pulse.userData.offset = 0;
  pulse.userData.line = line;
  group.add(pulse);
  threeDeck.phaseTransferPulses.push(pulse);

  if (route.blocked) {
    const stopMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.012, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, opacity: 0.72 })
    );
    stopMarker.position.copy(to);
    stopMarker.rotation.x = Math.PI / 2;
    stopMarker.userData.phaseTransferStop = true;
    group.add(stopMarker);
  }
}

function createSignalArcs(projects) {
  if (!threeDeck.group || projects.length < 2) return;

  const nodes = projects
    .map((project) => threeDeck.nodeObjects.get(project.id))
    .filter(Boolean);

  for (let index = 0; index < nodes.length; index += 1) {
    const from = nodes[index].position.clone();
    const to = nodes[(index + 1) % nodes.length].position.clone();
    if (from.distanceTo(to) < 1.2) continue;

    const mid = from.clone().lerp(to, 0.5);
    mid.y = 0.18 + Math.min(1.4, from.distanceTo(to) * 0.12);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(from.x, 0.24, from.z),
      mid,
      new THREE.Vector3(to.x, 0.24, to.z)
    );
    const points = curve.getPoints(42);
    const color = accentColors[projects[index].accent] || accentColors.teal;

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: projects[index].status.key === "active" ? 0.32 : 0.16
      })
    );
    threeDeck.group.add(line);

    if (projects[index].status.key === "active" || projects[index].status.key === "running") {
      const pulse = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 16, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
      );
      pulse.userData.curve = curve;
      pulse.userData.offset = index / Math.max(1, nodes.length);
      pulse.userData.speed = 0.00023 + index * 0.000006;
      threeDeck.signalPulses.push(pulse);
      threeDeck.group.add(pulse);
    }
  }
}

function createProjectNode(project, index, context = {}) {
  const color = accentColors[project.accent] || accentColors.teal;
  const phase = context.director?.phase || runPhaseFromTask(context.task);
  const mode = missionModeFromTask(context.task);
  const focusWorkerId = context.director?.focusWorkerId || project.workerId || "coding-yuan";
  const statusLift = {
    active: 0.56,
    draft: 0.32,
    idle: 0.18,
    ready: 0.26,
    running: 0.7
  };
  const lift = statusLift[project.status.key] ?? 0.24;
  const livePhase = Boolean(context.task) && !["queued", "assigned", "completed"].includes(phase);
  const activeNode = project.status.key === "active" || project.status.key === "running" || livePhase;
  const group = new THREE.Group();
  group.userData.projectId = project.id;
  group.userData.baseScale = project.id === state.selectedId ? 1.1 : activeNode ? 1.035 : 1;
  group.scale.setScalar(group.userData.baseScale);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.58, 0.78, 0.16, 64),
    new THREE.MeshStandardMaterial({
      color: 0xf8f7ef,
      metalness: 0.22,
      roughness: 0.38,
      transparent: true,
      opacity: 0.9
    })
  );
  base.position.y = 0.08;
  group.add(base);

  const tower = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.58, 0.2 + lift, 8),
    new THREE.MeshStandardMaterial({
      color: 0x20252e,
      emissive: color,
      emissiveIntensity: activeNode ? 0.16 : 0.045,
      metalness: 0.48,
      roughness: 0.31
    })
  );
  tower.position.y = 0.27 + lift / 2;
  tower.rotation.y = Math.PI / 8;
  tower.userData.projectId = project.id;
  group.add(tower);

  const accentSpine = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.035, 0.018),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: activeNode ? 0.92 : 0.58 })
  );
  accentSpine.position.set(0, 0.42 + lift, -0.53);
  accentSpine.userData.projectId = project.id;
  group.add(accentSpine);

  const glassDeck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.48, 0.05, 64),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: color,
      emissiveIntensity: activeNode ? 0.08 : 0.025,
      metalness: 0.08,
      roughness: 0.18,
      transparent: true,
      opacity: 0.82
    })
  );
  glassDeck.position.y = 0.45 + lift;
  glassDeck.userData.projectId = project.id;
  group.add(glassDeck);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.34, 0.055, 44),
    new THREE.MeshStandardMaterial({
      color: 0x11151c,
      emissive: color,
      emissiveIntensity: activeNode ? 0.08 : 0.025,
      metalness: 0.44,
      roughness: 0.32
    })
  );
  cap.position.y = 0.5 + lift;
  cap.userData.projectId = project.id;
  group.add(cap);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.66, 0.01, 8, 96),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: project.id === state.selectedId ? 0.86 : 0.42
    })
  );
  halo.position.y = 0.51 + lift;
  halo.rotation.x = Math.PI / 2;
  group.add(halo);

  const signalCount = Math.min(5, Math.max(1, project.repo.changeCount || project.packages.length || 1));
  for (let signalIndex = 0; signalIndex < signalCount; signalIndex += 1) {
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.042, 0.018, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: activeNode ? 0.72 : 0.42 })
    );
    tick.position.set(-0.3 + signalIndex * 0.15, 0.54 + lift, -0.42);
    group.add(tick);
  }

  const beacon = new THREE.PointLight(color, activeNode ? 1.25 : 0.5, 3.2);
  beacon.position.set(0, 0.65 + lift, 0);
  group.add(beacon);

  const gateRailMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb454,
    transparent: true,
    opacity: phase === "apply_blocked" || phase === "failed" ? 0.52 : 0
  });
  const gateRails = [];
  for (let railIndex = 0; railIndex < 3; railIndex += 1) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.86 - railIndex * 0.08, 0.018, 0.022), gateRailMaterial.clone());
    rail.position.set(0, 0.86 + lift + railIndex * 0.105, -0.68);
    rail.rotation.x = -0.08;
    rail.visible = phase === "apply_blocked" || phase === "failed";
    rail.userData.baseY = rail.position.y;
    rail.userData.phase = railIndex * 0.7;
    rail.userData.projectId = project.id;
    group.add(rail);
    gateRails.push(rail);
  }

  const agentRig = createCodingYuanModelRig(project, color, lift, index, {
    activeNode,
    phase,
    workerId: focusWorkerId
  }) || createAgentRig(project, color, lift, index, {
    activeNode,
    phase,
    workerId: focusWorkerId
  });
  group.add(agentRig);
  createWorkerDispatchMarkers(group, phase, lift, mode, focusWorkerId);
  createMissionPhaseTransferPath(group, project, phase, lift, activeNode, mode);
  group.userData.agentRig = agentRig;
  group.userData.gateRails = gateRails;
  group.userData.missionPhase = phase;
  group.userData.missionMode = mode;
  group.userData.focusWorkerId = focusWorkerId;

  group.userData.spin = index % 2 === 0 ? 1 : -1;
  return group;
}

function agentMotionProfile(status) {
  const profiles = {
    active: {
      arm: 0.19,
      breath: 0.036,
      headPitch: -0.045,
      headYaw: 0.26,
      keyPulse: 1,
      lean: -0.055,
      scanSpeed: 0.0028,
      shardLift: 1
    },
    draft: {
      arm: 0.1,
      breath: 0.024,
      headPitch: 0.015,
      headYaw: 0.34,
      keyPulse: 0.58,
      lean: -0.018,
      scanSpeed: 0.002,
      shardLift: 0.54
    },
    idle: {
      arm: 0.045,
      breath: 0.014,
      headPitch: 0.025,
      headYaw: 0.14,
      keyPulse: 0.22,
      lean: 0.012,
      scanSpeed: 0.0012,
      shardLift: 0.2
    },
    ready: {
      arm: 0.06,
      breath: 0.017,
      headPitch: -0.005,
      headYaw: 0.12,
      keyPulse: 0.34,
      lean: 0,
      scanSpeed: 0.001,
      shardLift: 0.28
    },
    running: {
      arm: 0.24,
      breath: 0.042,
      headPitch: -0.062,
      headYaw: 0.3,
      keyPulse: 1.18,
      lean: -0.07,
      scanSpeed: 0.0032,
      shardLift: 1.18
    }
  };

  return profiles[status] || profiles.idle;
}

function workerLifeProfile(workerId, phase, status) {
  const base = { ...agentMotionProfile(status) };
  const codingPhases = ["evidence_collecting", "proposal_generating", "patch_running", "diff_ready"];
  const judgePhases = ["verification_running", "judge_review", "human_gate", "verification_failed"];
  const opsPhases = ["apply_blocked", "failed"];

  if (workerId === "coding-yuan" && codingPhases.includes(phase)) {
    return {
      ...base,
      arm: Math.max(base.arm, 0.28),
      breath: Math.max(base.breath, 0.046),
      headPitch: -0.07,
      headYaw: Math.max(base.headYaw, 0.32),
      keyPulse: Math.max(base.keyPulse, 1.42),
      lean: -0.082,
      scanSpeed: Math.max(base.scanSpeed, 0.0034),
      shardLift: Math.max(base.shardLift, 1.25),
      lifeMode: "coding"
    };
  }

  if (workerId === "judge-yuan" && judgePhases.includes(phase)) {
    return {
      ...base,
      arm: 0.12,
      breath: Math.max(base.breath, 0.028),
      headPitch: -0.035,
      headYaw: 0.48,
      keyPulse: Math.max(base.keyPulse, 1.08),
      lean: -0.026,
      scanSpeed: 0.0042,
      shardLift: 1.55,
      lifeMode: "judge"
    };
  }

  if (workerId === "ops-yuan" && opsPhases.includes(phase)) {
    return {
      ...base,
      arm: 0.08,
      breath: 0.026,
      headPitch: -0.015,
      headYaw: 0.58,
      keyPulse: 1.25,
      lean: 0.022,
      scanSpeed: 0.0048,
      shardLift: 1.1,
      lifeMode: "ops-gate"
    };
  }

  return {
    ...base,
    lifeMode: workerId === "judge-yuan" ? "judge" : workerId === "ops-yuan" ? "ops" : "coding"
  };
}

function createAgentRig(project, color, lift, index, context = {}) {
  const phase = context.phase || "assigned";
  const workerId = context.workerId || project.workerId || "coding-yuan";
  const active = Boolean(context.activeNode) || project.status.key === "active" || project.status.key === "running";
  const profile = workerLifeProfile(workerId, phase, project.status.key);
  const rig = new THREE.Group();
  rig.position.set(0, 0.56 + lift, -0.02);
  rig.scale.setScalar(active ? 1.1 : 1.02);
  rig.userData.projectId = project.id;
  rig.userData.baseY = rig.position.y;
  rig.userData.phase = index * 0.62;
  rig.userData.missionPhase = phase;
  rig.userData.workerId = workerId;
  rig.userData.status = project.status.key;
  rig.userData.active = active;
  rig.userData.profile = profile;

  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x151a22,
    metalness: 0.52,
    roughness: 0.32
  });
  const suitMaterial = new THREE.MeshStandardMaterial({
    color: 0x202633,
    metalness: 0.36,
    roughness: 0.38
  });
  const helmetMaterial = new THREE.MeshStandardMaterial({
    color: 0x111720,
    emissive: 0x05080c,
    emissiveIntensity: 0.12,
    metalness: 0.42,
    roughness: 0.28
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: active ? 0.18 : 0.07,
    metalness: 0.22,
    roughness: 0.34
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: color,
    emissiveIntensity: active ? 0.16 : 0.06,
    metalness: 0.08,
    roughness: 0.18,
    transparent: true,
    opacity: 0.78
  });
  const holoMaterial = new THREE.MeshBasicMaterial({
    color,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: active ? 0.34 : 0.2
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: active ? 0.78 : 0.46
  });

  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.05), shellMaterial);
  seatBack.position.set(0, 0.2, 0.12);
  seatBack.rotation.x = -0.18;
  seatBack.userData.projectId = project.id;
  rig.add(seatBack);

  const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.34), shellMaterial);
  seatBase.position.set(0, 0.015, 0.0);
  seatBase.userData.projectId = project.id;
  rig.add(seatBase);

  const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.24), accentMaterial);
  leftRail.position.set(-0.245, 0.105, -0.02);
  leftRail.userData.projectId = project.id;
  rig.add(leftRail);

  const rightRail = leftRail.clone();
  rightRail.position.x = 0.245;
  rightRail.userData.projectId = project.id;
  rig.add(rightRail);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.155, 0.34, 28), suitMaterial);
  body.position.set(0, 0.22, -0.02);
  body.rotation.x = -0.08;
  body.userData.projectId = project.id;
  rig.add(body);

  const torsoPanel = new THREE.Mesh(new THREE.BoxGeometry(0.126, 0.23, 0.014), accentMaterial);
  torsoPanel.position.set(0, 0.225, -0.133);
  torsoPanel.rotation.x = -0.08;
  torsoPanel.userData.projectId = project.id;
  rig.add(torsoPanel);

  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.064, 0.18), shellMaterial);
  waist.position.set(0, 0.055, -0.02);
  waist.userData.projectId = project.id;
  rig.add(waist);

  const chestLine = new THREE.Mesh(new THREE.BoxGeometry(0.148, 0.014, 0.012), glowMaterial);
  chestLine.position.set(0, 0.31, -0.135);
  chestLine.rotation.x = -0.08;
  chestLine.userData.projectId = project.id;
  rig.add(chestLine);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.055, 26), shellMaterial);
  collar.position.set(0, 0.39, -0.02);
  collar.userData.projectId = project.id;
  rig.add(collar);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.046, 0.07, 18), shellMaterial);
  neck.position.set(0, 0.43, -0.02);
  neck.userData.projectId = project.id;
  rig.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.525, -0.035);
  headGroup.userData.projectId = project.id;
  rig.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 22), helmetMaterial);
  head.userData.projectId = project.id;
  headGroup.add(head);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.042, 0.032), shellMaterial);
  brow.position.set(0, 0.03, -0.118);
  brow.userData.projectId = project.id;
  headGroup.add(brow);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.05, 0.018), glassMaterial);
  visor.position.set(0, 0.012, -0.136);
  visor.userData.projectId = project.id;
  headGroup.add(visor);

  const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.009, 0.006), glowMaterial.clone());
  visorGlow.position.set(0, 0.018, -0.149);
  visorGlow.userData.projectId = project.id;
  headGroup.add(visorGlow);

  const chin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.036, 0.035), shellMaterial);
  chin.position.set(0, -0.076, -0.09);
  chin.userData.projectId = project.id;
  headGroup.add(chin);

  const leftComms = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.086, 0.04), shellMaterial);
  leftComms.position.set(-0.12, -0.002, -0.012);
  leftComms.userData.projectId = project.id;
  headGroup.add(leftComms);

  const rightComms = leftComms.clone();
  rightComms.position.x = 0.115;
  rightComms.userData.projectId = project.id;
  headGroup.add(rightComms);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.064, 0.12), shellMaterial);
  shoulder.position.set(0, 0.32, -0.02);
  shoulder.userData.projectId = project.id;
  rig.add(shoulder);

  const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.22, 14), suitMaterial);
  leftArm.position.set(-0.188, 0.245, -0.12);
  leftArm.rotation.set(Math.PI / 2.8, 0, 0.45);
  leftArm.userData.projectId = project.id;
  rig.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.22, 14), suitMaterial);
  rightArm.position.set(0.188, 0.245, -0.12);
  rightArm.rotation.set(Math.PI / 2.8, 0, -0.45);
  rightArm.userData.projectId = project.id;
  rig.add(rightArm);

  const leftForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.023, 0.27, 14), suitMaterial);
  leftForearm.position.set(-0.195, 0.135, -0.29);
  leftForearm.rotation.set(Math.PI / 2.32, 0, 0.08);
  leftForearm.userData.projectId = project.id;
  rig.add(leftForearm);

  const rightForearm = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.023, 0.27, 14), suitMaterial);
  rightForearm.position.set(0.195, 0.135, -0.29);
  rightForearm.rotation.set(Math.PI / 2.32, 0, -0.08);
  rightForearm.userData.projectId = project.id;
  rig.add(rightForearm);

  const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.022, 0.035), shellMaterial);
  leftHand.position.set(-0.2, 0.075, -0.43);
  leftHand.rotation.y = -0.18;
  leftHand.userData.projectId = project.id;
  rig.add(leftHand);

  const rightHand = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.022, 0.035), shellMaterial);
  rightHand.position.set(0.2, 0.075, -0.43);
  rightHand.rotation.y = 0.18;
  rightHand.userData.projectId = project.id;
  rig.add(rightHand);

  const consolePanel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.048, 0.24), glassMaterial);
  consolePanel.position.set(0, 0.08, -0.39);
  consolePanel.rotation.x = -0.24;
  consolePanel.userData.projectId = project.id;
  rig.add(consolePanel);

  const consoleKeys = [];
  for (let keyIndex = 0; keyIndex < 12; keyIndex += 1) {
    const key = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.007, 0.012),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: active ? 0.62 : 0.28
      })
    );
    const row = keyIndex % 3;
    key.position.set(-0.225 + Math.floor(keyIndex / 3) * 0.15, 0.111 + row * 0.004, -0.47 + row * 0.045);
    key.rotation.x = -0.24;
    key.userData.projectId = project.id;
    key.userData.phase = keyIndex * 0.51;
    rig.add(key);
    consoleKeys.push(key);
  }

  const holoPanels = [];
  const panelSpecs = [
    { x: 0, y: 0.34, z: -0.49, width: 0.46, height: 0.2, rotationY: 0, opacity: active ? 0.31 : 0.18 },
    { x: -0.34, y: 0.29, z: -0.43, width: 0.22, height: 0.16, rotationY: -0.46, opacity: active ? 0.26 : 0.14 },
    { x: 0.34, y: 0.29, z: -0.43, width: 0.22, height: 0.16, rotationY: 0.46, opacity: active ? 0.26 : 0.14 }
  ];

  panelSpecs.forEach((spec, panelIndex) => {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, spec.height), holoMaterial.clone());
    panel.position.set(spec.x, spec.y, spec.z);
    panel.rotation.set(-0.18, spec.rotationY, 0);
    panel.material.opacity = spec.opacity;
    panel.userData.projectId = project.id;
    panel.userData.baseY = spec.y;
    panel.userData.baseRotationY = spec.rotationY;
    panel.userData.baseOpacity = spec.opacity;
    panel.userData.phase = panelIndex * 0.7;
    rig.add(panel);
    holoPanels.push(panel);

    for (let lineIndex = 0; lineIndex < 3; lineIndex += 1) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * (0.48 + lineIndex * 0.12), 0.006, 0.006),
        glowMaterial.clone()
      );
      line.position.set(spec.x, spec.y + 0.045 - lineIndex * 0.046, spec.z - 0.004);
      line.rotation.set(-0.18, spec.rotationY, 0);
      line.material.opacity = (active ? 0.46 : 0.24) - lineIndex * 0.07;
      line.userData.projectId = project.id;
      line.userData.baseY = line.position.y;
      line.userData.baseRotationY = spec.rotationY;
      line.userData.baseOpacity = line.material.opacity;
      line.userData.phase = lineIndex * 0.42 + panelIndex * 0.8;
      rig.add(line);
      holoPanels.push(line);
    }
  });

  const headHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.004, 8, 56),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: active ? 0.58 : 0.26 })
  );
  headHalo.position.set(0, 0.525, -0.035);
  headHalo.rotation.x = Math.PI / 2;
  rig.add(headHalo);

  const dataShards = [];
  for (let shardIndex = 0; shardIndex < 7; shardIndex += 1) {
    const shard = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.084, 0.006),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: active ? 0.38 : 0.13
      })
    );
    const side = shardIndex % 2 === 0 ? -1 : 1;
    shard.position.set(side * (0.27 + shardIndex * 0.02), 0.23 + shardIndex * 0.028, -0.24 - shardIndex * 0.018);
    shard.rotation.set(0.22, 0, side * 0.28);
    shard.userData.projectId = project.id;
    shard.userData.baseY = shard.position.y;
    shard.userData.phase = shardIndex * 0.74;
    rig.add(shard);
    dataShards.push(shard);
  }

  const workLight = new THREE.PointLight(color, active ? 0.5 : 0.14, 1.1);
  workLight.position.set(0, 0.19, -0.34);
  rig.add(workLight);

  const gateMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb454,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0
  });
  const gateWall = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.28), gateMaterial);
  gateWall.position.set(0, 0.22, -0.56);
  gateWall.rotation.x = -0.18;
  gateWall.visible = false;
  gateWall.userData.baseY = gateWall.position.y;
  gateWall.userData.projectId = project.id;
  rig.add(gateWall);

  const scanBeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.012, 0.012),
    new THREE.MeshBasicMaterial({
      color: 0x30e0c6,
      transparent: true,
      opacity: 0
    })
  );
  scanBeam.position.set(0, 0.39, -0.515);
  scanBeam.visible = false;
  scanBeam.userData.baseX = scanBeam.position.x;
  scanBeam.userData.projectId = project.id;
  rig.add(scanBeam);

  rig.userData.body = body;
  rig.userData.torsoPanel = torsoPanel;
  rig.userData.chestLine = chestLine;
  rig.userData.head = headGroup;
  rig.userData.visorGlow = visorGlow;
  rig.userData.leftArm = leftArm;
  rig.userData.rightArm = rightArm;
  rig.userData.leftForearm = leftForearm;
  rig.userData.rightForearm = rightForearm;
  rig.userData.leftHand = leftHand;
  rig.userData.rightHand = rightHand;
  rig.userData.consolePanel = consolePanel;
  rig.userData.consoleKeys = consoleKeys;
  rig.userData.holoPanels = holoPanels;
  rig.userData.dataShards = dataShards;
  rig.userData.headHalo = headHalo;
  rig.userData.workLight = workLight;
  rig.userData.gateWall = gateWall;
  rig.userData.scanBeam = scanBeam;
  return rig;
}

function focusThreeSelection() {
  if (!threeDeck.selectedRing || !state.selectedId) return;
  const selected = threeDeck.nodeObjects.get(state.selectedId);
  if (!selected) {
    threeDeck.selectedRing.visible = false;
    return;
  }

  threeDeck.selectedRing.visible = true;
  const worldPosition = new THREE.Vector3();
  selected.getWorldPosition(worldPosition);
  threeDeck.selectedRing.position.set(worldPosition.x, 0.14, worldPosition.z);
  elements.sceneFocus.textContent =
    zhText(state.snapshot?.projects.find((project) => project.id === state.selectedId)?.name || "工作区核心");
}

function clearThreeGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose?.());
      } else {
        object.material?.dispose?.();
      }
    });
  }
}

function resizeThreeDeck() {
  if (!threeDeck.renderer || !elements.threeDeck) return;
  const bounds = elements.threeDeck.parentElement.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  threeDeck.renderer.setSize(width, height, false);
  threeDeck.camera.aspect = width / height;
  threeDeck.camera.position.z = width < 560 ? 15.8 : 13.7;
  threeDeck.camera.position.y = width < 560 ? 7.8 : 7.0;
  threeDeck.camera.updateProjectionMatrix();
}

function animateThreeDeck(time = 0) {
  if (!threeDeck.renderer || !threeDeck.scene || !threeDeck.camera) return;
  resizeThreeDeck();
  const delta = threeDeck.lastAnimationTime ? Math.min(0.05, (time - threeDeck.lastAnimationTime) / 1000) : 0.016;
  threeDeck.lastAnimationTime = time;
  if (!threeDeck.isDragging) {
    threeDeck.rotationTarget += 0.00055;
  }
  threeDeck.group.rotation.y += (threeDeck.rotationTarget - threeDeck.group.rotation.y) * 0.035;

  for (const entry of threeDeck.mixers) {
    entry.mixer.update(delta);
  }

  for (const node of threeDeck.nodeObjects.values()) {
    node.position.y = Math.sin(time * 0.0012 + node.position.x) * 0.035;
    node.rotation.y += node.userData.spin * 0.0018;
    animateGateRails(node.userData.gateRails, time, node.userData.missionPhase);
    animateWorkerDispatchMarkers(node.userData.dispatchMarkers, time);
    animateAgentRig(node.userData.agentRig, time);
  }

  for (const pulse of threeDeck.signalPulses) {
    const progress = (pulse.userData.offset + time * pulse.userData.speed) % 1;
    pulse.position.copy(pulse.userData.curve.getPoint(progress));
  }

  for (const pulse of threeDeck.phaseTransferPulses) {
    animatePhaseTransferPulse(pulse, time);
  }

  if (threeDeck.selectedRing?.visible) {
    const ringPulse = 1 + Math.sin(time * 0.003) * 0.08;
    threeDeck.selectedRing.scale.set(ringPulse, ringPulse, ringPulse);
    threeDeck.selectedRing.material.opacity = 0.74 + Math.sin(time * 0.004) * 0.16;
  }

  focusThreeSelection();
  updateSceneLabels();
  threeDeck.renderer.render(threeDeck.scene, threeDeck.camera);
  requestAnimationFrame(animateThreeDeck);
}

function animatePhaseTransferPulse(pulse, time) {
  const routeProgress = (pulse.userData.offset + time * pulse.userData.speed) % 1;
  const progress = pulse.userData.blocked ? Math.min(0.92, routeProgress) : routeProgress;
  pulse.position.copy(pulse.userData.curve.getPoint(progress));
  const breath = Math.max(0, Math.sin(time * 0.0075));
  const size = pulse.userData.blocked ? 1.05 + breath * 0.58 : 0.88 + breath * 0.34;
  pulse.scale.setScalar(size);
  pulse.material.opacity = pulse.userData.blocked ? 0.68 + breath * 0.3 : 0.54 + breath * 0.28;
  if (pulse.userData.line?.material) {
    pulse.userData.line.material.opacity = pulse.userData.blocked ? 0.5 + breath * 0.25 : 0.34 + breath * 0.16;
  }
}

function animateGateRails(gateRails = [], time, phase) {
  const visible = phase === "apply_blocked" || phase === "failed";
  for (const rail of gateRails) {
    const pulse = Math.max(0, Math.sin(time * 0.0058 + rail.userData.phase));
    rail.visible = visible;
    rail.position.y = rail.userData.baseY + pulse * 0.035;
    rail.scale.x = 0.92 + pulse * 0.18;
    rail.material.opacity = visible ? 0.34 + pulse * 0.34 : 0;
  }
}

function animateWorkerDispatchMarkers(markers = [], time) {
  for (const marker of markers) {
    const state = marker.userData.dispatchState || "support";
    const pulse = Math.max(0, Math.sin(time * 0.005 + marker.userData.phase));
    const isActive = state === "active";
    const isBlocked = state === "blocked";
    marker.position.y = marker.userData.baseY + (isActive || isBlocked ? pulse * 0.035 : pulse * 0.012);
    marker.scale.setScalar(
      state === "standby"
        ? 0.74
        : isBlocked
          ? 1.08 + pulse * 0.18
          : isActive
            ? 1 + pulse * 0.12
            : 0.88 + pulse * 0.06
    );
    if (marker.userData.disk?.material) {
      marker.userData.disk.material.opacity =
        state === "standby" ? 0.12 : isBlocked ? 0.62 + pulse * 0.22 : isActive ? 0.56 + pulse * 0.22 : 0.28;
    }
    if (marker.userData.pulse?.material) {
      marker.userData.pulse.material.opacity =
        state === "standby" ? 0.08 : isBlocked ? 0.58 + pulse * 0.32 : isActive ? 0.36 + pulse * 0.24 : 0.18;
    }
    if (marker.userData.light) {
      marker.userData.light.intensity =
        state === "standby" ? 0.06 : isBlocked ? 0.54 + pulse * 0.36 : isActive ? 0.28 + pulse * 0.22 : 0.14;
    }
  }
}

function animateAgentRig(rig, time) {
  if (!rig) return;
  const phase = rig.userData.phase;
  const active = rig.userData.active;
  const profile = rig.userData.profile || agentMotionProfile(rig.userData.status);
  const missionPhase = rig.userData.missionPhase || "assigned";
  const lifeMode = profile.lifeMode || "coding";
  const speed = active ? 0.0064 : 0.0031;
  const breath = Math.sin(time * speed + phase);
  const tap = Math.sin(time * (active ? 0.014 : 0.006) + phase);
  const scan = Math.sin(time * profile.scanSpeed + phase * 0.8);
  const blink = Math.sin(time * (active ? 0.019 : 0.009) + phase) > 0.94 ? 0.38 : 1;
  const gatePulse = Math.max(0, Math.sin(time * 0.006 + phase));
  const scanSweep = Math.sin(time * 0.0045 + phase);

  if (rig.userData.model) {
    rig.position.y = rig.userData.baseY + breath * profile.breath;
    rig.rotation.x = profile.lean * 0.34 + breath * 0.008;
    rig.userData.model.rotation.y = Math.PI + scan * profile.headYaw * 0.22;
    rig.userData.modelGlow.intensity = (active ? 0.28 : 0.1) + Math.max(0, tap) * profile.keyPulse * 0.2;
    return;
  }

  rig.position.y = rig.userData.baseY + breath * profile.breath;
  rig.rotation.x = profile.lean + breath * 0.012;
  rig.userData.body.rotation.z = breath * 0.026;
  rig.userData.torsoPanel.rotation.z = breath * 0.03;
  rig.userData.torsoPanel.material.emissiveIntensity = 0.06 + Math.max(0, breath) * 0.12 * profile.keyPulse;
  rig.userData.head.rotation.x = profile.headPitch + Math.cos(time * 0.0018 + phase) * 0.025;
  rig.userData.head.rotation.y = scan * profile.headYaw;
  rig.userData.head.rotation.z = breath * 0.04;
  rig.userData.leftArm.rotation.x = Math.PI / 2.8 + tap * profile.arm * 0.62;
  rig.userData.rightArm.rotation.x =
    Math.PI / 2.8 + Math.cos(time * (active ? 0.013 : 0.005) + phase) * profile.arm * 0.58;
  rig.userData.leftArm.rotation.z = 0.45 + Math.cos(time * 0.007 + phase) * profile.arm * 0.13;
  rig.userData.rightArm.rotation.z = -0.45 + Math.sin(time * 0.007 + phase) * profile.arm * 0.13;
  rig.userData.leftForearm.rotation.x = Math.PI / 2.32 + tap * profile.arm * 0.9;
  rig.userData.rightForearm.rotation.x =
    Math.PI / 2.32 + Math.cos(time * (active ? 0.013 : 0.005) + phase) * profile.arm * 0.84;
  rig.userData.leftHand.position.y = 0.075 + Math.max(0, tap) * profile.arm * 0.05;
  rig.userData.rightHand.position.y =
    0.075 + Math.max(0, Math.cos(time * (active ? 0.013 : 0.005) + phase)) * profile.arm * 0.048;
  rig.userData.leftHand.rotation.z = tap * profile.arm * 0.26;
  rig.userData.rightHand.rotation.z = Math.cos(time * (active ? 0.013 : 0.005) + phase) * profile.arm * 0.24;
  rig.userData.consolePanel.rotation.x = -0.24 + tap * 0.025;
  rig.userData.consolePanel.material.emissiveIntensity = 0.04 + profile.keyPulse * (0.08 + Math.max(0, tap) * 0.06);
  rig.userData.headHalo.rotation.z += active ? 0.025 : 0.01;
  rig.userData.headHalo.scale.setScalar(1 + Math.sin(time * 0.003 + phase) * (active ? 0.08 : 0.035));
  rig.userData.visorGlow.scale.x = 0.72 + Math.abs(scan) * 0.42;
  rig.userData.visorGlow.material.opacity = (active ? 0.58 : 0.34) * blink + Math.max(0, tap) * 0.16;
  rig.userData.chestLine.material.opacity = 0.34 + Math.max(0, breath) * 0.28;
  rig.userData.workLight.intensity = (active ? 0.28 : 0.12) + Math.max(0, tap) * profile.keyPulse * 0.24;

  const gateVisible = lifeMode === "ops-gate" || missionPhase === "apply_blocked" || missionPhase === "failed";
  if (rig.userData.gateWall) {
    rig.userData.gateWall.visible = gateVisible;
    rig.userData.gateWall.position.y = rig.userData.gateWall.userData.baseY + gatePulse * 0.026;
    rig.userData.gateWall.scale.x = gateVisible ? 0.92 + gatePulse * 0.18 : 0.8;
    rig.userData.gateWall.scale.y = gateVisible ? 0.86 + gatePulse * 0.12 : 0.8;
    rig.userData.gateWall.material.opacity = gateVisible ? 0.24 + gatePulse * 0.28 : 0;
  }

  const scanVisible = lifeMode === "judge" || ["verification_running", "judge_review", "human_gate"].includes(missionPhase);
  if (rig.userData.scanBeam) {
    rig.userData.scanBeam.visible = scanVisible;
    rig.userData.scanBeam.position.x = rig.userData.scanBeam.userData.baseX + scanSweep * 0.16;
    rig.userData.scanBeam.scale.x = scanVisible ? 0.7 + Math.abs(scanSweep) * 0.48 : 0.7;
    rig.userData.scanBeam.material.opacity = scanVisible ? 0.18 + Math.max(0, scanSweep) * 0.38 : 0;
  }

  for (const key of rig.userData.consoleKeys || []) {
    const keyPulse = Math.sin(time * 0.015 + phase + key.userData.phase);
    const codingBoost = lifeMode === "coding" && ["evidence_collecting", "proposal_generating", "patch_running"].includes(missionPhase) ? 0.16 : 0;
    key.material.opacity = 0.16 + codingBoost + Math.max(0, keyPulse) * 0.48 * profile.keyPulse;
    key.scale.x = 0.7 + codingBoost + Math.max(0, keyPulse) * 0.52;
  }

  for (const panel of rig.userData.holoPanels || []) {
    const panelPulse = Math.sin(time * 0.0028 + phase + panel.userData.phase);
    panel.position.y = panel.userData.baseY + panelPulse * 0.012 * profile.shardLift;
    panel.rotation.y = panel.userData.baseRotationY + scan * 0.035;
    panel.material.opacity = Math.max(0.08, panel.userData.baseOpacity + Math.max(0, panelPulse) * 0.09 * profile.keyPulse);
  }

  for (const shard of rig.userData.dataShards || []) {
    const float = Math.sin(time * 0.0035 + phase + shard.userData.phase);
    shard.position.y = shard.userData.baseY + float * 0.05 * profile.shardLift;
    shard.rotation.y = scan * 0.5 + shard.userData.phase;
    shard.material.opacity = 0.08 + Math.max(0, float) * 0.36 * profile.shardLift;
  }
}

function updateSceneLabels() {
  const canvasRect = elements.threeDeck.getBoundingClientRect();
  const position = new THREE.Vector3();

  for (const [id, label] of threeDeck.labels) {
    const node = threeDeck.nodeObjects.get(id);
    if (!node) continue;
    node.getWorldPosition(position);
    position.y += 1.08;
    position.project(threeDeck.camera);
    const x = (position.x * 0.5 + 0.5) * canvasRect.width;
    const y = (-position.y * 0.5 + 0.5) * canvasRect.height;
    const selected = id === state.selectedId;
    const pinned = label.dataset.pinned === "true";
    label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    const safeTop = canvasRect.width < 560 ? 76 : 190;
    const sideSafeInset = canvasRect.width < 760 ? 78 : 170;
    const insideSafeFrame =
      x > sideSafeInset &&
      x < canvasRect.width - sideSafeInset &&
      y > safeTop &&
      y < canvasRect.height - 112;
    const visible = position.z < 1 && insideSafeFrame && (selected || pinned);
    label.style.opacity = visible ? "1" : "0";
    label.style.visibility = visible ? "visible" : "hidden";
    label.style.pointerEvents = visible ? "auto" : "none";
    label.classList.toggle("is-selected", selected);
  }
}

function handleThreePointerDown(event) {
  threeDeck.isDragging = true;
  threeDeck.lastPointerX = event.clientX;
  threeDeck.dragDelta = 0;
  elements.threeDeck.setPointerCapture?.(event.pointerId);
}

function handleThreePointerMove(event) {
  if (!threeDeck.isDragging) return;
  const delta = event.clientX - threeDeck.lastPointerX;
  threeDeck.dragDelta += Math.abs(delta);
  threeDeck.lastPointerX = event.clientX;
  threeDeck.rotationTarget += delta * 0.006;
}

function handleThreePointerUp(event) {
  elements.threeDeck.releasePointerCapture?.(event.pointerId);
  threeDeck.isDragging = false;
  if (threeDeck.dragDelta > 8) return;

  const rect = elements.threeDeck.getBoundingClientRect();
  threeDeck.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  threeDeck.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  threeDeck.raycaster.setFromCamera(threeDeck.pointer, threeDeck.camera);
  const objects = [...threeDeck.nodeObjects.values()].flatMap((node) => node.children);
  const hit = threeDeck.raycaster.intersectObjects(objects, true)[0];
  const projectId = hit?.object?.userData?.projectId || hit?.object?.parent?.userData?.projectId;
  if (projectId) {
    state.selectedId = projectId;
    state.selectionLocked = true;
    render();
  }
}

function requestDeckDraw() {
  cancelAnimationFrame(deckAnimationFrame);
  deckAnimationFrame = requestAnimationFrame(drawDeckNetwork);
}

function drawDeckNetwork(time = 0) {
  const canvas = elements.deckCanvas;
  const floor = canvas?.parentElement;
  if (!canvas || !floor) return;

  const rect = floor.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const targetWidth = Math.max(1, Math.floor(rect.width * scale));
  const targetHeight = Math.max(1, Math.floor(rect.height * scale));
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const cards = [...elements.deskGrid.querySelectorAll(".desk-card:not(.is-hidden)")];
  const points = cards.map((card) => {
    const cardRect = card.getBoundingClientRect();
    return {
      x: cardRect.left - rect.left + cardRect.width / 2,
      y: cardRect.top - rect.top + 70,
      status: [...card.classList].find((name) => name.startsWith("status-"))?.replace("status-", "") || "idle",
      accent: getComputedStyle(card).getPropertyValue("--accent").trim() || "#16a79f"
    };
  });

  context.lineWidth = 1;
  context.lineCap = "round";
  context.globalAlpha = 0.64;

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const lift = Math.min(60, Math.abs(to.x - from.x) * 0.16 + 24);
    const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, hexToRgba(from.accent, 0.4));
    gradient.addColorStop(1, hexToRgba(to.accent, 0.18));
    context.strokeStyle = gradient;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.bezierCurveTo(from.x, from.y + lift, to.x, to.y - lift, to.x, to.y);
    context.stroke();

    if (from.status === "active" || from.status === "running") {
      const progress = ((time / 1700 + index * 0.13) % 1);
      const pulseX = from.x + (to.x - from.x) * progress;
      const pulseY = from.y + (to.y - from.y) * progress;
      context.fillStyle = hexToRgba(from.accent, 0.75);
      context.beginPath();
      context.arc(pulseX, pulseY, 2.4, 0, Math.PI * 2);
      context.fill();
    }
  }

  context.globalAlpha = 1;
  for (const point of points) {
    context.fillStyle = hexToRgba(point.accent, 0.14);
    context.beginPath();
    context.arc(point.x, point.y, 11, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = hexToRgba(point.accent, 0.55);
    context.beginPath();
    context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    context.fill();
  }

  deckAnimationFrame = requestAnimationFrame(drawDeckNetwork);
}

function hexToRgba(value, alpha) {
  const fallback = `rgba(22, 167, 159, ${alpha})`;
  const match = value.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return fallback;
  const red = parseInt(match[1], 16);
  const green = parseInt(match[2], 16);
  const blue = parseInt(match[3], 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const DEMO_REPLAY_INTERVAL_MS = 18000;
const DEMO_REPLAY_STEPS = Object.freeze([
  { id: "project", label: "选择项目", eventType: "task_queued", focusNode: "task", focusWorkerId: "coding-yuan" },
  { id: "assigned", label: "Coding猿接单", eventType: "task_queued", focusNode: "task", focusWorkerId: "coding-yuan" },
  { id: "evidence", label: "Evidence Pack", eventType: "task_evidence", focusNode: "evidence", focusWorkerId: "coding-yuan" },
  { id: "proposal", label: "Patch Proposal", eventType: "patch_plan", focusNode: "proposal", focusWorkerId: "coding-yuan" },
  { id: "verification", label: "Verification", eventType: "verification_passed", focusNode: "verification", focusWorkerId: "judge-yuan" },
  { id: "judge", label: "Judge Review", eventType: "judge_review", focusNode: "judge", focusWorkerId: "judge-yuan" },
  { id: "human", label: "Human Gate", eventType: "human_gate_approved", focusNode: "human", focusWorkerId: "judge-yuan" },
  { id: "diff", label: "Diff Preview", eventType: "patch_run_ready", focusNode: "diff", focusWorkerId: "coding-yuan" },
  { id: "apply", label: "Apply Gate", eventType: "apply_gate_pending", focusNode: "apply", focusWorkerId: "ops-yuan" },
  { id: "report", label: "Company Report", eventType: "task_completed", focusNode: "report", focusWorkerId: "coding-yuan" }
]);

function demoIso(minutes = 0) {
  return new Date(Date.UTC(2026, 4, 28, 1, minutes, 0)).toISOString();
}

function seededDemoTask(stepIndex = DEMO_REPLAY_STEPS.length - 1) {
  const stepId = DEMO_REPLAY_STEPS[Math.max(0, Math.min(stepIndex, DEMO_REPLAY_STEPS.length - 1))]?.id || "report";
  const task = {
    id: "demo_mac_mvp_paid_loop",
    projectId: "demo-coding-yuan-office",
    projectName: "Demo Data · Codingape Office Mac App",
    workerId: "coding-yuan",
    workerName: "Coding猿",
    title: "Demo Data · 修复 Apply Gate 状态并生成可审计补丁",
    status: stepId === "project" ? "queued" : stepId === "assigned" ? "assigned" : stepId === "evidence" ? "running" : "completed",
    risk: "medium",
    priority: "high",
    source: "mission_sandbox_patch",
    createdAt: demoIso(0),
    updatedAt: demoIso(stepIndex),
    patchCandidates: ["src/apply-gate.ts", "tests/apply-gate.test.ts"],
    patchDrafts: [],
    evidence: [],
    result: {
      commandCount: stepIndex >= 2 ? 4 : 0,
      changedFiles: stepIndex >= 7 ? ["src/apply-gate.ts", "tests/apply-gate.test.ts"] : []
    }
  };
  if (stepIndex >= 3) {
    task.evidence.push("data/evidence/demo_mac_mvp_paid_loop.json");
    task.patchDrafts = [
      { file: "src/apply-gate.ts", bytes: 612 },
      { file: "tests/apply-gate.test.ts", bytes: 438 }
    ];
  }
  if (stepIndex >= 4) {
    task.evidence.push("data/proposals/demo_mac_mvp_paid_loop.json");
    task.proposal = "Demo Data · Patch Proposal";
  }
  if (stepIndex >= 5) {
    task.evidence.push("data/verifications/demo_mac_mvp_paid_loop.json");
    task.verification = "Demo Data · Verification";
  }
  if (stepIndex >= 6) task.result.verificationStatus = "passed";
  if (stepIndex >= 7) task.result.humanGateStatus = "approved";
  if (stepIndex >= 8) {
    task.evidence.push("data/patch-runs/demo_mac_mvp_paid_loop.json");
    task.patchRun = "Demo Data · Diff Preview";
    task.result.patchRunStatus = "sandbox_written";
    task.result.patchRunMode = "sandbox";
    task.result.patchRunPath = "Demo Data · Diff Preview";
  }
  if (stepIndex >= 9) {
    task.evidence.push("data/patch-applies/demo_mac_mvp_paid_loop/manifest.json");
    task.applyRun = "Demo Data · Apply Gate";
    task.result.applyStatus = "applied";
    task.result.applyPath = "Demo Data · Apply Gate";
  } else if (stepIndex >= 8) {
    task.applyRun = "Demo Data · Apply Gate";
    task.result.applyStatus = "requires_confirmation";
    task.result.applyPath = "Demo Data · Apply Gate";
  }
  return task;
}

function seededDemoSnapshot(stepIndex = DEMO_REPLAY_STEPS.length - 1) {
  const replayStep = DEMO_REPLAY_STEPS[Math.max(0, Math.min(stepIndex, DEMO_REPLAY_STEPS.length - 1))];
  const task = seededDemoTask(stepIndex);
  const project = {
    id: "demo-coding-yuan-office",
    name: "Demo Data · Codingape Office Mac App",
    path: "/Users/you/Code/coding-yuan-office-demo",
    folder: "coding-yuan-office-demo",
    role: "Mac 本地代码项目",
    workerId: "coding-yuan",
    workerName: "Coding猿",
    accent: "teal",
    status: { key: stepIndex <= 1 ? "ready" : "active", label: `Demo replay · ${replayStep.label}` },
    risk: { key: "medium", label: "Human Gate" },
    task: {
      current: `${replayStep.label} · ${task.title}`,
      nextAction: "Apply Approved Patch 保持阻断，直到确认语、回滚和根目录守卫全部满足"
    },
    repo: {
      kind: "git",
      branch: "main",
      changeCount: 2,
      changes: ["src/apply-gate.ts", "tests/apply-gate.test.ts"]
    },
    activity: {
      latest: demoIso(6),
      recentFiles: [
        { path: "src/apply-gate.ts", mtime: demoIso(4) },
        { path: "tests/apply-gate.test.ts", mtime: demoIso(5) }
      ]
    },
    packages: [
      {
        path: "package.json",
        scripts: {
          test: "node --test",
          "mac:mvp": "npm run test"
        }
      }
    ],
    inferredPorts: [],
    runningPorts: []
  };
  const workers = [
    {
      id: "coding-yuan",
      name: "Coding猿",
      mark: "猿",
      domain: "Engineering",
      accent: "teal",
      status: "working",
      statusLabel: "Diff ready",
      risk: "medium",
      currentTask: "Demo Data · Evidence Pack + Diff Preview",
      queue: 1,
      projectIds: [project.id],
      projectCount: 1,
      launchTier: "core",
      launchLabel: "Core"
    },
    {
      id: "judge-yuan",
      name: "Judge猿",
      mark: "审",
      domain: "Governance",
      accent: "violet",
      status: "ready",
      statusLabel: "Human Gate approved",
      risk: "low",
      currentTask: "Demo Data · Human Gate",
      queue: 0,
      projectIds: [project.id],
      projectCount: 1,
      launchTier: "core",
      launchLabel: "Core"
    },
    {
      id: "ops-yuan",
      name: "Ops猿",
      mark: "运",
      domain: "Runtime",
      accent: "gold",
      status: "ready",
      statusLabel: "Apply Gate blocked",
      risk: "medium",
      currentTask: "Demo Data · Rollback ready, Apply blocked",
      queue: 0,
      projectIds: [project.id],
      projectCount: 1,
      launchTier: "core",
      launchLabel: "Core"
    }
  ];
  const events = [
    ["task_queued", "Coding猿 接到本地代码任务", "用户选择本地项目并输入任务。", "coding-yuan", 0],
    ["task_evidence", "Evidence Pack 就绪", "采集 package scripts、git diff、目标文件和风险边界。", "coding-yuan", 1],
    ["patch_plan", "Patch Proposal 生成", "只提出补丁方案，不直接改项目文件。", "coding-yuan", 2],
    ["verification_passed", "Verification 通过", "Demo Data · node --test 通过。", "judge-yuan", 3],
    ["judge_review", "Judge Review 完成", "审核猿确认补丁方案有证据支撑。", "judge-yuan", 4],
    ["human_gate_approved", "Human Gate 已批准", "人类确认这个 diff 可以进入写入闸门。", "judge-yuan", 4],
    ["patch_run_ready", "Diff Preview 和 Rollback 已准备", "沙盒补丁包、统一 diff、回滚快照都已生成。", "coding-yuan", 5],
    ["apply_gate_pending", "Apply Gate 阻断等待确认", "Apply Approved Patch 仍需精确确认和本地写入开关。", "ops-yuan", 6],
    ["task_completed", "Company Report 已生成", "Demo Data · 战报记录证据、diff、测试和回滚位置。", "coding-yuan", 7]
  ].filter(([type]) => {
    const stepForType = DEMO_REPLAY_STEPS.findIndex((step) => step.eventType === type);
    return stepForType === -1 || stepForType <= stepIndex;
  }).map(([type, title, detail, workerId, minute]) => ({
    id: `demo_${type}`,
    taskId: task.id,
    projectId: project.id,
    workerId,
    workerName: workers.find((worker) => worker.id === workerId)?.name || "Coding猿",
    type,
    title: `Demo Data · ${title}`,
    detail,
    risk: type === "apply_gate_pending" ? "high" : "low",
    evidence: task.evidence,
    timestamp: demoIso(minute)
  }));
  const companyReport = {
    generatedAt: demoIso(Math.max(7, stepIndex)),
    headline: "Demo Data · Codingape Office completed the local Mac paid-loop replay.",
    shareLine: "Demo Data · Evidence first, diff second, writes only after approval.",
    metrics: [
      { label: "完成任务", value: 1 },
      { label: "证据包", value: 1 },
      { label: "验证通过", value: 1 },
      { label: "补丁运行", value: 1 },
      { label: "写入闸门", value: 1 },
      { label: "阻断", value: 1 },
      { label: "节省", value: "1.4h" }
    ],
    latestLoop: {
      taskId: task.id,
      title: task.title,
      checks: 4,
      changedFiles: task.result.changedFiles,
      evidenceCapturedAt: demoIso(1),
      proposalCreatedAt: demoIso(2),
      proposalSummary: "Demo Data · 生成最小补丁并保留人工确认。",
      verificationStatus: "passed",
      patchRunStatus: "sandbox_written",
      applyStatus: "requires_confirmation"
    }
  };

  return {
    generatedAt: demoIso(Math.max(7, stepIndex)),
    workspace: "/Users/you/Code",
    counts: { active: 1, ready: 0, draft: 0, running: 0 },
    projects: [project],
    workers,
    tasks: [task],
    approvals: [
      {
        id: `approval_close_loop_${task.id}`,
        taskId: task.id,
        projectId: project.id,
        projectName: project.name,
        workerId: "judge-yuan",
        workerName: "Judge猿",
        title: "Demo Data · Human Gate 已批准",
        reason: "Demo replay",
        status: "approved",
        risk: "medium",
        gateType: "close_loop"
      }
    ],
    events,
    autonomy: {
      score: 72,
      level: "Demo Data · Mac MVP ready",
      verdict: "supervised_only",
      summary: "Demo Data · 可付费闭环已跑通，真实写入仍受 Human Gate 和 Apply Gate 保护。",
      metrics: {
        applyRunnerEnabled: false,
        aiwcConfigured: true
      },
      hardBlockers: [
        {
          owner: "Ops猿",
          title: "Apply Approved Patch 默认阻断",
          remediation: "启用本地写入开关并输入确认语后才可写入。"
        }
      ],
      objectives: []
    },
    companyReport,
    launch: {
      currentStage: "Demo Data · Coding猿闭环 replay",
      latestEvidence: {
        taskId: task.id,
        title: task.title,
        checks: 4,
        changedFiles: task.result.changedFiles,
        verificationStatus: "passed",
        gateStatus: "approved",
        patchRunStatus: "sandbox_written",
        applyStatus: "requires_confirmation",
        proposalRisk: "medium"
      }
    },
    localJudge: {
      enabled: false,
      provider: "disabled",
      model: "",
      timeoutMs: 0,
      latestStatus: "none",
      latestSummary: "Demo Data"
    },
    serviceHealth: {
      local: { label: "Demo Data · 本地服务", status: "configured", statusLabel: "回放", detail: "这个页面不连接你的本地服务。" },
      publicEntry: { label: "Demo Data · 公网页面", status: "online", statusLabel: "在线", detail: "Watch Demo 使用 seeded 数据。" },
      tunnel: { label: "Demo Data · 隧道", status: "configured", statusLabel: "演示", detail: "没有读取本机控制台状态。" },
      daemon: { label: "Demo Data · 守护进程", status: "configured", statusLabel: "未使用", detail: "真实办公室在 /office。" }
    }
  };
}

function seededDemoEvidencePack() {
  const commands = [
    { command: "pwd", ok: true, output: "/Users/you/Code/coding-yuan-office-demo" },
    { command: "git status --short", ok: true, output: " M src/apply-gate.ts" },
    { command: "git diff --name-only", ok: true, output: "src/apply-gate.ts\ntests/apply-gate.test.ts" },
    { command: "git diff --stat", ok: true, output: "src/apply-gate.ts | 8 ++++++++\ntests/apply-gate.test.ts | 6 ++++++" }
  ];
  return {
    taskId: "demo_mac_mvp_paid_loop",
    commands,
    summary: { commands },
    changedFiles: ["src/apply-gate.ts", "tests/apply-gate.test.ts"],
    recommendedVerification: ["npm test"],
    verificationScripts: ["npm test"],
    note: "Demo Data · Evidence Pack 已采集，只读、不写项目文件。",
    evidencePath: "Demo Data · Evidence Pack"
  };
}

function seededDemoProposal() {
  return {
    summary: "Demo Data · 只修改 Apply Gate 状态判断和对应测试。",
    risk: "medium",
    changedFiles: ["src/apply-gate.ts", "tests/apply-gate.test.ts"],
    observations: [
      "Evidence Pack 显示目标文件都在所选项目根目录内。",
      "Patch Proposal 只涉及 Apply Gate 状态，不包含部署、重启或外部副作用。"
    ],
    recommendedSteps: [
      "生成沙盒补丁。",
      "运行 Verification。",
      "等待 Human Gate。",
      "确认 Rollback snapshot 后再进入 Apply Gate。"
    ],
    gatedActions: ["Apply Approved Patch 必须等待人工确认。"]
  };
}

function seededDemoVerification() {
  return {
    status: "passed",
    result: {
      ok: true,
      command: "npm test",
      output: "Demo Data · node --test tests/apply-gate.test.ts\n8 tests passed"
    },
    summary: {
      script: "test",
      scriptCommand: "node --test",
      command: "npm test",
      result: { ok: true, output: "Demo Data · 8 tests passed" }
    }
  };
}

function seededDemoPatchRun() {
  return {
    status: "sandbox_written",
    mode: "sandbox",
    patchRunPath: "Demo Data · Diff Preview",
    sandboxPath: "Demo Data · Sandbox Patch Package",
    sandboxManifestPath: "Demo Data · Sandbox Manifest",
    diffPath: "Demo Data · diff.patch",
    rollbackSnapshotPath: "Demo Data · Rollback Snapshot",
    allowedFiles: ["src/apply-gate.ts", "tests/apply-gate.test.ts"],
    blockedFiles: [],
    outOfScopeFiles: [],
    blockers: [],
    draftsAppliedToSandbox: 2,
    rollbackFiles: [
      { file: "src/apply-gate.ts", existed: true, bytes: 1240 },
      { file: "tests/apply-gate.test.ts", existed: true, bytes: 830 }
    ],
    sandboxFiles: [
      { file: "src/apply-gate.ts", changed: true, proposedBytes: 612, sandboxPath: "Demo Data · sandbox/src/apply-gate.ts" },
      { file: "tests/apply-gate.test.ts", changed: true, proposedBytes: 438, sandboxPath: "Demo Data · sandbox/tests/apply-gate.test.ts" }
    ],
    diffPreview: [
      "--- a/src/apply-gate.ts",
      "+++ b/src/apply-gate.ts",
      "@@ -1,3 +1,4 @@",
      "+const rollbackReady = Boolean(snapshot.ready);",
      "+const canApply = diffReady && verificationReady && rollbackReady && humanApproved && insideRoot;"
    ].join("\n"),
    preview: "Demo Data · 生成 diff、创建 rollback snapshot、项目文件仍未修改。",
    note: "Demo Data · 补丁执行器只写入沙盒产物，没有修改项目代码。"
  };
}

function seededDemoApplyRun() {
  return {
    status: "requires_confirmation",
    requiredConfirmation: "APPLY demo_mac_mvp_paid_loop",
    applyRunnerEnabled: false,
    sandboxManifestPath: "Demo Data · Sandbox Manifest",
    rollbackSnapshotPath: "Demo Data · Rollback Snapshot",
    applyPath: "Demo Data · Apply Gate Report",
    applyReportPath: "Demo Data · Apply Gate Report",
    appliedFiles: [],
    candidateFiles: [
      { file: "src/apply-gate.ts", bytes: 612, proposedSha256: "demo000000000000000000000000000000000000000000000000000000000001" },
      { file: "tests/apply-gate.test.ts", bytes: 438, proposedSha256: "demo000000000000000000000000000000000000000000000000000000000002" }
    ],
    blockers: [
      {
        id: "apply_runner_disabled",
        title: "Apply runner is disabled",
        detail: "Demo Data · Apply Approved Patch is visible only after the gate facts are ready; real writes stay off."
      },
      {
        id: "apply_confirmation_required",
        title: "Exact apply confirmation is required",
        detail: "Demo Data · User must confirm before project files change."
      }
    ],
    applyGate: {
      version: "v1",
      status: "ready",
      canApply: true,
      requiredFacts: {
        diffReady: true,
        verificationResultExists: true,
        rollbackSnapshotReady: true,
        humanApprovalGranted: true,
        allTargetFilesInsideProjectRoot: true
      }
    },
    rollbackAvailable: true,
    rollbackOption: {
      available: true,
      rollbackSnapshotPath: "Demo Data · Rollback Snapshot",
      note: "Demo Data · 如果真实写入失败，用户会看到 rollback option。"
    },
    applyReport: {
      status: "requires_confirmation",
      generatedAt: demoIso(7),
      appliedFiles: 0,
      rollbackAvailable: true
    },
    note: "Demo Data · Apply Gate v1 已满足产品条件，但真实写入仍等待本地开关和精确确认。"
  };
}

function demoReplayInsightHtml() {
  const task = seededDemoTask();
  return `
    <div class="demo-replay-stack">
      <p class="demo-data-label">Demo Data · Coding猿 完整闭环 replay</p>
      <h4>Demo Data · Evidence Pack</h4>
      ${evidenceInsightHtml(seededDemoEvidencePack(), seededDemoProposal())}
      <h4>Demo Data · Verification</h4>
      ${verificationInsightHtml(seededDemoVerification())}
      <h4>Demo Data · Human Gate</h4>
      ${humanGateInsightHtml(task, { status: "approved", approvalId: `approval_close_loop_${task.id}`, note: "Demo Data · 人工批准后才进入 Apply Gate。" })}
      <h4>Demo Data · Diff Preview</h4>
      ${patchRunInsightHtml(seededDemoPatchRun())}
      <h4>Demo Data · Apply Gate</h4>
      ${applyRunInsightHtml(seededDemoApplyRun())}
      <h4>Demo Data · Company Report</h4>
      ${closedLoopWarReportHtml({
        task,
        evidence: seededDemoEvidencePack(),
        proposal: seededDemoProposal(),
        verification: seededDemoVerification(),
        patchRun: seededDemoPatchRun(),
        applyRun: seededDemoApplyRun()
      })}
    </div>
  `;
}

function renderPublicHome() {
  if (elements.publicHome) elements.publicHome.hidden = false;
  if (elements.betaPage) elements.betaPage.hidden = true;
  if (elements.demoModeBanner) elements.demoModeBanner.hidden = true;
}

function renderPublicBeta() {
  if (elements.publicHome) elements.publicHome.hidden = true;
  if (elements.betaPage) elements.betaPage.hidden = false;
  if (elements.demoModeBanner) elements.demoModeBanner.hidden = true;
}

function demoReplayStepFromUrl() {
  const value = new URLSearchParams(window.location.search).get("demoStep");
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, DEMO_REPLAY_STEPS.length - 1)) : 0;
}

function demoReplayRecordingMode() {
  return new URLSearchParams(window.location.search).get("recording") === "1";
}

function currentDemoReplayStep() {
  return DEMO_REPLAY_STEPS[state.demoReplay.stepIndex] || DEMO_REPLAY_STEPS[0];
}

function updateDemoReplayControls() {
  if (!elements.demoReplayStatus) return;
  const step = currentDemoReplayStep();
  const index = Math.min(state.demoReplay.stepIndex + 1, DEMO_REPLAY_STEPS.length);
  elements.demoReplayStatus.textContent = `Demo Data · ${index}/${DEMO_REPLAY_STEPS.length} · ${step.label}`;
  if (elements.demoReplayPauseButton) {
    elements.demoReplayPauseButton.textContent = state.demoReplay.paused ? "Play" : "Pause";
  }
}

function focusDemoReplayEvent(snapshot, step) {
  const event = (snapshot.events || []).find((candidate) => candidate.type === step.eventType);
  if (!event) {
    state.selectedEventId = null;
    state.selectedReplayEvent = null;
    state.selectedReplaySummary = {
      focusNode: step.focusNode,
      focusWorkerId: step.focusWorkerId,
      taskId: "demo_mac_mvp_paid_loop"
    };
    return;
  }
  state.selectedEventId = timelineEventKey(event);
  state.selectedReplayEvent = eventSnapshot(event);
  state.selectedReplaySummary = timelineReplaySummary(event);
}

function applyDemoReplayStep(stepIndex, options = {}) {
  const maxIndex = DEMO_REPLAY_STEPS.length - 1;
  state.demoReplay.stepIndex = Math.max(0, Math.min(stepIndex, maxIndex));
  const step = currentDemoReplayStep();
  state.snapshot = seededDemoSnapshot(state.demoReplay.stepIndex);
  state.selectedId = "demo-coding-yuan-office";
  state.selectionLocked = true;
  state.inspectorOpen = true;
  state.inspectorTab = step.focusNode === "human" || step.focusNode === "apply" ? "gate" : "evidence";
  focusDemoReplayEvent(state.snapshot, step);
  if (options.keepInsight !== true) {
    state.taskInsight = {
      context: state.inspectorTab,
      taskId: "demo_mac_mvp_paid_loop",
      title: `Demo Data · ${step.label}`,
      status: "Demo Data",
      html: demoReplayInsightHtml()
    };
  }
  render();
  updateDemoReplayControls();
  setControlStatus(`Demo Data · ${step.label} · 不连接本地服务`);
}

function scheduleDemoReplay() {
  clearTimeout(demoReplayTimer);
  if (APP_MODE !== AppMode.publicDemo || state.demoReplay.paused) return;
  if (state.demoReplay.stepIndex >= DEMO_REPLAY_STEPS.length - 1) return;
  demoReplayTimer = setTimeout(() => {
    applyDemoReplayStep(state.demoReplay.stepIndex + 1);
    scheduleDemoReplay();
  }, DEMO_REPLAY_INTERVAL_MS);
}

function toggleDemoReplayPause() {
  state.demoReplay.paused = !state.demoReplay.paused;
  updateDemoReplayControls();
  if (state.demoReplay.paused) {
    clearTimeout(demoReplayTimer);
    setControlStatus("Demo Data · 演示已暂停");
  } else {
    setControlStatus("Demo Data · 演示继续播放");
    scheduleDemoReplay();
  }
}

function restartDemoReplay() {
  state.demoReplay.paused = false;
  applyDemoReplayStep(0);
  scheduleDemoReplay();
}

function attachDemoReplayHandlers() {
  elements.demoReplayPauseButton?.addEventListener("click", toggleDemoReplayPause);
  elements.demoReplayRestartButton?.addEventListener("click", restartDemoReplay);
}

function renderPublicDemo() {
  if (elements.publicHome) elements.publicHome.hidden = true;
  if (elements.betaPage) elements.betaPage.hidden = true;
  if (elements.demoModeBanner) elements.demoModeBanner.hidden = false;
  state.demoReplay.paused = demoReplayRecordingMode();
  applyDemoReplayStep(demoReplayStepFromUrl());
  if (!state.demoReplay.paused) scheduleDemoReplay();
}

async function fetchStatus() {
  const response = await fetch("/api/status", { cache: "no-store" });
  state.snapshot = await response.json();
  syncLiveRunFromSnapshot(state.snapshot);
  const selectedExists = state.snapshot?.projects?.some((project) => project.id === state.selectedId);
  if (!state.selectionLocked || !state.selectedId || !selectedExists) {
    state.selectedId = preferredProject(state.snapshot)?.id || null;
    state.selectionLocked = false;
  }
  render();
}

async function queueSelectedTask(kind) {
  const project = currentProject();
  if (!project) return;

  const blocked = kind === "blocked";
  const title = blocked
    ? `${zhWorkerName(project.workerName, project.workerId)}在${zhText(project.name)}遇到阻断，需要人工决定`
    : `复核${zhText(project.name)}，总结风险并附上证据`;

  setControlStatus(blocked ? "正在标记..." : "正在加入队列...");
  try {
    await postJson("/api/tasks", {
      projectId: project.id,
      workerId: project.workerId,
      title,
      status: blocked ? "blocked" : "queued",
      risk: blocked ? "high" : project.risk?.key || "medium",
      priority: blocked ? "high" : "normal",
      source: "operator"
    });
    setControlStatus(blocked ? "已阻断" : "已排队");
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error));
  }
}

async function updateApproval(approvalId, status) {
  const approval = state.snapshot?.approvals?.find((candidate) => candidate.id === approvalId);
  setControlStatus(status === "approved" ? "正在批准..." : status === "changes_requested" ? "正在要求返工..." : "正在复核...");
  try {
    await postJson(`/api/approvals/${encodeURIComponent(approvalId)}`, {
      status,
      workerId: approval?.workerId || "judge-yuan",
      workerName: approval?.workerName || "审核猿",
      projectId: approval?.projectId || "",
      note: approval?.title || "人工闸门已更新"
    });
    setControlStatus(status === "approved" ? "已批准" : status === "changes_requested" ? "已要求返工" : "已复核");
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error));
  }
}

async function runTaskEvidence(taskId) {
  setControlStatus("正在采集...");
  try {
    const result = await postJson(`/api/tasks/${encodeURIComponent(taskId)}/run`, {});
    state.taskInsight = {
      context: "evidence",
      taskId,
      title: "证据包",
      status: "已采集",
      html: evidenceInsightHtml(result.evidence)
    };
    setControlStatus("证据就绪");
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error));
  }
}

async function viewTaskEvidence(taskId, options = {}) {
  setControlStatus("正在打开...");
  try {
    const result = await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/evidence`);
    state.inspectorTab = "evidence";
    state.inspectorOpen = true;
    state.taskInsight = {
      context: "evidence",
      taskId,
      title: result.patchRun ? "补丁审核" : result.verification ? "证据与验证" : result.proposal ? "证据与方案" : "证据包",
      status: result.patchRun
        ? patchRunStatusLabel(result.patchRun.status)
        : result.verification
          ? verificationStatusLabel(verificationStatusFromSummary(result.verification))
          : result.proposal
            ? "已规划"
            : "已采集",
      html: `${evidenceInsightHtml(result.evidence, result.proposal)}${verificationInsightHtml(result.verification)}${humanGateInsightHtml(result.task, result.humanGate)}${patchRunInsightHtml(result.patchRun)}${applyRunInsightHtml(result.applyRun)}${result.rollback ? rollbackInsightHtml(result.rollback) : ""}${taskCompanyReportHtml(result.taskReport)}`
    };
    setControlStatus("证据已打开");
    setInspectorOpen(true);
    renderTaskInsight();
    renderInspectorTabs();
    renderReplaySurfaces();
    scrollInspectorToEvidenceFocus(options.focus || "top");
  } catch (error) {
    setControlStatus(uiErrorMessage(error));
  }
}

async function viewTaskGateEvidence(taskId, options = {}) {
  setControlStatus("正在打开闸门回放...");
  try {
    const result = await fetchJson(`/api/tasks/${encodeURIComponent(taskId)}/evidence`);
    state.inspectorTab = "gate";
    state.inspectorOpen = true;
    state.taskInsight = {
      context: "gate",
      taskId,
      title: result.applyRun ? "写入闸门回放" : "人工闸门回放",
      status: result.applyRun
        ? applyRunStatusLabel(result.applyRun.status)
        : humanGateStatusLabel(result.humanGate?.status),
      html: `${humanGateInsightHtml(result.task, result.humanGate)}${applyRunInsightHtml(result.applyRun)}${result.rollback ? rollbackInsightHtml(result.rollback) : ""}${taskCompanyReportHtml(result.taskReport)}`
    };
    setControlStatus("闸门回放已打开");
    setInspectorOpen(true);
    renderGateInspector(state.snapshot, currentProject());
    renderInspectorTabs();
    renderReplaySurfaces();
    if (options.focus === "gate") scrollInspectorToGateFocus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "闸门回放失败"));
  }
}

async function runTaskVerification(taskId) {
  const task = taskById(taskId);
  const mode = missionModeFromTask(task);
  if (!["verify", "sandbox_patch"].includes(mode)) {
    setControlStatus("当前模式不运行验证；请切到“审查 + 验证”或“完整沙盒闭环”。");
    return;
  }
  setControlStatus("正在验证...");
  try {
    const result = await postJson(`/api/tasks/${encodeURIComponent(taskId)}/verification`, {});
    state.inspectorTab = "evidence";
    state.taskInsight = {
      context: "evidence",
      taskId,
      title: "验证证据",
      status: verificationStatusLabel(result.status),
      html: `${verificationInsightHtml(result.verification)}${evidenceInsightHtml(result.evidence)}`
    };
    setControlStatus(verificationStatusLabel(result.status));
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "验证被阻断"));
  }
}

async function draftTaskPlan(taskId) {
  setControlStatus("正在规划...");
  try {
    const result = await postJson(`/api/tasks/${encodeURIComponent(taskId)}/proposal`, {});
    state.inspectorTab = "evidence";
    state.taskInsight = {
      context: "evidence",
      taskId,
      title: "补丁方案",
      status: "已起草",
      html: `${proposalInsightHtml(result.proposal)}${humanGateInsightHtml(result.task)}`
    };
    setControlStatus("方案已起草");
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error));
  }
}

async function runTaskPatch(taskId) {
  const task = taskById(taskId);
  if (missionModeFromTask(task) !== "sandbox_patch") {
    setControlStatus("当前模式不生成沙盒补丁；请切到“完整沙盒闭环”。");
    return;
  }
  setControlStatus("补丁预检中...");
  try {
    const result = await postJson(`/api/tasks/${encodeURIComponent(taskId)}/patch-run`, {});
    state.inspectorTab = "evidence";
    state.taskInsight = {
      context: "evidence",
      taskId,
      title: "受控补丁执行器",
      status: patchRunStatusLabel(result.status),
      html: patchRunInsightHtml(result.patchRun)
    };
    setControlStatus(patchRunStatusLabel(result.status));
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "补丁执行器失败"));
  }
}

async function runTaskApplyGate(taskId, options = {}) {
  const task = taskById(taskId);
  if (missionModeFromTask(task) !== "sandbox_patch") {
    setControlStatus("当前模式不进入写入闸门；请切到“完整沙盒闭环”。");
    return;
  }
  const applying = Boolean(options.applyApproved);
  const formState = applying
    ? applyGateFormState(taskId)
    : { confirmation: "", localWriteEnabled: false };
  if (applying && !formState.localWriteEnabled) {
    setControlStatus("请先打开本地写入开关");
    return;
  }
  if (applying && formState.confirmation !== `APPLY ${taskId}`) {
    setControlStatus("确认语不匹配，写入保持阻断");
    return;
  }
  setControlStatus(applying ? "正在申请写入..." : "正在检查写入闸门...");
  try {
    const result = await postJson(`/api/tasks/${encodeURIComponent(taskId)}/apply-gate`, applying
      ? { confirmation: formState.confirmation, localWriteEnabled: formState.localWriteEnabled }
      : {});
    state.inspectorTab = "gate";
    state.taskInsight = {
      context: "gate",
      taskId,
      title: applying ? "Apply Approved Patch" : "写入提案闸门",
      status: applyRunStatusLabel(result.status),
      html: `${applyRunInsightHtml(result.applyRun)}${taskCompanyReportHtml(result.taskReport)}`
    };
    setControlStatus(applyRunStatusLabel(result.status));
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "写入闸门失败"));
  }
}

async function runTaskRollback(taskId) {
  setControlStatus("正在回滚...");
  try {
    const result = await postJson(`/api/tasks/${encodeURIComponent(taskId)}/rollback`, {});
    state.inspectorTab = "gate";
    state.taskInsight = {
      context: "gate",
      taskId,
      title: "Rollback Manager",
      status: result.status === "rolled_back" ? "已回滚" : "回滚阻断",
      html: `${rollbackInsightHtml(result.rollback)}${taskCompanyReportHtml(result.taskReport)}`
    };
    setControlStatus(result.status === "rolled_back" ? "已回滚到快照" : "回滚被阻断");
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "回滚失败"));
  }
}

async function runCodingLoop(options = {}) {
  if (state.liveRun?.status === "running") return;

  const project = missionSelectedProject(state.snapshot);
  if (!project) {
    const message = "Choose a local project folder first. Codingape Office will not scan the full disk by default.";
    setControlStatus(message);
    setLiveRunStatus("failed", "", message);
    return;
  }

  const missionTitle = options.title || missionInputTitle(project);
  if (options.mode && elements.missionModeSelect) elements.missionModeSelect.value = options.mode;
  const mode = selectedMissionMode();
  const modeLabel = missionModeLabel(mode);
  state.selectedId = project.id;
  state.selectionLocked = true;
  state.selectedEventId = null;
  state.taskInsight = null;
  setControlStatus(`编程猿正在接单 · ${modeLabel}`);
  setLiveRunStatus("running", `编程猿正在执行：${missionTitle} · ${modeLabel}`, "", {
    mode,
    projectId: project.id,
    runId: ""
  });
  if (elements.latestEvidenceStatus) elements.latestEvidenceStatus.textContent = "编程猿正在工作";
  if (elements.latestEvidenceSummary) {
    elements.latestEvidenceSummary.textContent = `${missionTitle} · ${modeLabel}`;
  }
  try {
    const result = await postJson(`/api/projects/${encodeURIComponent(project.id)}/coding-loop`, {
      mode,
      title: missionTitle,
      safeFirstOrder: Boolean(options.safeFirstOrder),
      patchCandidates: Array.isArray(options.patchCandidates) ? options.patchCandidates : []
    });
    const resultMode = result.mode || mode;
    const hasApplyGate = Boolean(result.applyRun);
    const verificationStatus = result.verification ? verificationStatusFromSummary(result.verification) : "not_run";
    const finalStatus = closedLoopResultStatus(resultMode, result, verificationStatus);
    const insight = codingLoopResultInsight(resultMode, result, verificationStatus);
    state.inspectorTab = insight.context;
    state.taskInsight = {
      context: insight.context,
      taskId: result.task?.id,
      title: insight.title,
      status: finalStatus,
      html: insight.html
    };
    state.inspectorOpen = true;
    renderTaskInsight();
    renderInspectorTabs();
    if (elements.latestEvidenceStatus) {
      elements.latestEvidenceStatus.textContent = finalStatus;
    }
    if (elements.latestEvidenceSummary) {
      elements.latestEvidenceSummary.textContent = latestEvidenceSummaryForMode(resultMode, hasApplyGate);
    }
    setControlStatus(finalStatus);
    await fetchStatus();
    setLiveRunStatus("completed", `${modeLabel}已完成 · ${latestEvidenceSummaryForMode(resultMode, hasApplyGate)}`, "", {
      mode: resultMode,
      projectId: result.task?.projectId || project.id,
      runId: result.task?.id || ""
    });
    if (elements.missionInput) elements.missionInput.value = "";
    window.setTimeout(() => {
      if (state.liveRun?.status === "completed") {
        setLiveRunStatus("idle");
        render();
      }
    }, 4500);
  } catch (error) {
    const message = demoRunErrorMessage(error);
    setControlStatus(message);
    setLiveRunStatus("failed", "", message);
  }
}

async function runFirstOrder() {
  if (elements.missionModeSelect) elements.missionModeSelect.value = "sandbox_patch";
  if (elements.missionInput) elements.missionInput.value = FIRST_ORDER_TITLE;
  setControlStatus("Preparing the first-task safety loop...");
  await runCodingLoop({
    mode: "sandbox_patch",
    title: FIRST_ORDER_TITLE,
    safeFirstOrder: true
  });
  revealPilotFeedbackPanel("The first-task safety loop finished. You can export the pilot feedback JSON.");
}

async function viewDossier() {
  setControlStatus("正在打开档案...");
  try {
    const result = await fetchJson("/api/readiness-dossier");
    const dossier = result.dossier || result;
    state.inspectorTab = "evidence";
    state.taskInsight = {
      context: "evidence",
      title: "自治就绪档案",
      status: `${dossier.score || 0}/100`,
      html: dossierInsightHtml(dossier)
    };
    setControlStatus("档案已打开");
    renderTaskInsight();
  } catch (error) {
    setControlStatus(uiErrorMessage(error));
  }
}

async function generateSupportBundle() {
  if (!elements.generateSupportBundleButton) return;
  elements.generateSupportBundleButton.disabled = true;
  elements.generateSupportBundleButton.textContent = "生成中";
  setControlStatus("正在生成运营支持包...");
  if (elements.supportBundleStatus) elements.supportBundleStatus.textContent = "正在收集脱敏运行状态。";

  try {
    const result = await postJson("/api/support-bundle", {}, {
      headers: {
        "X-Codex-Office-Local": "support-bundle"
      }
    });
    const bundle = result.bundle || {};
    const bundlePath = bundle.bundlePath || "data/support-bundles";
    if (elements.supportBundleStatus) {
      elements.supportBundleStatus.textContent = `已生成：${bundlePath}`;
    }
    setControlStatus(`支持包已生成 · ${bundlePath}`);
    await fetchStatus();
  } catch (error) {
    const message = uiErrorMessage(error, "支持包生成失败");
    if (elements.supportBundleStatus) elements.supportBundleStatus.textContent = message;
    setControlStatus(message);
  } finally {
    elements.generateSupportBundleButton.disabled = false;
    elements.generateSupportBundleButton.textContent = "生成支持包";
  }
}

async function testAiwcHealth() {
  if (!elements.testAiwcHealthButton) return;
  elements.testAiwcHealthButton.disabled = true;
  elements.testAiwcHealthButton.textContent = "测试中";
  setControlStatus("正在测试 AIWC 连接...");

  try {
    const result = await fetchJson("/api/aiwc/health-check");
    const aiwc = result.aiwc || {};
    if (elements.aiwcHealthDetail) {
      elements.aiwcHealthDetail.textContent = zhText(aiwc.detail || (aiwc.ok ? "AIWC 连接成功。" : "AIWC 连接未通过。"));
    }
    setControlStatus(aiwc.ok ? "AIWC 连接成功" : "AIWC 仍是 warning，不阻断本地 beta");
    await fetchStatus();
  } catch (error) {
    const message = uiErrorMessage(error, "AIWC 测试失败");
    if (elements.aiwcHealthDetail) elements.aiwcHealthDetail.textContent = message;
    setControlStatus(message);
  } finally {
    elements.testAiwcHealthButton.disabled = false;
    elements.testAiwcHealthButton.textContent = "测试 AIWC 连接";
  }
}

async function openSupportBundleDirectory() {
  if (!elements.openSupportBundleDirectoryButton) return;
  elements.openSupportBundleDirectoryButton.disabled = true;
  elements.openSupportBundleDirectoryButton.textContent = "打开中";
  try {
    const result = await postJson("/api/support-bundle/open-directory", {}, {
      headers: {
        "X-Codex-Office-Local": "support-bundle-open"
      }
    });
    setControlStatus(result.ok ? "支持包目录已打开" : "无法打开支持包目录");
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "打开支持包目录失败"));
  } finally {
    elements.openSupportBundleDirectoryButton.disabled = false;
    elements.openSupportBundleDirectoryButton.textContent = "打开支持包目录";
  }
}

async function copyDiagnosticSummary() {
  const summary = state.snapshot?.supportCenter?.diagnosticSummary || "Codingape Office diagnostic summary is not available yet.";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
    await navigator.clipboard.writeText(summary);
    setControlStatus("诊断摘要已复制");
  } catch {
    setControlStatus("诊断摘要已显示，可手动复制");
  }
}

async function copyRestartHint() {
  const hint = state.snapshot?.supportCenter?.restartHint || elements.restartHintText?.textContent || "";
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
    await navigator.clipboard.writeText(hint);
    setControlStatus("本地服务重启提示已复制");
  } catch {
    setControlStatus("重启提示已显示，可手动复制");
  }
}

async function decideTaskHumanGate(taskId, status) {
  setControlStatus(status === "approved" ? "正在批准..." : "正在要求返工...");
  try {
    const result = await postJson(`/api/tasks/${encodeURIComponent(taskId)}/human-gate`, {
      status,
      note: status === "approved"
        ? "人工已批准经过验证的编程猿闭环结果。"
        : "人工要求返工，结果暂不能视为就绪。"
    });
    state.inspectorTab = "gate";
    state.taskInsight = {
      context: "gate",
      taskId,
      title: "人工闸门",
      status: humanGateStatusLabel(result.humanGate?.status),
      html: `${humanGateInsightHtml(result.task, result.humanGate)}`
    };
    setControlStatus(humanGateStatusLabel(result.humanGate?.status));
    await fetchStatus();
  } catch (error) {
    setControlStatus(uiErrorMessage(error, "闸门失败"));
  }
}

function connectEvents() {
  if (!("EventSource" in window)) return;
  const source = new EventSource("/events");
  source.addEventListener("status", (event) => {
    state.snapshot = JSON.parse(event.data);
    syncLiveRunFromSnapshot(state.snapshot);
    if (!state.selectedId) {
      state.selectedId = preferredProject(state.snapshot)?.id || null;
    }
    render();
  });
  source.addEventListener("error", () => {
    source.close();
    setTimeout(connectEvents, 5000);
  });
}

function attachLocalOfficeHandlers() {
  elements.refreshButton.addEventListener("click", fetchStatus);
  elements.newMissionButton.addEventListener("click", runCodingLoop);
  elements.runFirstOrderButton?.addEventListener("click", runFirstOrder);
  elements.onboardingChooseProjectButton?.addEventListener("click", chooseProjectFolder);
  elements.onboardingRunSelfCheckButton?.addEventListener("click", fetchStatus);
  elements.onboardingFirstOrderButton?.addEventListener("click", runFirstOrder);
  elements.onboardingEnterOfficeButton?.addEventListener("click", () => {
    elements.firstRunOnboarding.hidden = true;
    document.body.classList.remove("is-onboarding");
    setControlStatus("已进入 Office");
  });
  attachInspectorShellHandlers();
  elements.missionComposer?.addEventListener("submit", (event) => {
    event.preventDefault();
    runCodingLoop();
  });
  elements.missionProjectSelect?.addEventListener("change", async () => {
    state.selectedId = elements.missionProjectSelect.value || state.selectedId;
    state.selectionLocked = true;
    state.selectedEventId = null;
    const project = currentProject() || state.snapshot?.projects?.find((candidate) => candidate.id === state.selectedId);
    try {
      if (project?.path) {
        await saveLocalProjectRoot({ path: project.path, name: project.name, quiet: true });
        setControlStatus("目标 project root 已保存");
      } else {
        setControlStatus("目标项目已切换");
        render();
      }
    } catch (error) {
      setControlStatus(uiErrorMessage(error, "project root 保存失败"));
      render();
    }
  });
  elements.projectRootForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveLocalProjectRoot({
        path: elements.projectRootInput?.value || "",
        name: projectNameFromPath(elements.projectRootInput?.value || "")
      });
    } catch (error) {
      setControlStatus(uiErrorMessage(error, "project root 保存失败"));
      if (elements.projectRootStatus) elements.projectRootStatus.textContent = uiErrorMessage(error);
    }
  });
  elements.chooseProjectFolderButton?.addEventListener("click", chooseProjectFolder);
  elements.missionModeSelect?.addEventListener("change", () => {
    setControlStatus(`任务模式：${missionModeLabel(selectedMissionMode())}`);
    renderMissionComposer(state.snapshot);
    renderLiveRunState();
  });
  elements.queueReviewButton.addEventListener("click", () => queueSelectedTask("review"));
  elements.markBlockedButton.addEventListener("click", () => queueSelectedTask("blocked"));
  elements.runCodingLoopButton.addEventListener("click", runCodingLoop);
  elements.runCodingLoopHeroButton.addEventListener("click", runCodingLoop);
  elements.viewDossierButton.addEventListener("click", viewDossier);
  elements.testAiwcHealthButton?.addEventListener("click", testAiwcHealth);
  elements.generateSupportBundleButton?.addEventListener("click", generateSupportBundle);
  elements.openSupportBundleDirectoryButton?.addEventListener("click", openSupportBundleDirectory);
  elements.copyDiagnosticSummaryButton?.addEventListener("click", copyDiagnosticSummary);
  elements.copyRestartHintButton?.addEventListener("click", copyRestartHint);
  elements.companyShareButton?.addEventListener("click", copyCompanyShareReport);
  elements.testLocalJudgeButton?.addEventListener("click", testLocalJudgeConnection);
  elements.copyLocalJudgeCommandButton?.addEventListener("click", copyLocalJudgeCommand);
  elements.modelProviderForm?.addEventListener("submit", saveModelProviderSettings);
  elements.testModelProviderButton?.addEventListener("click", testModelProvider);
  elements.previewAiContextButton?.addEventListener("click", () => previewAiContextForFirstRealOrder());
  elements.runFirstRealOrderButton?.addEventListener("click", runFirstRealOrder);
  elements.pilotFeedbackForm?.addEventListener("submit", submitPilotFeedback);
  elements.approvalList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-approval-action]");
    if (!button) return;
    const approval = button.closest("[data-approval-id]");
    if (!approval) return;
    updateApproval(approval.dataset.approvalId, button.dataset.approvalAction);
  });
  elements.taskQueueList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-task-action]");
    if (!button) return;
    const task = button.closest("[data-task-id]");
    if (!task) return;
    const action = button.dataset.taskAction;
    if (action === "run") runTaskEvidence(task.dataset.taskId);
    if (action === "verify") runTaskVerification(task.dataset.taskId);
    if (action === "view") viewTaskEvidence(task.dataset.taskId);
    if (action === "plan") draftTaskPlan(task.dataset.taskId);
    if (action === "patch") runTaskPatch(task.dataset.taskId);
    if (action === "apply") runTaskApplyGate(task.dataset.taskId);
  });
  elements.taskInsightBody.addEventListener("click", (event) => {
    const gateNavButton = event.target.closest("[data-gate-nav]");
    if (gateNavButton) {
      navigateGateSurface(gateNavButton.dataset.gateNav, gateNavButton.dataset.taskId);
      return;
    }

    const evidenceButton = event.target.closest("[data-evidence-action]");
    if (evidenceButton?.dataset.evidenceAction === "open") {
      viewTaskEvidence(evidenceButton.dataset.taskId, { focus: "diff" });
      return;
    }

    const rollbackButton = event.target.closest("[data-rollback-action]");
    if (rollbackButton?.dataset.rollbackAction === "restore") {
      runTaskRollback(rollbackButton.dataset.taskId);
      return;
    }

    const applyButton = event.target.closest("[data-apply-gate-action]");
    if (applyButton?.dataset.applyGateAction === "check") {
      runTaskApplyGate(applyButton.dataset.taskId);
      return;
    }
    if (applyButton?.dataset.applyGateAction === "apply") {
      runTaskApplyGate(applyButton.dataset.taskId, { applyApproved: true });
      return;
    }

    const reviewButton = event.target.closest("[data-review-action]");
    if (reviewButton) {
      const action = reviewButton.dataset.reviewAction;
      const taskId = reviewButton.dataset.taskId;
      if (action === "back_gate") {
        state.inspectorTab = "gate";
        state.inspectorOpen = true;
        setControlStatus("闸门已打开");
        renderGateInspector(state.snapshot, currentProject());
        renderInspectorTabs();
        return;
      }
      if (action === "keep_blocked") {
        state.inspectorTab = "gate";
        state.inspectorOpen = true;
        setControlStatus("写入保持阻断");
        renderGateInspector(state.snapshot, currentProject());
        renderInspectorTabs();
        return;
      }
      if (action === "request_rework" && taskId) {
        decideTaskHumanGate(taskId, "changes_requested");
        return;
      }
    }

    const button = event.target.closest("[data-gate-action]");
    if (!button) return;
    if (button.dataset.gateAction === "keep_blocked") {
      setControlStatus("写入保持阻断");
      state.inspectorTab = "gate";
      renderGateInspector(state.snapshot, currentProject());
      renderInspectorTabs();
      return;
    }
    decideTaskHumanGate(button.dataset.taskId, button.dataset.gateAction);
  });
  elements.taskInsightBody.addEventListener("input", () => syncApplyGateControls(elements.taskInsightBody));
  elements.taskInsightBody.addEventListener("change", () => syncApplyGateControls(elements.taskInsightBody));
  elements.gateInsightBody?.addEventListener("click", (event) => {
    const gateButton = event.target.closest("[data-gate-action]");
    if (gateButton) {
      if (gateButton.dataset.gateAction === "keep_blocked") {
        setControlStatus("写入保持阻断");
        state.inspectorTab = "gate";
        renderInspectorTabs();
        return;
      }
      decideTaskHumanGate(gateButton.dataset.taskId, gateButton.dataset.gateAction);
      return;
    }

    const gateNavButton = event.target.closest("[data-gate-nav]");
    if (gateNavButton) {
      navigateGateSurface(gateNavButton.dataset.gateNav, gateNavButton.dataset.taskId);
      return;
    }

    const rollbackButton = event.target.closest("[data-rollback-action]");
    if (rollbackButton?.dataset.rollbackAction === "restore") {
      runTaskRollback(rollbackButton.dataset.taskId);
      return;
    }

    const applyButton = event.target.closest("[data-apply-gate-action]");
    if (applyButton?.dataset.applyGateAction === "check") {
      runTaskApplyGate(applyButton.dataset.taskId);
    }
    if (applyButton?.dataset.applyGateAction === "apply") {
      runTaskApplyGate(applyButton.dataset.taskId, { applyApproved: true });
    }
  });
  elements.gateInsightBody?.addEventListener("input", () => syncApplyGateControls(elements.gateInsightBody));
  elements.gateInsightBody?.addEventListener("change", () => syncApplyGateControls(elements.gateInsightBody));

  document.querySelectorAll(".filter-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      render();
    });
  });

  document.querySelectorAll("[data-inspector-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.inspectorTab = button.dataset.inspectorTab;
      state.inspectorOpen = true;
      renderInspectorTabs();
    });
  });
}

async function bootAppMode() {
  if (APP_MODE === AppMode.publicHome) {
    renderPublicHome();
    return;
  }

  if (APP_MODE === AppMode.publicBeta) {
    renderPublicBeta();
    return;
  }

  if (APP_MODE === AppMode.publicDemo) {
    renderPublicDemo();
    attachDemoReplayHandlers();
    attachInspectorShellHandlers();
    window.addEventListener("resize", requestDeckDraw);
    return;
  }

  if (elements.publicHome) elements.publicHome.hidden = true;
  if (elements.betaPage) elements.betaPage.hidden = true;
  if (elements.demoModeBanner) elements.demoModeBanner.hidden = true;
  attachLocalOfficeHandlers();
  await fetchStatus();
  connectEvents();
  window.addEventListener("resize", requestDeckDraw);
}

await bootAppMode();
