import { generateNightlyReport } from "../lib/reports.mjs";

const projectId = process.argv[2];
const dateString = process.argv[3] || new Date().toISOString().slice(0, 10);

if (!projectId) {
  console.error("Usage: npm run report -- <project_id> [YYYY-MM-DD]");
  process.exit(1);
}

const result = generateNightlyReport(projectId, dateString);
console.log(result.markdown);

