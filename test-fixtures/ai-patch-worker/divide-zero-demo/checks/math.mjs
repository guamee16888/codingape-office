import test from "node:test";
import assert from "node:assert/strict";
import { add, divide } from "../src/math.js";

test("add is already a numeric sum", () => {
  assert.equal(add(2, 3), 5);
});

test("divide handles normal divisors", () => {
  assert.equal(divide(8, 2), 4);
});

test("divide throws RangeError for zero divisors", () => {
  assert.throws(() => divide(5, 0), RangeError);
});
