import assert from "node:assert/strict";
import { test } from "node:test";
import {
  folderNameFromPath,
  hostAllowsNativeFolderPicker,
  openMacNativeFolderPicker
} from "../src/native-folder-picker.mjs";

test("native folder picker only allows localhost hosts", () => {
  assert.equal(hostAllowsNativeFolderPicker("127.0.0.1:4142"), true);
  assert.equal(hostAllowsNativeFolderPicker("localhost:4142"), true);
  assert.equal(hostAllowsNativeFolderPicker("[::1]:4142"), true);
  assert.equal(hostAllowsNativeFolderPicker("geoaifactory.com"), false);
});

test("native folder picker parses macOS POSIX path output", () => {
  const result = openMacNativeFolderPicker({
    platform: "darwin",
    execFileSyncImpl: () => "/Users/example/Code/codingape-office/\n"
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, "/Users/example/Code/codingape-office/");
  assert.equal(result.name, "codingape-office");
});

test("native folder picker reports unsupported platforms without shelling out", () => {
  const result = openMacNativeFolderPicker({
    platform: "linux",
    execFileSyncImpl: () => {
      throw new Error("should not run");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "unsupported");
});

test("folder name handles trailing slashes", () => {
  assert.equal(folderNameFromPath("/Users/example/Code/codingape-office/"), "codingape-office");
});
