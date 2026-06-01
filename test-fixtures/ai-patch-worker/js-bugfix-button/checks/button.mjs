import test from "node:test";
import assert from "node:assert/strict";
import { getButtonLabel } from "../src/button.js";

test("uses explicit label", () => {
  assert.equal(getButtonLabel({ label: "Create" }), "Create");
});
