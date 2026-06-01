# External Pilot Runbook

This runbook is for 3-5 external testers trying Codingape Office for the first time.

## Goal

Validate that a stranger can install or run Codingape Office, choose a local project, configure Demo Only / BYO Key / Local Model, run the first README task, understand the Human Gate, and export feedback or a support bundle.

## Safety Promise To Read First

Codingape Office is a local AI coding worker for your Mac. It shows evidence, context, a plan, a diff, verification, and Human Gate before any write. It does not default-scan the full disk and it does not auto-apply patches.

## Install Or Run

For the open-source pilot:

```bash
git clone https://github.com/guamee16888/codingape-office.git
cd codingape-office
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:4142/office
```

If you receive a packaged Mac build, open `Codingape Office.app` and use the same `/office` screen.

## Choose A Project

1. Click `选择本地项目目录`.
2. Pick a small local test project.
3. Do not choose a secrets folder, wallet folder, or production-only repo for the first run.
4. Confirm the selected project is shown in the Office header.

Codingape Office will bind evidence, diff, verification, apply, rollback, and reports to this selected project root.

## Choose Model Mode

Demo Only:

- Does not call any AI provider.
- Shows the safety loop with a local README task.
- Good for verifying the Human Gate and rollback UX.

BYO API Key:

- Use your own OpenAI, Anthropic, Gemini, or OpenAI-compatible key.
- The key stays in local gitignored config.
- Do not paste API keys into feedback, GitHub issues, screenshots, or support messages.

Local Model:

- Use Ollama, LM Studio, or another OpenAI-compatible local endpoint.
- Example endpoint: `http://127.0.0.1:11434`.
- Example model: `qwen2.5-coder:7b`.

## Run The First Order

Click:

```text
Run First Task: Update README
```

Expected flow:

1. Context Preview shows which files may be sent to the selected model.
2. AI Plan appears if a real model is configured.
3. Diff Preview appears before any write.
4. Verification runs in the controlled loop.
5. Human Gate asks for explicit approval.
6. Apply Gate remains blocked until all safety conditions pass.
7. Rollback / Report remains available after apply.

If no model is configured, the run uses Demo Only and should clearly say that no AI call was made.

## Export Feedback

After the first run, fill the `Pilot Feedback Pack` panel and click:

```text
Export Pilot Feedback JSON
```

The file is written under:

```text
data/pilot-feedback/
```

The lightweight latest metrics file is:

```text
data/pilot/latest.json
```

Feedback must not include API keys, full source files, private keys, `.env` contents, wallet files, certificates, or secrets.

## Generate Support Bundle

If anything fails:

1. Open `Beta 支持中心`.
2. Click `生成支持包`.
3. Click `打开支持包目录`.
4. Send the generated JSON plus your feedback JSON.

Support bundles are designed to redact secrets and avoid API key plaintext.

## Current Limits

- Codingape Office is not a fully autonomous programmer.
- It may fail on complex or ambiguous tasks.
- It does not auto-apply patches.
- It does not upload the whole project by default.
- Real model quality depends on the provider, endpoint, timeout, and model.
- Mac App Store signing or Apple account blockers are outside this pilot runbook.
