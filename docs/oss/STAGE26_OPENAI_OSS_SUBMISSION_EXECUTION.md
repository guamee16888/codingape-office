# Stage-26 OpenAI OSS Submission Execution

Stage-26 turns the prepared OSS application packet into a maintainer-submitted application. This document is intentionally public-safe: it does not store account details, OpenAI Organization IDs, emails, tokens, or private form screenshots.

## Goal

Submit the OpenAI OSS application from the maintainer account, then update the public tracker with only the submission status.

## Current Status

| Item | Status |
| --- | --- |
| Public repository | Ready |
| Latest public release | `v0.1.1` |
| Required CI on `main` | Ready |
| Branch protection evidence | Ready |
| OSS application packet | Ready |
| Public tracker issue | Ready |
| Maintainer form submission | Pending user action |
| OpenAI response | Not received |

## Authoritative Inputs

Generate the latest local packet immediately before filling the form:

```bash
npm run oss:application-packet
```

Use:

```text
data/oss-application/latest.md
```

Public evidence links:

```text
Repository:
https://github.com/guamee16888/codingape-office

Latest release:
https://github.com/guamee16888/codingape-office/releases/tag/v0.1.1

Pilot tracker:
https://github.com/guamee16888/codingape-office/issues/5

OpenAI OSS tracker:
https://github.com/guamee16888/codingape-office/issues/6
```

Official form:

```text
https://openai.com/form/codex-for-oss/
```

## Submission Steps

1. Run `npm run oss:application-packet`.
2. Open the official form in the maintainer browser session.
3. Fill private identity fields directly in the form.
4. Copy only public-safe project fields from `data/oss-application/latest.md`.
5. Review the final form before submit.
6. Submit from the maintainer account.
7. Update issue #6 with status `submitted`.

## Private Fields

Enter these directly in the OpenAI form only:

- first name
- last name
- email
- OpenAI Organization ID
- account-specific details requested by the form

Do not commit them. Do not paste them into GitHub issues. Do not include them in screenshots, support bundles, logs, or local docs.

## Public-Safe Short Answers

Use the latest generated packet for full answers. If the form asks for shorter fields, these are safe starting points.

Project:

```text
Codingape Office
```

Repository:

```text
https://github.com/guamee16888/codingape-office
```

One-line description:

```text
A local-first AI coding worker for Mac: evidence, diff, verification, human approval, and rollback before code writes.
```

Why this qualifies:

```text
Codingape Office is an active MIT-licensed OSS project for safer AI-assisted code changes on Mac. It implements selected project roots, context minimization, sensitive-file filtering, unified diff validation, sandbox apply, verification, Human Gate, Apply Gate, rollback, support bundles, required CI, and public pilot tracking. It is early but maintained and focused on reusable safety patterns for coding agents.
```

How credits would be used:

```text
Use credits to improve the open-source AI patch worker: run fixture-based patch evaluations, test provider reliability, review PRs, generate safe docs/examples, harden diff validation, and validate context minimization. Credits will not be used to upload whole private repositories or bypass human approval gates.
```

Anything else:

```text
Public signals are early but honest: public releases, required CI, branch protection, safety docs, PR/issue templates, and pilot tracking. We are not claiming broad adoption yet; the goal is to accelerate a maintainer-led safety workflow for local AI coding agents.
```

## Public Tracker Update After Submission

After the maintainer clicks submit, comment on issue #6:

```text
Stage-26 update: the OpenAI OSS application has been submitted by the maintainer.

Status: submitted
Submitted date: YYYY-MM-DD

Public evidence used:
- Repository: https://github.com/guamee16888/codingape-office
- Release: https://github.com/guamee16888/codingape-office/releases/tag/v0.1.1
- Pilot tracker: https://github.com/guamee16888/codingape-office/issues/5

No private account data, Organization ID, credentials, API keys, private source, local paths, or form-only private data are recorded here.
```

## Truth Rules

- Keep status `pending` until the maintainer actually submits the form.
- Do not claim approval until OpenAI confirms approval.
- Do not record private identity or account details.
- Do not post screenshots that reveal private browser/account state.
- If the form changes or cannot be submitted, record the blocker without private data.

