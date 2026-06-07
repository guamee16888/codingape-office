# Stage-22 PR-only Governance

Stage-22 moves Codingape Office toward a healthier open-source workflow: contributors and maintainers should use pull requests for changes that affect `main`.

This document records the current governance state and the next enforcement steps. It does not claim that branch protection is fully enforced yet.

## Goal

Make the public repository safer for external contributors by requiring reviewable changes, visible checks, and clear maintainer merge rules.

Public tracker:

```text
https://github.com/guamee16888/codingape-office/issues/8
```

## Current Evidence

GitHub currently reports branch protection on `main` with:

- pull request review required: yes
- required approving reviews: 0
- force pushes disabled: yes
- deletions disabled: yes
- admin enforcement: yes
- required status checks: `npm test`

Earlier Stage-22 setup allowed maintainer bypass because admin enforcement was disabled. GitHub showed this warning during direct pushes:

```text
Bypassed rule violations for refs/heads/main:
- Changes must be made through a pull request.
```

## Stage-22 Policy

From Stage-22 onward:

- normal maintainer work should happen on `codex/*` branches
- changes should be opened as pull requests
- `main` should not receive direct pushes except emergency security rollback
- docs-only changes may still use a lightweight PR, but should remain reviewable
- safety-sensitive changes should require extra review before merge
- external contributors should never receive maintainer or collaborator access for first contributions

## Safety-sensitive Areas

Treat these paths and behaviors as safety-sensitive:

- Human Gate / Apply Gate behavior
- Project Root Guard
- sensitive file filtering
- model provider configuration and key storage
- support bundle redaction
- patch generation, diff validation, sandbox apply, rollback
- GitHub Actions, build scripts, release scripts, signing, notarization, App Store packaging
- security policy and vulnerability reporting flow

## Recommended GitHub Settings

In GitHub repository settings:

1. Open `Settings -> Branches -> Branch protection rules`.
2. Edit the rule for `main`.
3. Keep `Require a pull request before merging` enabled.
4. Keep at least `1` approving review required.
5. Enable `Do not allow bypassing the above settings` or equivalent admin enforcement if available.
6. Disable force pushes.
7. Disable deletions.
8. Add required status checks after GitHub Actions are present and stable.

Do not add a required status check until that check exists and is passing consistently; otherwise, contributors may be blocked by a missing check rather than by real quality gates.

## Emergency Exception

Direct maintainer push to `main` is allowed only for a documented emergency, such as:

- removing a leaked secret from public docs
- reverting a broken release artifact link
- disabling a dangerous workflow

After an emergency push, open a follow-up issue explaining:

- what was pushed
- why PR flow was bypassed
- what verification was run
- what will prevent repeat bypasses

Do not include private secrets, tokens, local paths, or private source in that issue.

## Status

| Item | Status |
| --- | --- |
| Branch protection exists | Observed |
| Pull request review required | Observed |
| Admin bypass disabled | Verified |
| Required status checks configured | Verified: `npm test` |
| PR-only maintainer policy documented | Ready |
| Public governance tracker | https://github.com/guamee16888/codingape-office/issues/8 |

## Stage-23 Follow-up

Stage-23 adds the first GitHub Actions CI gate and prepares `main` for required status checks:

```text
docs/oss/STAGE23_CI_GATE_ENFORCEMENT.md
```

Stage-24 records the solo-maintainer governance mode:

```text
docs/oss/STAGE24_SOLO_MAINTAINER_GOVERNANCE.md
```
