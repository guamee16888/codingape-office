import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEvidencePackIntegrity } from "../lib/report-evidence.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const filePath = resolve(process.cwd(), valueAfter(args, "--file") || args[0] || "local-output/report-evidence-pack.json");
const pack = JSON.parse(readFileSync(filePath, "utf8"));
const result = verifyEvidencePackIntegrity(pack);

console.log(JSON.stringify({
  file_path: filePath,
  ...result,
}, null, 2));

if (!result.valid) {
  process.exit(1);
}
