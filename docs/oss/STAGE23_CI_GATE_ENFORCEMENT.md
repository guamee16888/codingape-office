# Stage-23 CI Gate Enforcement

Stage-23 adds the first GitHub Actions CI gate and prepares the repository for required status checks.

## Goal

Make pull requests verifiable by GitHub before they can be merged to `main`.

## Current Status

| Item | Status |
| --- | --- |
| Draft PR for governance docs | https://github.com/guamee16888/codingape-office/pull/9 |
| CI workflow proposed | Ready in PR branch |
| CI observed on PR | Passed on PR #9 |
| CI workflow merged to `main` | Verified |
| Required status check configured | Verified: `npm test` |
| Admin bypass disabled | Verified |
| Merge attempt without admin bypass | Blocked by review policy |
| Auto-merge | Not enabled for this repository |

## CI Workflow

The first CI workflow is:

```text
.github/workflows/ci.yml
```

It runs:

```bash
npm install --no-audit --no-fund
npm test
```

It uses Node.js 24 because the AI Worker Control Plane integration imports `node:sqlite`, which is not available in the Node 20 runner used by the first CI attempt.

The check name should appear as:

```text
npm test
```

GitHub must observe this check on a pull request before it can be safely added as a required status check.

## Enforcement Sequence

1. Keep PR #9 open.
2. Push the CI workflow to the PR branch.
3. Mark PR #9 ready for review.
4. Wait for the CI check to run.
5. If CI passes and review is satisfied, merge PR #9.
6. After the workflow exists on `main`, update branch protection to require the `npm test` check.
7. If the repository settings allow it, disable maintainer/admin bypass.

Do not require a status check before GitHub has observed that check name. A required check that does not exist can block all future merges for the wrong reason.

## Truth Rule

Do not mark Stage-23 as enforced until current GitHub branch protection shows:

- required status check configured
- CI check passing on the relevant branch or PR
- admin bypass disabled, or a documented reason why GitHub does not allow it

## Latest Verified State

As of Stage-23, PR #9 is ready for review and the `CI / npm test` check passed on the pull request:

```text
https://github.com/guamee16888/codingape-office/actions/runs/27098787720
```

A normal merge without administrator bypass was attempted and blocked by branch policy because review is still required. Auto-merge was also attempted, but GitHub reported that auto-merge is not enabled for this repository.

This is the correct remaining blocker: review/merge governance, not a code or test failure.

Stage-24 resolved that blocker by switching to solo-maintainer governance:

```text
docs/oss/STAGE24_SOLO_MAINTAINER_GOVERNANCE.md
```
