import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const LOCAL_PICKER_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

export function hostAllowsNativeFolderPicker(hostHeader = "") {
  const host = String(hostHeader || "").split(",")[0].trim().toLowerCase();
  if (!host) return false;
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
  return LOCAL_PICKER_HOSTS.has(hostname);
}

export function folderNameFromPath(folderPath = "") {
  return basename(String(folderPath || "").replace(/\/+$/, "")) || "Local Project";
}

export function openMacNativeFolderPicker(options = {}) {
  const {
    execFileSyncImpl = execFileSync,
    platform = process.platform,
    prompt = "Choose a Coding猿 project folder"
  } = options;

  if (platform !== "darwin") {
    return {
      ok: false,
      status: "unsupported",
      error: "Native folder picker is only available on macOS."
    };
  }

  try {
    const output = execFileSyncImpl("osascript", [
      "-e",
      `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`
    ], {
      encoding: "utf8",
      timeout: 120000
    }).trim();

    return {
      ok: Boolean(output),
      status: output ? "selected" : "cancelled",
      path: output,
      name: folderNameFromPath(output)
    };
  } catch (error) {
    return {
      ok: false,
      status: "cancelled",
      error: error?.message || "Folder picker was cancelled."
    };
  }
}
