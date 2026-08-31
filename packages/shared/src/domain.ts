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

/**
 * A status is terminal when no transition leads out of it. Only `REJECTED`
 * qualifies today (§5.1) — `RESOLVED` can reopen. Guarded resolvers (CRIS-18)
 * use this to short-circuit before attempting a conditional write.
 */
export function isTerminalStatus(status: ReportStatus): boolean {
  return STATUS_TRANSITIONS[status].length === 0;
}

/**
 * Non-human actor for pipeline-driven transitions (NEW→PROCESSING and the
 * classification outcomes are performed by the async worker, not a user).
 */
export const SYSTEM_ACTOR = 'SYSTEM';

/** Who may drive a transition: a Cognito role, or the async pipeline. */
export type TransitionActor = UserRole | typeof SYSTEM_ACTOR;

/**
 * Role authority for each transition (§5.6, human-in-the-loop §2.6/§5.5).
 *
 * Structurally-legal moves live in `STATUS_TRANSITIONS`; this map narrows each
 * to the actors allowed to perform it. Irreversible/safety-critical moves
 * (confirming, rejecting, reopening) require a human role — never the pipeline.
 * `ADMIN` is granted every legal transition separately (see `canActorTransition`)
 * and is therefore omitted here. Keys MUST stay a subset of `STATUS_TRANSITIONS`.
 */
export const TRANSITION_ROLES: Readonly<
  Record<ReportStatus, Readonly<Partial<Record<ReportStatus, readonly TransitionActor[]>>>>
> = {
  NEW: { PROCESSING: [SYSTEM_ACTOR] },
  PROCESSING: { AI_CLASSIFIED: [SYSTEM_ACTOR], NEEDS_VERIFICATION: [SYSTEM_ACTOR] },
  AI_CLASSIFIED: {
    VERIFIED: ['RESPONDER', 'COORDINATOR'],
    NEEDS_VERIFICATION: ['RESPONDER', 'COORDINATOR'],
    REJECTED: ['COORDINATOR'],
  },
  NEEDS_VERIFICATION: {
    VERIFIED: ['RESPONDER', 'COORDINATOR'],
    REJECTED: ['COORDINATOR'],
  },
  VERIFIED: {
    IN_PROGRESS: ['RESPONDER', 'COORDINATOR'],
    REJECTED: ['COORDINATOR'],
  },
  IN_PROGRESS: { RESOLVED: ['RESPONDER', 'COORDINATOR'] },
  RESOLVED: { IN_PROGRESS: ['COORDINATOR'] }, // reopen — coordinator only
  REJECTED: {},
} as const;

/** Actors permitted to move `from → to`, ignoring the ADMIN override. */
export function rolesForTransition(
  from: ReportStatus,
  to: ReportStatus,
): readonly TransitionActor[] {
  return TRANSITION_ROLES[from][to] ?? [];
}

/**
 * True when `actor` may perform the `from → to` transition. Requires the move to
 * be structurally legal AND permitted for the actor. `ADMIN` may perform any
 * legal transition.
 */
