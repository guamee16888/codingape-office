# Stage-26 First Three Tester Invites Execution

Stage-26 turns reserved tester slots into real external invitations. Do not mark a tester as invited until a real message has been sent to a real person.

## Goal

Send three real external tester invites and keep issue #7 honest about invite and run status.

## Current Status

| Slot | Invite status | Run status | Evidence rule |
| --- | --- | --- | --- |
| T01 | Pending | Not started | Update only after a real invite is sent |
| T02 | Pending | Not started | Update only after a real invite is sent |
| T03 | Pending | Not started | Update only after a real invite is sent |
| T04 | Reserve | Not started | Use only after T01-T03 are sent |
| T05 | Reserve | Not started | Use only after T01-T03 are sent |

## Who To Invite

Prefer testers who can give concrete feedback within 10 minutes:

- a developer who can run a Node project from source
- a Mac user who can follow a checklist
- someone willing to test on a toy repo or disposable branch

Do not ask first testers to use production-only code.

## Message To Send

```text
Hi, I’m testing an open-source Mac app called Codingape Office.

It is a local AI coding worker for Mac: you choose a small project folder, ask for one simple code/docs change, review the evidence and diff, and approve before anything writes.

Could you try one first task and tell me where you get stuck?

Please use a small repo or disposable branch first, not an important production project.

Start here:
https://github.com/guamee16888/codingape-office/blob/main/docs/pilot/TESTER_INTAKE_CHECKLIST.md

Feedback tracker:
https://github.com/guamee16888/codingape-office/issues/5
```

## Invite Channels

Allowed public tracker labels:

- private DM
- email
- developer chat
- in-person

Do not publish tester names, email addresses, phone numbers, chat handles, private repo names, private screenshots, or private source.

## Public Tracker Update After Each Invite

After each real message is sent, comment on issue #7:

```text
Stage-26 invite update:

- T01: invited
- Channel: private DM / email / developer chat / in-person
- Date: YYYY-MM-DD
- Awaiting first-run result: yes

No private contact details, API keys, local paths, private source, or raw support bundle contents are recorded publicly.
```

Repeat for T02 and T03 only after each invite is actually sent.

## First-Run Success Criteria

A useful first run reaches one of these outcomes:

- tester sees a diff before any write and understands Human Gate
- tester is blocked, but the blocker category is clear and redacted feedback is available

Do not mark a run successful if the tester thinks Codingape Office writes code automatically before approval.

## Result Recording

After a tester finishes or gets blocked, record the result locally:

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

Review the generated redacted comment draft before posting it to issue #5.

## Do Not Record

Do not record:

- API keys
- `.env` contents
- private keys
- wallet files
- certificates
- Apple signing material
- private local paths
- raw private source files
- full prompts or full model context
- private tester contact details

## Truth Rules

- `invited` means a real message was sent.
- `run started` means the tester actually began the checklist.
- `result recorded` means a real tester result was captured with the pilot recorder or a manually reviewed redacted summary.
- Reserved slots are not adoption.
- A polite promise to test later is not a completed run.

