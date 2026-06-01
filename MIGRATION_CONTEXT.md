# Migration Context

Source conversation: `019e4fa1-194e-7b20-b68d-543653c3333e`

Imported on: 2026-05-27 Asia/Shanghai

## What Moved

- Main project: `<old-workspace>/codex-office/` -> `<repo>/`
- Sandbox demo: `<old-workspace>/coding-yuan-sandbox-demo/` -> `<repo>/coding-yuan-sandbox-demo/`
- AI Worker Control Plane: `<old-workspace>/ai-worker-control-plane/` -> `<repo>/integrations/ai-worker-control-plane/`
- Raw Codex transcript: `codex-session-import/rollout-2026-05-22T20-20-18-019e4fa1-194e-7b20-b68d-543653c3333e.jsonl`

## Last Stable State From The Old Thread

The old thread was building `Codex Office`, a local Coding猿 control-room demo served on `127.0.0.1:4142` and publicly routed through `geoaifactory.com`.

Last completed checkpoint:

- Added a Chinese service-health panel.
- Unified the default server port to `4142`.
- Verified `node --check server.js`, `node --check public/app.js`, and `npm test` with `125/125` passing in the old workspace.
- Confirmed local `http://127.0.0.1:4142` and public `https://geoaifactory.com` returned `200`.
- Installed and started a launchd-backed local service in the old path.

The next intended step was to surface service health in the top status strip with a small `公网已托管` style badge.

## Interrupted State

The final old turn was interrupted after adding the `commandPublicHealth` badge element and JavaScript selector. The rendering logic for that top-strip badge may still need to be finished.

## Migration Adjustments Made Here

- Updated the launchd plist working directory from the old path to `<repo>`.
- Updated `scripts/run-codex-office-service.zsh` to start from the new path.
- Updated README path references that would otherwise point at the old project directory.
- Imported AIWC source, docs, tests, examples, local output, and `.data` into `integrations/ai-worker-control-plane`.
- Excluded AIWC rebuildable caches: `node_modules`, `.next`, and `tsconfig.tsbuildinfo`.

## Useful Commands

```bash
npm test
npm run aiwc:test
node --check server.js
node --check public/app.js
PORT=4142 npm run dev
/bin/zsh scripts/check-codex-office-health.zsh
```
