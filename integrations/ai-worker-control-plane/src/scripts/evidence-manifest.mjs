import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEvidencePackIntegrity } from "../lib/report-evidence.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const dir = resolve(process.cwd(), valueAfter(args, "--dir") || "local-output");
const outPath = resolve(process.cwd(), valueAfter(args, "--out") || "local-output/evidence-manifest.json");

const files = readdirSync(dir)
  .filter((name) => name.includes("evidence-pack") && name.endsWith(".json"))
  .sort();

const packs = files.map((name) => {
  const path = resolve(dir, name);
  const pack = JSON.parse(readFileSync(path, "utf8"));
  const verification = verifyEvidencePackIntegrity(pack);

  return {
    file: path,
    report_id: pack.report?.id || null,
    project_id: pack.report?.project_id || null,
    period_start: pack.report?.period_start || null,
    period_end: pack.report?.period_end || null,
    redaction_mode: pack.redaction?.mode || "unknown",
    source_run_count: pack.summary?.source_run_count || 0,
    evidence_pack_hash: pack.integrity?.evidence_pack_hash || null,
    valid: verification.valid,
    verification_reason: verification.reason,
  };
});

const manifest = {
  manifest_version: "2026-05-22.v1",
  generated_at: new Date().toISOString(),
  evidence_pack_count: packs.length,
  valid_count: packs.filter((pack) => pack.valid).length,
  invalid_count: packs.filter((pack) => !pack.valid).length,
  packs,
};

writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  output_path: outPath,
  evidence_pack_count: manifest.evidence_pack_count,
  valid_count: manifest.valid_count,
  invalid_count: manifest.invalid_count,
}, null, 2));
