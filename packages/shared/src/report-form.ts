/**
 * CrisisMap AI — citizen report form core (CRIS-6).
 *
 * Platform-agnostic draft shape, limits, and validation for the citizen
 * emergency-report form. The React Native mobile app (`apps/mobile`) is the
 * primary consumer; keeping this logic here (not in a UI package) means any
 * future surface — web fallback form, SMS intake, kiosk — enforces the same
 * rules, and the `submitReport` resolver can validate against the identical
 * contract (design doc §5.1).
 *
 * No PII handling happens here beyond shaping the payload: `toReportSubmission`
 * is the single place where the anonymity flag strips contact data, so callers
 * cannot accidentally send contact info on an anonymous report (§5.4.1, §5.6).
 */

import type { Category, Urgency } from './domain';

/* -------------------------------------------------------------------------- */
/* Limits                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A report description must be longer than this (after trimming) to be
 * submittable — a bare "help" or "fire" carries too little signal for triage.
 */
export const REPORT_TEXT_MIN_LENGTH = 10;

/** Hard cap on the free-text description, mirrored by the input's maxLength. */
export const REPORT_TEXT_MAX_LENGTH = 1000;

/* -------------------------------------------------------------------------- */
/* Draft shape                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The in-progress form state. `''` means "not chosen yet" for the two required
 * enum fields so the draft can be driven directly by form controls.
 */
export interface ReportDraft {
  text: string;
  category: Category | '';
  subcategory: string;
  urgency: Urgency | '';
  anonymous: boolean;
  contact: string;
}

/** Fresh, empty draft. A factory (not a constant) so callers can't share state. */
export function createEmptyReportDraft(): ReportDraft {
  return {
    text: '',
    category: '',
    subcategory: '',
    urgency: '',
    anonymous: false,
    contact: '',
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/** Per-field validation messages; a field is absent when it is valid. */
export type ReportDraftErrors = Partial<Record<keyof ReportDraft, string>>;

/**
 * Validate a draft for submission. Required: description (length bounds),
 * category, urgency. Subcategory and contact are optional by design (§2.2 —
 * free-text first, structure is AI-derived downstream).
 */
export function validateReportDraft(draft: ReportDraft): ReportDraftErrors {
  const errors: ReportDraftErrors = {};
  const trimmed = draft.text.trim();

  if (trimmed.length <= REPORT_TEXT_MIN_LENGTH) {
    errors.text = `Description must be longer than ${REPORT_TEXT_MIN_LENGTH} characters.`;
  } else if (trimmed.length > REPORT_TEXT_MAX_LENGTH) {
    errors.text = `Description must be at most ${REPORT_TEXT_MAX_LENGTH} characters.`;
  }
  if (draft.category === '') {
    errors.category = 'Choose a category.';
  }
  if (draft.urgency === '') {
    errors.urgency = 'Choose an urgency level.';
  }

  return errors;
}

/** True when the draft would pass `validateReportDraft`. */
export function isReportDraftSubmittable(draft: ReportDraft): boolean {
  return Object.keys(validateReportDraft(draft)).length === 0;
}

/* -------------------------------------------------------------------------- */
/* Submission payload                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The client-side payload handed to the submit path (CRIS-9 `submitReport`).
 * Media and location attachments ride alongside, owned by their own tickets
 * (CRIS-16 location, CRIS-17 media upload).
 */
export interface ReportSubmission {
  text: string;
  category: Category;
  subcategory: string | null;
  urgency: Urgency;
  anonymous: boolean;
  /** Always `null` when `anonymous` — enforced here, not by callers. */
  contact: string | null;
}

/**
 * Compose the free-text body sent to the `submitReport` mutation.
 *
 * The deployed API contract is free-text-first (§2.2): structure (category,
 * urgency) is derived by AI triage downstream, so the mutation has no
 * category/urgency arguments. The citizen's own selections still carry real
 * signal, so they ride along as a trailing, clearly-delimited hint block the
 * triage prompt can weigh. Server limit is 5000 chars (submit-report core);
 * form text is capped at 1000, so the hint block always fits.
 *
 * TODO: promote category/urgency to first-class `submitReport` arguments and
 * drop this (needs a backend deploy + ADR).
 */
export function toSubmissionText(submission: ReportSubmission): string {
  const hints = [`category: ${submission.category}`, `urgency: ${submission.urgency}`];
  if (submission.subcategory) {
    hints.push(`supply: ${submission.subcategory}`);
  }
  return `${submission.text}\n\n[Citizen selections — ${hints.join('; ')}]`;
}

/**
 * Shape a validated draft into the submission payload. Throws if the draft is
 * not submittable so an invalid payload can never be constructed.
 */
export function toReportSubmission(draft: ReportDraft): ReportSubmission {
  if (draft.category === '' || draft.urgency === '' || !isReportDraftSubmittable(draft)) {
    throw new Error('Report draft is not submittable; validate before submitting.');
  }
  const contact = draft.contact.trim();
  return {
    text: draft.text.trim(),
    category: draft.category,
    subcategory: draft.subcategory.trim() || null,
    urgency: draft.urgency,
    anonymous: draft.anonymous,
    contact: draft.anonymous || contact === '' ? null : contact,
  };
}
