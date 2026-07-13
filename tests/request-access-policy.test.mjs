import assert from "node:assert/strict";
import { test } from "node:test";
import { localOperatorAccess } from "../src/request-access-policy.mjs";

test("public hosts can access public pages but not operator routes", () => {
  assert.equal(localOperatorAccess({ host: "geoaifactory.com", pathname: "/" }).allowed, true);
  assert.equal(localOperatorAccess({ host: "geoaifactory.com", pathname: "/demo" }).allowed, true);
  assert.equal(localOperatorAccess({ host: "geoaifactory.com", pathname: "/office" }).allowed, false);
  assert.equal(localOperatorAccess({ host: "geoaifactory.com", pathname: "/api/status" }).allowed, false);
  assert.equal(localOperatorAccess({ host: "geoaifactory.com", pathname: "/events" }).allowed, false);
});

test("local operator routes require a local host and local origin", () => {
  assert.equal(localOperatorAccess({ host: "127.0.0.1:4142", pathname: "/api/status" }).allowed, true);
  assert.equal(localOperatorAccess({ host: "localhost:4142", origin: "http://localhost:4142", pathname: "/api/tasks" }).allowed, true);
  assert.equal(localOperatorAccess({ host: "127.0.0.1:4142", origin: "https://attacker.example", pathname: "/api/tasks" }).allowed, false);
});
