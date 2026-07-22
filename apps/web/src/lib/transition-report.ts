import type { ReportStatus } from '@crisismap/shared';

import { client } from './amplify';

/**
 * Client side of the CRIS-18 report state-machine mutation (design doc §5.1,
 * §5.3). Mirrors `submit-report.ts`: a thin, typed wrapper over one AppSync
 * custom mutation. Here it drives `updateReportStatus`, the single guarded
 * engine behind every human-driven status change.
 *
 * The mutation is authorized for the RESPONDER/COORDINATOR/ADMIN Cognito groups,
 * so this uses the shared `client`'s default auth mode (Cognito user pool) — no
 * per-operation `authMode` override (unlike the guest `submitReport` path).
 *
 * The backend enforces the real guarantees (legality, per-transition role
 * authority, and the optimistic lock) and returns a message prefixed with a
 * stable code on failure. We translate those prefixes into a typed
 * `TransitionError` so the UI can branch on the machine-readable `code` — most
 * importantly `CONFLICT`, which means "someone else moved this report; refetch
 * and retry" (§5.3).
 */

/** Stable, machine-readable failure codes the backend resolver emits (§5.3). */
export type TransitionErrorCode =
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'ILLEGAL_TRANSITION'
  | 'NOT_FOUND'
  | 'UNKNOWN';

/** The codes the resolver prefixes onto its error messages, in match order. */
const KNOWN_CODES: readonly Exclude<TransitionErrorCode, 'UNKNOWN'>[] = [
  'CONFLICT',
  'FORBIDDEN',
  'ILLEGAL_TRANSITION',
  'NOT_FOUND',
];

/** A failed transition, carrying the resolver's stable `code` for UI branching. */
export class TransitionError extends Error {
  readonly code: TransitionErrorCode;
  constructor(code: TransitionErrorCode, message: string) {
    super(message);
    this.name = 'TransitionError';
    this.code = code;
  }
}

/**
 * Map a raw AppSync error message to a typed `TransitionError`. The resolver
 * throws `new Error('CONFLICT: …')` etc.; AppSync surfaces that text on the
 * GraphQL error, so we key off the leading `CODE:` token.
 */
export function classifyTransitionError(message: string | undefined): TransitionError {
  const text = message ?? 'The report status could not be updated.';
  for (const code of KNOWN_CODES) {
    if (text.startsWith(`${code}:`)) {
      return new TransitionError(code, text.slice(code.length + 1).trim());
    }
  }
  return new TransitionError('UNKNOWN', text);
}

export interface TransitionInput {
  reportId: string;
  toStatus: ReportStatus;
  /** The version the caller last read — drives the optimistic lock (§5.3). */
  expectedVersion: number;
  /** Optional free-text reason recorded on the audit event. */
  note?: string;
}

export interface TransitionResult {
  reportId: string;
  status: ReportStatus;
  /** The report version AFTER the transition (`expectedVersion + 1`). */
  version: number;
}

/**
 * Apply one guarded status transition. Resolves with the report's new status +
 * version on success; rejects with a `TransitionError` (inspect `.code`) on any
 * guard failure so callers can special-case `CONFLICT` (refetch) versus
 * `FORBIDDEN` / `ILLEGAL_TRANSITION` (surface to the operator).
 */
export async function transitionReportStatus(input: TransitionInput): Promise<TransitionResult> {
  const { data, errors } = await client.mutations.updateReportStatus({
    reportId: input.reportId,
    toStatus: input.toStatus,
    expectedVersion: input.expectedVersion,
    note: input.note,
  });

  if ((errors && errors.length > 0) || !data) {
    throw classifyTransitionError(errors?.[0]?.message);
  }

  return {
    reportId: data.id,
    status: (data.status ?? input.toStatus) as ReportStatus,
    version: data.version ?? input.expectedVersion + 1,
  };
}
