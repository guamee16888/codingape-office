import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), "utf8");
}

test("control-room stylesheet loads after the legacy base stylesheet", async () => {
  const html = await readProjectFile("public/index.html");

  const baseIndex = html.indexOf('href="/styles.css"');
  const controlRoomIndex = html.indexOf('href="/control-room.css"');

  assert.notEqual(baseIndex, -1);
  assert.notEqual(controlRoomIndex, -1);
  assert.ok(controlRoomIndex > baseIndex);
});

test("company report share button copies English report text", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(html, /id="companyShareButton"[\s\S]*?>Copy Report Copy<\/button>/);
  assert.match(app, /async function copyCompanyShareReport\(\)/);
  assert.match(app, /navigator\.clipboard\?\.writeText/);
  assert.match(app, /await navigator\.clipboard\.writeText\(card\.shareText\)/);
  assert.match(app, /setControlStatus\("Report copy copied"\)/);
  assert.match(app, /setControlStatus\("Share card is highlighted; you can copy the report text manually"\)/);
  assert.match(app, /elements\.companyShareButton\?\.addEventListener\("click", copyCompanyShareReport\)/);
  assert.match(css, /\.company-share-card\.is-copy-ready\s*{[^}]*animation:\s*companyShareCopyPulse 1\.1s ease-in-out 2 !important/s);
});

test("coding loop buttons show live progress and block duplicate runs", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(html, /id="missionComposer" class="mission-composer"/);
  assert.match(html, /id="missionProjectSelect"[\s\S]*?aria-label="Target project"/);
  assert.match(html, /id="missionModeSelect"[\s\S]*?aria-label="Mission mode"/);
  assert.match(html, /<option value="sandbox_patch">Full sandbox loop<\/option>/);
  assert.match(html, /<option value="verify">Review \+ verification<\/option>/);
  assert.match(html, /<option value="proposal">Plan only<\/option>/);
  assert.match(html, /<option value="review_only">Evidence only<\/option>/);
  assert.match(html, /id="missionInput"[\s\S]*?placeholder="Enter a task, for example: inspect project risk and draft an auditable patch proposal"/);
  assert.match(html, /id="assignMissionButton"[\s\S]*?>Assign to Codingape<\/button>/);
  assert.match(html, /<div class="command-progress" aria-label="Live run progress">/);
  assert.match(html, /id="commandProgressBar"/);
  assert.match(html, /id="commandProgressSteps"/);
  assert.match(html, /id="commandRunReceipt" class="command-run-receipt" data-status="idle"/);
  assert.match(app, /\[elements\.newMissionButton, "运行当前任务", "编程猿工作中"\]/);
  assert.match(app, /\[elements\.runCodingLoopButton, "Run Loop", "Loop running"\]/);
  assert.match(app, /\[elements\.runCodingLoopHeroButton, "Run Three-Worker Demo", "Three workers running"\]/);
  assert.match(app, /function missionInputTitle\(project\)/);
  assert.match(app, /function taskById\(taskId, snapshot = state\.snapshot\)/);
  assert.match(app, /function selectedMissionMode\(\)/);
  assert.match(app, /function missionModeActionLabel\(mode\)/);
  assert.match(app, /function missionModeRunningLabel\(mode\)/);
  assert.match(app, /function missionSelectedProject\(snapshot = state\.snapshot\)/);
  assert.match(app, /function renderMissionComposer\(snapshot\)/);
  assert.match(app, /function missionModeBriefHtml\(mode\)/);
  assert.match(app, /function codingLoopResultInsight\(mode, result, verificationStatus\)/);
  assert.match(app, /function missionFlowNodeCaption\(task, node, status, isFocus = false, isReplayFocus = false\)/);
  assert.match(app, /review_only:[\s\S]*?verification:\s*"本次不跑"[\s\S]*?apply:\s*"本次不写"/);
  assert.match(app, /proposal:[\s\S]*?verification:\s*"本次不跑"[\s\S]*?apply:\s*"本次不写"/);
  assert.match(app, /verify:[\s\S]*?apply:\s*"本次不写"/);
  assert.match(app, /<span>这次不会做<\/span>/);
  assert.match(app, /不修改项目文件/);
  assert.match(app, /elements\.missionComposer\?\.addEventListener\("submit"/);
  assert.match(app, /elements\.missionProjectSelect\?\.addEventListener\("change"/);
  assert.match(app, /elements\.missionModeSelect\?\.addEventListener\("change"/);
  assert.match(app, /elements\.assignMissionButton\.textContent = missionModeActionLabel\(selectedMissionMode\(\)\)/);
  assert.match(app, /\[elements\.assignMissionButton, missionModeActionLabel\(selectedMode\), missionModeRunningLabel\(selectedMode\)\]/);
  assert.match(app, /const project = missionSelectedProject\(state\.snapshot\)/);
  assert.match(app, /const mode = selectedMissionMode\(\)/);
  assert.match(app, /mode,\s*[\r\n]+\s*title: missionTitle/);
  assert.match(app, /function renderCommandProgress\(task, director = null\)/);
  assert.match(app, /function setCommandRunReceipt\(status, message\)/);
  assert.match(app, /function completedRunReceiptMessage\(live = \{\}, task = null\)/);
  assert.match(app, /真实运行已接入 · \$\{formatRunId\(task\.id\)\} · \$\{runPhaseLabel\(phase\)\}/);
  assert.match(app, /Submitted to backend · waiting for real events/);
  assert.match(app, /Evidence Pack refreshed; this run did not generate a patch or enter Apply Gate/);
  assert.match(app, /Evidence, sandbox patch, and Apply Gate refreshed/);
  assert.match(app, /COMPACT_MISSION_FLOW_NODES/);
  assert.match(app, /elements\.commandProgressBar\.style\.width = `\$\{Math\.max\(0, Math\.min\(100, progress\)\)\}%`/);
  assert.match(app, /class="status-\$\{escapeHtml\(status\)\}\$\{active\}"/);
  assert.match(app, /button\.disabled = isRunning/);
  assert.match(app, /button\.setAttribute\("aria-busy", isRunning \? "true" : "false"\)/);
  assert.match(app, /elements\.commandPhase\) elements\.commandPhase\.textContent = `Phase: \$\{runPhaseLabel\(phase\)\}`/);
  assert.match(app, /elements\.commandRun\) elements\.commandRun\.textContent = `Run: \$\{formatRunId\(task\.id\)\}`/);
  assert.match(css, /#newMissionButton\.is-running,[\s\S]*?#runCodingLoopHeroButton\.is-running\s*{[^}]*animation:\s*liveRunButtonPulse 1\.4s ease-in-out infinite !important/s);
  assert.match(css, /v18: mission composer/);
  assert.match(css, /\.top-command-bar\s*{[^}]*height:\s*auto !important/s);
  assert.match(css, /\.mission-composer\s*{[^}]*grid-template-columns:\s*minmax\(180px, 1fr\) minmax\(160px, 0\.8fr\) auto !important/s);
  assert.match(css, /\.mission-composer #missionInput\s*{[^}]*grid-column:\s*1 \/ -1 !important/s);
  assert.match(css, /\.mission-composer select,[\s\S]*?\.mission-composer input\s*{[^}]*min-height:\s*38px !important/s);
  assert.match(css, /v19: mission mode brief/);
  assert.match(css, /\.mission-mode-brief\s*{[^}]*border:\s*1px solid rgba\(48, 224, 198, 0\.2\) !important/s);
  assert.match(css, /\.deck-viewport\[data-live-mode="review_only"\] ~ \.mission-flow-panel \.mission-flow-node:nth-child\(n\+3\)/);
  assert.match(css, /\.command-progress-track span\s*{[^}]*transition:\s*width 280ms ease !important/s);
  assert.match(css, /\.command-progress-steps\s*{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.command-run-receipt\s*{[^}]*text-overflow:\s*ellipsis !important/s);
  assert.match(css, /\.command-run-receipt\[data-status="running"\]\s*{[^}]*border-color:\s*rgba\(48, 224, 198, 0\.34\) !important/s);
  assert.match(css, /\.command-run-receipt\[data-status="completed"\]\s*{[^}]*border-color:\s*rgba\(124, 255, 155, 0\.32\) !important/s);
});

test("task queue actions stay honest about the selected run mode", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /const canVerifyMode = mode === "verify" \|\| mode === "sandbox_patch"/);
  assert.match(app, /const canPatchMode = mode === "sandbox_patch"/);
  assert.match(app, /const patchLabel = canPatchMode \? "沙盒补丁" : "本次不补丁"/);
  assert.match(app, /const applyLabel = canPatchMode \? "写入闸门" : "本次不写入"/);
  assert.match(app, /const verifyLabel = canVerifyMode \? "验证" : "本次不验证"/);
  assert.match(app, /当前模式不运行验证；请切到“审查 \+ 验证”或“完整沙盒闭环”/);
  assert.match(app, /当前模式不生成沙盒补丁；请切到“完整沙盒闭环”/);
  assert.match(app, /当前模式不进入写入闸门；请切到“完整沙盒闭环”/);
});

test("latest closed-loop evidence stays the default stage focus until the operator clicks elsewhere", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /const latestEvidenceTaskId = snapshot\?\.launch\?\.latestEvidence\?\.taskId/);
  assert.match(app, /const latestEvidenceTask = latestEvidenceTaskId[\s\S]*?tasks\.find\(\(task\) => task\.id === latestEvidenceTaskId\)/);
  assert.match(app, /\.sort\(\(a, b\) => taskEventTime\(b\) - taskEventTime\(a\)\)\[0\]/);
  assert.match(app, /state\.selectionLocked = true/);
  assert.match(app, /if \(!state\.selectionLocked \|\| !state\.selectedId \|\| !selectedExists\)/);
  assert.match(app, /state\.selectionLocked = false/);
});

