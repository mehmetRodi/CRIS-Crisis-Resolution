import {
  REPORT_SUBMIT_VALIDATION_PREFIX,
  ReportSubmitError,
  isReportSubmitValidationError,
  toSubmissionText,
  type ReportSubmission,
} from '@crisismap/shared';

import { client } from './amplify';

/**
 * Client side of the CRIS-9 write path for the web emergency-fallback form
 * (ADR-0021). Mirrors `apps/mobile/src/lib/submit-report.ts` exactly — same
 * mutation, same idempotency contract — but on web primitives.
 *
 * Citizens submit as guests. The shared web `client` keeps its default auth
 * mode (Cognito user pool) for the authenticated coordinator/responder
 * surfaces, so we override `authMode` to `identityPool` per operation here
 * rather than globally — an unauthenticated visitor gets a guest Cognito
 * identity and the `allow.guest()` rule on `submitReport` accepts it.
 *
 * Never log the submission: it can carry contact PII (design doc §5.4.1, §5.6).
 *
 * Throws `ReportSubmitError` (CRIS-26), not a bare `Error`: the offline queue
 * needs to tell a transport failure (the call never got a response — offline,
 * DNS, timeout) from a server-side rejection (the call resolved with `errors`)
 * apart. Only the former is safe to queue and retry later — retrying an
 * identical rejection converges on nothing.
 */

/**
 * Idempotency token for one submission attempt (§5.4.4). Generate it when the
 * user starts a submission and REUSE it on retries of the same report — the
 * backend dedupes on it, so a flaky network can't create duplicates. Only mint
 * a new one after success (next report) or when the content changes.
 */
export function newClientRequestId(): string {
  return crypto.randomUUID();
}

export interface SubmitReportResult {
  reportId: string;
  status: string;
}

export async function submitReport(
  submission: ReportSubmission,
  clientRequestId: string,
): Promise<SubmitReportResult> {
  let result: Awaited<ReturnType<typeof client.mutations.submitReport>>;
  try {
    result = await client.mutations.submitReport(
      {
        text: toSubmissionText(submission),
        clientRequestId,
        isAnonymous: submission.anonymous,
        reporterContact: submission.contact,
        mediaKeys: submission.mediaKeys,
        lat: submission.lat,
        lng: submission.lng,
      },
      { authMode: 'identityPool' },
    );
  } catch (err) {
    throw new ReportSubmitError(
      err instanceof Error && err.message ? err.message : 'The report could not be submitted.',
      true,
    );
  }

  const { data, errors } = result;
  if ((errors && errors.length > 0) || !data) {
    const message = errors?.[0]?.message ?? 'The report could not be submitted.';
    const isValidation = isReportSubmitValidationError(message);
    const displayMessage = isValidation
      ? message.slice(REPORT_SUBMIT_VALIDATION_PREFIX.length).trim()
      : message;
    throw new ReportSubmitError(displayMessage, !isValidation);
  }
  return { reportId: data.id, status: data.status ?? 'NEW' };
}
