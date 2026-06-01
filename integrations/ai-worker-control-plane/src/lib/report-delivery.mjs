import { createId } from "./ids.mjs";
import { fromJson, migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { renderReportHtml } from "./report-rendering.mjs";
import { getReport } from "./reports.mjs";
import { DEFAULT_MAX_RETRIES, computeNextRetryAt } from "./retry-policy.mjs";

export class DeliveryError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeliveryError";
  }
}

export function createLocalEmailProvider() {
  return {
    name: "local",
    async sendEmail({ to, subject, markdown, html }) {
      return {
        provider_message_id: createId("localmsg"),
        metadata: {
          transport: "local",
          to,
          subject,
          content_formats: [
            markdown ? "markdown" : null,
            html ? "html" : null,
          ].filter(Boolean),
        },
      };
    },
  };
}

function truncate(text, maxLength = 2800) {
  const value = String(text ?? "");
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function money(value) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function reportSummaryLines(report) {
  const json = report.content_json || {};
  const failures = Array.isArray(json.top_failure_categories)
    ? json.top_failure_categories.slice(0, 3).map((item) => `${item.name}: ${item.count}`).join(", ")
    : "none";
  const nextActions = Array.isArray(json.next_actions)
    ? json.next_actions.slice(0, 3).map((item) => `${item.priority}: ${item.title}`).join("; ")
    : "none";

  return [
    `Project: ${report.project_id}`,
    `Period: ${report.period_start} to ${report.period_end}`,
    `Runs: ${json.total_runs ?? 0}, success: ${json.success_count ?? 0}, failed/partial: ${json.failure_count ?? 0}, high risk: ${json.high_risk_count ?? 0}`,
    `Cost: ${money(json.total_cost)} total, ${money(json.average_cost_per_run)} avg/run`,
    `Top failures: ${failures || "none"}`,
    `Next actions: ${nextActions || "none"}`,
  ];
}

function buildSlackPayload({ subject, report }) {
  const lines = reportSummaryLines(report);
  const json = report.content_json || {};
  const fields = [
    `*Runs:* ${json.total_runs ?? 0}`,
    `*High risk:* ${json.high_risk_count ?? 0}`,
    `*Cost:* ${money(json.total_cost)}`,
    `*Success rate:* ${(Number(json.success_rate || 0) * 100).toFixed(1)}%`,
  ];

  return {
    text: truncate(`${subject}\n${lines.join("\n")}`, 3000),
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: truncate(subject, 150), emoji: false },
      },
      {
        type: "section",
        fields: fields.map((text) => ({ type: "mrkdwn", text })),
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: truncate(lines.slice(4).join("\n"), 2800) },
      },
    ],
  };
}

function buildDiscordPayload({ subject, report }) {
  const lines = reportSummaryLines(report);
  const json = report.content_json || {};

  return {
    content: truncate(`**${subject}**\n${lines.slice(0, 3).join("\n")}`, 1900),
    embeds: [
      {
        title: subject,
        description: truncate(lines.slice(3).join("\n"), 4000),
        fields: [
          { name: "Total runs", value: String(json.total_runs ?? 0), inline: true },
          { name: "High risk", value: String(json.high_risk_count ?? 0), inline: true },
          { name: "Total cost", value: money(json.total_cost), inline: true },
        ],
      },
    ],
  };
}

function buildGenericWebhookPayload({ subject, markdown, html, report }) {
  return {
    subject,
    summary: reportSummaryLines(report),
    markdown,
    html,
    report: {
      id: report.id,
      project_id: report.project_id,
      report_type: report.report_type,
      period_start: report.period_start,
      period_end: report.period_end,
      content_json: report.content_json,
    },
  };
}

function buildWebhookPayload({ channel, subject, markdown, html, report }) {
  if (channel === "slack") {
    return buildSlackPayload({ subject, report });
  }

  if (channel === "discord") {
    return buildDiscordPayload({ subject, report });
  }

  return buildGenericWebhookPayload({ subject, markdown, html, report });
}

export function createHttpWebhookProvider({ name = "webhook", fetchImpl = globalThis.fetch } = {}) {
  return {
    name,
    async sendWebhook({ url, channel, subject, markdown, html, report }) {
      if (typeof fetchImpl !== "function") {
        throw new DeliveryError("No fetch implementation available for webhook delivery");
      }

      const body = buildWebhookPayload({ channel, subject, markdown, html, report });
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const responseText = typeof response.text === "function" ? await response.text() : "";
        throw new DeliveryError(`Webhook delivery failed: ${response.status} ${truncate(responseText, 200)}`.trim());
      }

      return {
        provider_message_id: response.headers?.get?.("x-request-id") ?? response.headers?.get?.("x-slack-req-id") ?? null,
        metadata: {
          transport: "http_webhook",
          channel,
          status_code: response.status,
          content_formats: ["json", markdown ? "markdown" : null, html ? "html" : null].filter(Boolean),
        },
      };
    },
  };
}

export function createDeliveryProvider({ channel = "email", provider = null } = {}) {
  if (channel === "email") {
    return createLocalEmailProvider();
  }

  return createHttpWebhookProvider({ name: provider || channel });
}

function parseDeliveryRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: fromJson(row.metadata, {}),
  };
}

export function parseReportDeliveryRow(row) {
  return parseDeliveryRow(row);
}