test("latest closed-loop run is visibly marked in projects and the replay timeline", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function latestClosedLoopTaskId\(snapshot = state\.snapshot\)/);
  assert.match(app, /function latestClosedLoopCandidateTask\(snapshot = state\.snapshot\)/);
  assert.match(app, /taskHasEvidencePath\(task, "data\/patch-applies\/"\)/);
  assert.match(app, /return snapshot\?\.launch\?\.latestEvidence\?\.taskId \|\| latestClosedLoopCandidateTask\(snapshot\)\?\.id \|\| ""/);
  assert.match(app, /function isLatestClosedLoopProject\(project, snapshot = state\.snapshot\)/);
  assert.match(app, /function isLatestClosedLoopEvent\(event, snapshot = state\.snapshot\)/);
  assert.match(app, /taskIdFromTimelineEvent\(event\) === taskId \|\| eventEvidenceRefs\(event\)\.includes\(taskId\)/);
  assert.match(app, /class="feed-event risk-\$\{escapeHtml\(event\.risk \|\| "low"\)\}\$\{selected\}\$\{latestClosedLoop\}"/);
  assert.match(app, /<mark class="latest-loop-badge">最新闭环<\/mark>/);
  assert.match(app, /class="desk-card accent-\$\{escapeHtml\(project\.accent\)\} status-\$\{escapeHtml\(project\.status\.key\)\}\$\{selected\}\$\{hidden\}\$\{latestClosedLoop\}"/);
  assert.match(css, /v16: latest closed-loop marker/);
  assert.match(css, /\.latest-loop-badge\s*{[^}]*color:\s*#cffff7 !important/s);
  assert.match(css, /\.desk-card\.is-latest-closed-loop\s*{[^}]*border-color:\s*rgba\(48, 224, 198, 0\.34\) !important/s);
  assert.match(css, /\.workfeed-panel \.feed-event\.is-latest-closed-loop\s*{[^}]*rgba\(48, 224, 198, 0\.1\)/s);
});

