import test from "node:test";
import assert from "node:assert/strict";
import { normalizeUser } from "../src/user.js";

test("normalizes email case", () => {
  assert.deepEqual(normalizeUser({ email: "A@EXAMPLE.COM", name: "A" }), {
    email: "a@example.com",
    name: "A"
  });
});
