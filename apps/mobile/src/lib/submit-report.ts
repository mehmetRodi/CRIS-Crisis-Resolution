import * as Crypto from 'expo-crypto';
import { toSubmissionText, type ReportSubmission } from '@crisismap/shared';

import { client } from './amplify';

/**
 * Client side of the CRIS-9 write path. Calls the guarded `submitReport`
 * mutation as a guest (identity pool). Media upload is CRIS-17 — the photo
 * stays on-device for now. Never log the submission: it can carry contact PII
 * (design doc §5.4.1, §5.6).
 */

/**
 * Idempotency token for one submission attempt (§5.4.4). Generate it when the
 * user starts a submission and REUSE it on retries of the same report — the
 * backend dedupes on it, so a flaky network can't create duplicates. Only mint
 * a new one after success (next report) or when the content changes.
 */
export function newClientRequestId(): string {
  return Crypto.randomUUID();
}

export interface SubmitReportResult {
  reportId: string;
  status: string;
}

export async function submitReport(
  submission: ReportSubmission,
  clientRequestId: string,
): Promise<SubmitReportResult> {
  const { data, errors } = await client.mutations.submitReport({
    text: toSubmissionText(submission),
    clientRequestId,
    isAnonymous: submission.anonymous,
    reporterContact: submission.contact,
  });

  if ((errors && errors.length > 0) || !data) {
    throw new Error(errors?.[0]?.message ?? 'The report could not be submitted.');
  }
  return { reportId: data.id, status: data.status ?? 'NEW' };
}