test("stage latest event follows the selected mission instead of global workspace noise", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /function missionRibbonEvent\(snapshot, project = currentProject\(\) \|\| preferredProject\(snapshot\)\)/);
  assert.match(app, /const focusTaskId = isLatestClosedLoopProject\(project, snapshot\) \? latestClosedTaskId : latestTask\?\.id/);
  assert.match(app, /events\.find\(\(event\) => focusTaskId && \(taskIdFromTimelineEvent\(event\) === focusTaskId \|\| eventEvidenceRefs\(event\)\.includes\(focusTaskId\)\)\)/);
  assert.match(app, /const latestEvent = missionRibbonEvent\(snapshot, project\)/);
});

test("control-room readability guardrail keeps dense control surfaces legible", async () => {
  const css = await readProjectFile("public/control-room.css");

  assert.match(css, /v9: readability guardrail/);
  assert.match(css, /--text-primary:\s*#f8fbff/);
  assert.match(css, /--text-secondary:\s*#d8e2ee/);
  assert.match(css, /--text-muted:\s*#b8c4d2/);
  assert.match(css, /\.worker-grid\s*{[^}]*grid-template-columns:\s*1fr !important/s);
  assert.match(css, /\.mascot-panel\s*{[^}]*min-height:\s*clamp\(168px, 22vh, 206px\) !important/s);
  assert.match(css, /\.pulse-panel\s*{[^}]*min-height:\s*92px !important/s);
  assert.match(css, /\.worker-card\s*{[^}]*max-height:\s*88px !important/s);
  assert.match(css, /\.worker-copy em\s*{[^}]*display:\s*-webkit-box !important/s);
  assert.match(css, /\.gate-proof-cards\s*{[^}]*grid-template-columns:\s*1fr !important/s);
  assert.match(css, /\.mission-inspector-tabs button\s*{[^}]*font-size:\s*0\.8rem !important/s);
  assert.match(css, /\.feed-event strong[\s\S]*font-size:\s*0\.96rem !important/);
});

test("evidence diff and gate surfaces stay readable in the floating inspector", async () => {
  const css = await readProjectFile("public/control-room.css");

  assert.match(css, /v10: evidence \/ diff \/ gate surfaces/);
  assert.match(css, /\.detail-panel\s*{[^}]*width:\s*min\(540px, calc\(100vw - 32px\)\) !important/s);
  assert.match(css, /\.detail-panel\s*{[^}]*visibility:\s*hidden !important/s);
  assert.match(css, /\.detail-panel\.is-open\s*{[^}]*visibility:\s*visible !important/s);
  assert.match(css, /\.app-shell:has\(\.detail-panel\.is-open\)::after\s*{/);
  assert.match(css, /\.evidence-pack-hero,[\s\S]*?\.gate-contract-grid\s*{[^}]*grid-template-columns:\s*1fr !important/s);
  assert.match(css, /\.evidence-pack-hero,[\s\S]*?\.diff-dossier-body,[\s\S]*?grid-template-columns:\s*1fr !important/s);
  assert.match(css, /\.gate-action-dock\s*{[^}]*grid-template-columns:\s*1fr 1fr !important/s);
  assert.match(css, /\.diff-line\s*{[^}]*font-size:\s*0\.84rem !important/s);
  assert.match(css, /\.task-insight-body pre,[\s\S]*?\.patch-run-card pre\.diff-preview\s*{[^}]*font-size:\s*0\.84rem !important/s);
  assert.match(css, /\.audit-pack-footer button,[\s\S]*?\.gate-action-dock button\s*{[^}]*min-height:\s*44px !important/s);
});

test("operator console is guarded to render English-first copy", async () => {
  const app = await readProjectFile("public/app.js");
  const html = await readProjectFile("public/index.html");
  const server = await readProjectFile("server.js");

  assert.match(app, /function enforceEnglishSurface\(root = document\.body\)/);
  assert.match(app, /new MutationObserver\(scheduleEnglishSurfaceGuard\)/);
  assert.match(app, /"Codingape"/);
  assert.match(server, /title:\s*`Task queued: \$\{task\.title\}`/);
  assert.match(server, /title:\s*`Codingape collected evidence: \$\{task\.title\}`/);
  assert.match(server, /title:\s*`Judgeape review ready: \$\{task\.title\}`/);
  assert.match(server, /title:\s*`\$\{verification\.ok \? "Verification passed" : "Verification failed"\}: \$\{task\.title\}`/);
  assert.match(server, /title:\s*`Opsape completed Apply Gate check: \$\{task\.title\}`/);
  assert.match(server, /function serverErrorMessageZh\(message = ""\)/);
  assert.match(server, /Task not found\/i\.test\(text\)\) return "Task not found"/);
  assert.match(server, /Project not found\/i\.test\(text\)\) return "Project not found"/);
  assert.match(server, /Method not allowed\/i\.test\(text\)\) return "Method not allowed"/);
  assert.match(server, /JSON\.stringify\(\{ error: serverErrorMessageZh\(message\) \}/);
  assert.match(app, /throw new Error\(body\.error \|\| `Request failed: \$\{response\.status\}`\)/);
  assert.match(app, /function uiErrorMessage\(error, fallback = "Operation failed"\)/);
  assert.match(html, /Idle: after a run starts, this shows the real run ID, phase, and gate status/);
  assert.doesNotMatch(html, /[\p{Script=Han}]/u);
});

test("diff review entry points open the evidence inspector at the diff section", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /function scrollInspectorToEvidenceFocus\(focus = "top"\)/);
  assert.match(app, /focus === "diff"[\s\S]*?querySelector\("\.diff-dossier"\)/);
  assert.match(app, /viewTaskEvidence\(evidenceButton\.dataset\.taskId, \{ focus: "diff" \}\)/);
  assert.match(app, /navigateGateSurface\(gateNavButton\.dataset\.gateNav, gateNavButton\.dataset\.taskId\)/);
  assert.match(app, /viewTaskEvidence\(taskId, \{ focus: "diff" \}\)/);
});

