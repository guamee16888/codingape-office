export const DEFAULT_MAX_RETRIES = 3;

export function computeNextRetryAt(attemptNumber, fromIso, options = {}) {
  const baseMinutes = options.baseMinutes ?? 5;
  const maxMinutes = options.maxMinutes ?? 60;
  const attempt = Math.max(1, Number(attemptNumber) || 1);
  const delayMinutes = Math.min(maxMinutes, baseMinutes * 2 ** (attempt - 1));
  const from = fromIso ? new Date(fromIso) : new Date();

  return new Date(from.getTime() + delayMinutes * 60 * 1000).toISOString();
}

export function isRetryDue(row, nowIso) {
  return !row.next_retry_at || row.next_retry_at <= nowIso;
}
