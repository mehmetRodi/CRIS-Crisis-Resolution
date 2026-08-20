import { client } from './amplify';

/**
 * Client side of the CRIS-32 team-assignment mutation (design doc §5.1).
 * Mirrors `transition-report.ts`: a thin, typed wrapper over one AppSync
 * custom mutation. Here it drives `assignTeam`, the guarded engine behind
 * assigning a response team to a report.
 *
 * The mutation is authorized for the COORDINATOR/ADMIN Cognito groups only —
 * unlike `updateReportStatus` there is no fine-grained per-actor rule, so the
 * only failure this wrapper needs to distinguish beyond `CONFLICT` is
 * `NOT_FOUND` (a stale/bogus `teamId`) and `ILLEGAL` (a terminal report).
 */

/** Stable, machine-readable failure codes the backend resolver emits (§5.3). */
export type AssignErrorCode = 'CONFLICT' | 'NOT_FOUND' | 'ILLEGAL' | 'UNKNOWN';

/** The codes the resolver prefixes onto its error messages, in match order. */
const KNOWN_CODES: readonly Exclude<AssignErrorCode, 'UNKNOWN'>[] = [
  'CONFLICT',
  'NOT_FOUND',
  'ILLEGAL',
];

/** A failed assignment, carrying the resolver's stable `code` for UI branching. */
export class AssignError extends Error {
  readonly code: AssignErrorCode;
  constructor(code: AssignErrorCode, message: string) {
    super(message);
    this.name = 'AssignError';
    this.code = code;
  }
}

/**
 * Map a raw AppSync error message to a typed `AssignError`. The resolver
 * throws `new Error('CONFLICT: …')` etc.; AppSync surfaces that text on the
 * GraphQL error, so we key off the leading `CODE:` token.
 */
export function classifyAssignError(message: string | undefined): AssignError {
  const text = message ?? 'The team could not be assigned.';
  for (const code of KNOWN_CODES) {
    if (text.startsWith(`${code}:`)) {
      return new AssignError(code, text.slice(code.length + 1).trim());
    }
  }
  return new AssignError('UNKNOWN', text);
}

export interface AssignTeamInput {
  reportId: string;
  teamId: string;
  /** The version the caller last read — drives the optimistic lock (§5.3). */
  expectedVersion: number;
  /** Optional free-text reason recorded on the audit event. */
  note?: string;
}

export interface AssignTeamResult {
  reportId: string;
  assignedTeamId: string;
  /** The report version AFTER the assignment (`expectedVersion + 1`). */
  version: number;
}

/**
 * Apply one guarded team assignment. Resolves with the report's new
 * `assignedTeamId` + version on success; rejects with an `AssignError`
 * (inspect `.code`) on any guard failure so callers can special-case
 * `CONFLICT` (refetch) versus `NOT_FOUND` / `ILLEGAL` (surface to the operator).
 */
export async function assignTeam(input: AssignTeamInput): Promise<AssignTeamResult> {
  const { data, errors } = await client.mutations.assignTeam({
    reportId: input.reportId,
    teamId: input.teamId,
    expectedVersion: input.expectedVersion,
    note: input.note,
  });

  if ((errors && errors.length > 0) || !data) {
    throw classifyAssignError(errors?.[0]?.message);
  }

  return {
    reportId: data.id,
    assignedTeamId: data.assignedTeamId ?? input.teamId,
    version: data.version ?? input.expectedVersion + 1,
  };
}
