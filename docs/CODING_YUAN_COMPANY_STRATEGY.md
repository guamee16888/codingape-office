# Coding猿 Company Strategy

## Category

Coding猿 is an AI Workforce Control Plane.

The company should not be framed as a mascot, NFT, dashboard skin, chatbot wrapper, or generic agent launcher. The category is:

> A visual operating system for managing, auditing, and trusting real AI workers.

The sharper consumer-facing narrative is:

> I own a 24/7 AI worker company that never sleeps.

This is stronger than "AI Agent visualization" because it speaks to users who want leverage: side hustles, automation, quantitative systems, content production, research, and operations. The product should make people feel they do not merely have a chatbot; they have a small AI company working through the night.

## Core Wedge

Most users cannot understand AI agents from terminal logs. They need to see who is working, what they are doing, what is blocked, what is risky, and what proof exists.

Coding猿 makes AI labor visible:

- Worker identity
- Task queue
- Runtime state
- Tool activity
- Risk gate
- Evidence trail
- Replayable history

The IP creates memory. The control plane creates defensibility.

## First Killer Product

AI Worker Desktop:

1. Open one local command room.
2. See Coding猿 and other workers mapped to real projects.
3. Click a worker to inspect current task, risk, files, scripts, and events.
4. Run or approve next actions.
5. Receive an evidence pack when work finishes.

V1 should feel like owning a small AI company, not using a single AI tool.

The MVP delight loop should be: it looks like the workers are working, and then the proof shows they really worked.

Example first-class flow:

1. User says: "Help me optimize this function."
2. Coding猿 moves to the code console, enters a coding/testing posture, and the workfeed starts streaming actual tool activity.
3. The backend task runner records commands, files touched, errors, tests, and risk state.
4. When finished, Coding猿 returns to its station and reports the result with an evidence pack.

The visual motion must be bound to real execution state: coding, testing, reviewing, blocked, deploying, alerting, done. Fake animation without evidence should not become the product center.

Launch focus should stay narrow:

- Primary demo worker: Coding猿.
- Trust layer worker: Judge猿.
- Runtime/status worker: Ops猿.
- Quant猿 stays visible as a high-interest next wedge, but should not distract the first demo loop.

Other roles can remain in the universe wall as "next hire" signals until the Coding猿 loop is genuinely impressive.

## Worker Company Cast

| Worker | Ownership | Product Meaning |
| --- | --- | --- |
| Coding猿 | Engineering | Code changes, tests, PRs, local automation |
| Quant猿 | Markets | Trading, signals, strategies, risk watch |
| Security猿 | Security | Compliance, vulnerabilities, attack paths, policy |
| Ops猿 | Runtime | Deploys, incidents, logs, uptime, Cloudflare |
| Judge猿 | Governance | Review, approvals, evals, release gates |
| Hunter猿 | Intelligence | Research, domains, leads, external signal |

Each worker must have a reason to exist in the product. No decorative roles.

Expansion roles:

| Worker | Ownership | Product Meaning |
| --- | --- | --- |
| Intern猿 | Operations support | Running low-risk errands, research formatting, task cleanup |
| Memer猿 | Growth/media | Memes, launch assets, short-video scripts, copy variants |
| Negotiator猿 | Commercial/legal workflow | Email drafts, vendor comparison, negotiation prep, contract review |
| Research猿 | Deep analysis | Literature review, competitor maps, market/trend synthesis |

Expansion rule: new workers should be introduced only when they unlock a new workflow surface, not merely a new character. Research猿 should not replace Hunter猿; Research猿 goes deep, Hunter猿 hunts external signals quickly.

Role identity is product UI, not decoration. Each worker needs a job-specific silhouette, behavior, and temperament:

- Coding猿: focused builder energy, terminal posture, fast typing and test feedback.
- Security猿: darker tactical look, scanning visor or glasses, cautious and suspicious review posture.
- Quant猿: analytical, charts and risk lines, more precise and bookish.
- Memer猿 / Marketing猿: expressive, camera-aware, layout and short-video surfaces.
- Negotiator猿: calm, controlled, split-screen communication cockpit, always human-gated for commitments.

This makes the IP useful because users can understand the kind of work by looking at the worker.

## Defensibility

The moat is not the ape image. The moat is the reliability layer around autonomous work:

