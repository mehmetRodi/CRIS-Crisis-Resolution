/**
 * CrisisMap AI — shared domain model.
 *
 * These constants are the single source of truth for the report lifecycle, user
 * roles, priority bands, and classification enums. They are consumed by the
 * frontend (`apps/web`), the Amplify data schema, and — later — the Lambda
 * classification workers, so that every layer agrees on the same vocabulary.
 *
 * Traceability: values here are lifted directly from the design document
 * (`crisismap.pdf`). Section references are noted per block. Anything marked
 * TENTATIVE is a reasonable default for the scaffold and is expected to be
 * finalized by its owning ticket (see CLAUDE.md for ticket ownership).
 */

/* -------------------------------------------------------------------------- */
/* Report lifecycle — design doc §5.1                                          */
/* -------------------------------------------------------------------------- */

/**
 * The report state machine. Every transition is guarded by a role check and a
 * versioned conditional write, and appends an immutable audit event (§5.1).
 */
export const ReportStatus = {
  /** Durably accepted, not yet processed. Returned to the client < 800 ms. */
  NEW: 'NEW',
  /** Claimed by a classifier worker (NEW → PROCESSING via a version condition). */
  PROCESSING: 'PROCESSING',
  /** AI classification succeeded and passed schema/enum validation. */
  AI_CLASSIFIED: 'AI_CLASSIFIED',
  /** Low confidence / conflicting data — escalated to human review (§2.6). */
  NEEDS_VERIFICATION: 'NEEDS_VERIFICATION',
  /** Confirmed by a responder/coordinator (or corroborated). */
  VERIFIED: 'VERIFIED',
  /** A team is actively responding. */
  IN_PROGRESS: 'IN_PROGRESS',
  /** Incident handled. Can be reopened. */
  RESOLVED: 'RESOLVED',
  /** False / invalid report. Terminal. */
  REJECTED: 'REJECTED',
} as const;

export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

/**
 * Allowed transitions of the report state machine (§5.1). Encoded so resolvers
 * and UI can share one authority on what moves are legal. Role authorization
 * and optimistic-lock version checks are enforced separately at the resolver
 * layer (TODO CRIS-9), not here.
 */
export const STATUS_TRANSITIONS: Readonly<Record<ReportStatus, readonly ReportStatus[]>> = {
  NEW: ['PROCESSING'],
  PROCESSING: ['AI_CLASSIFIED', 'NEEDS_VERIFICATION'],
  AI_CLASSIFIED: ['VERIFIED', 'NEEDS_VERIFICATION', 'REJECTED'],
  NEEDS_VERIFICATION: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['IN_PROGRESS', 'REJECTED'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['IN_PROGRESS'], // reopen
  REJECTED: [], // terminal
} as const;

/** Returns true if `to` is a legal next state from `from`. */
export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/* -------------------------------------------------------------------------- */
/* Roles — design doc §5.6 (Cognito groups)                                    */
/* -------------------------------------------------------------------------- */

/** Cognito groups that gate operations at the schema/resolver/projection layers. */
export const UserRole = {
  CITIZEN: 'CITIZEN',
  VOLUNTEER: 'VOLUNTEER',
  RESPONDER: 'RESPONDER',
  COORDINATOR: 'COORDINATOR',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/* -------------------------------------------------------------------------- */
/* Priority bands — design doc §5.4.2                                          */
/* -------------------------------------------------------------------------- */

/**
 * Priority is a deterministic, explainable score in [0, 10] (§5.4.2) — never
 * the raw model output — that maps to bands P0–P3. P0 is the most critical.
 */
export const PriorityBand = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
} as const;

export type PriorityBand = (typeof PriorityBand)[keyof typeof PriorityBand];

export const MIN_PRIORITY_SCORE = 0;
export const MAX_PRIORITY_SCORE = 10;

/**
 * Maps a [0, 10] priority score to a band.
 *
 * TENTATIVE thresholds — the authoritative scoring formula and band cutoffs are
 * owned by the deterministic scoring work (design doc §5.4.2 / CRIS-11). Kept
 * here so the UI has something to render against during scaffolding.
 */
export function priorityBandForScore(score: number): PriorityBand {
  if (score >= 8) return PriorityBand.P0;
  if (score >= 6) return PriorityBand.P1;
  if (score >= 3) return PriorityBand.P2;
  return PriorityBand.P3;
}

/* -------------------------------------------------------------------------- */
/* Classification enums — design doc §2.2, §2.4 (TENTATIVE MVP set)            */
/* -------------------------------------------------------------------------- */

/**
 * Report categories. The MVP visual set from §2.4 (medical, structural damage,
 * shelter, blocked roads) plus the incident types called out elsewhere in the
 * doc. TENTATIVE — the enum allow-list is finalized with the JSON classification
 * contract (CRIS-11).
 */
export const Category = {
  MEDICAL: 'MEDICAL',
  RESCUE: 'RESCUE',
  STRUCTURAL_DAMAGE: 'STRUCTURAL_DAMAGE',
  FIRE: 'FIRE',
  FLOOD: 'FLOOD',
  HAZMAT: 'HAZMAT',
  BLOCKED_ROAD: 'BLOCKED_ROAD',
  SHELTER: 'SHELTER',
  UTILITY: 'UTILITY',
  OTHER: 'OTHER',
} as const;

export type Category = (typeof Category)[keyof typeof Category];

/** Urgency level assigned by classification (§2.2). TENTATIVE MVP set. */
export const Urgency = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;

export type Urgency = (typeof Urgency)[keyof typeof Urgency];

/* -------------------------------------------------------------------------- */
/* Location precision — design doc §2.4, §5.4 (geocoding confidence)           */
/* -------------------------------------------------------------------------- */

/**
 * How precisely a report's location is known after geocoding. Set by the
 * geocode worker (CRIS-10); drives how a marker is rendered on the map.
 */
export const LocationPrecision = {
  /** Exact coordinates supplied (GPS or map pin). */
  EXACT: 'EXACT',
  /** Geocoded from text to an approximate point. */
  APPROXIMATE: 'APPROXIMATE',
  /** Only the containing region is known. */
  REGION_ONLY: 'REGION_ONLY',
  /** Location could not be resolved. */
  UNKNOWN: 'UNKNOWN',
} as const;

export type LocationPrecision = (typeof LocationPrecision)[keyof typeof LocationPrecision];

/* -------------------------------------------------------------------------- */
/* Verification — design doc §2.5, §2.6 (human-in-the-loop review)             */
/* -------------------------------------------------------------------------- */

/** Outcome of a single verification signal on a report (§2.6). */
export const VerificationStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
} as const;