test("main command deck keeps the 3d room dominant and the mission flow visible", async () => {
  const css = await readProjectFile("public/control-room.css");

  assert.match(css, /#threeDeck\s*{[^}]*brightness\(0\.66\) !important/s);
  assert.match(css, /\.office-stage \.deck-viewport\s*{[^}]*min-height:\s*clamp\(360px, calc\(100vh - 350px\), 520px\) !important/s);
  assert.match(css, /\.core-station\s*{[^}]*max-height:\s*112px !important/s);
  assert.match(css, /\.station-telemetry\s*{[^}]*display:\s*none !important/s);
  assert.match(css, /\.mission-flow-rail\s*{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.mission-flow-node\s*{[^}]*min-height:\s*58px !important/s);
});

test("gate inspector leads with blocker context and keeps writes human gated", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /<div class="gate-blocker-hero">/);
  assert.match(app, /<span>当前卡点<\/span>/);
  assert.match(app, /<span>不会自动发生<\/span>/);
  assert.match(app, /<strong>不会修改项目文件<\/strong>/);
  assert.match(app, /不会部署、重启、调用外部副作用接口、触发钱包\/交易或生产写入/);
  assert.match(app, /这里是最后一道门：确认前不会改项目文件/);
  assert.match(css, /\.gate-blocker-hero\s*{[^}]*border:\s*1px solid rgba\(255, 180, 84, 0\.25\) !important/s);
  assert.match(css, /\.gate-action-dock\s*{[^}]*position:\s*static !important/s);
});

test("Stage-9 first-order screen reduces visual conversion friction", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");
  const director = await readProjectFile("public/mission-director.js");
  const audit = await readProjectFile("docs/3d/STAGE9_VISUAL_CONVERSION_AUDIT.md");

  assert.match(app, /<span>运行 <strong>\$\{escapeHtml\(formatRunId\(model\.runId\)\)\}<\/strong><\/span>/);
  assert.match(app, /<span>闸门 <strong>\$\{escapeHtml\(zhStatus\(model\.gateStatus\)\)\}<\/strong><\/span>/);
  assert.match(app, /elements\.stageTitle\.textContent = zhText\(director\.roomTitle \|\| director\.taskTitle/);
  assert.doesNotMatch(app, /<span>Light <strong>/);
  assert.match(css, /v24: Stage-9 external-tester conversion pass/);
  assert.match(css, /body\[data-app-mode="local_office"\] \.active-mission-strip > h2\s*{[^}]*display:\s*block !important/s);
  assert.match(css, /\.station-meta\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.mission-flow-rail\.is-premium\s*{[^}]*grid-template-columns:\s*repeat\(10, minmax\(84px, 1fr\)\) !important/s);
  assert.match(director, /Waiting for write confirmation · No auto-write/);
  assert.match(director, /Ready to inspect; nothing written yet/);
  assert.match(director, /Project files have not changed; no write before the confirmation phrase passes/);
  assert.match(audit, /No new business loop behavior/);
});

test("gate action hierarchy keeps safe review actions primary", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /class="gate-primary-action"[\s\S]*?<span>查看差异<\/span>[\s\S]*?<\/button>/);
  assert.match(app, /class="gate-rework-action"[\s\S]*?<span>要求返工<\/span>[\s\S]*?<\/button>/);
  assert.match(app, /class="gate-safe-action"[\s\S]*?<span>保持阻断<\/span>[\s\S]*?<\/button>/);
  assert.match(app, /<div class="gate-decision-actions">/);
  assert.match(app, /写入闸门决策/);
  assert.match(app, /先看差异；不确定就保持阻断/);
  assert.match(app, /查看沙盒补丁和文件影响/);
  assert.match(app, /退回编程猿重新生成方案/);
  assert.match(app, /不做任何项目写入/);
  assert.match(app, /<div class="gate-preflight-action">/);
  assert.match(app, /<strong>写入闸门预检，不写项目文件<\/strong>/);
  assert.match(app, />运行预检<\/button>/);
  assert.doesNotMatch(app, /data-apply-gate-action="check"[\s\S]{0,160}运行写入闸门检查/);
  assert.match(css, /\.gate-decision-actions\s*{[^}]*border:\s*1px solid rgba\(255, 180, 84, 0\.2\) !important/s);
  assert.match(css, /\.detail-panel \.gate-decision-grid\s*{[^}]*grid-template-columns:\s*1fr !important/s);
  assert.match(css, /\.gate-action-dock \.gate-primary-action\s*{[^}]*grid-column:\s*1 \/ -1 !important/s);
  assert.match(css, /\.gate-action-dock button small\s*{[^}]*font-size:\s*0\.72rem !important/s);
  assert.match(css, /\.gate-preflight-action\s*{[^}]*border:\s*1px dashed rgba\(255, 255, 255, 0\.18\) !important/s);
});

test("proposal inspector exposes local Judge model review without implying auto writes", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function localJudgeReviewHtml\(proposal\)/);
  assert.match(app, /<h4>本地模型审查<\/h4>/);
  assert.match(app, /当前使用规则审查/);
  assert.match(app, /本地模型审查不会自动修改项目文件/);
  assert.match(css, /v17: local Judge猿 review/);
  assert.match(css, /\.local-judge-card\s*{[^}]*border:\s*1px solid rgba\(122, 167, 255, 0\.24\) !important/s);
});

