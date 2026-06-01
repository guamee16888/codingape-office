import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sandboxSignal, summarizeSandboxSignal } from "../src/worker-signal.js";

const source = readFileSync(new URL("../src/worker-signal.js", import.meta.url), "utf8");

assert.equal(sandboxSignal.worker, "coding-yuan");
assert.equal(sandboxSignal.status, "ready");
assert.ok(source.includes("rollback-snapshot"));
assert.equal(summarizeSandboxSignal(), "coding-yuan:ready:3");

console.log("sandbox demo verification passed");
