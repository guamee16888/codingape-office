import { runNightlyHealthChecksForDate } from "../lib/nightly.mjs";

const dateString = process.argv[2] || new Date().toISOString().slice(0, 10);
const result = await runNightlyHealthChecksForDate(dateString);

console.log(JSON.stringify({
  date: result.date,
  project_count: result.project_count,
  reports: result.results.map((item) => ({
    project_id: item.project_id,
    analyzed_count: item.analyzed_count,
    failed_analysis_count: item.failed_analysis_count,
    report_id: item.report_id,
    delivery_count: item.deliveries.length,
  })),
}, null, 2));
