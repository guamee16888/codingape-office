# CodingYuan Worker Asset Pipeline v1

Stage-7 uses 3D workers as a product surface for real run state. The room must never imply fake work: animation, light, and station labels are driven by the current run phase, evidence, gate, and apply status.

## Asset Contract

Each worker entry in `public/assets/workers/manifest.json` defines:

- `id`: stable worker id, for example `coding-yuan`, `judge-yuan`, or `ops-yuan`.
- `role`: product role shown in the Office worker room.
- `model`: optional `.glb` path. If `public/assets/workers/coding-ape.glb` exists, CodingYuan tries that path first.
- `textures`: `embedded` or bundled relative paths. Prefer embedded textures for the first beta.
- `animations`: must include `idle`, `assigned`, `working`, `running_command`, `reviewing`, `waiting_approval`, `blocked`, `completed`, and `reporting`.
- `fallbackAvatar`: compact text avatar used when the model is missing or WebGL is unavailable.
- `version` and `hash`: asset versioning and integrity metadata.
- `maxRecommendedModelSizeMb`: target budget for initial load.

Recommended model budget:

- Single worker `.glb`: 8 MB or less.
- All three workers combined: 18 MB or less.
- Texture max edge: 2048 px for hero worker, 1024 px for supporting workers.
- Mesh count: keep under 40 meshes per worker unless the file is proven fast on older Intel Macs.

## Required Animation Semantics

Animations are semantic, not decorative:

- `idle`: no active task for this worker.
- `assigned`: task exists but no evidence collection has started.
- `working`: general active work.
- `running_command`: command or patch runner is active.
- `reviewing`: evidence, verification, or judge review is active.
- `waiting_approval`: human gate or diff review is waiting for the user.
- `blocked`: apply gate, project root guard, verification, or rollback blocker is active.
- `completed`: task completed.
- `reporting`: company report or final evidence archive is being shown.

The runtime may map detailed states like `generating_evidence`, `generating_patch`, and `verifying` to the nearest available animation. The detailed state is still preserved in DOM data attributes and tests.

## Runtime State Mapping

`public/worker-avatar-runtime.js` owns the mapping from run phase to worker state:

- `queued` -> `idle` or `assigned`
- `evidence_collecting` -> `generating_evidence`
- `proposal_generating` -> `generating_patch`
- `verification_running` -> `verifying`
- `judge_review` -> `reviewing`
- `human_gate` -> `waiting_approval`
- `patch_running` -> `working` or `running_command`
- `diff_ready` -> `waiting_approval`
- `apply_gate` / `apply_blocked` -> `blocked`
- `completed` -> `reporting`
- `failed` -> `failed`

Lighting is state-driven:

- Working, generating, verifying, reviewing: cyan.
- Completed or reporting: green.
- Waiting for approval: amber.
- Blocked or failed: red.
- Idle: neutral.

## Fallback Rules

Fallback is a first-class product path:

1. If `.glb` files are missing, the app uses the built-in procedural worker rig.
2. If WebGL fails, the app hides the canvas and renders the HTML worker room fallback.
3. Office controls, inspector, support center, mission flow, and gates must remain usable.
4. Fallback UI must still show worker name, role, current action, run id, risk level, gate status, and real run state.

## IP Direction

CodingYuan workers should be original IP:

- No copied BAYC or other collectible ape traits.
- Use a Mac-local workshop / audit room language: compact workstations, evidence panels, gate lights, and subtle uniforms.
- The face can be mascot-like, but it should read as a proprietary CodingYuan office worker, not a derivative collection asset.

## Release Checklist

- Add or update `.glb` files under `public/assets/workers/`.
- Update `manifest.json` version/hash.
- Verify WebGL render and fallback render.
- Run `npm test`.
- Confirm no animation runs without a real run phase or demo-seeded event.
