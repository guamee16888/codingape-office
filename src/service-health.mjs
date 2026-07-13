export function buildServiceHealthSummary({
  localUrl = "http://127.0.0.1:4142",
  publicUrl = "",
  publicProbe = {},
  appLaunchAgentInstalled = false,
  tunnelConfigured = false,
  tunnelLaunchAgentInstalled = false
} = {}) {
  const probeStatus = publicProbe.status || "checking";
  const publicOnline = probeStatus === "online";
  const publicProtected = probeStatus === "protected";
  const publicReachable = publicOnline || publicProtected;
  const publicChecking = probeStatus === "checking";
  const checkedAt = publicProbe.checkedAt || "";
  const httpStatus = Number(publicProbe.httpStatus || 0);

  const publicStatus = !tunnelConfigured
    ? "missing"
    : publicChecking
      ? "checking"
      : publicReachable
        ? "online"
        : "offline";
  const tunnelStatus = !tunnelConfigured
    ? "missing"
    : publicReachable
      ? tunnelLaunchAgentInstalled ? "connected" : "online"
      : publicChecking
        ? "checking"
        : "degraded";

  return {
    generatedAt: new Date().toISOString(),
    local: {
      label: "Local service",
      status: "online",
      statusLabel: "Online",
      url: localUrl,
      detail: `This page is served from ${localUrl}; the local service is responding.`
    },
    publicEntry: {
      label: "Public entry",
      status: publicStatus,
      statusLabel: publicStatus === "online"
        ? publicProtected ? "Protected" : "Online"
        : publicStatus === "checking"
          ? "Checking"
          : publicStatus === "missing"
            ? "Not configured"
            : "Offline",
      url: publicUrl,
      checkedAt,
      httpStatus,
      detail: !tunnelConfigured
        ? "Cloudflare tunnel config was not found."
        : publicChecking
          ? "Waiting for a live public endpoint probe."
          : publicReachable
            ? `Live probe reached the public entry${httpStatus ? ` with HTTP ${httpStatus}` : ""}.`
            : `Live probe failed${publicProbe.error ? `: ${publicProbe.error}` : "."}`
    },
    tunnel: {
      label: "Cloudflare tunnel",
      status: tunnelStatus,
      statusLabel: tunnelStatus === "connected"
        ? "Connected"
        : tunnelStatus === "online"
          ? "Online"
          : tunnelStatus === "checking"
            ? "Checking"
            : tunnelStatus === "degraded"
              ? "No active route"
              : "Not configured",
      checkedAt,
      detail: !tunnelConfigured
        ? "Configure the Cloudflare tunnel first."
        : publicReachable
          ? tunnelLaunchAgentInstalled
            ? "The public route is live and the tunnel launch agent is installed."
            : "The public route is live, but automatic tunnel startup is not configured."
          : publicChecking
            ? "Tunnel config exists; active connectivity is still being checked."
            : "Tunnel config exists, but the public route is not reachable."
    },
    daemon: {
      label: "Background daemon",
      status: appLaunchAgentInstalled ? "managed" : "manual",
      statusLabel: appLaunchAgentInstalled ? "Managed" : "Manual",
      detail: appLaunchAgentInstalled
        ? "Codingape Office is managed by the macOS background launch agent."
        : "The local service may need to be started again after login or restart."
    }
  };
}
