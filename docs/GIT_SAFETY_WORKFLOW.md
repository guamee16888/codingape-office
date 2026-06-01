# Git Safety Workflow

Coding猿 Office should always have a recoverable code baseline before risky work starts.

## Baseline Rules

- Keep source, tests, docs, launch scripts, and reproducible config in git.
- Keep runtime evidence, local databases, imported sessions, generated output, logs, and secrets out of git.
- Use one branch per task when a change is larger than a quick copy or text edit.
- Commit only after tests or syntax checks pass.
- Tag stable local releases after the service is verified.

## Normal Change Loop

1. Check state:

   ```sh
   git status --short
   ```

2. Create a task branch:

   ```sh
   git switch -c codex/<short-task-name>
   ```

3. Make the change, then verify:

   ```sh
   node --check server.js
   node --check public/app.js
   npm test
   ```

4. Commit:

   ```sh
   git add <changed source files>
   git commit -m "<clear change summary>"
   ```

5. After local/public health checks pass, tag a stable point:

   ```sh
   git tag stable/YYYYMMDD-HHMM
   ```

## Local Rollback

Use this only when the code has broken and you need to return to a known good commit or tag.

```sh
git status --short
git switch main
git reset --hard <stable-tag-or-commit>
launchctl kickstart -k gui/$(id -u)/com.geoaifactory.codex-office
```

Then verify:

```sh
curl -I http://127.0.0.1:4142/
curl -I http://127.0.0.1:4142/office
npm test
```

## Data Backup

`data/` and `integrations/ai-worker-control-plane/.data/` are intentionally ignored by git. Back them up separately before destructive migrations or schema changes.
