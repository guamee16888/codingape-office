import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildLocalPreviewResult } from "../lib/local-preview.mjs";
import { buildReportEvidencePack, recordReportEvidencePackExport } from "../lib/report-evidence.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const reportIdArg = valueAfter(args, "--report");
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/report-evidence-pack.json");
const redact = args.includes("--redact");

const reportId = reportIdArg || (await buildLocalPreviewResult({
  date: valueAfter(args, "--date") || undefined,
  forceGenerate: args.includes("--force"),
})).report_id;

const pack = buildReportEvidencePack(reportId, { redact });

if (!pack) {
  console.error(`Report not found: ${reportId}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
const audit = recordReportEvidencePackExport(reportId, pack, {
  actorType: "local_operator",
  actorId: "local",
  exportSurface: "local_cli",
});

console.log(JSON.stringify({
  report_id: pack.report.id,
  project_id: pack.report.project_id,
  source_run_count: pack.summary.source_run_count,
  redaction_mode: pack.redaction.mode,
  evidence_pack_hash: pack.integrity.evidence_pack_hash,
  audit_event_id: audit?.audit_event_id || null,
  output_path: outPath,
}, null, 2));
