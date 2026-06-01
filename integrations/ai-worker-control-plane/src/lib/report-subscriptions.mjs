import { createId } from "./ids.mjs";
import { migrate, nowIso, openDatabase, toJson } from "./db.mjs";
import { validateReportSubscriptionPayload } from "./validation.mjs";

function parseSubscriptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    enabled: Boolean(row.enabled),
  };
}

export function createReportSubscription(projectId, payload, options = {}) {
  const normalized = validateReportSubscriptionPayload(payload);
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const project = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const subscriptionId = createId("subscription");
    const createdAt = options.createdAt || nowIso();

    db.prepare(
      `INSERT INTO report_subscriptions (
        id, project_id, channel, recipient, provider, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      subscriptionId,
      projectId,
      normalized.channel,
      normalized.recipient,
      normalized.provider,
      normalized.enabled ? 1 : 0,
      createdAt,
      createdAt
    );

    db.prepare(
      `INSERT INTO audit_events (
        id, org_id, project_id, actor_type, actor_id, action, target_type, target_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      createId("audit"),
      project.org_id,
      projectId,
      "system",
      null,
      "report_subscription.created",
      "report_subscription",
      subscriptionId,
      toJson({ recipient: normalized.recipient, channel: normalized.channel, provider: normalized.provider }),
      createdAt
    );

    return parseSubscriptionRow(db.prepare("SELECT * FROM report_subscriptions WHERE id = ?").get(subscriptionId));
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function listReportSubscriptions(projectId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const enabledOnly = options.enabledOnly ?? false;
    const sql = enabledOnly
      ? `SELECT * FROM report_subscriptions WHERE project_id = ? AND enabled = 1 ORDER BY created_at DESC`
      : `SELECT * FROM report_subscriptions WHERE project_id = ? ORDER BY created_at DESC`;

    return db.prepare(sql).all(projectId).map(parseSubscriptionRow);
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function getReportSubscription(subscriptionId, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    return parseSubscriptionRow(db.prepare("SELECT * FROM report_subscriptions WHERE id = ?").get(subscriptionId));
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function updateReportSubscription(subscriptionId, patch, options = {}) {
  const db = options.db || openDatabase(options.dbPath);

  if (!options.skipMigrate) {
    migrate(db);
  }

  try {
    const existing = getReportSubscription(subscriptionId, { db, skipMigrate: true });
    if (!existing) {
      throw new Error(`Report subscription not found: ${subscriptionId}`);
    }

    const normalized = validateReportSubscriptionPayload({
      recipient: patch.recipient ?? existing.recipient,
      channel: patch.channel ?? existing.channel,
      provider: patch.provider ?? existing.provider,
      enabled: patch.enabled ?? existing.enabled,
    });
    const updatedAt = options.updatedAt || nowIso();

    db.prepare(
      `UPDATE report_subscriptions
       SET channel = ?, recipient = ?, provider = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      normalized.channel,
      normalized.recipient,
      normalized.provider,
      normalized.enabled ? 1 : 0,
      updatedAt,
      subscriptionId
    );

    return getReportSubscription(subscriptionId, { db, skipMigrate: true });
  } finally {
    if (!options.db) {
      db.close();
    }
  }
}

export function deliveryTargetsForProject(projectId, options = {}) {
  return listReportSubscriptions(projectId, { ...options, enabledOnly: true }).map((subscription) => ({
    recipient: subscription.recipient,
    channel: subscription.channel,
    provider: subscription.provider,
    subscription_id: subscription.id,
  }));
}
