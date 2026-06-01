import test from "node:test";
import assert from "node:assert/strict";
import { add, divide, multiply } from "../src/math.js";

test("existing add and divide behavior is healthy", () => {
  assert.equal(add(2, 3), 5);
  assert.equal(divide(8, 2), 4);
  assert.throws(() => divide(5, 0), RangeError);
});

test("multiply returns a numeric product", () => {
  assert.equal(multiply(3, 4), 12);
});
