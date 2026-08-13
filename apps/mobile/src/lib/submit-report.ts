import * as Crypto from 'expo-crypto';
import {
  REPORT_SUBMIT_VALIDATION_PREFIX,
  ReportSubmitError,
  isReportSubmitValidationError,
  toSubmissionText,
  type ReportSubmission,
} from '@crisismap/shared';

import { client } from './amplify';

/**
 * Client side of the CRIS-9 write path. Calls the guarded `submitReport`
 * mutation as a guest (identity pool). `submission.mediaKeys` are already-
 * uploaded S3 keys from the presigned-upload path (CRIS-17,
 * `lib/media-upload.ts`) — never raw file bytes. Never log the submission: it
 * can carry contact PII (design doc §5.4.1, §5.6).
 *
 * Throws `ReportSubmitError` (CRIS-26), not a bare `Error` — see the web twin
 * (`apps/web/src/lib/submit-report.ts`) for why the transport-failure vs.
 * server-rejection distinction matters to the offline queue.
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
  let result: Awaited<ReturnType<typeof client.mutations.submitReport>>;
  try {
    result = await client.mutations.submitReport({
      text: toSubmissionText(submission),
      clientRequestId,
      isAnonymous: submission.anonymous,
      reporterContact: submission.contact,
      mediaKeys: submission.mediaKeys,
      lat: submission.lat,
      lng: submission.lng,
    });
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