export function canActorTransition(
  actor: TransitionActor,
  from: ReportStatus,
  to: ReportStatus,
): boolean {
  if (!canTransition(from, to)) return false;
  if (actor === UserRole.ADMIN) return true;
  return rolesForTransition(from, to).includes(actor);
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

/**
 * Privilege order for resolving a caller's *single* effective role out of
 * however many Cognito groups their token carries (CRIS-24). Used both
 * server-side (an AppSync Cognito identity's `groups`) and client-side (the ID
 * token's `cognito:groups` claim in `AuthContext`) so the two never drift.
 */
const ROLE_RANK: readonly UserRole[] = [
  UserRole.CITIZEN,
  UserRole.VOLUNTEER,
  UserRole.RESPONDER,
  UserRole.COORDINATOR,
  UserRole.ADMIN,
];

/** The highest-ranked `UserRole` among `groups`, or `null` if none match. */
export function highestRole(groups?: readonly string[] | null): UserRole | null {
  let best: UserRole | null = null;
  let bestRank = -1;
  for (const group of groups ?? []) {
    const rank = ROLE_RANK.indexOf(group as UserRole);
    if (rank > bestRank) {
      bestRank = rank;
      best = group as UserRole;
    }
  }
  return best;
}

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
 * Authoritative v2 cutoffs for deterministic scoring (design doc §5.4.2 /
 * CRIS-30). A cutoff change requires a score-version bump and ADR.
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
/* Location / geospatial — design doc §5.2                                     */
/* -------------------------------------------------------------------------- */

/**
 * Geohash precision used for the resolved report location and the map-viewport
 * GSI (§5.2). Precision 7 ≈ a 153 m × 153 m cell — the granularity coordinators
 * cluster and query on. Viewport requests are decomposed into a bounded set of
 * geohash prefixes at this precision, queried in parallel, then filtered exactly
 * (there is no native radius query in DynamoDB).
 */
export const GEOHASH_PRECISION = 7;

/* -------------------------------------------------------------------------- */
/* Supporting entities — design doc §5.1, §5.2                                 */
/* -------------------------------------------------------------------------- */

/**
 * Outcome recorded on a `Verification` (§5.1). A verification preserves the
 * evidence and human/agent judgement behind a report's move out of
 * `NEEDS_VERIFICATION`; the outcome is distinct from the report status so the
 * evidence trail survives even if the report is later reopened.
 */
export const VerificationOutcome = {
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
} as const;

export type VerificationOutcome = (typeof VerificationOutcome)[keyof typeof VerificationOutcome];

/**
 * Lifecycle of an `Assignment` linking a `Team` to a report (§5.1, §6.3). Drives
 * the responder "update assignment status" flow and the team task-board GSI.
 * TENTATIVE MVP set — the dispatch workflow is owned by E4 / Phase 2 (§5.5).
 */
export const AssignmentStatus = {
  /** Proposed by the Dispatch Agent, awaiting coordinator approval (§5.5). */
  PROPOSED: 'PROPOSED',
  /** Coordinator assigned the team; not yet acknowledged. */
  ASSIGNED: 'ASSIGNED',
  /** Team acknowledged and accepted the task. */
  ACCEPTED: 'ACCEPTED',
  EN_ROUTE: 'EN_ROUTE',
  ON_SCENE: 'ON_SCENE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus];

/**
 * Strength of a link inside a `DuplicateGroup` (§5.4.3). Reports are grouped,
 * never auto-deleted, so evidence is preserved. A similarity ≥ 0.80 is a STRONG
 * link; 0.65–0.79 is a SUGGESTED link surfaced for coordinator review. The
 * thresholds/formula themselves are owned by the duplicate-detection ticket.
 */
export const DuplicateLinkType = {
  STRONG: 'STRONG',
  SUGGESTED: 'SUGGESTED',
} as const;

export type DuplicateLinkType = (typeof DuplicateLinkType)[keyof typeof DuplicateLinkType];

/**
 * Delivery channels for proximity alerts (§2.7, §5). An `AlertSubscription`
 * opts a recipient into one or more channels; an `AlertDelivery` records one
 * attempt per recipient per channel.
 */
export const AlertChannel = {
  SMS: 'SMS',
  EMAIL: 'EMAIL',
  PUSH: 'PUSH',
} as const;

export type AlertChannel = (typeof AlertChannel)[keyof typeof AlertChannel];

/**
 * Delivery state of a single `AlertDelivery` record (§5, Fig 10). Every fan-out
 * recipient gets a durable record with status + attempt count so delivery is
 * auditable and retriable.
 */
export const AlertDeliveryStatus = {
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;

export type AlertDeliveryStatus = (typeof AlertDeliveryStatus)[keyof typeof AlertDeliveryStatus];

/**
 * Type of an immutable `ReportEvent` audit record (§5.1). Every mutating
 * operation appends exactly one event; the append-only stream is the audit log
 * behind a report's timeline in the coordinator UI (§6.3).
 */
export const ReportEventType = {
  SUBMITTED: 'SUBMITTED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  CLASSIFIED: 'CLASSIFIED',
  PRIORITY_SCORED: 'PRIORITY_SCORED',
  VERIFICATION_RECORDED: 'VERIFICATION_RECORDED',
  ASSIGNED: 'ASSIGNED',
  DUPLICATE_LINKED: 'DUPLICATE_LINKED',
  ALERT_DISPATCHED: 'ALERT_DISPATCHED',
} as const;

export type ReportEventType = (typeof ReportEventType)[keyof typeof ReportEventType];

/* -------------------------------------------------------------------------- */
/* Public projection — design doc §5.3, §5.6                                   */
/* -------------------------------------------------------------------------- */

/**
 * The redacted shape safe to expose through public queries and the live-map
 * subscription (§5.3). A separate `PublicReport` type is the design's guarantee
 * that reporter identity, contact data, internal notes, and the raw free-text
 * report body can never leak (§5.6). The map shows the AI-generated `summary`,
 * never the untrusted raw `text`.
 */
export interface PublicReport {
  reportId: string;
  status: ReportStatus;
  category: Category | null;
  urgency: Urgency | null;
  priorityScore: number | null;
  priorityBand: PriorityBand | null;
  summary: string | null;
  lat: number | null;
  lng: number | null;
  geohash: string | null;
  geohashPrefix: string | null;
  regionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * The exact allow-list of fields that may appear on a `PublicReport`. Exported
 * so a test (and reviewers) can assert nothing else is ever projected.
 */
export const PUBLIC_REPORT_FIELDS = [
  'reportId',
  'status',
  'category',
  'urgency',
  'priorityScore',
  'priorityBand',
  'summary',
  'lat',
  'lng',
  'geohash',
  'geohashPrefix',
  'regionId',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof PublicReport)[];

/** The internal fields `toPublicReport` reads from — a superset that holds PII. */
export interface RedactableReport {
  id: string;
  status: ReportStatus;
  category?: Category | null;
  urgency?: Urgency | null;
  priorityScore?: number | null;
  priorityBand?: PriorityBand | null;
  summary?: string | null;
  lat?: number | null;
  lng?: number | null;
  geohash?: string | null;
  geohashPrefix?: string | null;
  regionId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  // PII / internal fields below MUST NOT be copied into the projection.
  text?: string | null;
  reporterId?: string | null;
  reporterContact?: string | null;
  notes?: string | null;
}

/**
 * Project an internal report down to its public, PII-free shape (§5.3, §5.6).
 * Builds the result from the field allow-list rather than by deleting keys, so a
 * newly-added sensitive field can never accidentally pass through.
 */
export function toPublicReport(report: RedactableReport): PublicReport {
  return {
    reportId: report.id,
    status: report.status,
    category: report.category ?? null,
    urgency: report.urgency ?? null,
    priorityScore: report.priorityScore ?? null,
    priorityBand: report.priorityBand ?? null,
    summary: report.summary ?? null,
    lat: report.lat ?? null,
    lng: report.lng ?? null,
    geohash: report.geohash ?? null,
    geohashPrefix: report.geohashPrefix ?? null,
    regionId: report.regionId ?? null,
    createdAt: report.createdAt ?? null,
    updatedAt: report.updatedAt ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Public visibility — design doc §5.3, §5.6 (CRIS-54, ADR-0056)              */
/* -------------------------------------------------------------------------- */

/**
 * Statuses an incident may be shown at on the UNAUTHENTICATED public map.
 *
 * Redaction (`toPublicReport`) answers "which FIELDS are safe to expose". This
 * answers the separate and equally important question: "which INCIDENTS are
 * safe to expose at all". A report can be perfectly redacted and still be
 * harmful to publish — an unverified report is, by definition, an unconfirmed
 * claim, and putting one on a public map during a disaster broadcasts
 * potentially false information to everyone in the area.
 *
 * So the public map shows only incidents a HUMAN has confirmed (§2.6's
 * human-in-the-loop guarantee) or that are already being acted on:
 *
 *   - `VERIFIED`     — a responder or coordinator confirmed it happened
 *   - `IN_PROGRESS`  — a team is on it
 *   - `RESOLVED`     — it happened and has been handled
 *
 * Everything else is withheld, each for its own reason:
 *
 *   - `NEW` / `PROCESSING`     — nothing has assessed it yet
 *   - `AI_CLASSIFIED`          — the MODEL believes it; no human has agreed
 *   - `NEEDS_VERIFICATION`     — actively flagged as doubtful
 *   - `REJECTED`               — found to be false; publishing it would be
 *                                spreading a claim already known to be untrue
 *
 * Staff surfaces are unaffected: coordinators and responders must see
 * unverified reports — triaging them is the job.
 */
export const PUBLICLY_VISIBLE_STATUSES: readonly ReportStatus[] = [
  ReportStatus.VERIFIED,
  ReportStatus.IN_PROGRESS,
  ReportStatus.RESOLVED,
];

/** True when `status` may appear on the unauthenticated public map. */
export function isPubliclyVisible(status: ReportStatus): boolean {
  return PUBLICLY_VISIBLE_STATUSES.includes(status);
}
