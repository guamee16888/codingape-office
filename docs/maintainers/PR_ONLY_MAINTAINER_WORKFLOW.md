# PR-only Maintainer Workflow

Use this workflow for Codingape Office changes after Stage-22.

## Standard Flow

1. Start from an up-to-date `main`.
2. Create a branch using the `codex/` prefix.
3. Make a focused change.
4. Run the relevant checks.
5. Push the branch.
6. Open a pull request.
7. Let the PR checklist and GitHub review surface the change.
8. Merge only after the scope and safety checklist are clear.

## Suggested Commands

```bash
git fetch origin main
git switch -c codex/short-change-name origin/main
```

After changes and checks:

```bash
git status --short
git add <changed-files>
git commit -m "Short change summary"
git push -u origin HEAD
gh pr create --draft --base main --head "$(git branch --show-current)"
```

Use a ready PR instead of a draft only when the change is already reviewed locally and all relevant checks have passed.

## Review Rules

For docs-only PRs:

- confirm no secrets or private local paths are present
- confirm claims are modest and accurate
- confirm OpenAI OSS, pilot, and release statuses are not overstated

For product-code PRs:

- run `npm test`
- verify Human Gate and Apply Gate remain intact
- verify Project Root Guard still blocks unsafe paths
- verify model/provider changes do not leak API keys

For safety-sensitive PRs:

- explain why the change is necessary
- keep the diff small
- add or update tests
- do not merge until the safety impact is clear

## Direct Push Rule

Do not push directly to `main` for normal work.

Allowed exceptions:

- emergency secret removal
- urgent security rollback
- disabling a dangerous workflow

If an exception is used, create a public follow-up issue without exposing secrets.

