import { analyzeRun } from "../lib/judge.mjs";

const runId = process.argv[2];

if (!runId) {
  console.error("Usage: npm run analyze -- <run_id>");
  process.exit(1);
}

const result = await analyzeRun(runId);
console.log(JSON.stringify(result, null, 2));

