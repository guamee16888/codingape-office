# Stage-9 Visual Conversion Audit

Stage-9 reviews the first-order experience as a stranger seeing Coding猿 Office for the first time. The goal is not more features; it is faster comprehension.

## Confusion Found

- The first screen showed controls before the main safety decision.
- Worker cards mixed user-facing state with internal telemetry labels such as Role, Risk, Gate, and Light.
- Mission Flow labels mixed English product terms with Chinese operator copy.
- The App Store screenshot plan listed required scenes but did not provide a repeatable capture command.

## Changes Made

- Restored a compact current-state headline in `/office` so the operator sees the active decision before parsing controls.
- Rewrote apply-blocked copy around the user decision: check the diff, keep blocked when unsure, and only apply with exact confirmation.
- Changed the full mission flow to Chinese-first labels while keeping the underlying task phases unchanged.
- Reduced worker station metadata to three external-tester concepts: run, risk, and gate.
- Added `npm run stage9:capture-app-store-screenshots` for repeatable Demo Data App Store frames.

## Non-Goals

- No new worker roles.
- No new business loop behavior.
- No automatic apply path.
- No private source code in App Store screenshots.
