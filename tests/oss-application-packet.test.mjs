import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("OSS application packet is generated without secrets or fabricated pilot results", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "codingape-oss-packet-"));
  const scriptPath = fileURLToPath(new URL("../scripts/generate-oss-application-packet.mjs", import.meta.url));

  const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--offline"], {
    env: { ...process.env, CODEX_OFFICE_DATA_DIR: tmp }
  });
  const result = JSON.parse(stdout);

  assert.equal(result.project.repository, "https://github.com/guamee16888/codingape-office");
  assert.equal(result.project.license, "MIT License");
  assert.equal(result.pilot.recordedResults, 0);
  assert.equal(result.pilot.localTesterResultsRecorded, 0);

  const packetJson = JSON.parse(await readFile(join(tmp, "oss-application", "latest.json"), "utf8"));
  assert.equal(packetJson.formFields.projectName, "Codingape Office");
  assert.match(packetJson.formFields.oneLineDescription, /local-first AI coding worker/);
  assert.equal(packetJson.evidence.scorecardSaysNoFabricatedData, true);
  assert.equal(packetJson.evidence.recorderSafetyTestPresent, true);

  const packetMd = await readFile(join(tmp, "oss-application", "latest.md"), "utf8");
  assert.match(packetMd, /OpenAI OSS Application Packet/);
  assert.match(packetMd, /Do not include private credentials/);
  assert.doesNotMatch(packetMd, /\/Users\//);
  assert.doesNotMatch(packetMd, /sk-[A-Za-z0-9_-]{20,}/);
});
