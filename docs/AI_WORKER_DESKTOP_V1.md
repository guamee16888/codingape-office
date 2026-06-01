# AI Worker Desktop V1

## Goal

V1 should make a normal user feel: "I have AI workers doing real work right now."

This is the smallest product loop that proves the Coding猿 Universe is more than a visual shell.

The emotional goal is sharper:

> I opened my laptop and my 24-hour AI worker company is already at work.

The first screen should communicate ownership, activity, and proof before the user reads instructions.

## V1 User Experience

1. Open the dashboard.
2. See a 3D worker room with live workers.
3. Click a worker or project.
4. See what it is doing, what changed, what is blocked, and what it can do next.
5. Approve or reject risky next actions.
6. Get an evidence trail after work completes.

Signature interaction:

1. User enters a task such as "optimize this function" or "research these competitors."
2. The selected worker moves into a matching work posture.
3. The backend records actual task execution state: command, model/tool call, file, browser, test, alert, or approval gate.
4. UI state and animation follow the real run state, not a decorative timer.
5. The worker returns with a concise report and evidence pack.

## Core Modules

### Command Deck

Current prototype exists.

Needs:

- Workers grouped by role, not only by project.
- Real-time state transitions: sleeping, thinking, coding, testing, blocked, reviewing, done.
- Click-to-focus camera behavior.
- Worker-specific animations.
- State-bound worker motion: typing only during real coding/tool activity, testing posture during real verification, alert posture during real risk or failure, review posture during human-gated decisions.

### Worker Detail

Needs:

- Current task.
- Last tool call.
- Files touched.
- Risk level.
- Next suggested action.
- Approval button slot.

### Terminal / Workfeed

Needs:

- Chronological event stream.
- Commands run.
- Tests run.
- Errors and fixes.
- Links to local files.
- Battle-report summaries that can become shareable updates: bugs fixed, tasks completed, tests passed, risks blocked, money saved or earned where applicable.

### Risk and Evidence

Needs:

- Action risk: low, medium, high.
- Approval required flag.
- Before/after diff summary.
- Test evidence.
- Output artifact links.

### Worker Universe Strip

Needs:

- Coding猿, Quant猿, Security猿, Ops猿, Judge猿, Hunter猿.
- Each role has color, status, queue count, and current job.
- Empty roles can show "available" rather than disappear.
- Expansion roles stay out of V1 until workflows justify them: Intern猿, Memer猿, Negotiator猿, Research猿.

## Data Model

Worker:

```json
{
  "id": "coding-yuan",
  "name": "Coding猿",
  "role": "Engineering",
  "status": "working",
  "queue": 3,
  "currentTask": "Fix dashboard rendering",
  "risk": "medium",
  "tools": ["codex", "terminal", "git", "browser"],
  "lastEventAt": "2026-05-23T00:00:00.000Z"
}
```

Event:

```json
{
  "id": "evt_001",
  "workerId": "coding-yuan",
  "type": "test_run",
  "title": "Playwright visual QA passed",
  "risk": "low",
  "timestamp": "2026-05-23T00:00:00.000Z",
  "evidence": ["/private/tmp/codex-office-livelier-people-desktop.png"]
}
```

Approval:

```json
{
  "id": "approval_001",
  "workerId": "ops-yuan",
  "action": "deploy",
  "risk": "high",
  "requiresHuman": true,
  "status": "pending"
}
```

## MVP Integration Sources

- Local workspace scan: current `server.js`
- Git state: current project discovery
- Terminal/test runs: Codex execution history later
- Browser QA: current Playwright scripts
- Future connectors: GitHub, MCP, monitoring, local desktop automation

## Build Order

1. Worker Universe strip.
2. Worker event feed.
3. Approval model.
4. Real Codex task binding.
5. Replay and evidence pack.
6. Role-specific 3D GLB models.
7. Drag-and-drop worker workflow builder.
8. Shareable "AI company daily report" cards and short-video-ready work replays.

## Technical Route Notes

- V1 should remain a web control plane because state, audit, evidence, and approvals are the product core.
- Unity/Unreal can become a cinematic or rich-client layer after the control plane proves real work value. The first product source of truth remains the web/runtime control plane, not a game scene.
- Early orchestration should stay simple: task queue, worker assignment, evidence capture, approval, result.
- Later orchestration can evaluate CrewAI, AutoGen, LangGraph, or a custom graph runtime once workflows require multi-agent handoff and retries.

## Current Prototype Status

- Worker Universe strip is now API-driven from local workspace state.
- Six workers are always present: Coding猿, Quant猿, Security猿, Ops猿, Judge猿, Hunter猿.
- Projects are routed into workers by product identity, not by static UI.
- Workfeed events are generated from git changes, recent file activity, inferred ports, and verification scripts.
- Project detail shows assigned worker, current task, risk level, and next suggested action.
- High-risk surfaces are labeled as human-gated; no risky operation executes automatically.
- Local JSONL logs now persist queued tasks, manual worker events, and approval decisions.
- The right detail panel can queue a review task, mark a project blocked, and record Reviewed/Hold decisions for human gates.
- `Run Evidence` connects queued tasks to a read-only evidence runner that captures git status, diff stats, changed filenames, and package-script recommendations.
- `View Pack` exposes the evidence in the control plane instead of forcing the user to open JSON files.
- `Draft Plan` creates a local patch-plan artifact with observations, recommended steps, verification suggestions, and gated action boundaries.

## Non-Negotiables

- The UI must show real state, not decorative fake status.
- Risky actions must require human approval.
- IP must support the product, not obscure it.
- Every flashy visual needs an operational meaning.
- The MVP should feel cinematic, but every cinematic state needs a real backend run, event, or evidence artifact behind it.