test("mode-honest inspector hides gate controls outside the full sandbox loop", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function missionModeNextStepHtml\(mode, task = null\)/);
  assert.match(app, /function modeBoundaryGateHtml\(task\)/);
  assert.match(app, /当前不是完整沙盒闭环/);
  assert.match(app, /本次不进入写入/);
  assert.match(app, /missionModeFromTask\(task\) !== "sandbox_patch"/);
  assert.match(app, /proposalInsightHtml\(result\.proposal\)}\$\{missionModeNextStepHtml\(mode, result\.task\)\}/);
  assert.match(app, /verificationInsightHtml\(result\.verification\)}\$\{missionModeNextStepHtml\(mode, result\.task\)\}/);
  assert.match(css, /\.mode-boundary-card\s*{[^}]*border:\s*1px solid rgba\(122, 167, 255, 0\.24\) !important/s);
  assert.match(css, /\.mission-mode-next\s*,\s*\n\.mode-boundary-card/s);
});

test("mission flow focus copy respects task mode boundaries", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /const modeFocusCopy = \{/);
  assert.match(app, /审核猿本次保持待命/);
  assert.match(app, /方案模式不进入写入闸门/);
  assert.match(app, /验证模式不进入写入闸门/);
  assert.match(app, /const copy = modeFocusCopy\[mode\]\?\.\[nodeId\] \|\| focusCopy\[nodeId\] \|\| focusCopy\.task/);
});

test("full sandbox loop result includes a screenshot-ready audit war report", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function closedLoopWarReportHtml\(result = \{\}\)/);
  assert.match(app, /完整沙盒闭环战报/);
  assert.match(app, /项目文件未被自动修改/);
  assert.match(app, /查看证据与差异/);
  assert.match(app, /查看写入闸门/);
  assert.match(app, /\$\{missionModeBriefHtml\(mode\)\}\$\{closedLoopWarReportHtml\(result\)\}\$\{humanGateInsightHtml\(result\.task\)\}/);
  assert.match(css, /\.closed-loop-war-report\s*{[^}]*border:\s*1px solid rgba\(48, 224, 198, 0\.26\) !important/s);
  assert.match(css, /\.war-report-redline strong\s*{[^}]*color:\s*#ffe1a8 !important/s);
});

test("war report actions navigate directly to diff and gate surfaces", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /function navigateGateSurface\(action, taskId\)/);
  assert.match(app, /viewTaskEvidence\(taskId, \{ focus: "diff" \}\)/);
  assert.match(app, /viewTaskGateEvidence\(taskId, \{ focus: "gate" \}\)/);
  assert.match(app, /function scrollInspectorToGateFocus\(\)/);
  assert.match(app, /elements\.taskInsightBody\.addEventListener\("click", \(event\) => \{\s*const gateNavButton = event\.target\.closest\("\[data-gate-nav\]"\)/s);
});

test("top command bar exposes local Judge model health when configured", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /state\.snapshot\?\.localJudge/);
  assert.match(app, /审核猿模型：/);
  assert.match(app, /审核猿模型需重试/);
  assert.match(app, /本地模型：/);
  assert.match(app, /localJudgeStatusLabel\(localJudge\.latestStatus\)/);
});

test("operator console includes local model setup and connection test", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(html, /<article class="local-model-panel">/);
  assert.match(html, /id="testLocalJudgeButton"[\s\S]*?>Test Connection<\/button>/);
  assert.match(html, /id="copyLocalJudgeCommandButton"[\s\S]*?>Copy Launch Command<\/button>/);
  assert.match(app, /async function testLocalJudgeConnection\(\)/);
  assert.match(app, /apiFetch\("\/api\/local-judge\/status"\)/);
  assert.match(app, /async function copyLocalJudgeCommand\(\)/);
  assert.match(app, /CODEX_OFFICE_LOCAL_LLM_PROVIDER=/);
  assert.match(app, /elements\.testLocalJudgeButton\?\.addEventListener\("click", testLocalJudgeConnection\)/);
  assert.match(css, /\.local-model-panel\s*{[^}]*display:\s*grid !important/s);
  assert.match(css, /\.local-model-command\s*{[^}]*font-family:\s*"JetBrains Mono"/s);
});

test("operator console exposes service health for public launch reliability", async () => {
  const html = await readProjectFile("public/index.html");
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");
  const server = await readProjectFile("server.js");

  assert.match(server, /function buildServiceHealthSummary\(\)/);
  assert.match(server, /const PORT = Number\(process\.env\.PORT \|\| 4142\)/);
  assert.match(server, /PUBLIC_ENTRY_URL/);
  assert.match(server, /serviceHealth,\s*\n\s*operationalReadiness,\s*\n\s*companyReport/);
  assert.match(server, /Cloudflare tunnel/);
  assert.match(server, /Background daemon/);
  assert.match(html, /<article class="service-health-panel"/);
  assert.match(html, /Service Health/);
  assert.match(html, /id="serviceHealthList"/);
  assert.match(app, /function renderServiceHealthPanel\(snapshot\)/);
  assert.match(app, /Local service, public entry, Cloudflare tunnel, and daemon hosting/);
  assert.match(app, /serviceHealthCardTemplate/);
  assert.match(css, /\.service-health-panel\s*{[^}]*display:\s*grid !important/s);
  assert.match(css, /\.service-health-item\.tone-warning\s*{[^}]*rgba\(255, 180, 84, 0\.24\)/s);
});

test("gate inspector includes an operator decision brief before approval actions", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function gateOperatorDecisionHtml\(task\)/);
  assert.match(app, /<span>操作员审批结论<\/span>/);
  assert.match(app, /建议先查看差异；不确定就保持阻断/);
  assert.match(app, /<span>允许范围<\/span>/);
  assert.match(app, /<span>安全红线<\/span>/);
  assert.match(app, /<span>执行条件<\/span>/);
  assert.match(app, /<span>精确确认语<\/span>/);
  assert.match(app, /当前页面不会替你确认/);
  assert.match(app, /\$\{gateOperatorDecisionHtml\(task\)\}[\s\S]*?<div class="gate-command-center tone-\$\{escapeHtml\(verdict\.tone\)\}">/);
  assert.match(app, /\$\{gateImpactPanelHtml\(task\)\}[\s\S]*?\$\{gateActionDockHtml\(task\)\}/);
  assert.match(css, /\.gate-operator-brief\s*{[^}]*border-left:\s*4px solid rgba\(48, 224, 198, 0\.74\) !important/s);
  assert.match(css, /\.gate-decision-grid\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.gate-decision-grid \.is-confirmation\s*{[^}]*grid-column:\s*1 \/ -1 !important/s);
  assert.match(css, /\.gate-decision-grid \.is-confirmation\s*{[^}]*border-color:\s*rgba\(255, 180, 84, 0\.3\) !important/s);
});

