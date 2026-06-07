# Tester Intake Checklist

Use this checklist when testing Codingape Office for the first time.

## Before You Start

- Use macOS.
- Use a small test repo, toy repo, or disposable branch.
- Do not start with a production-only repository.
- Do not paste API keys, `.env` contents, private keys, wallet files, certificates, private paths, or full private source code into GitHub issues, screenshots, or feedback.

## Option A: Run From Source

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

## Option B: Use A Packaged App

If you received a packaged Mac build, open `Codingape Office.app`, then use the `/office` screen.

If macOS blocks the app, record the message and do not bypass security prompts unless you trust the build source.

## First Task

1. Open `/office`.
2. Choose a small local project folder.
3. Choose a model mode:
   - Demo Only
   - BYO API Key
   - Local Model
4. Click `Run First Task: Update README`.
5. Confirm whether Context Preview appears.
6. Confirm whether a plan appears.
7. Confirm whether a diff appears before any write.
8. Confirm whether verification appears.
9. Confirm whether Human Gate / Apply Gate are understandable.
10. Stop and report if anything feels unsafe or confusing.

## What To Report

Use this format in the pilot tracker:

```text
Tester: T01
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
Feedback score:
Next fix:
```

## Good Feedback

Good feedback is specific:

- where you got stuck
- what wording was unclear
- whether you trusted the workflow
- whether you saw the diff before writes
- whether Human Gate felt clear
- whether support bundle generation worked

## Do Not Share

Do not share:

- API keys
- `.env` contents
- private keys
- wallet files
- certificates
- Apple signing material
- raw private source files
- full prompts or full model context
- private local machine paths
