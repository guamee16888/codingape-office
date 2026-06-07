#!/usr/bin/env node

const TRACKER_URL = "https://github.com/guamee16888/codingape-office/issues/5";

function parseArgs(argv) {
  const args = { json: false };
  for (const token of argv) {
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--help") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function usage() {
  return `Usage:
  npm run pilot:feedback-template
  npm run pilot:feedback-template -- --json

Prints a public-safe pilot feedback template for external testers.
`;
}

function buildTemplate() {
  return `## Pilot First Run Feedback

Status: tester self-report.

\`\`\`text
Run mode: Demo Only / BYO API Key / Local Model
Install/local run: pass/fail/blocked
Project selected: pass/fail/blocked
Model configured: pass/fail/skipped/blocked
First task: pass/fail/blocked
Diff visible: yes/no
Human Gate understood: yes/no
Apply attempted: yes/no
Rollback visible: yes/no
Support bundle generated: yes/no
Main blocker: install / node / git / port-4142 / project-selection / model-provider / context-preview / diff-not-visible / verification / human-gate-confusing / apply / rollback / support-bundle / trust / other / none
Feedback score 1-5:
Next fix:
\`\`\`

What was the first confusing or blocked step?

Would you trust this workflow on a small real project? Why or why not?

Safety confirmation:

- [ ] I did not include API keys, .env contents, private keys, wallet files, certificates, or secrets.
- [ ] I did not paste full source files from a private project.
- [ ] I did not include private local machine paths.
- [ ] I saw evidence and/or a diff before any write.
- [ ] I understand Codingape Office should not apply patches without explicit approval.

Post this in the pilot tracker:
${TRACKER_URL}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const template = buildTemplate();
  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      trackerUrl: TRACKER_URL,
      template,
      safety: {
        writesFiles: false,
        readsProjectFiles: false,
        callsModelProvider: false,
        recordsTesterResult: false
      }
    }, null, 2));
    return;
  }
  console.log(template);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