export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

/* -------------------------------------------------------------------------- */
/* Assignment & teams — design doc §2.5, §5.1 (dispatch lifecycle)             */
/* -------------------------------------------------------------------------- */

/** Lifecycle of a team assignment to a report (§5.1 dispatch). */
export const AssignmentStatus = {
  PROPOSED: 'PROPOSED',
  ACCEPTED: 'ACCEPTED',
  EN_ROUTE: 'EN_ROUTE',
  ON_SCENE: 'ON_SCENE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

/** Availability of a response team. */
export const TeamStatus = {
  AVAILABLE: 'AVAILABLE',
  BUSY: 'BUSY',
  OFFLINE: 'OFFLINE',
} as const;

export type TeamStatus = (typeof TeamStatus)[keyof typeof TeamStatus];

/* -------------------------------------------------------------------------- */
/* Alerts — design doc §2.7, §3 (proximity alerts via SNS)                     */
/* -------------------------------------------------------------------------- */

/** Channel a proximity alert is delivered over (§3 SNS SMS/email/push). */
export const AlertChannel = {
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  PUSH: 'PUSH',
} as const;

export type AlertChannel = (typeof AlertChannel)[keyof typeof AlertChannel];

/** Lifecycle of an alert subscription (§2.7). */
export const SubscriptionStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
} as const;

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/** Delivery state of a single alert send attempt (§5.4.4 resilience). */
export const DeliveryStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  SUPPRESSED: 'SUPPRESSED',
} as const;

export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

/* -------------------------------------------------------------------------- */
/* Audit & duplicates — design doc §5.1 (immutable events), §5.4.3            */
/* -------------------------------------------------------------------------- */

/**
 * Type of an immutable audit event appended to a report's history (§5.1).
 * Every mutating operation records one of these.
 */
export const ReportEventType = {
  SUBMITTED: 'SUBMITTED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  CLASSIFIED: 'CLASSIFIED',
  SCORED: 'SCORED',
  GEOCODED: 'GEOCODED',
  DEDUPED: 'DEDUPED',
  ASSIGNED: 'ASSIGNED',
  VERIFIED: 'VERIFIED',
  ALERT_SENT: 'ALERT_SENT',
  NOTE_ADDED: 'NOTE_ADDED',
} as const;

export type ReportEventType = (typeof ReportEventType)[keyof typeof ReportEventType];

/** Lifecycle of a duplicate group (§5.4.3 — grouped, never auto-deleted). */
export const DuplicateGroupStatus = {
  OPEN: 'OPEN',
  MERGED: 'MERGED',
  DISMISSED: 'DISMISSED',
} as const;

export type DuplicateGroupStatus = (typeof DuplicateGroupStatus)[keyof typeof DuplicateGroupStatus];

/* -------------------------------------------------------------------------- */
/* PII boundary — design doc §5.3, §5.6 (redacted public projection)          */
/* -------------------------------------------------------------------------- */

/**
 * Reporter identity/contact and internal-only fields that MUST NEVER appear in
 * public/guest views (§5.6). The separate `PublicReport` projection omits these
 * physically; this list is the single authority shared by the projection/
 * redaction logic (CRIS-9) and by tests that guard the boundary.
 */
export const REDACTED_REPORT_FIELDS = [
  'reporterUserId',
  'reporterName',
  'reporterContact',
  'internalNotes',
] as const;

export type RedactedReportField = (typeof REDACTED_REPORT_FIELDS)[number];
