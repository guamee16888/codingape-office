# Stage-24 Solo Maintainer Governance

Stage-24 makes Codingape Office governance practical for a solo maintainer while preserving pull-request reviewability and CI enforcement.

## Goal

Avoid direct `main` pushes and avoid impossible self-review requirements.

## Verified Branch Protection

Current `main` branch protection:

| Setting | Verified value |
| --- | --- |
| Pull request protection | Enabled |
| Required approving reviews | 0 |
| Required status checks | `npm test` |
| Strict status checks | Enabled |
| Admin enforcement | Enabled |
| Force pushes | Disabled |
| Deletions | Disabled |

## Why Reviews Are 0 For Now

Codingape Office currently has a solo maintainer. Requiring 1 approving review made normal PR merges impossible without either:

- waiting for a second trusted maintainer, or
- using administrator bypass.

The Stage-24 policy keeps pull requests and CI required, but sets approving reviews to 0 until a second trusted maintainer exists.

This is safer than direct pushes because:

- every normal change still goes through a PR
- GitHub Actions must pass
- admin enforcement applies branch protection to maintainers
- force pushes and branch deletion remain disabled
- review requirement can be raised back to 1 when a trusted reviewer exists

## Required Check

The required check is:

```text
npm test
```

It comes from:

```text
.github/workflows/ci.yml
```

The workflow uses Node.js 24 because the AI Worker Control Plane integration imports `node:sqlite`.

## When To Require Reviews Again

Raise `required_approving_review_count` to `1` after at least one trusted maintainer or recurring reviewer is available.

Good candidates should understand:

- Human Gate and Apply Gate
- Project Root Guard
- sensitive file filtering
- model provider and API key redaction
- support bundle redaction
- patch/diff/rollback safety

## Public Tracker

Governance tracker:

```text
https://github.com/guamee16888/codingape-office/issues/8
```

