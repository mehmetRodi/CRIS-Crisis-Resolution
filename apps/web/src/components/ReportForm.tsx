import { useEffect, useRef, useState } from 'react';
import {
  Category,
  LOCATION_HINT_MAX_LENGTH,
  REPORT_TEXT_MAX_LENGTH,
  Urgency,
  createEmptyReportDraft,
  toReportSubmission,
  validateReportDraft,
} from '@crisismap/shared';
import type { ReportDraft } from '@crisismap/shared';

import { uploadReportMedia } from '../lib/media-upload';
import { LocationPicker } from './LocationPicker';
import { newClientRequestId, submitReport } from '../lib/submit-report';

/**
 * Web emergency-fallback report form (ADR-0021). The behavioural twin of
 * `apps/mobile/src/components/ReportForm.tsx`: same shared form core, same
 * submit gate, same success/reset flow. Only the presentation differs —
 * DOM + Tailwind here, React Native + StyleSheet there. Keep the two in step;
 * all rules live in `@crisismap/shared`, so this file is presentation only.
 */

const CATEGORY_OPTIONS = Object.values(Category);
const URGENCY_OPTIONS = Object.values(Urgency);

function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ');
}

/**
 * Required-field indicator (CRIS-27). The red asterisk is decoration — screen
 * readers either skip it or read "star", neither of which says "required" — so
 * it is hidden and paired with visually-hidden text that does.
 */
function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="text-red-500">
        *
      </span>
      <span className="sr-only">(required)</span>
    </>
  );
}

/**
 * Order in which outstanding fields are reported and focused (CRIS-27) — the
 * form's own top-to-bottom order, which `validateReportDraft`'s object key
 * order does not promise.
 */
const FIELD_ORDER = [
  'text',
  'category',
  'urgency',
  'locationHint',
] as const satisfies ReadonlyArray<keyof ReportDraft>;

/** A chip group's first option — where focus enters the group. */
function firstChip(fieldset: HTMLFieldSetElement | null) {
  return fieldset?.querySelector('button') ?? null;
}

const chipBase =
  'rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500';
const chipIdle = 'border-slate-300 bg-white text-slate-900 hover:border-blue-400';
const chipSelected = 'border-blue-600 bg-blue-600 text-white';
const inputBase =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500';

