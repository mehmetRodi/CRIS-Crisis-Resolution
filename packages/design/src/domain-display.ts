import {
  AssignmentStatus,
  Category,
  PriorityBand,
  ReportStatus,
  Urgency,
  UserRole,
} from '@crisismap/shared';

/**
 * How the domain vocabulary is WORDED, shared by both clients
 * (CRIS-57, ADR-0057).
 *
 * `@crisismap/shared` owns the vocabulary and its authority; this module owns
 * only the human wording and a colour intent. Nothing here may change
 * behaviour, and nothing here may be the reason a UI offers or withholds an
 * action.
 *
 * Centralising the WORDING is the point. Before this existed, the same status
 * rendered as `NEEDS_VERIFICATION` in the coordinator queue, "Verification
 * needed" on the volunteer board, and something else again on mobile — three
 * spellings of one status, because every surface mapped it locally. Icons and
 * colour VALUES stay platform-side (lucide-react vs lucide-react-native,
 * Tailwind classes vs StyleSheet objects); only the words and the intent are
 * shared.
 *
 * Every map is a total `Record<Enum, …>`, so adding a value to a shared enum
 * fails the type-check here until it is given a label. That is deliberate: a
 * missing label should be a build error, not a raw enum leaking to a citizen
 * mid-emergency.
 */

/**
 * A colour INTENT, not a colour. Each client resolves it against its own
 * styling layer — Tailwind badge variants on web, `StyleSheet` objects on
 * mobile — so the two agree on meaning without sharing a rendering mechanism.
 */
export type Tone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'p0'
  | 'p1'
  | 'p2'
  | 'p3'
  | 'unscored';

/* -------------------------------------------------------------------------- */
/* Priority bands — design doc §5.4.2                                          */
/* -------------------------------------------------------------------------- */

export interface PriorityLabel {
  /** The band's own name, as coordinators say it out loud. */
  label: string;
  /** What the band MEANS — for legends, tooltips, and accessible names. */
  description: string;
  tone: Tone;
}

export const PRIORITY_LABELS: Readonly<Record<PriorityBand, PriorityLabel>> = {
  [PriorityBand.P0]: {
    label: 'Critical',
    description: 'Life-threatening. Dispatch immediately.',
    tone: 'p0',
  },
  [PriorityBand.P1]: {
    label: 'High',
    description: 'Serious harm likely without a prompt response.',
    tone: 'p1',
  },
  [PriorityBand.P2]: {
    label: 'Elevated',
    description: 'Needs a response, but not ahead of P0 or P1.',
    tone: 'p2',
  },
  [PriorityBand.P3]: {
    label: 'Routine',
    description: 'Handle in order. No immediate escalation.',
    tone: 'p3',
  },
};

/**
 * Presentation for an incident with NO band yet (NEW / PROCESSING).
 *
 * Kept out of `PRIORITY_LABELS` and given its own neutral tone because
 * "not scored yet" is a different claim from "scored lowest". Rendering an
 * unclassified report as P3 would tell a coordinator the AI had assessed it and
 * found it routine — the opposite of the truth, and precisely what the design
 * doc's human-in-the-loop escalation exists to prevent (§2.6).
 */
export const UNSCORED_LABEL: PriorityLabel = {
  label: 'Unscored',
  description: 'Awaiting AI classification. Not yet ranked.',
  tone: 'unscored',
};

/** Wording for `band`, falling back to the unscored treatment for `null`. */
export function priorityLabel(band: PriorityBand | null | undefined): PriorityLabel {
  return band ? PRIORITY_LABELS[band] : UNSCORED_LABEL;
}

/* -------------------------------------------------------------------------- */
/* Report status — design doc §5.1                                             */
/* -------------------------------------------------------------------------- */

export interface StatusLabel {
  label: string;
  /** Plain-language meaning. Citizens see this on their own report. */
  description: string;
  tone: Tone;
}

export const STATUS_LABELS: Readonly<Record<ReportStatus, StatusLabel>> = {
  [ReportStatus.NEW]: {
    label: 'New',
    description: 'Received and stored. Waiting to be processed.',
    tone: 'neutral',
  },
  [ReportStatus.PROCESSING]: {
    label: 'Processing',
    description: 'Being classified by the triage agent.',
    tone: 'info',
  },
  [ReportStatus.AI_CLASSIFIED]: {
    label: 'AI classified',
    description: 'Classified automatically. Awaiting human confirmation.',
    tone: 'info',
  },
  [ReportStatus.NEEDS_VERIFICATION]: {
    label: 'Needs verification',
    description: 'Low confidence or conflicting detail. Escalated for review.',
    tone: 'warning',
  },
  [ReportStatus.VERIFIED]: {
    label: 'Verified',
    description: 'Confirmed by a responder or coordinator.',
    tone: 'accent',
  },
  [ReportStatus.IN_PROGRESS]: {
    label: 'In progress',
    description: 'A team is actively responding.',
    tone: 'accent',
  },
  [ReportStatus.RESOLVED]: {
    label: 'Resolved',
    description: 'Handled. Can be reopened if the situation changes.',
    tone: 'success',
  },
  [ReportStatus.REJECTED]: {
    label: 'Rejected',
    description: 'Found to be false or invalid. Final.',
    tone: 'danger',
  },
};

