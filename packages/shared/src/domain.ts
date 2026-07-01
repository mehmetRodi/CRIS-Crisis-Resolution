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
