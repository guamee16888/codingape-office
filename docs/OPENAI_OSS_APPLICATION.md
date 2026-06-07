# OpenAI OSS Application Draft

Use this document as copy material for an OpenAI OSS or developer ecosystem application. Do not include private credentials, API keys, Apple signing material, or local machine paths in any submitted form.

## Project Summary

Codingape Office is an open-source, local-first AI coding worker for macOS.

It helps developers use AI to modify local code projects safely. Instead of letting an AI agent silently change files, Codingape Office follows a safety-gated workflow: project selection, evidence collection, AI plan generation, patch generation, diff preview, verification, Human Gate, Apply Gate, rollback snapshot, and final report.

The project supports Demo Only mode, BYO API keys, and local model providers such as Ollama, LM Studio, and OpenAI-compatible endpoints. It is designed for developers who want AI-assisted code changes while keeping control over project access, model context, diffs, approvals, and rollback.

## Why This Project Matters

Many AI coding tools optimize for speed, but developers still need safer workflows for real projects. Codingape Office focuses on controlled AI code modification.

The project is useful to the open-source ecosystem because it explores safety primitives for local AI coding agents:

- user-selected project roots instead of full-disk scans
- context minimization before model calls
- sensitive file filtering
- unified diff validation
- sandbox patch application
- verification before apply
- explicit human approval gates
- rollback snapshots
- secret-redacted support bundles
- local and BYO model provider support

The goal is not to create a fully autonomous developer, but to build a practical, auditable, local-first AI coding worker that developers can inspect, run, improve, and safely experiment with.

## Maintainer Activity

I am the maintainer of the project and actively work on the core safety workflow, AI patch worker, macOS packaging, evaluation harness, documentation, and external pilot process.

The repository includes tests, fixtures, evaluation scripts, docs, a contribution guide, a demo GIF, MIT license, v0.1.0 release tag, and a structured benchmark for AI patch reliability. The project has also started receiving external contributor interest and PR activity.

## What Support Would Enable

Access to Codex would help accelerate development of the open-source safety workflow, especially around:

- improving AI patch reliability
- expanding fixture-based evaluation
- hardening diff validation
- improving first-time user onboarding
- documenting safe model provider setup
- reviewing external contributions
- preparing the macOS pilot build and App Store candidate pipeline

The project is still early, but it has a clear open-source purpose: make AI-assisted code changes safer, more inspectable, and more developer-controlled.

## Short Version

Codingape Office is an open-source local-first AI coding worker for macOS.

It helps developers use AI to change code safely by requiring evidence, an AI plan, diff preview, verification, Human Gate, Apply Gate, and rollback before any write to the selected project folder.

The project supports Demo Only, BYO API keys, and local model providers such as Ollama and LM Studio. It focuses on safety primitives for AI coding agents: project root guards, sensitive file filtering, context minimization, unified diff validation, sandbox apply, human approval, rollback, and redacted support bundles.

I am the project maintainer and actively maintain the code, docs, evaluation fixtures, macOS packaging pipeline, and contributor workflow. Codex access would help improve AI patch reliability, evaluation coverage, onboarding, documentation, and OSS contributor review.

## Submission Checklist

Before submitting:

- [x] Repository is public.
- [x] README first screen explains the project in plain English.
- [x] MIT license is present.
- [x] Release `v0.1.0` exists.
- [x] Demo GIF is visible in README or release notes.
- [x] `CONTRIBUTING.md` is present.
- [x] `SECURITY.md` is present.
- [x] GitHub issue and PR templates are present.
- [x] At least one external pilot tracker issue exists.
- [x] Do not include API keys, Apple credentials, private local paths, app-specific passwords, or private source code in the application.
- [ ] Submit the OpenAI OSS application from the maintainer account.
- [ ] Record the submitted status in the public OSS tracker.

Generate the latest local application packet before submitting:

```bash
npm run oss:application-packet
```

The generated files are local runtime artifacts and are not committed:

```text
data/oss-application/latest.md
data/oss-application/latest.json
```

The packet summarizes repository metadata, release evidence, pilot tracker status, the no-fabricated-data scorecard rule, and copy-ready form fields.

## Stage-19 Submission Tracker

Stage-19 tracks the application process without claiming that submission has already happened:

```text
docs/oss/STAGE19_OSS_SUBMISSION_TRACKER.md
```

Public GitHub tracker:

```text
https://github.com/guamee16888/codingape-office/issues/6
```

Official form:

```text
https://openai.com/form/codex-for-oss/
```

Stage-20 copy-ready form worksheet:

```text
docs/oss/STAGE20_OPENAI_OSS_FORM_WORKSHEET.md
```

## Suggested Form Fields

Project name:

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

Maintainer role:

```text
I am the maintainer and primary developer of Codingape Office. I maintain the safety workflow, AI patch worker, evaluation fixtures, macOS packaging pipeline, documentation, and contributor workflow.
```

Open-source impact:

```text
Codingape Office explores safety primitives for AI-assisted code changes: selected project roots, context minimization, sensitive file filtering, unified diff validation, sandbox apply, verification before apply, human approval gates, rollback snapshots, and redacted support bundles.
```

What access would help with:

```text
Codex access would help improve AI patch reliability, expand evaluation fixtures, harden diff validation, improve first-run onboarding, document model provider setup, review external contributions, and support the macOS external pilot.
```