/**
 * Human label for a status that arrives as a plain `string`.
 *
 * Audit events store `fromStatus`/`toStatus` as free-form strings, so a record
 * written under an older vocabulary can name a status this build no longer
 * knows. Falling back to the raw value keeps a historical timeline readable
 * instead of rendering "undefined" over an event that genuinely happened — an
 * audit trail must never lose information it already holds.
 */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return (STATUS_LABELS as Record<string, StatusLabel | undefined>)[status]?.label ?? status;
}

/* -------------------------------------------------------------------------- */
/* Category — design doc §2.4                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Categories carry no tone of their own, on purpose.
 *
 * Colour in this product means severity, everywhere, without exception. Giving
 * ten categories ten more hues would put two competing colour languages on the
 * same screen, and the one that matters — how urgent is this — would lose. Each
 * client attaches its own ICON instead.
 */
export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  [Category.MEDICAL]: 'Medical',
  [Category.RESCUE]: 'Rescue',
  [Category.STRUCTURAL_DAMAGE]: 'Structural damage',
  [Category.FIRE]: 'Fire',
  [Category.FLOOD]: 'Flood',
  [Category.HAZMAT]: 'Hazmat',
  [Category.BLOCKED_ROAD]: 'Blocked road',
  [Category.SHELTER]: 'Shelter',
  [Category.UTILITY]: 'Utility',
  [Category.OTHER]: 'Other',
};

export function categoryLabel(category: Category | null | undefined): string {
  return category ? CATEGORY_LABELS[category] : 'Unclassified';
}

/* -------------------------------------------------------------------------- */
/* Urgency — design doc §2.2                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Urgency is the AI's stated assessment; the priority band is the deterministic
 * score's verdict (§5.4.2). They usually agree and are NOT the same field, so
 * urgency carries no severity tone — colouring it on the severity scale would
 * imply a second, competing ranking sitting beside the real one.
 */
export const URGENCY_LABELS: Readonly<Record<Urgency, string>> = {
  [Urgency.CRITICAL]: 'Critical',
  [Urgency.HIGH]: 'High',
  [Urgency.MEDIUM]: 'Medium',
  [Urgency.LOW]: 'Low',
};

export function urgencyLabel(urgency: Urgency | null | undefined): string {
  return urgency ? URGENCY_LABELS[urgency] : 'Unassessed';
}

/* -------------------------------------------------------------------------- */
/* Assignment status — design doc §5.1, §6.3                                   */
/* -------------------------------------------------------------------------- */

export const ASSIGNMENT_STATUS_LABELS: Readonly<
  Record<AssignmentStatus, { label: string; tone: Tone }>
> = {
  [AssignmentStatus.PROPOSED]: { label: 'Proposed', tone: 'neutral' },
  [AssignmentStatus.ASSIGNED]: { label: 'Assigned', tone: 'info' },
  [AssignmentStatus.ACCEPTED]: { label: 'Accepted', tone: 'info' },
  [AssignmentStatus.EN_ROUTE]: { label: 'En route', tone: 'accent' },
  [AssignmentStatus.ON_SCENE]: { label: 'On scene', tone: 'accent' },
  [AssignmentStatus.COMPLETED]: { label: 'Completed', tone: 'success' },
  [AssignmentStatus.CANCELLED]: { label: 'Cancelled', tone: 'neutral' },
};

/* -------------------------------------------------------------------------- */
/* Roles — design doc §5.6                                                     */
/* -------------------------------------------------------------------------- */

export const ROLE_LABELS: Readonly<Record<UserRole, { label: string; description: string }>> = {
  [UserRole.CITIZEN]: {
    label: 'Citizen',
    description: 'Submits emergency reports.',
  },
  [UserRole.VOLUNTEER]: {
    label: 'Volunteer',
    description: 'Works regional tasks. Sees no reporter detail or coordinates.',
  },
  [UserRole.RESPONDER]: {
    label: 'Responder',
    description: 'Verifies incidents and drives them through response.',
  },
  [UserRole.COORDINATOR]: {
    label: 'Coordinator',
    description: 'Full incident command: triage, assignment, and rejection.',
  },
  [UserRole.ADMIN]: {
    label: 'Administrator',
    description: 'Every coordinator authority, plus system administration.',
  },
};

export function roleLabel(role: UserRole | null | undefined): string {
  return role ? ROLE_LABELS[role].label : 'Guest';
}
