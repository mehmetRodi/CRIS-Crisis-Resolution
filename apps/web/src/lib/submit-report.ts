import { toSubmissionText, type ReportSubmission } from '@crisismap/shared';

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
  const { data, errors } = await client.mutations.submitReport(
    {
      text: toSubmissionText(submission),
      clientRequestId,
      isAnonymous: submission.anonymous,
      reporterContact: submission.contact,
      mediaKeys: submission.mediaKeys,
    },
    { authMode: 'identityPool' },
  );

  if ((errors && errors.length > 0) || !data) {
    throw new Error(errors?.[0]?.message ?? 'The report could not be submitted.');
  }
  return { reportId: data.id, status: data.status ?? 'NEW' };
}
