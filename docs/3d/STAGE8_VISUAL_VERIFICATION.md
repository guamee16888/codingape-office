# Stage-8 Visual Verification

Stage-8 proves the worker room beyond unit tests:

1. `npm run assets:worker` generates the first original `public/assets/workers/coding-ape.glb`.
2. `npm run stage8:record-demo` records `/demo` through Chrome screenshots and renders a 3-minute MP4 with ffmpeg.
3. `npm run stage8:verify-office` creates one real `/office` safe first-order coding loop, waits for that task to render in `/office`, captures a screenshot, and records the worker station states derived from that task.

Generated evidence is local-only and intentionally ignored by git under `data/stage8-recordings/`.

Expected evidence files:

- `data/stage8-recordings/latest-demo-summary.json`
- `data/stage8-recordings/latest-office-state-summary.json`
- `data/stage8-recordings/demo-*/codingyuan-stage8-demo-3min.mp4`

The video is based on deterministic `/demo?demoStep=N&recording=1` URLs. Those URLs use seeded Demo Data and do not connect to the local project.

The `/office` verification uses the current authorized project root and the safe first-order loop. It generates evidence, proposal, verification, human gate, sandbox patch, apply gate, and report artifacts, but direct project apply remains human-gated and off by default.

The `/office` screenshot is captured through Chrome DevTools Protocol so the script can wait until the real task title or run id appears in the page. Headless Chrome may fail to create a WebGL context; when that happens, the summary records `webglFallback: true` and still requires the Worker Room fallback, Mission Flow, Inspector, and support controls to render.
