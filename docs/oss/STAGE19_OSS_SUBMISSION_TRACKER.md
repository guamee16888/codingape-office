# Stage-19 OSS Submission Tracker

Stage-19 turns the OpenAI OSS application draft into a submission-ready packet with public tracking. It does not claim that the application has been submitted or accepted.

## Goal

Make the OpenAI OSS application process trackable without leaking secrets or fabricating community proof.

## Current Status

| Item | Status |
| --- | --- |
| Public repository | Ready |
| README first screen | Ready |
| MIT license | Ready |
| Demo GIF | Ready |
| Release `v0.1.0` | Ready |
| Contributor guardrails | Ready |
| Security policy | Ready |
| Pilot tracker | Ready |
| OSS application packet generator | Ready |
| Stage-20 form worksheet | Ready |
| OpenAI OSS form submission | Pending user action |
| OpenAI response | Not received |

## Submission Packet

Generate the latest packet before filling out an external form:

```bash
npm run oss:application-packet
```

The generated files are local runtime artifacts and are intentionally not committed:

```text
data/oss-application/latest.md
data/oss-application/latest.json
```

The packet contains copy-ready fields for:

- project name
- repository URL
- one-line description
- maintainer role
- open-source impact
- what Codex or OpenAI OSS support would help with

Official form:

```text
https://openai.com/form/codex-for-oss/
```

## Public Evidence To Reference

- Repository: https://github.com/guamee16888/codingape-office
- Release: https://github.com/guamee16888/codingape-office/releases/tag/v0.1.0
- Pilot tracker: https://github.com/guamee16888/codingape-office/issues/5
- OSS submission tracker: https://github.com/guamee16888/codingape-office/issues/6
- Application draft: `docs/OPENAI_OSS_APPLICATION.md`
- Stage-20 form worksheet: `docs/oss/STAGE20_OPENAI_OSS_FORM_WORKSHEET.md`

## Do Not Submit

Do not include:

- API keys
- `.env` contents
- app-specific passwords
- Apple signing material
- private keys
- certificates
- wallet files
- raw private source files
- full model prompts or full model context
- private local machine paths

## Maintainer Submission Steps

1. Generate the latest packet.
2. Open the OpenAI OSS or developer ecosystem application form.
3. Copy only the public-safe fields from `data/oss-application/latest.md`.
4. Submit the form from the maintainer account.
5. Record the submission date and status in the public tracking issue.
6. Do not record any private email, account token, password, or form-only private data.

## Truth Rule

Use these statuses only:

- `pending`: form not submitted yet
- `submitted`: maintainer submitted the form
- `follow_up_requested`: OpenAI or program owner requested more information
- `accepted`: support was approved
- `declined`: support was declined
- `unknown`: status cannot be verified

If the status is not externally verified, keep it as `pending` or `unknown`.
