import assert from "node:assert/strict";
import { test } from "node:test";
import { buildServiceHealthSummary } from "../src/service-health.mjs";

test("service health does not treat config files as a live public route", () => {
  const health = buildServiceHealthSummary({
    publicUrl: "https://example.com",
    tunnelConfigured: true,
    tunnelLaunchAgentInstalled: true,
    publicProbe: { status: "offline", checkedAt: "2026-07-13T00:00:00.000Z", httpStatus: 530 }
  });

  assert.equal(health.publicEntry.status, "offline");
  assert.equal(health.tunnel.status, "degraded");
  assert.equal(health.publicEntry.httpStatus, 530);
});

test("service health reports a successful or protected live probe", () => {
  const online = buildServiceHealthSummary({
    publicUrl: "https://example.com",
    tunnelConfigured: true,
    tunnelLaunchAgentInstalled: true,
    publicProbe: { status: "online", httpStatus: 200 }
  });
  const protectedRoute = buildServiceHealthSummary({
    publicUrl: "https://example.com",
    tunnelConfigured: true,
    publicProbe: { status: "protected", httpStatus: 403 }
  });

  assert.equal(online.publicEntry.status, "online");
  assert.equal(online.tunnel.status, "connected");
  assert.equal(protectedRoute.publicEntry.statusLabel, "Protected");
});
