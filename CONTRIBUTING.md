# Contributing to Codingape Office

Thanks for helping improve Codingape Office.

Codingape Office is a local-first AI coding worker for Mac. It is built around a safety-first workflow: evidence, plan, diff, verification, Human Gate, Apply Gate, and rollback before project files are changed.

## Contribution Guidelines

- Open an issue before large changes.
- Keep pull requests small and focused.
- Do not weaken safety guarantees.
- Do not add automatic code apply.
- Do not bypass Human Gate or Apply Gate.
- Do not change Project Root Guard behavior unless the issue is explicitly about file-access safety.
- Do not add secrets, API keys, local machine paths, certificates, or private screenshots.
- Do not change GitHub Actions, build scripts, signing, or release scripts unless the issue explicitly asks for it.
- Run `npm test` before opening a pull request when code changes are involved.

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

