# Tester DM Templates

Use these messages to invite external testers. Keep claims modest: Codingape Office is early, local-first, and safety-gated. It is not a fully autonomous developer.

## Friend Version

```text
Hey, I’m testing an open-source Mac app called Codingape Office.

It is a local AI coding worker: you choose a small project folder, ask for one simple code/docs change, review the evidence and diff, and approve before anything writes.

Could you try one first task and tell me where you get stuck?

Please use a small repo or disposable branch first, not an important production project.

Runbook:
https://github.com/guamee16888/codingape-office/blob/main/docs/pilot/TESTER_INTAKE_CHECKLIST.md

Feedback tracker:
https://github.com/guamee16888/codingape-office/issues/5
```

## Developer Version

```text
Hi, I’m running a small external pilot for Codingape Office.

It is an open-source local-first AI coding worker for Mac. The workflow is:

choose project -> evidence -> plan -> diff -> verification -> Human Gate -> Apply Gate -> rollback

The test is one safe first task: update a README in a small local project. I’m trying to learn whether the flow is understandable and trustworthy for real developers.

Please do not use a production-only repo for the first run, and please do not share API keys, .env contents, private paths, or private source in feedback.

Checklist:
https://github.com/guamee16888/codingape-office/blob/main/docs/pilot/TESTER_INTAKE_CHECKLIST.md

Tracker:
https://github.com/guamee16888/codingape-office/issues/5
```

## Open-source Contributor Version

```text
Hi, thanks for checking out Codingape Office.

I’m looking for external pilot feedback, not feature PRs yet. The goal is to see whether a new user can run the first task and understand the safety model:

- selected project folder only
- no full-disk scan by default
- context preview before model calls
- diff before write
- verification before apply
- Human Gate / Apply Gate before project writes
- rollback available

If you can test it, please use the checklist and leave one redacted result in the pilot tracker.

Checklist:
https://github.com/guamee16888/codingape-office/blob/main/docs/pilot/TESTER_INTAKE_CHECKLIST.md

Tracker:
https://github.com/guamee16888/codingape-office/issues/5

Please do not include secrets, API keys, private paths, or full private source code in public feedback.
```
