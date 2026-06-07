# Security Policy

Codingape Office is a local-first AI coding worker for macOS. Its core safety model is built around user-selected project roots, evidence, diff review, verification, Human Gate, Apply Gate, and rollback before project writes.

## Supported Versions

This project is early and currently supports the latest `main` branch and the latest public release tag.

## Reporting A Vulnerability

Please do not open a public GitHub issue for vulnerabilities that could expose user projects, secrets, model keys, Apple signing material, or local filesystem access.

Use GitHub Security Advisories:

```text
https://github.com/guamee16888/codingape-office/security/advisories/new
```

If you cannot use GitHub Security Advisories, open a minimal public issue that says you need a private security contact. Do not include exploit details, secrets, API keys, local paths, or private source code.

## High-priority Security Areas

Please report issues involving:

- Project Root Guard bypasses
- path traversal or writes outside the selected project root
- Human Gate or Apply Gate bypasses
- automatic project writes without explicit approval
- sensitive file reads or patches involving `.env`, credentials, private keys, wallets, or certificates
- API keys or secrets appearing in logs, screenshots, reports, evaluation output, or support bundles
- model provider prompts or reports containing full private source code unexpectedly
- support bundle redaction failures
- unsafe build, packaging, signing, or release script behavior

## Safety Invariants

Security fixes must preserve these invariants:

- no full-disk scan by default
- no automatic code writes
- user chooses the project folder
- model context is minimized to task-relevant snippets
- sensitive files are skipped
- diff is shown before write
- verification runs before apply
- Human Gate and Apply Gate are required before writes
- rollback remains available
- secrets are redacted from diagnostics and support material

## Disclosure Expectations

When reporting privately, please include:

- a short summary
- affected version or commit
- reproduction steps using a disposable test project
- expected impact
- whether secrets or private files could be exposed

Please do not include real API keys, private repository source, Apple credentials, certificates, wallet material, or production secrets.
