import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  localProjectIdForPath,
  normalizeProjectRootPath,
  readLocalProjectRegistry,
  selectLocalProjectRecord,
  upsertLocalProjectRecord
} from "../src/local-project-registry.mjs";

test("local project registry normalizes and persists a selected project root", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codex-office-local-project-"));
  const dataRoot = mkdtempSync(join(tmpdir(), "codex-office-data-"));
  const registryPath = join(dataRoot, "local-projects.json");
  const result = upsertLocalProjectRecord(registryPath, {
    path: projectRoot,
    name: "Selected App"
  }, {
    now: "2026-05-28T00:00:00.000Z"
  });

  assert.equal(result.ok, true);
  assert.equal(result.project.id, localProjectIdForPath(projectRoot));
  assert.equal(result.registry.selectedProjectId, result.project.id);
  assert.equal(readLocalProjectRegistry(registryPath).projects.length, 1);
  assert.match(readFileSync(registryPath, "utf8"), /Selected App/);
});

test("local project registry preserves MAS security-scoped bookmark metadata", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "codex-office-local-project-"));
  const registryPath = join(mkdtempSync(join(tmpdir(), "codex-office-data-")), "local-projects.json");
  const result = upsertLocalProjectRecord(registryPath, {
    path: projectRoot,
    name: "Sandboxed App",
    securityScopedBookmark: "bookmark-base64",
    authorizationSource: "mac_app_security_scoped_bookmark"
  });

  assert.equal(result.ok, true);
  assert.equal(result.project.securityScopedBookmark, "bookmark-base64");
  assert.equal(result.project.authorizationSource, "mac_app_security_scoped_bookmark");
  assert.match(readFileSync(registryPath, "utf8"), /bookmark-base64/);
});

test("local project registry blocks missing roots and unsafe bytes", () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "codex-office-data-"));
  const registryPath = join(dataRoot, "local-projects.json");

  assert.equal(normalizeProjectRootPath("bad\0path").ok, false);
  const result = upsertLocalProjectRecord(registryPath, {
    path: join(dataRoot, "missing")
  });

  assert.equal(result.ok, false);
  assert.equal(result.blocker.id, "project_root_missing");
});

test("local project registry switches between saved roots", () => {
  const projectA = mkdtempSync(join(tmpdir(), "codex-office-local-a-"));
  const projectB = mkdtempSync(join(tmpdir(), "codex-office-local-b-"));
  const registryPath = join(mkdtempSync(join(tmpdir(), "codex-office-data-")), "local-projects.json");
  const first = upsertLocalProjectRecord(registryPath, { path: projectA, name: "A" });
  const second = upsertLocalProjectRecord(registryPath, { path: projectB, name: "B" });

  assert.equal(readLocalProjectRegistry(registryPath).selectedProjectId, second.project.id);
  const selected = selectLocalProjectRecord(registryPath, first.project.id, {
    now: "2026-05-28T00:10:00.000Z"
  });

  assert.equal(selected.ok, true);
  assert.equal(readLocalProjectRegistry(registryPath).selectedProjectId, first.project.id);
});
