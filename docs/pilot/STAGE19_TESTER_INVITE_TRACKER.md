# Stage-19 Tester Invite Tracker

Stage-19 prepares the first real external tester invite loop. It does not invent tester results and does not count a reserved slot as a completed run.

## Goal

Invite at least 3 real external testers and track whether they can reach a visible diff with Human Gate understood within about 10 minutes.

## Current Status

| Item | Status |
| --- | --- |
| Public pilot tracker issue | Ready |
| Tester slots `T01` to `T05` | Reserved |
| Tester DM templates | Ready |
| Tester intake checklist | Ready |
| Local result recorder | Ready |
| Public invite tracker | https://github.com/guamee16888/codingape-office/issues/7 |
| Real invites sent | Pending |
| Real tester results recorded | 0 |

## Invite Targets

Start with 3 testers, then expand to 5 if the first runs are understandable.

| Slot | Invite status | Run status | Notes |
| --- | --- | --- | --- |
| T01 | Pending | Not started | First external tester |
| T02 | Pending | Not started | Second external tester |
| T03 | Pending | Not started | Third external tester |
| T04 | Optional | Not started | Reserve slot |
| T05 | Optional | Not started | Reserve slot |

## What Testers Should Try

1. Clone or run Codingape Office.
2. Open `/office`.
3. Choose a small local project folder.
4. Choose Demo Only, BYO API Key, or Local Model.
5. Run `Run First Task: Update README`.
6. Confirm the diff is visible before any write.
7. Confirm Human Gate and Apply Gate are understood.
8. Export feedback JSON or a support bundle if blocked.

## Safe Result Recording

Record a tester run locally:

```bash
npm run pilot:record-tester -- \
  --tester-id T01 \
  --run-mode demo_only \
  --install-status pass \
  --project-selected pass \
  --model-configured skipped \
  --first-task pass \
  --diff-visible yes \
  --human-gate-understood yes \
  --apply-attempted no \
  --rollback-visible yes \
  --support-bundle-generated no \
  --main-blocker none \
  --feedback-score 4 \
  --next-fix "Clarify model setup"
```

The recorder writes local, gitignored runtime files:

```text
data/pilot/tester-results.jsonl
data/pilot/stage17-scorecard.json
data/pilot/latest-tester-result.json
data/pilot/github-comments/T01.md
```

Post only the redacted comment draft to GitHub after reviewing it manually.

## Do Not Record

Do not record:

- API keys
- `.env` contents
- private keys
- certificates
- wallet files
- Apple signing material
- raw private source files
- full prompts or full model context
- private local machine paths
- tester personal contact details

## Success Signal

A run is useful if the tester reaches either:

- a visible diff with Human Gate understood, or
- a clear blocker category with redacted support material

Do not mark a run successful if the tester does not understand that Codingape Office will not write code before approval.
