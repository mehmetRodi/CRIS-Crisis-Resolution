import { STATUS_TRANSITIONS, UserRole, canActorTransition } from '@crisismap/shared';
import type { ReportStatus } from '@crisismap/shared';

/**
 * What a signed-in role may see and do in the workspace (CRIS-54, ADR-0055).
 *
 * The redesigned workspace is one shell whose panels adapt to the caller's
 * role, so exactly one module has to answer "what does this role get?". This is
 * it — every surface reads these flags instead of testing `role === 'X'` inline,
 * which is how the previous UI ended up with four different opinions about what
 * a RESPONDER could do.
 *
 * ── This is presentation, not enforcement ──────────────────────────────────
 * Every flag here mirrors a gate that the SERVER already enforces (schema group
 * rules and the guarded resolvers in `amplify/data/resource.ts`). Its only job
 * is to avoid showing a control that would come back `FORBIDDEN`. If this file
 * and the server ever disagree, the server wins and the user sees an error —
 * which is the correct failure direction, and the reason it is safe for this to
 * be a plain client-side derivation.
 *
 * The mirrored gates, and where they actually live:
 *   - `canReadIncidentFeed`  → `Report` model auth: RESPONDER/COORDINATOR/ADMIN
 *   - `canTransitionStatus`  → `updateReportStatus`: RESPONDER/COORDINATOR/ADMIN
 *                              (narrowed per-transition by `TRANSITION_ROLES`)
 *   - `canAssignTeam`        → `assignTeam`: COORDINATOR/ADMIN only
 *   - `canReadVolunteerTasks`→ `listVolunteerTasks`: VOLUNTEER and above
 */

/** Which centre pane the workspace mounts for this role. */
export type WorkspaceView =
  /** Live map + priority queue + incident detail. */
  | 'incidents'
  /**
   * Stage board + task detail, with NO map.
   *
   * Not a lesser variant of the map view — a consequence of the data model.
   * The `VolunteerTask` projection has no wire representation for coordinates
   * at all (ADR-0042), so there is nothing to place on a map for this role. A
   * map here could only ever render empty, which would read as "no incidents"
   * rather than "not shown to you" — a dangerous thing to imply during a
   * crisis.
   */
  | 'tasks';

export interface Capabilities {
  /** The caller's effective role, or `null` when signed out. */
  role: UserRole | null;
  /** Which centre pane to mount. */
  view: WorkspaceView;
  /** May read the staff incident feed (`useLiveReports`). */
  canReadIncidentFeed: boolean;
  /** May read the redacted volunteer task projection. */
  canReadVolunteerTasks: boolean;
  /** May drive at least one status transition from some state. */
  canTransitionStatus: boolean;
  /** May assign a response team (`assignTeam`). */
  canAssignTeam: boolean;
  /** May read an incident's audit timeline (rides the staff feed). */
  canViewTimeline: boolean;
  /** Sees the operational workspace at all, rather than the citizen surfaces. */
  isOperational: boolean;
}

/** Roles the operational workspace is mounted for. */
export const OPERATIONAL_ROLES = [
  UserRole.VOLUNTEER,
  UserRole.RESPONDER,
  UserRole.COORDINATOR,
  UserRole.ADMIN,
] as const;

/** Roles permitted to read the staff incident feed (`Report` model auth). */
const INCIDENT_FEED_ROLES: readonly UserRole[] = [
  UserRole.RESPONDER,
  UserRole.COORDINATOR,
  UserRole.ADMIN,
];

/** Roles permitted to assign a team (`assignTeam` group rule). */
const ASSIGN_TEAM_ROLES: readonly UserRole[] = [UserRole.COORDINATOR, UserRole.ADMIN];

const SIGNED_OUT: Capabilities = {
  role: null,
  view: 'tasks',
  canReadIncidentFeed: false,
  canReadVolunteerTasks: false,
  canTransitionStatus: false,
  canAssignTeam: false,
  canViewTimeline: false,
  isOperational: false,
};

export function capabilitiesFor(role: UserRole | null | undefined): Capabilities {
  if (!role) return SIGNED_OUT;

  const canReadIncidentFeed = INCIDENT_FEED_ROLES.includes(role);

  return {
    role,
    // A role that cannot read the incident feed cannot be shown the map, so the
    // feed grant — not the role name — is what selects the view. VOLUNTEER is
    // the only operational role that lands on `tasks` today, but a future role
    // without feed access inherits the correct pane for free.
    view: canReadIncidentFeed ? 'incidents' : 'tasks',
    canReadIncidentFeed,
    // Every operational role can read the volunteer projection, including
    // coordinators — it is the same board their volunteers are working.
    canReadVolunteerTasks: (OPERATIONAL_ROLES as readonly UserRole[]).includes(role),
    // Derived from the shared authority matrix rather than restated: a role can
    // transition if ANY legal move anywhere in the state machine is open to it.
    // Which moves specifically is answered per-incident by `transitionsFor`.
    canTransitionStatus: (Object.keys(STATUS_TRANSITIONS) as ReportStatus[]).some((from) =>
      STATUS_TRANSITIONS[from].some((to) => canActorTransition(role, from, to)),
    ),
    canAssignTeam: ASSIGN_TEAM_ROLES.includes(role),
    canViewTimeline: canReadIncidentFeed,
    isOperational: (OPERATIONAL_ROLES as readonly UserRole[]).includes(role),
  };
}

/**
 * The status transitions `role` may drive from `from`, in state-machine order.
 *
 * `STATUS_TRANSITIONS` supplies the structurally-legal moves and
 * `canActorTransition` narrows them to this actor's authority — the same two
 * functions the server resolver uses, so the buttons offered here cannot drift
 * from the moves the resolver will accept. SYSTEM-only moves (NEW → PROCESSING
 * and the classification outcomes) never surface, because no human role holds
 * them in `TRANSITION_ROLES`.
 */
export function transitionsFor(from: ReportStatus, role: UserRole): ReportStatus[] {
  return STATUS_TRANSITIONS[from].filter((to) => canActorTransition(role, from, to));
}
