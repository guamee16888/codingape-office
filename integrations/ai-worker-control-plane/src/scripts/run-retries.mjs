import { runRetryQueue } from "../lib/retries.mjs";

const now = process.argv[2] || new Date().toISOString();
const result = await runRetryQueue({ now });

console.log(JSON.stringify({
  retried_analysis_count: result.retried_analysis_count,
  retried_delivery_count: result.retried_delivery_count,
}, null, 2));

