/**
 * Display formatting shared across every surface (CRIS-54).
 *
 * Timestamps in this product are read under time pressure, so the rule is:
 * RELATIVE for recency ("4m ago" — how stale is this?), ABSOLUTE for the record
 * ("14 Mar, 09:12" — what exactly happened when?). The queue and activity feed
 * use the first; the audit timeline uses the second, because an audit trail that
 * only says "2 hours ago" is not an audit trail.
 */

/** Reports with no/invalid timestamp render this rather than "Invalid Date". */
const NO_TIME = '—';

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Compact elapsed time: `now`, `4m`, `3h`, `6d`.
 *
 * Deliberately unit-suffixed and short — this sits inside a dense queue row
 * where "4 minutes ago" would force the column wide enough to push the priority
 * badge off screen on a laptop.
 *
 * `now` is injectable so tests are not clock-dependent.
 */
export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
  const date = parse(value);
  if (!date) return NO_TIME;

  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  // A clock skew between the browser and the server can put a freshly-created
  // report a few seconds in the future. "in 3 seconds" on a new report reads as
  // a bug; clamp to "now".
  if (seconds < 45) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return absoluteDate(value);
}

/** Full timestamp for the audit record: `14 Mar 2025, 09:12`. */
export function absoluteTime(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return NO_TIME;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Date only: `14 Mar 2025`. */
export function absoluteDate(value: string | null | undefined): string {
  const date = parse(value);
  if (!date) return NO_TIME;
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * First 8 characters of a report id, for dense rows.
 *
 * Truncation is display-only — the incident detail panel always shows the id in
 * full, because a coordinator reading an id aloud over a radio needs all of it.
 */
export function shortId(reportId: string): string {
  return reportId.length > 8 ? `${reportId.slice(0, 8)}…` : reportId;
}

/** `4.0` — always one decimal, so scores stay column-aligned in the queue. */
export function formatScore(score: number | null | undefined): string {
  return score == null ? NO_TIME : score.toFixed(1);
}

/** Model confidence in [0,1] as a whole percentage. */
export function formatConfidence(confidence: number | null | undefined): string {
  return confidence == null ? NO_TIME : `${Math.round(confidence * 100)}%`;
}

/** `1 incident` / `2 incidents`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