- Real project and runtime ingestion
- Multi-agent task routing
- Human approval gates for high-risk actions
- Evidence packs for completed work
- Replayable event timelines
- Worker reliability scores
- Cross-tool execution through Codex, MCP, GitHub, browser, cloud, and local desktop
- A memorable worker universe that users can explain in one sentence

## Product Milestones

### Phase 1: Visible Worker Desktop

- Worker roster is driven by real local project state.
- Workfeed is generated from git, files, ports, and scripts.
- Detail panel shows current task, risk, next action, and evidence surfaces.
- Procedural 3D workers remain until original rigged GLB models are ready.
- Optional presentation layer can be explored in Unity or Unreal, but the web control plane remains the source of truth.

### Phase 2: Real Agent Execution

- Add task creation and assignment.
- Let Coding猿 run bounded local commands.
- Attach terminal/test/browser evidence to events.
- Add pause, retry, approve, and reject controls.
- Persist task history as JSONL or SQLite.

Current bridge:

- Task creation exists as a local JSONL queue.
- Approval decisions exist as a local human-gate log.
- Workfeed merges scanned workspace signals with operator-created tasks and approval events.
- Queued tasks can run a read-only evidence bridge that captures git/project signals without modifying code or executing high-risk operations.
- Evidence can be inspected in the UI and converted into a patch-plan artifact before any code-writing capability is enabled.
- Patch generation, package-script execution, deployments, trades, restarts, and writes remain future gated capabilities.

### Phase 3: AI Worker Company

- Add handoffs between workers.
- Add team-level reliability, cost, time saved, and output quality.
- Add replay mode for completed tasks.
- Add shareable work summaries and launch-ready visuals.
- Evaluate multi-agent orchestration frameworks such as CrewAI, AutoGen, and LangGraph after the local evidence and approval model is stable.
- Add "AI company scoreboard" views such as revenue influenced, cost saved, bugs fixed, tasks completed, risk blocked, and hours saved.

### Phase 4: AI Operating System

- Connect external runtimes: GitHub, Cloudflare, monitoring, trading systems, docs, and browser agents.
- Add organization permissions and audit exports.
- Make the control plane the management layer for AI labor.
- Let users drag, connect, and compose workers into their own AI company workflows, like building with operational Lego blocks.

## Technical Route

Phase 1 should prioritize a shippable control plane over maximum 3D fidelity:

- Use the current web dashboard for state, tasks, evidence, approvals, and workfeed.
- Use Claude/Codex/Cursor-style coding agents behind bounded task runners.
- Keep Unity/Unreal as optional cinematic shells or future rich-client layers, not the first source of product truth.
- Keep agent orchestration simple: worker assignment, queue, evidence, approval, result.

Phase 2 can introduce dedicated multi-agent orchestration:

- CrewAI-style role/task crews for repeatable business workflows.
- AutoGen-style agent conversations for collaboration patterns that need discussion, critique, or tool handoff.
- LangGraph-style stateful graphs for deterministic workflow control, approvals, retries, and long-running processes.

Phase 3 should become the user-facing control plane:

- Visual worker graph.
- Drag-and-drop task routing.
- Human gates as explicit nodes.
- Evidence packs as first-class artifacts.
- Templates for "AI software team", "AI quant desk", "AI media desk", and "AI research desk".

## Distribution Loops

The easiest way to explain the product is to show the AI company working.

Potential breakout surfaces:

- AI Worker Twitch / TikTok: livestream an AI team building, testing, researching, or operating systems.
- "My AI company earned/saved this much today": real-time owner dashboard for revenue, cost, output, and risk.
- "My AI workers fixed 47 bugs last night": battle-report videos generated from evidence packs.
- "From zero to one with my AI worker team": full build-in-public series where each worker leaves auditable proof.

Every shareable moment should connect back to real logs, evidence, diffs, tests, outputs, or business metrics.

## Risk Principle

The biggest product risk is building a beautiful toy. Visual life and real productivity must advance together.

Decision rule:

- If it only looks alive, cut it or make it explain state.
- If it works but feels invisible, visualize its state and proof.
- If it can cause real-world cost, legal exposure, money movement, production impact, or reputational damage, it requires a human gate.
- If it cannot produce evidence, it cannot be trusted as autonomous work.

## Brand Guardrails

- Original characters only. Never copy BAYC traits or assets.
- Premium, tactical, technical, and believable.
- Visual flair must explain operational meaning.
- The worker universe should make non-technical users understand agent work instantly.
- Every future screenshot should communicate: "These AI workers are doing real work for me."