test("write gate detail leads with approval triad", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function applyGateApprovalDeskHtml\(applyRun\)/);
  assert.match(app, /写入审批三件套/);
  assert.match(app, /为什么被阻断/);
  assert.match(app, /需要输入什么/);
  assert.match(app, /会影响哪些文件/);
  assert.match(app, /\$\{applyGateApprovalDeskHtml\(applyRun\)\}[\s\S]*?<div class="insight-grid">/);
  assert.match(css, /\.apply-approval-desk\s*{[^}]*border:\s*1px solid rgba\(255, 180, 84, 0\.28\) !important/s);
  assert.match(css, /\.apply-approval-grid\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
});

test("diff review presents audit verdict before code details", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /const reviewVerdict = maxRisk === "high"/);
  assert.match(app, /const projectFileState = patchRun\?\.mode === "sandbox" \? "项目文件未修改" : "检查运行模式"/);
  assert.match(app, /const rollbackState = patchRun\?\.rollbackSnapshotPath \? "回滚快照已就绪" : "缺少回滚快照"/);
  assert.match(app, /const writeCondition = "必须经过人工闸门和精确确认语"/);
  assert.match(app, /<div class="diff-review-verdict risk-\$\{escapeHtml\(maxRisk\)\}">/);
  assert.match(app, /<span>审查结论<\/span>/);
  assert.match(app, /当前展示的是补丁审核产物，不是自动写入结果/);
  assert.match(css, /\.diff-review-verdict\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.diff-review-verdict\.risk-high > div:first-child\s*{[^}]*rgba\(255, 92, 122, 0\.38\)/s);
});

test("diff review leads with audit brief before code rows", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function diffAuditBriefHtml\(\{ summary, maxRisk, reviewVerdict, projectFileState, rollbackState \}\)/);
  assert.match(app, /function diffReviewChecklistHtml\(\{ patchRun, summary, maxRisk \}\)/);
  assert.match(app, /改了什么/);
  assert.match(app, /风险在哪/);
  assert.match(app, /能否继续/);
  assert.match(app, /差异复核三问/);
  assert.match(app, /先确认沙盒、回滚和人工闸门，再看代码细节/);
  assert.match(app, /是不是只在沙盒/);
  assert.match(app, /是，项目文件未改/);
  assert.match(app, /能不能自动写入/);
  assert.match(app, /不能，仍需人工确认/);
  assert.match(app, /\$\{diffAuditBriefHtml\(\{ summary, maxRisk, reviewVerdict, projectFileState, rollbackState \}\)\}[\s\S]*?<div class="diff-review-actions">/);
  assert.match(app, /\$\{diffReviewChecklistHtml\(\{ patchRun, summary, maxRisk \}\)\}[\s\S]*?<div class="diff-review-actions">/);
  assert.match(css, /\.diff-audit-brief\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.diff-audit-brief\.risk-high section:nth-child\(2\)\s*{[^}]*border-color:\s*rgba\(255, 92, 122, 0\.38\) !important/s);
  assert.match(css, /\.diff-review-checklist\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.diff-review-check\.is-blocked\s*{[^}]*border-color:\s*rgba\(255, 92, 122, 0\.34\) !important/s);
});

test("mission flow clicks open a Chinese focus card without weakening the write gate", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function missionFlowFocusInsight\(task, nodeId, director\)/);
  assert.match(app, /apply:\s*{[\s\S]*?title:\s*"写入闸门焦点"/);
  assert.match(app, /headline:\s*"写入闸门正在保护项目文件"/);
  assert.match(app, /系统也不会自动修改项目文件/);
  assert.match(app, /安全红线：没有明确人工批准，不会修改项目文件/);
  assert.match(app, /function setMissionFlowFocus\(nodeId, task, director\)/);
  assert.match(app, /setMissionFlowFocus\(target, task, director\)/);
  assert.match(css, /\.flow-focus-card\s*{[^}]*border:\s*1px solid rgba\(48, 224, 198, 0\.24\) !important/s);
  assert.match(css, /\.flow-focus-card\.status-blocked,[\s\S]*?\.flow-focus-card\.status-waiting_human\s*{[^}]*rgba\(255, 180, 84, 0\.42\)/s);
});

