# Stage-20 First Three Tester Invites

Stage-20 turns reserved pilot slots into real invitations. Do not mark a slot as invited until a real message has been sent to a real person.

## Goal

Send the first 3 external tester invites and keep GitHub issue #7 honest about invite status.

## Current Status

| Slot | Invite status | Evidence rule |
| --- | --- | --- |
| T01 | Pending | Update only after a real invite is sent |
| T02 | Pending | Update only after a real invite is sent |
| T03 | Pending | Update only after a real invite is sent |
| T04 | Reserve | Use after T01-T03 are sent |
| T05 | Reserve | Use after T01-T03 are sent |

For the Stage-26 execution checklist, use:

```text
docs/pilot/STAGE26_FIRST_THREE_TESTER_INVITES_EXECUTION.md
```

## Invite Message

Use this short version for the first 3 testers:

```text
Hi, I’m testing an open-source Mac app called Codingape Office.

It is a local AI coding worker: you choose a small project folder, ask for one simple code/docs change, review the evidence and diff, and approve before anything writes.

Could you try one first task and tell me where you get stuck?

Please use a small repo or disposable branch first, not an important production project.

Runbook:
https://github.com/guamee16888/codingape-office/blob/main/docs/pilot/TESTER_INTAKE_CHECKLIST.md

Feedback tracker:
https://github.com/guamee16888/codingape-office/issues/5
```

## Public Tracker Update After Invites

After each real invite is sent, comment on issue #7:

```text
Stage-20 invite update:

- T01: invited
- Channel: private DM / email / developer chat
- Date: YYYY-MM-DD
- Awaiting first-run result: yes

No private contact details are recorded publicly.
```

Do not include the tester's private email, phone number, private chat handle, API key, source code, local path, or screenshots with personal data.

## Result Recording After A Run

When a tester finishes or gets blocked, record the run locally:

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

Review the generated comment draft before posting it to issue #5.
