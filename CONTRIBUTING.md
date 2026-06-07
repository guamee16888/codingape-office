# Contributing to Codingape Office

Thanks for helping improve Codingape Office.

Codingape Office is a local-first AI coding worker for Mac. It is built around a safety-first workflow: evidence, plan, diff, verification, Human Gate, Apply Gate, and rollback before project files are changed.

## Contribution Guidelines

- Open an issue before large changes.
- Keep pull requests small and focused.
- Use pull requests for changes that affect `main`.
- Do not weaken safety guarantees.
- Do not add automatic code apply.
- Do not bypass Human Gate or Apply Gate.
- Do not change Project Root Guard behavior unless the issue is explicitly about file-access safety.
- Do not add secrets, API keys, local machine paths, certificates, or private screenshots.
- Do not change GitHub Actions, build scripts, signing, or release scripts unless the issue explicitly asks for it.
- Run `npm test` before opening a pull request when code changes are involved.

## Maintainer Merge Policy

Maintainers should also use pull requests for normal changes. Direct pushes to `main` should be reserved for documented emergencies such as secret removal, urgent security rollback, or disabling a dangerous workflow.

Safety-sensitive changes need extra care. This includes changes to Human Gate, Apply Gate, Project Root Guard, model provider configuration, support bundle redaction, patch generation, diff validation, sandbox apply, rollback, GitHub Actions, build scripts, signing, release scripts, or packaging.

The Stage-22 governance notes live in:

```text
docs/oss/STAGE22_PR_ONLY_GOVERNANCE.md
docs/maintainers/PR_ONLY_MAINTAINER_WORKFLOW.md
```

## Good First Issues

Good first contributions usually touch:

- README wording
- onboarding copy
- docs
- screenshots or demo instructions
- small UI copy improvements

For onboarding copy, please keep the message clear:

- Codingape Office runs locally on the user's Mac.
- The user must choose a project folder.
- The app does not scan the full disk by default.
- The app shows evidence and diffs before changing code.
- Project writes require explicit human approval.

## Pull Request Checklist

Before opening a pull request, confirm:

- The PR scope matches the issue.
- Safety behavior is unchanged.
- No secrets or local paths are included.
- User-facing claims do not imply fully autonomous coding.
- Tests pass, or the PR explains why tests were not needed.