test("current write gate blocker stays visually unmistakable", async () => {
  const css = await readProjectFile("public/control-room.css");

  assert.match(css, /v11: final blocker\/readability polish/);
  assert.match(css, /@keyframes gateBlockerBreath/);
  assert.match(css, /@keyframes gateStationSweep/);
  assert.match(css, /\.mission-flow-node\.status-blocked\.is-focus,[\s\S]*?\.deck-viewport\[data-live-phase="apply_blocked"\] \.mission-proof-strip[\s\S]*?animation:\s*gateBlockerBreath 2\.8s ease-in-out infinite !important/s);
  assert.match(css, /\.mission-flow-node\.status-blocked\.is-focus\s*{[^}]*min-height:\s*66px !important/s);
  assert.match(css, /\.mission-flow-node\.status-blocked\.is-focus span,[\s\S]*?\.mission-flow-node\.status-waiting_human\.is-focus span\s*{[^}]*width:\s*20px !important/s);
  assert.match(css, /\.mission-proof-strip #proofApplyGate\s*{[^}]*font-size:\s*0\.92rem !important/s);
  assert.match(css, /\.core-station\.is-focus\.phase-apply_blocked\s*{[^}]*border-left-color:\s*#ffb454 !important/s);
  assert.match(css, /\.core-station\.is-focus\.phase-apply_blocked::before\s*{[^}]*animation:\s*gateStationSweep 3\.4s ease-in-out infinite !important/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("latest event and station text keep high contrast in bright environments", async () => {
  const css = await readProjectFile("public/control-room.css");

  assert.match(css, /v15: legibility pass/);
  assert.match(css, /\.room-ops-ribbon span,[\s\S]*?\.station-event\s*{[^}]*color:\s*#e4edf8 !important/s);
  assert.match(css, /\.room-ops-ribbon span,[\s\S]*?\.station-event\s*{[^}]*font-weight:\s*900 !important/s);
  assert.match(css, /\.room-ops-ribbon span,[\s\S]*?\.feed-event small\s*{[^}]*text-shadow:\s*0 1px 2px rgba\(0, 0, 0, 0\.72\)/s);
  assert.match(css, /\.feed-event\s*{[^}]*border-color:\s*rgba\(255, 255, 255, 0\.18\) !important/s);
  assert.match(css, /\.scene-label,[\s\S]*?\.mission-director-ribbon\s*{[^}]*text-shadow:\s*0 1px 2px rgba\(0, 0, 0, 0\.72\) !important/s);
  assert.match(css, /\.scene-label\s*{[^}]*background:[\s\S]*rgba\(5, 7, 10, 0\.9\) !important/s);
  assert.match(css, /\.feed-event span,[\s\S]*?\.mission-director-ribbon span\s*{[^}]*color:\s*#eef5ff !important/s);
});

test("responsive deck keeps the worker room before the rail on narrow screens", async () => {
  const css = await readProjectFile("public/control-room.css");

  assert.match(css, /v12: responsive command deck/);
  assert.match(css, /html,[\s\S]*?body,[\s\S]*?\.app-shell\s*{[^}]*overflow-x:\s*hidden !important/s);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.app-shell\s*{[^}]*"top"\s*"stage"\s*"rail" !important/s);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.side-rail\s*{[^}]*position:\s*static !important/s);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.office-stage \.deck-viewport\s*{[^}]*min-height:\s*620px !important/s);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.worker-grid\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
});

test("mobile layout stacks controls without squeezing the mission flow", async () => {
  const css = await readProjectFile("public/control-room.css");

  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.top-command-bar\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) !important/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.command-meta\s*{[^}]*display:\s*none !important/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mission-proof-strip\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.mission-flow-rail\s*{[^}]*grid-template-columns:\s*1fr !important/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.room-ops-ribbon\s*{[^}]*display:\s*grid !important/s);
});

test("company report reads like a shareable audit-grade war report", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /function companyMetricClass\(label = ""\)/);
  assert.match(app, /class="company-metric \$\{escapeHtml\(metricClass\)\}"/);
  assert.match(app, /elements\.companyShareLine\.innerHTML =/);
  assert.match(app, /card\.safetyStamp/);
  assert.match(css, /v13: company report and audit replay polish/);
  assert.match(css, /\.company-report-panel\s*{[^}]*grid-column:\s*1 \/ -1 !important/s);
  assert.match(css, /\.company-report-panel::before\s*{[^}]*content:\s*"24\/7 AI WORKER COMPANY"/s);
  assert.match(css, /\.company-metrics\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.company-metric strong\s*{[^}]*font-size:\s*clamp\(1\.45rem, 2\.1vw, 2\.15rem\) !important/s);
  assert.match(css, /\.company-metric\.metric-risk strong,[\s\S]*?\.company-metric\.metric-gate strong\s*{[^}]*color:\s*#ffe0a8 !important/s);
  assert.match(css, /\.company-share-card > p strong\s*{[^}]*font-size:\s*clamp\(1\.14rem, 2vw, 1\.72rem\) !important/s);
  assert.match(css, /\.company-share-bullets li:last-child\s*{[^}]*grid-column:\s*1 \/ -1 !important/s);
});

test("company share card highlights the latest real close loop", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /const latestLoop = companyReport\.latestLoop \|\| \{\}/);
  assert.match(app, /company-evidence-chain/);
  assert.match(app, /最新真实闭环证据链/);
  assert.match(app, /最新真实闭环/);
  assert.match(app, /项目文件未被自动修改/);
  assert.match(css, /\.operator-console \.company-share-card\s*{[^}]*display:\s*grid !important/s);
  assert.match(css, /\.operator-console \.company-share-button\s*{[^}]*display:\s*inline-flex !important/s);
  assert.match(css, /\.company-latest-loop\s*{[^}]*border:\s*1px solid rgba\(255, 180, 84, 0\.28\) !important/s);
  assert.match(css, /\.company-evidence-chain\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.company-share-metrics\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /\.company-evidence-chain \.chain-safe\s*{[^}]*border-color:\s*rgba\(48, 224, 198, 0\.28\) !important/s);
  assert.match(css, /@media \(max-width: 1180px\)[\s\S]*?\.company-evidence-chain\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\) !important/s);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.company-evidence-chain\s*{[^}]*grid-template-columns:\s*1fr !important/s);
});

test("workfeed renders as a replay timeline with explicit event time", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /<i class="feed-event-pin" aria-hidden="true"><\/i>/);
  assert.match(app, /<em>\$\{escapeHtml\(eventTime\)\}<\/em>/);
  assert.match(css, /\.workfeed-list::before\s*{[^}]*linear-gradient\(180deg, rgba\(48, 224, 198, 0\.08\), rgba\(48, 224, 198, 0\.42\), rgba\(255, 180, 84, 0\.2\)\)/s);
  assert.match(css, /\.feed-event-pin\s*{[^}]*background:\s*#30e0c6/s);
  assert.match(css, /\.feed-event\.risk-high \.feed-event-pin\s*{[^}]*background:\s*#ff5c7a/s);
  assert.match(css, /\.feed-event em\s*{[^}]*font-style:\s*normal !important/s);
});

