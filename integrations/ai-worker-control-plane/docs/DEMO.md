# Demo Smoke Flow

Run the local Phase 1 closed-loop demo:

```bash
npm run demo
```

The demo creates a project, an agent, an email report subscription, five representative agent runs, structured judgements, failure cases, optimization suggestions, eval cases, learning insights, a delivered nightly report, one approved draft prompt version, and one disabled policy-rule draft.

The generated report also shows the Phase 1 data moat: learning-asset counts, self-evolution memory, and a repeated `tool_error` pattern across the demo runs.

Print the generated report markdown too:

```bash
npm run demo -- --markdown
```

Print the generated report markdown in Chinese:

```bash
npm run demo -- --locale zh-CN --markdown
```

Export a local HTML report you can open in a browser:

```bash
npm run demo -- --html-out demo-output/nightly-report.html
```

Export a local operator console preview:

```bash
npm run demo -- --console-out demo-output/operator-console.html
```

Regenerate both browser-openable preview files at once in Chinese:

```bash
npm run demo:preview
```

Outputs:

- `demo-output/operator-console.html`
- `demo-output/nightly-report.html`

Generate the English preview when needed:

```bash
npm run demo:preview:en
```

By default the demo uses a temporary SQLite database and cleans it up. Keep the demo database for inspection:

```bash
npm run demo -- --keep
```

Use a persistent path explicitly:

```bash
AIWC_DEMO_DB_PATH=.data/demo.sqlite npm run demo -- --markdown
```

The demo always uses the deterministic local judge so it does not require `OPENAI_API_KEY`.
