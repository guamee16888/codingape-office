import { hostAllowsNativeFolderPicker } from "./native-folder-picker.mjs";

export function isLocalOperatorOrigin(origin = "") {
  if (!origin) return true;
  try {
    return hostAllowsNativeFolderPicker(new URL(origin).host);
  } catch {
    return false;
  }
}

export function localOperatorAccess({ host = "", origin = "", pathname = "/" } = {}) {
  const isOperatorRoute = pathname === "/office" || pathname === "/office/" || pathname === "/events" || pathname.startsWith("/api/");
  if (!isOperatorRoute) {
    return { allowed: true, reason: "public_route" };
  }

  if (!hostAllowsNativeFolderPicker(host)) {
    return { allowed: false, reason: "operator_host_required" };
  }

  if (!isLocalOperatorOrigin(origin)) {
    return { allowed: false, reason: "operator_origin_required" };
  }

  return { allowed: true, reason: "local_operator" };
}