test("stage edge polish prevents scene labels from reading like a second sidebar", async () => {
  const app = await readProjectFile("public/app.js");
  const css = await readProjectFile("public/control-room.css");

  assert.match(app, /const sideSafeInset = canvasRect\.width < 760 \? 78 : 170/);
  assert.match(app, /x > sideSafeInset/);
  assert.match(app, /x < canvasRect\.width - sideSafeInset/);
  assert.match(css, /v14: clean stage edges/);
  assert.match(css, /\.office-stage \.deck-viewport::before\s*{[^}]*rgba\(5, 7, 10, 0\.42\)/s);
  assert.match(css, /\.scene-label:not\(\.is-selected\)\s*{[^}]*scale:\s*0\.88/s);
  assert.match(css, /\.scene-label\s*{[^}]*max-width:\s*176px !important/s);
  assert.match(css, /\.scene-label\.is-selected\s*{[^}]*max-width:\s*210px !important/s);
});

test("three worker room animation is bound to real run phase and worker role", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /function workerLifeProfile\(workerId, phase, status\)/);
  assert.match(app, /workerId === "coding-yuan" && codingPhases\.includes\(phase\)/);
  assert.match(app, /workerId === "judge-yuan" && judgePhases\.includes\(phase\)/);
  assert.match(app, /workerId === "ops-yuan" && opsPhases\.includes\(phase\)/);
  assert.match(app, /const task = latestTaskFromList\(snapshot\?\.tasks \|\| \[\], project\.id\)/);
  assert.match(app, /const director = task[\s\S]*?missionDirectorForTask\(task/);
  assert.match(app, /rig\.userData\.missionPhase = phase/);
  assert.match(app, /rig\.userData\.workerId = workerId/);
});

test("three worker room shows gate and judge scan effects only for matching phases", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /const gateVisible = lifeMode === "ops-gate" \|\| missionPhase === "apply_blocked" \|\| missionPhase === "failed"/);
  assert.match(app, /rig\.userData\.gateWall\.visible = gateVisible/);
  assert.match(app, /const scanVisible = lifeMode === "judge" \|\| \["verification_running", "judge_review", "human_gate"\]\.includes\(missionPhase\)/);
  assert.match(app, /rig\.userData\.scanBeam\.visible = scanVisible/);
  assert.match(app, /const codingBoost = lifeMode === "coding" && \["evidence_collecting", "proposal_generating", "patch_running"\]\.includes\(missionPhase\) \? 0\.16 : 0/);
});

test("ops blocked phase adds a real 3d gate rail to the worker room", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /const gateRailMaterial = new THREE\.MeshBasicMaterial/);
  assert.match(app, /rail\.visible = phase === "apply_blocked" \|\| phase === "failed"/);
  assert.match(app, /group\.userData\.gateRails = gateRails/);
  assert.match(app, /function animateGateRails\(gateRails = \[\], time, phase\)/);
  assert.match(app, /const visible = phase === "apply_blocked" \|\| phase === "failed"/);
  assert.match(app, /animateGateRails\(node\.userData\.gateRails, time, node\.userData\.missionPhase\)/);
});

test("three worker room phase transfer follows the real mission phase", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /phaseTransferPulses:\s*\[\]/);
  assert.match(app, /threeDeck\.phaseTransferPulses = \[\]/);
  assert.match(app, /function phaseTransferRouteForPhase\(phase, mode = "sandbox_patch"\)/);
  assert.match(app, /if \(mode === "review_only"\) return null/);
  assert.match(app, /label: "方案交给审核猿旁路审查"/);
  assert.match(app, /const opsPhases = \["rollback_ready", "apply_gate", "apply_blocked", "failed"\]/);
  assert.match(app, /targetWorkerId: "ops-yuan"[\s\S]*?blocked: phase === "apply_blocked" \|\| phase === "failed"/);
  assert.match(app, /sourceWorkerId: "coding-yuan"[\s\S]*?targetWorkerId: "judge-yuan"[\s\S]*?label: "证据交给审核猿验证"/);
  assert.match(app, /function createMissionPhaseTransferPath\(group, project, phase, lift, activeNode, mode = "sandbox_patch"\)/);
  assert.match(app, /createMissionPhaseTransferPath\(group, project, phase, lift, activeNode, mode\)/);
  assert.match(app, /threeDeck\.phaseTransferPulses\.push\(pulse\)/);
  assert.match(app, /pulse\.userData\.targetWorkerId = route\.targetWorkerId/);
  assert.match(app, /function animatePhaseTransferPulse\(pulse, time\)/);
  assert.match(app, /for \(const pulse of threeDeck\.phaseTransferPulses\)[\s\S]*?animatePhaseTransferPulse\(pulse, time\)/);
  assert.match(app, /const progress = pulse\.userData\.blocked \? Math\.min\(0\.92, routeProgress\) : routeProgress/);
});

test("three worker room has mode-aware dispatch markers for Coding, Judge, and Ops", async () => {
  const app = await readProjectFile("public/app.js");

  assert.match(app, /function workerDispatchState\(workerId, phase, mode = "sandbox_patch", focusWorkerId = ""\)/);
  assert.match(app, /if \(mode === "review_only"\)[\s\S]*?workerId === "coding-yuan" \? "active" : "standby"/);
  assert.match(app, /if \(mode === "proposal"\)[\s\S]*?workerId === "ops-yuan"\) return "standby"/);
  assert.match(app, /function createWorkerDispatchMarkers\(group, phase, lift, mode, focusWorkerId\)/);
  assert.match(app, /for \(const workerId of \["coding-yuan", "judge-yuan", "ops-yuan"\]\)/);
  assert.match(app, /group\.userData\.dispatchMarkers = markers/);
  assert.match(app, /function animateWorkerDispatchMarkers\(markers = \[\], time\)/);
  assert.match(app, /animateWorkerDispatchMarkers\(node\.userData\.dispatchMarkers, time\)/);
});
