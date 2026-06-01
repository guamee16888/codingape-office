import test from "node:test";
import assert from "node:assert/strict";
import { add, divide } from "../src/math.js";

test("add returns a number sum", () => {
  assert.equal(add(2, 3), 5);
});

test("divide handles normal and zero divisors", () => {
  assert.equal(divide(8, 2), 4);
  assert.throws(() => divide(5, 0), RangeError);
});
