import { createServer } from "node:http";
import { openDatabase, migrate } from "../lib/db.mjs";
import { storeFeedback } from "../lib/feedback.mjs";
import { buildLocalPreviewResult } from "../lib/local-preview.mjs";
import { ensureLocalWorkspace } from "../lib/local-workspace.mjs";
import { renderOperatorConsoleHtml } from "../lib/operator-console-rendering.mjs";
import { updateCertificationActionStatus } from "../lib/autonomy-certification.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(303, { location });
  response.end();
}

function errorPage(error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>AIWC Error</title></head><body><h1>本地控制台错误</h1><pre>${message.replaceAll("<", "&lt;")}</pre><p><a href="/">返回</a></p></body></html>`;
}

const args = process.argv.slice(2);
const port = Number(valueAfter(args, "--port") || 4898);
const host = valueAfter(args, "--host") || "127.0.0.1";
const locale = valueAfter(args, "--locale") || "zh-CN";
const allowedEvidenceTargetTypes = new Set([
  "external",
  "incident_report",
  "eval_run",
  "recheck",
  "report",
  "evidence_pack",
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);
  const db = openDatabase();
  migrate(db);

  try {
    const workspace = ensureLocalWorkspace({ db, skipMigrate: true });

    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, project_id: workspace.project_id }));
      return;
    }

    if (request.method === "HEAD" && url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end();
      return;
    }

    if (request.method === "POST" && url.pathname === "/feedback") {
      const params = new URLSearchParams(await readRequestBody(request));
      const targetId = params.get("target_id");
      const feedbackType = params.get("feedback_type");
      const comment = params.get("comment") || "local_console";

      if (!targetId || !feedbackType) {
        send(response, 400, errorPage(new Error("target_id and feedback_type are required")));
        return;
      }

      storeFeedback(
        {
          project_id: workspace.project_id,
          target_type: "suggestion",
          target_id: targetId,
          feedback_type: feedbackType,
          comment,
        },
        { db, skipMigrate: true }
      );

      await buildLocalPreviewResult({
        db,
        skipMigrate: true,
        date: url.searchParams.get("date") || new Date().toISOString().slice(0, 10),
        forceGenerate: true,
      });

      redirect(response, "/?feedback=saved");
      return;
    }

    if (request.method === "POST" && url.pathname === "/certification-action") {
      const params = new URLSearchParams(await readRequestBody(request));
      const actionId = params.get("action_id");
      const status = params.get("status");
      const note = String(params.get("note") || "").trim();
      const evidenceRef = String(params.get("evidence_ref") || "").trim();
      const evidenceTargetType = String(params.get("evidence_target_type") || "external").trim();
      const evidenceTargetId = String(params.get("evidence_target_id") || "").trim();

      if (!actionId || !status) {
        send(response, 400, errorPage(new Error("action_id and status are required")));
        return;
      }
      if (!allowedEvidenceTargetTypes.has(evidenceTargetType)) {
        send(response, 400, errorPage(new Error("Unsupported evidence_target_type")));
        return;
      }
      if (status === "evidence_attached" && !evidenceRef) {
        send(response, 400, errorPage(new Error("evidence_ref is required when attaching evidence")));
        return;
      }
      if (status === "evidence_attached" && evidenceTargetType !== "external" && !evidenceTargetId) {
        send(response, 400, errorPage(new Error("evidence_target_id is required for platform evidence targets")));
        return;
      }

      updateCertificationActionStatus(actionId, {
        status,
        note: note || "local_console",
        evidence: {
          evidence_ref: evidenceRef || `local-console://${actionId}`,
          evidence_target_type: evidenceTargetType,
          evidence_target_id: evidenceTargetId || null,
          source: "local_operator_console",
          operator_note_present: Boolean(note),
        },
        actor_type: "local_operator",
        actor_id: process.env.USER || "local",
      }, {
        db,
        skipMigrate: true,
      });

      await buildLocalPreviewResult({
        db,
        skipMigrate: true,
        date: url.searchParams.get("date") || new Date().toISOString().slice(0, 10),
        forceGenerate: true,
      });

      redirect(response, "/?certification_action=updated#certification-roadmap");
      return;
    }

    if (request.method === "POST" && url.pathname === "/regenerate") {
      await buildLocalPreviewResult({
        db,
        skipMigrate: true,
        date: url.searchParams.get("date") || new Date().toISOString().slice(0, 10),
        forceGenerate: true,
      });
      redirect(response, "/?regenerated=1");
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      const result = await buildLocalPreviewResult({
        db,
        skipMigrate: true,
        date: url.searchParams.get("date") || new Date().toISOString().slice(0, 10),
        forceGenerate: url.searchParams.get("regenerate") === "1",
      });
      const html = renderOperatorConsoleHtml(result, {
        locale,
        showLocalCommands: true,
        feedbackForms: true,
        certificationActionForms: true,
      });
      send(response, 200, html);
      return;
    }

    send(response, 404, errorPage(new Error(`Not found: ${url.pathname}`)));
  } catch (error) {
    send(response, 500, errorPage(error));
  } finally {
    db.close();
  }
});

server.listen(port, host, () => {
  console.log(`AI Worker Control Plane local console: http://${host}:${port}/`);
});