async function attemptDelivery(db, delivery, report, provider, options = {}) {
  const attemptedAt = options.attemptedAt || nowIso();
  const retryCount = Number(delivery.retry_count || 0);
  const nextRetryCount = options.incrementRetry ? retryCount + 1 : retryCount;

  try {
    const html = renderReportHtml(report);
    let response;

    if (delivery.channel === "email") {
      if (typeof provider.sendEmail !== "function") {
        throw new DeliveryError(`Provider ${provider.name || "unknown"} cannot send email`);
      }

      response = await provider.sendEmail({
        to: delivery.recipient,
        subject: delivery.subject,
        markdown: report.content_markdown,
        html,
        report,
      });
    } else if (["webhook", "slack", "discord"].includes(delivery.channel)) {
      if (typeof provider.sendWebhook !== "function") {
        throw new DeliveryError(`Provider ${provider.name || "unknown"} cannot send webhooks`);
      }

      response = await provider.sendWebhook({
        url: delivery.recipient,
        channel: delivery.channel,
        subject: delivery.subject,
        markdown: report.content_markdown,
        html,
        report,
      });
    } else {
      throw new DeliveryError(`Unsupported delivery channel: ${delivery.channel}`);
    }

    const deliveredAt = options.deliveredAt || nowIso();
    const providerMessageId = response?.provider_message_id ?? null;
    const metadata = { ...fromJson(delivery.metadata, {}), ...(response?.metadata ?? {}) };

    db.prepare(
      `UPDATE report_deliveries
       SET status = ?, provider_message_id = ?, error_message = NULL, metadata = ?,
           attempted_at = ?, delivered_at = ?, retry_count = ?, next_retry_at = NULL,
           resolved_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      "sent",
      providerMessageId,
      toJson(metadata),
      attemptedAt,
      deliveredAt,
      nextRetryCount,
      deliveredAt,
      deliveredAt,
      delivery.id
    );

    return parseDeliveryRow(db.prepare("SELECT * FROM report_deliveries WHERE id = ?").get(delivery.id));
  } catch (error) {
    const failedAt = options.failedAt || nowIso();
    const message = error instanceof Error ? error.message : "Unknown delivery error";
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const exhausted = nextRetryCount >= maxRetries;
    const nextRetryAt = exhausted ? null : (options.nextRetryAt || computeNextRetryAt(nextRetryCount + 1, failedAt));

    db.prepare(
      `UPDATE report_deliveries
       SET status = ?, error_message = ?, attempted_at = ?, retry_count = ?,
           next_retry_at = ?, resolved_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      exhausted ? "exhausted" : "failed",
      message,
      attemptedAt,
      nextRetryCount,
      nextRetryAt,
      exhausted ? failedAt : null,
      failedAt,
      delivery.id
    );

    return parseDeliveryRow(db.prepare("SELECT * FROM report_deliveries WHERE id = ?").get(delivery.id));
  }
}

export async function deliverReport(reportId, payload, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const report = getReport(reportId, { db, skipMigrate: true });
    if (!report) {
      throw new Error(`Report not found: ${reportId}`);
    }

    const channel = payload.channel || "email";
    const provider = options.provider || createDeliveryProvider({ channel, provider: payload.provider });
    const providerName = payload.provider || provider.name || (channel === "email" ? "local" : channel);
    const subject = payload.subject || `AI Agent Nightly Health Report - ${report.period_start.slice(0, 10)}`;
    const createdAt = options.createdAt || nowIso();
    const deliveryId = createId("delivery");
    const baseMetadata = payload.subscription_id ? { subscription_id: payload.subscription_id } : {};

    db.prepare(
      `INSERT INTO report_deliveries (
        id, report_id, project_id, channel, recipient, provider, status, subject,
        error_message, provider_message_id, metadata, attempted_at, delivered_at,
        retry_count, next_retry_at, resolved_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, 0, NULL, NULL, ?, ?)`
    ).run(
      deliveryId,
      report.id,
      report.project_id,
      channel,
      payload.recipient,
      providerName,
      "pending",
      subject,
      toJson(baseMetadata),
      createdAt,
      createdAt
    );

    const delivery = db.prepare("SELECT * FROM report_deliveries WHERE id = ?").get(deliveryId);
    return attemptDelivery(db, delivery, report, provider, options);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export async function retryReportDelivery(deliveryId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const delivery = db.prepare("SELECT * FROM report_deliveries WHERE id = ?").get(deliveryId);
    if (!delivery) {
      throw new Error(`Report delivery not found: ${deliveryId}`);
    }

    if (!["failed", "exhausted"].includes(delivery.status) && !options.force) {
      return parseDeliveryRow(delivery);
    }

    if (delivery.status === "exhausted" && !options.force) {
      return parseDeliveryRow(delivery);
    }

    const report = getReport(delivery.report_id, { db, skipMigrate: true });
    if (!report) {
      throw new Error(`Report not found: ${delivery.report_id}`);
    }

    const provider = options.provider || createDeliveryProvider({ channel: delivery.channel, provider: delivery.provider });
    return attemptDelivery(db, delivery, report, provider, { ...options, incrementRetry: true });
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listRetryableReportDeliveries(options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const now = options.now || nowIso();
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));

    return db.prepare(
      `SELECT * FROM report_deliveries
       WHERE status = 'failed'
         AND resolved_at IS NULL
         AND retry_count < ?
         AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY updated_at ASC
       LIMIT ?`
    ).all(maxRetries, now, limit).map(parseDeliveryRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listReportDeliveries(reportId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    return db.prepare(
      `SELECT * FROM report_deliveries
       WHERE report_id = ?
       ORDER BY created_at DESC`
    ).all(reportId).map(parseDeliveryRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listProjectReportDeliveries(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const clauses = ["project_id = ?"];
    const params = [projectId];

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    if (options.unresolvedOnly) {
      clauses.push("resolved_at IS NULL");
    }

    const limit = Math.max(1, Math.min(Number(options.limit || 50), 200));
    params.push(limit);

    return db.prepare(
      `SELECT *
       FROM report_deliveries
       WHERE ${clauses.join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(...params).map(parseDeliveryRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}