export function ReportForm() {
  const [draft, setDraft] = useState(createEmptyReportDraft());
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [mediaKey, setMediaKey] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Idempotency token (§5.4.4): stable across retries of the same report so a
  // flaky network can't create duplicates; re-minted only after success. Also
  // scopes the media upload's S3 key (CRIS-17) — a photo is picked before a
  // report exists, so there's no reportId yet to key it by.
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  // Focus targets for the blocked-submit path below. The two enum fields are
  // chip groups, so the fieldset is the ref and the first chip takes focus.
  const textRef = useRef<HTMLTextAreaElement>(null);
  const categoryRef = useRef<HTMLFieldSetElement>(null);
  const urgencyRef = useRef<HTMLFieldSetElement>(null);
  const locationHintRef = useRef<HTMLInputElement>(null);

  const errors = validateReportDraft(draft);
  const outstanding = FIELD_ORDER.filter((field) => errors[field]);
  const canSubmit = outstanding.length === 0 && !submitting && !photoUploading;

  /**
   * What blocks submission, in form order. Sourced from `validateReportDraft`
   * rather than restated here, so the announced reason cannot drift from the
   * rule that actually gates the submit (CRIS-27).
   *
   * An in-flight photo upload (CRIS-17) also gates the submit but is not a
   * draft-validation failure, so it is appended separately. Without it, an
   * upload-blocked submit would be an `aria-disabled` button with no reason to
   * announce and no field to focus — the exact dead end ADR-0037 rules out.
   */
  const blockedReason = [
    ...outstanding.map((field) => errors[field]),
    ...(photoUploading ? ['Wait for the photo to finish uploading.'] : []),
  ].join(' ');

  /** Sends focus to the first field still holding submission up. */
  function focusFirstOutstandingField() {
    const target = outstanding[0];
    if (target === 'text') textRef.current?.focus();
    else if (target === 'category') firstChip(categoryRef.current)?.focus();
    else if (target === 'urgency') firstChip(urgencyRef.current)?.focus();
    else if (target === 'locationHint') locationHintRef.current?.focus();
  }

  // The confirmation replaces the form in place. Without moving focus, a screen
  // reader or keyboard user is left on a button that no longer exists and hears
  // nothing — so send focus to the confirmation heading once it mounts (CRIS-27).
  useEffect(() => {
    if (submitted) confirmationRef.current?.focus();
  }, [submitted]);

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setPhotoName(null);
      setMediaKey(null);
      setPhotoError(null);
      return;
    }
    setPhotoName(file.name);
    setMediaKey(null);
    setPhotoError(null);
    setPhotoUploading(true);
    try {
      const key = await uploadReportMedia(file, clientRequestId);
      setMediaKey(key);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not upload the photo.');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // The submit is `aria-disabled`, not `disabled`, so it stays focusable and
    // its reason is actually announced (ADR-0037). The trade is that a click
    // still reaches us while the form is incomplete — so answer it by moving
    // focus to the field at fault instead of swallowing the event.
    if (!canSubmit) {
      focusFirstOutstandingField();
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      await submitReport(toReportSubmission(draft, mediaKey ? [mediaKey] : []), clientRequestId);
      setSubmitted(true);
      setDraft(createEmptyReportDraft());
      setPhotoName(null);
      setMediaKey(null);
      setPhotoError(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setClientRequestId(newClientRequestId());
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : null;
      setError(message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-6 text-center"
      >
        <div
          aria-hidden="true"
          className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-green-200 text-3xl font-bold text-green-600"
        >
          ✓
        </div>
        <h2 ref={confirmationRef} tabIndex={-1} className="text-xl font-bold text-green-800">
          Report Submitted
        </h2>
        <p className="text-sm text-green-800">
          Thank you for your report. Emergency coordinators will review it shortly.
        </p>
        <button
          type="button"
          onClick={() => setSubmitted(false)}
          className="mt-2 text-sm text-blue-600 underline hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Submit another report
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      aria-label="Emergency report"
      onSubmit={handleSubmit}
      noValidate
    >
      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="report-text" className="text-sm font-semibold text-slate-900">
          Description <RequiredMark />
        </label>
        <textarea
          id="report-text"
          ref={textRef}
          // The form is `noValidate` (shared logic owns the gate), so the required
          // state has to be conveyed to assistive tech explicitly (CRIS-27).
          aria-required="true"
          aria-describedby="report-text-count"
          className={`${inputBase} min-h-[110px] resize-y`}
          placeholder="Provide clear details about what's happening and what's needed."
          value={draft.text}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
          maxLength={REPORT_TEXT_MAX_LENGTH}
        />
        <span id="report-text-count" className="self-end text-xs text-slate-400">
          {draft.text.length}/{REPORT_TEXT_MAX_LENGTH} characters
        </span>
      </div>

      {/* Category */}
      <fieldset ref={categoryRef} className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold text-slate-900">
          Category <RequiredMark />
        </legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map((c) => {
            const selected = draft.category === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={selected}
                onClick={() => setDraft((d) => ({ ...d, category: selected ? '' : c }))}
                className={`${chipBase} ${selected ? chipSelected : chipIdle}`}
              >
                {categoryLabel(c)}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Subcategory */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="report-subcategory" className="text-sm font-semibold text-slate-900">
          Supply Type (Subcategory)
        </label>
        <input
          id="report-subcategory"
          className={inputBase}
          placeholder="e.g., Water, Food, Medical"
          value={draft.subcategory}
          onChange={(e) => setDraft((d) => ({ ...d, subcategory: e.target.value }))}
        />
      </div>

      {/* Location */}
      {/* A fieldset/legend, matching Category and Urgency: the picker is a group
          of controls, so its heading has to name the group programmatically
          rather than sit beside it as loose text (CRIS-27). */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold text-slate-900">Location (Optional)</legend>
        <LocationPicker
          value={draft.location}
          onChange={(location) => setDraft((d) => ({ ...d, location }))}
        />
      </fieldset>

      {/* Location hint */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="report-location-hint" className="text-sm font-semibold text-slate-900">
          Location Hint (Optional)
        </label>
        <input
          id="report-location-hint"
          ref={locationHintRef}
          className={inputBase}
          placeholder="e.g., near the blue bridge, 2nd floor"
          value={draft.locationHint}
          onChange={(e) => setDraft((d) => ({ ...d, locationHint: e.target.value }))}
          maxLength={LOCATION_HINT_MAX_LENGTH}
        />
      </div>

      {/* Photo */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-slate-900">Add Photo (Optional)</span>
        <button
          type="button"
          // The visible copy is split across three spans and an emoji, which
          // concatenates into a noisy name. State it once, and reflect the
          // current selection so the control is not just "button" (CRIS-27).
          aria-label={photoName ? `Change photo, ${photoName} selected` : 'Add a photo (optional)'}
          onClick={() => fileInputRef.current?.click()}
          disabled={photoUploading}
          className={`flex flex-col items-center gap-0.5 rounded-xl border-2 border-dashed p-5 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-70 ${
            mediaKey
              ? 'border-green-600 bg-green-50'
              : photoError
                ? 'border-red-300 bg-red-50'
                : 'border-slate-300 hover:border-blue-400'
          }`}
        >
          <span aria-hidden="true" className="text-3xl">
            📷
          </span>
          {photoName ? (
            <>
              <span
                className={`max-w-[90%] truncate text-sm font-medium ${mediaKey ? 'text-green-600' : 'text-slate-900'}`}
              >
                {photoName}
              </span>
              <span className="text-xs text-slate-400">
                {photoUploading ? 'Uploading…' : photoError ? photoError : 'Click to change photo'}
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-slate-900">Click to add a photo</span>
              <span className="text-xs text-slate-400">
                Images help responders understand the situation
              </span>
            </>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={pickPhoto}
        />
      </div>

      {/* Urgency */}
      <fieldset ref={urgencyRef} className="flex flex-col gap-1.5">
        <legend className="text-sm font-semibold text-slate-900">
          Urgency <RequiredMark />
        </legend>
        <div className="flex flex-wrap gap-2">
          {URGENCY_OPTIONS.map((u) => {
            const selected = draft.urgency === u;
            return (
              <button
                key={u}
                type="button"
                aria-pressed={selected}
                onClick={() => setDraft((d) => ({ ...d, urgency: u }))}
                className={`${chipBase} grow basis-[45%] ${selected ? chipSelected : chipIdle}`}
              >
                {u}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Anonymous */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-1 flex-col gap-0.5">
          <label htmlFor="report-anonymous" className="text-sm font-semibold text-slate-900">
            Anonymous Report
          </label>
          <span className="text-xs text-slate-500">
            Hide my identity from other users and responders
          </span>
        </div>
        <input
          id="report-anonymous"
          type="checkbox"
          className="h-5 w-9 shrink-0 cursor-pointer accent-blue-600"
          checked={draft.anonymous}
          onChange={(e) => setDraft((d) => ({ ...d, anonymous: e.target.checked }))}
        />
      </div>

      {/* Contact (hidden when anonymous) */}
      {!draft.anonymous && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="report-contact" className="text-sm font-semibold text-slate-900">
            Contact Info (Optional)
          </label>
          <input
            id="report-contact"
            className={inputBase}
            placeholder="Phone or email"
            autoCapitalize="none"
            inputMode="email"
            value={draft.contact}
            onChange={(e) => setDraft((d) => ({ ...d, contact: e.target.value }))}
          />
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        // `aria-disabled` rather than `disabled`: a disabled button leaves the
        // tab order, so the reason hanging off `aria-describedby` could never be
        // reached by the keyboard user who most needs it (ADR-0037). The gate
        // itself lives in `handleSubmit`.
        aria-disabled={!canSubmit}
        // Keyed to the blocking reason, not to `canSubmit` — while submitting
        // there is nothing outstanding to explain, and pointing at an empty
        // element would give the button a description that says nothing.
        aria-describedby={blockedReason ? 'report-submit-requirements' : undefined}
        className={`flex items-center justify-center rounded-xl bg-blue-600 px-4 py-3.5 text-[15px] font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          canSubmit ? 'hover:bg-blue-700' : 'opacity-50'
        }`}
      >
        {submitting ? 'Submitting…' : 'Submit Report'}
      </button>
      {blockedReason && (
        <span id="report-submit-requirements" className="sr-only">
          {blockedReason}
        </span>
      )}

      <p className="text-center text-xs text-slate-400">All reports are secure and encrypted</p>
    </form>
  );
}
