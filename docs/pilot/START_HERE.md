# Codingape Office 10-Minute Pilot

This page is the shortest path for external testers. It is for one safe first run, not a production rollout.

## What You Are Testing

Codingape Office is a local-first AI coding worker for Mac.

It should let you:

1. choose one local project folder
2. run one small README task
3. see context, evidence, a plan, a diff, and verification
4. understand Human Gate before any write
5. report where the first-run flow is confusing or blocked

## Safety Rules

- Use a toy repo, test repo, or disposable branch.
- Do not start with a production-only project.
- Do not post API keys, `.env` contents, private paths, private source, support bundle raw contents, or screenshots with secrets.
- Stop if the app appears to write code before a visible diff and Human Gate.

## Run From Source

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

## Run One First Task

1. Open `/office`.
2. Choose a small local project folder.
3. Pick a model mode:
   - `Demo Only` if you do not want to configure a model.
   - `BYO API Key` if you want to test a hosted provider.
   - `Local Model` if you use Ollama, LM Studio, or another local endpoint.
4. Click:

```text
Run First Task: Update README
```

## What To Look For

Please check whether you can see:

- selected project root
- context preview
- evidence
- AI plan or clear Demo Only explanation
- diff before write
- verification result
- Human Gate
- Apply Gate
- rollback/report option

## Leave Feedback

Post a redacted result in the pilot tracker:

```text
https://github.com/guamee16888/codingape-office/issues/5
```

Use this format:

```text
Run mode: Demo Only / BYO API Key / Local Model
Install/local run: pass/fail
Project selected: pass/fail
Model configured: pass/fail/skipped
First task: pass/fail/blocked
Diff visible: yes/no
Human Gate understood: yes/no
Apply attempted: yes/no
Rollback visible: yes/no
Support bundle generated: yes/no
Main blocker:
Feedback score 1-5:
Next fix:
```

Good feedback is specific: the exact step where you got stuck is more useful than a general opinion.

