import { useEffect, useRef, useState } from 'react';
import {
  ALLOWED_MEDIA_CONTENT_TYPES,
  Category,
  LOCATION_HINT_MAX_LENGTH,
  REPORT_TEXT_MAX_LENGTH,
  ReportSubmitError,
  Urgency,
  createEmptyReportDraft,
  toReportSubmission,
  validateReportDraft,
} from '@crisismap/shared';
import type { ReportDraft } from '@crisismap/shared';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CircleCheck,
  CloudOff,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

import { useOfflineQueue } from '../OfflineQueueContext';
import { cn } from '../lib/cn';
import { categoryMeta, urgencyLabel } from '../lib/domain-display';
import { uploadReportMedia } from '../lib/media-upload';
import { newClientRequestId, submitReport } from '../lib/submit-report';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { FieldHint, Label, RequiredMark } from './ui/label';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { LocationPicker } from './LocationPicker';
import { OfflineQueueBanner } from './OfflineQueueBanner';

/**
 * The citizen report form (CRIS-6/ADR-0021, restyled in CRIS-54).
 *
 * Behavioural twin of `apps/mobile/src/components/ReportForm.tsx`: same shared
 * form core, same submit gate, same offline queueing, same success/reset flow.
 * Only the presentation differs — DOM + Tailwind here, React Native + StyleSheet
 * there. Every rule lives in `@crisismap/shared`, so this file is presentation
 * plus orchestration and nothing else.
 *
 * ── The one structural change in CRIS-54 ───────────────────────────────────
 * The fields are now grouped as REQUIRED first, then optional, under separate
 * headings. Previously all nine fields sat in one flat column, so a reporter in
 * an emergency had no way to see that four of them could be skipped — the
 * fastest possible report looked like the longest one. Nothing about validation
 * or submission changed; only what the person can tell at a glance.
 *
 * Every accessibility decision from CRIS-27/ADR-0037 is preserved deliberately:
 * `aria-disabled` instead of `disabled` on the gated controls, persistently
 * mounted live regions, focus moved to the confirmation, and focus sent to the
 * first outstanding field on a blocked submit. See the inline notes.
 */

const CATEGORY_OPTIONS = Object.values(Category);
const URGENCY_OPTIONS = Object.values(Urgency);

/**
 * Order in which outstanding fields are reported and focused (CRIS-27) — the
 * form's own top-to-bottom order, which `validateReportDraft`'s object key order
 * does not promise.
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

/** A selectable option chip. `aria-pressed` carries the selection state. */
function Chip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors',
        selected
          ? 'border-accent bg-accent-subtle text-accent-subtle-fg ring-1 ring-accent'
          : 'border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-hover',
        className,
      )}
    >
      {children}
      <Check
        aria-hidden="true"
        className={cn('ml-auto size-4 shrink-0', !selected && 'invisible')}
      />
    </button>
  );
}

/** A titled block of fields. `optional` marks the whole group as skippable. */
function FormSection({
  title,
  optional = false,
  description,
  children,
}: {
  title: string;
  optional?: boolean;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-5 rounded-2xl border border-border bg-surface p-5 shadow-xs sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-fg">{title}</h2>
        {optional ? (
          <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-fg-muted">
            Optional
          </span>
        ) : (
          <span className="rounded-full bg-accent-subtle px-2.5 py-1 text-xs font-medium text-accent-subtle-fg">
            Required
          </span>
        )}
      </div>
      {description ? <p className="text-sm leading-relaxed text-fg-muted">{description}</p> : null}
      {children}
    </section>
  );
}

const REPORT_STEPS = ['Situation', 'Location', 'Details', 'Review'] as const;

export function ReportForm() {
  const [step, setStep] = useState(0);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFieldFocus = useRef(false);
  const previousStep = useRef(0);
  const [draft, setDraft] = useState(createEmptyReportDraft());
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [mediaKey, setMediaKey] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Set on a submit that went out without the photo the user had picked, so the
  // confirmation can say so rather than claiming an unqualified success.
  const [photoDropped, setPhotoDropped] = useState(false);
  const [contactDropped, setContactDropped] = useState(false);
  // 'submitted': the server confirmed it. 'queued': saved locally, offline or
  // after a retryable failure, and will send automatically (CRIS-26). Both show
  // the same confirmation layout with distinct delivery guidance.
  const [outcome, setOutcome] = useState<'submitted' | 'queued' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isOnline, enqueue } = useOfflineQueue();
  // Idempotency token (§5.4.4): stable across retries of the same report so a
  // flaky network cannot create duplicates; re-minted only after success. Also
  // scopes the media upload's S3 key (CRIS-17) — a photo is picked before a
  // report exists, so there is no reportId yet to key it by.
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  // Monotonic upload generation. Only the newest pick may write photo state, so
  // a slow upload resolving after a newer pick — or after a successful submit
  // has reset the form — cannot attach its key to the wrong report.
  const uploadSeq = useRef(0);
  // Focus targets for the blocked-submit path. The two enum fields are chip
  // groups, so the fieldset is the ref and its first chip takes focus.
  const textRef = useRef<HTMLTextAreaElement>(null);
  const categoryRef = useRef<HTMLFieldSetElement>(null);
  const urgencyRef = useRef<HTMLFieldSetElement>(null);
  const locationHintRef = useRef<HTMLInputElement>(null);

  const errors = validateReportDraft(draft);
  const outstanding = FIELD_ORDER.filter((field) => errors[field]);
  const canSubmit = outstanding.length === 0 && !submitting && !photoUploading;

  /**
   * What blocks submission, in form order. Sourced from `validateReportDraft`
   * rather than restated, so the announced reason cannot drift from the rule
   * that actually gates the submit (CRIS-27).
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

  // Picking is also blocked while a submit is in flight: the success path resets
  // the draft and re-mints `clientRequestId`, so a photo picked in that window
  // would upload against a report that no longer exists.
  const photoBusy = photoUploading || submitting;

  /** Announced photo state. Empty when there is nothing to say. */
  const photoStatus = photoUploading
    ? `Uploading ${photoName ?? 'photo'}.`
    : photoError
      ? `Photo upload failed. ${photoError} You can still submit the report without it.`
      : mediaKey
        ? `Photo ${photoName ?? ''} attached.`
        : '';

  /** Button name, carrying the outcome the visible text cannot convey. */
  const photoLabel = !photoName
    ? 'Add a photo (optional)'
    : photoUploading
      ? `Uploading ${photoName}`
      : photoError
        ? `Retry photo upload, ${photoName} failed to upload`
        : `Change photo, ${photoName} attached`;

  /** Sends focus to the first field still holding submission up. */
  function focusFirstOutstandingField() {
    const target = outstanding[0];
    const targetStep = target === 'locationHint' ? 1 : 0;
    if (target && step !== targetStep) {
      pendingFieldFocus.current = true;
      setStep(targetStep);
      return;
    }
    if (target === 'text') textRef.current?.focus();
    else if (target === 'category') firstChip(categoryRef.current)?.focus();
    else if (target === 'urgency') firstChip(urgencyRef.current)?.focus();
    else if (target === 'locationHint') locationHintRef.current?.focus();
  }

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    if (pendingFieldFocus.current) {
      pendingFieldFocus.current = false;
      const target = outstanding[0];
      if (target === 'text') textRef.current?.focus();
      else if (target === 'category') firstChip(categoryRef.current)?.focus();
      else if (target === 'urgency') firstChip(urgencyRef.current)?.focus();
      else locationHintRef.current?.focus();
    } else {
      stepHeadingRef.current?.focus();
    }
  }, [step, outstanding]);

  const stepErrors = outstanding.filter((field) =>
    step === 0 ? field !== 'locationHint' : step === 1 ? field === 'locationHint' : false,
  );
  const continueReason = stepErrors.map((field) => errors[field]).join(' ');

  function nextStep() {
    if (submitting) return;
    if (stepErrors.length) {
      setError(continueReason);
      focusFirstOutstandingField();
      return;
    }
    setError(null);
    setStep((current) => Math.min(3, current + 1));
  }

  // The confirmation replaces the form in place. Without moving focus, a screen
  // reader or keyboard user is left on a button that no longer exists and hears
  // nothing — so send focus to the confirmation heading once it mounts (CRIS-27).
  useEffect(() => {
    if (outcome) confirmationRef.current?.focus();
  }, [outcome]);

  async function pickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    // The button already refuses to open the picker while busy, but the input is
    // not `disabled` (that would take it out of the tree), so guard here too —
    // this is the check that actually holds, and it mirrors mobile.
    if (photoBusy) {
      input.value = '';
      return;
    }
    const file = input.files?.[0];
    // Clear the input straight away. Re-selecting the SAME file leaves `value`
    // unchanged, so the browser fires no `change` event — meaning the retry the
    // failure message just asked for would silently do nothing.
    input.value = '';

    // Claim a generation before the first await; the guards below drop any
    // result a newer pick (or a completed submit) has since superseded.
    const seq = ++uploadSeq.current;

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
      if (seq !== uploadSeq.current) return;
      setMediaKey(key);
    } catch (err) {
      if (seq !== uploadSeq.current) return;
      setPhotoError(err instanceof Error ? err.message : 'Could not upload the photo.');
    } finally {
      if (seq === uploadSeq.current) setPhotoUploading(false);
    }
  }

  /**
   * Common reset after either a real send or an offline save (CRIS-26). Both are
   * "done" from the citizen's side, so they share every reset step — only the
   * confirmation copy, driven by `outcome`, differs.
   */
  function finishSubmission(result: 'submitted' | 'queued', omittedContact = false) {
    setOutcome(result);
    setContactDropped(omittedContact);
    // Tell the user their photo did not make it, rather than letting an
    // unqualified confirmation imply it did.
    setPhotoDropped(photoName !== null && mediaKey === null);
    setDraft(createEmptyReportDraft());
    // Retire any upload still in flight along with the report it belonged to:
    // its key is scoped to the `clientRequestId` about to be replaced, so
    // letting it land would attach this report's photo to the next one.
    uploadSeq.current++;
    setPhotoName(null);
    setMediaKey(null);
    setPhotoError(null);
    setPhotoUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setClientRequestId(newClientRequestId());
  }

  async function queueSubmission(submission: ReturnType<typeof toReportSubmission>) {
    try {
      await enqueue(submission, clientRequestId);
      finishSubmission('queued', submission.contact !== null);
    } catch {
      setError('This report could not be saved on this device. Please keep it open and try again.');
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (step < 3) {
      nextStep();
      return;
    }
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

    const submission = toReportSubmission(draft, mediaKey ? [mediaKey] : []);

    try {
      // Known-offline: skip the network call entirely rather than waiting on a
      // call that can only time out (CRIS-26).
      if (!isOnline) {
        await queueSubmission(submission);
        return;
      }
      await submitReport(submission, clientRequestId);
      finishSubmission('submitted');
    } catch (err) {
      if (err instanceof ReportSubmitError && !err.retryable) {
        // The server actively rejected this — retrying an identical payload
        // would too — so it stays a same-session error the citizen can see and
        // act on, not something silently queued.
        setError(err.message || 'Something went wrong. Please try again.');
      } else {
        // Either a transport failure (offline, DNS, timeout) or an unexpected
        // error of unknown shape — safe to assume retryable and queue it rather
        // than lose the report (CRIS-26, §5.4.4 idempotency).
        await queueSubmission(submission);
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Confirmation                                                           */
  /* ---------------------------------------------------------------------- */
  if (outcome) {
    return (
      <>
        <OfflineQueueBanner />
        <div
          role="status"
          className={cn(
            'flex flex-col items-center gap-3 rounded-2xl border px-6 py-10 text-center',
            outcome === 'queued'
              ? 'border-warning-border bg-warning-subtle'
              : 'border-success-border bg-success-subtle',
          )}
        >
          {outcome === 'queued' ? (
            <CloudOff aria-hidden="true" className="size-10 text-warning" />
          ) : (
            <CircleCheck aria-hidden="true" className="size-10 text-success" />
          )}
          <h2
            ref={confirmationRef}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight text-fg"
          >
            {outcome === 'queued' ? 'Report saved' : 'Report sent'}
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-fg-muted">
            {outcome === 'queued'
              ? 'Your report is saved on this device and is waiting to send. Keep this page open, or reopen CRIS on this device when you are online so it can retry.'
              : 'Your report has been received for triage and coordinator review.'}
          </p>

          {photoDropped ? (
            <p className="max-w-sm text-sm font-medium text-fg">
              Your photo could not be uploaded, so the report was{' '}
              {outcome === 'queued' ? 'saved' : 'sent'} without it.
            </p>
          ) : null}
          {contactDropped ? (
            <p className="max-w-sm text-sm font-medium text-fg">
              For your privacy, contact details are not stored on this device with an offline
              report.
            </p>
          ) : null}

          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              setStep(0);
              setOutcome(null);
            }}
            className="mt-2"
          >
            Submit another report
          </Button>
        </div>
      </>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Form                                                                    */
  /* ---------------------------------------------------------------------- */
  return (
    <>
      <OfflineQueueBanner />
      <form className="space-y-5" aria-label="Emergency report" onSubmit={handleSubmit} noValidate>
        <nav aria-label="Report progress" className="grid grid-cols-4 gap-2">
          {REPORT_STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              aria-label={`Go to ${label}`}
              aria-current={step === index ? 'step' : undefined}
              onClick={() => {
                if (!submitting) {
                  setError(null);
                  setStep(index);
                }
              }}
              className={cn(
                'flex min-h-16 flex-col items-center justify-center gap-2 rounded-xl border px-1 py-3 text-xs font-medium transition-colors sm:flex-row',
                step === index
                  ? 'border-accent-border bg-accent-subtle text-accent-subtle-fg'
                  : 'border-border bg-surface text-fg-muted hover:bg-surface-hover',
              )}
            >
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-[11px]',
                  step === index ? 'bg-accent text-fg-on-solid' : 'bg-surface-sunken',
                )}
              >
                {index + 1}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-3">
          <h2 ref={stepHeadingRef} tabIndex={-1} className="text-sm font-medium text-fg-muted">
            Step {step + 1} of 4 · {REPORT_STEPS[step]}
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-fg-muted">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            No account needed
          </span>
        </div>
        <div hidden={step !== 0}>
          <FormSection
            title="What is happening"
            description="Start with these three required details. Location, photos, and contact details are optional."
          >
            <div className="space-y-1.5">
              <Label htmlFor="report-text">
                Describe the situation <RequiredMark />
              </Label>
              <Textarea
                id="report-text"
                ref={textRef}
                // The form is `noValidate` (shared logic owns the gate), so the
                // required state must be conveyed to assistive tech explicitly.
                aria-required="true"
                aria-describedby="report-text-hint report-text-count"
                rows={5}
                maxLength={REPORT_TEXT_MAX_LENGTH}
                value={draft.text}
                onChange={(event) => setDraft((d) => ({ ...d, text: event.target.value }))}
                placeholder="What has happened, who is affected, and what is needed."
                className="rounded-lg text-base leading-relaxed"
              />
              <div className="flex items-start justify-between gap-4 text-xs leading-relaxed text-fg-muted">
                <p id="report-text-hint">Describe the incident without names or contact details.</p>
                <p id="report-text-count" className="tabular shrink-0">
                  {draft.text.length} / {REPORT_TEXT_MAX_LENGTH}
                </p>
              </div>
            </div>

            <fieldset ref={categoryRef} className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-fg">
                Type of emergency <RequiredMark />
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORY_OPTIONS.map((category) => {
                  const selected = draft.category === category;
                  const { label, icon: Icon } = categoryMeta(category);
                  return (
                    <Chip
                      key={category}
                      selected={selected}
                      onClick={() =>
                        setDraft((d) => ({ ...d, category: selected ? '' : category }))
                      }
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="min-w-0 break-words text-left">{label}</span>
                    </Chip>
                  );
                })}
              </div>
            </fieldset>

            <fieldset ref={urgencyRef} className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-fg">
                How urgent is it <RequiredMark />
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {URGENCY_OPTIONS.map((urgency) => {
                  return (
                    <Chip
                      key={urgency}
                      selected={draft.urgency === urgency}
                      onClick={() => setDraft((d) => ({ ...d, urgency }))}
                      className="justify-between font-semibold"
                    >
                      {urgencyLabel(urgency)}
                    </Chip>
                  );
                })}
              </div>
            </fieldset>
          </FormSection>
        </div>
        <div hidden={step !== 1}>
          <FormSection
            title="Where is help needed?"
            optional
            description="Add the incident location or a nearby landmark if you know it."
          >
            {/* A fieldset/legend, matching the chip groups: the picker is a group
              of controls, so its heading must name the group programmatically
              rather than sit beside it as loose text (CRIS-27). */}
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-fg">Location</legend>
              {step === 1 ? (
                <LocationPicker
                  value={draft.location}
                  onChange={(location) => setDraft((d) => ({ ...d, location }))}
                />
              ) : null}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="report-location-hint">Landmark or detail</Label>
              <Input
                id="report-location-hint"
                className="h-12 rounded-lg text-base"
                ref={locationHintRef}
                maxLength={LOCATION_HINT_MAX_LENGTH}
                value={draft.locationHint}
                onChange={(event) => setDraft((d) => ({ ...d, locationHint: event.target.value }))}
                placeholder="Near the blue bridge, second floor"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-subcategory">What is needed</Label>
              <Input
                id="report-subcategory"
                className="h-12 rounded-lg text-base"
                value={draft.subcategory}
                onChange={(event) => setDraft((d) => ({ ...d, subcategory: event.target.value }))}
                placeholder="Water, food, medical supplies"
              />
            </div>
          </FormSection>
        </div>
        <div hidden={step !== 2} className="space-y-5">
          <FormSection
            title="Photo"
            optional
            description="Add an image to help explain the situation."
          >
            <button
              type="button"
              // The visible copy spans several elements, which concatenates into a
              // noisy name. State it once, and reflect the current selection so
              // the control is not just "button" (CRIS-27). Because this label
              // overrides the element's content it must also carry the upload
              // outcome — otherwise the only mention of a failure is text the
              // label hides (see the live region below).
              aria-label={photoLabel}
              // `aria-disabled`/`aria-busy` rather than `disabled` (ADR-0037): a
              // disabled button is blurred to the document body the instant the
              // upload starts, dropping the user out of the form mid-interaction.
              // The gate is the re-entry guard in the handler instead.
              aria-disabled={photoBusy}
              aria-busy={photoUploading}
              onClick={() => {
                if (photoBusy) return;
                fileInputRef.current?.click();
              }}
              className={cn(
                'flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors',
                photoBusy && 'opacity-70',
                mediaKey
                  ? 'border-success-border bg-success-subtle shadow-2xs'
                  : photoError
                    ? 'border-danger-border bg-danger-subtle shadow-2xs'
                    : 'border-border-strong/70 bg-surface hover:bg-surface-hover hover:border-accent/60 shadow-2xs',
              )}
            >
              {photoUploading ? (
                <Loader2 aria-hidden="true" className="size-7 animate-spin text-accent" />
              ) : mediaKey ? (
                <div className="flex size-10 items-center justify-center rounded-full bg-success/15 text-success ring-1 ring-success/30">
                  <Check aria-hidden="true" className="size-6" />
                </div>
              ) : photoError ? (
                <div className="flex size-10 items-center justify-center rounded-full bg-danger/15 text-danger ring-1 ring-danger/30">
                  <TriangleAlert aria-hidden="true" className="size-6" />
                </div>
              ) : (
                <div className="flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent ring-1 ring-accent/20">
                  <Camera aria-hidden="true" className="size-5" />
                </div>
              )}

              {photoName ? (
                <>
                  <span
                    className={cn(
                      'max-w-full truncate text-sm font-semibold',
                      mediaKey ? 'text-success' : 'text-fg',
                    )}
                  >
                    {photoName}
                  </span>
                  {/* A failure must not look identical to the muted "tap to
                    change" hint — mobile already colours this; web was the odd
                    one out. */}
                  <span
                    className={cn(
                      'text-xs',
                      photoError ? 'font-semibold text-danger' : 'text-fg-subtle',
                    )}
                  >
                    {photoUploading
                      ? 'Uploading…'
                      : photoError
                        ? photoError
                        : 'Tap to change photo'}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm font-semibold text-fg">Add a photo</span>
                  <span className="text-xs text-fg-muted">JPEG, PNG, or WebP</span>
                </>
              )}
            </button>

            {/* Persistently mounted, never conditionally rendered (ADR-0037): a
              live region that appears at the same moment as its text is
              frequently missed. All upload state is announced here because the
              button's `aria-label` hides its own content from assistive tech.
              Named because the form carries more than one live region — the name
              is what lets a user, and a test, tell them apart. */}
            <span role="status" aria-label="Photo upload status" className="sr-only">
              {photoStatus}
            </span>

            <input
              ref={fileInputRef}
              type="file"
              // Narrower than `image/*`: the presigned policy accepts only these
              // three, so offering HEIC or GIF invites a rejection after the fact.
              accept={ALLOWED_MEDIA_CONTENT_TYPES.join(',')}
              className="hidden"
              onChange={pickPhoto}
            />
          </FormSection>

          <FormSection title="About you" optional>
            <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-sunken px-4 py-4">
              <div className="min-w-0">
                <Label htmlFor="report-anonymous" className="font-semibold text-fg">
                  Report anonymously
                </Label>
                <FieldHint className="mt-0.5 text-xs text-fg-muted">
                  Your identity is hidden from responders and never appears on the map.
                </FieldHint>
              </div>
              <Switch
                id="report-anonymous"
                checked={draft.anonymous}
                onCheckedChange={(anonymous) => setDraft((d) => ({ ...d, anonymous }))}
              />
            </div>

            {!draft.anonymous ? (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="report-contact" className="font-medium">
                  Contact details
                </Label>
                <Input
                  id="report-contact"
                  autoCapitalize="none"
                  inputMode="email"
                  value={draft.contact}
                  onChange={(event) => setDraft((d) => ({ ...d, contact: event.target.value }))}
                  placeholder="Phone or email"
                  aria-describedby="report-contact-hint"
                  className="h-12 rounded-lg text-base"
                />
                <FieldHint id="report-contact-hint" className="text-xs text-fg-muted">
                  Used only if a responder needs to reach you. Never shown publicly and never sent
                  to the classification model.
                </FieldHint>
              </div>
            ) : null}
          </FormSection>
        </div>
        <div hidden={step !== 3}>
          <section
            className="rounded-2xl border border-border bg-surface p-5 shadow-xs sm:p-6"
            aria-labelledby="review-title"
          >
            <h2 id="review-title" className="text-xl font-semibold tracking-tight">
              Ready to send?
            </h2>
            <p className="mt-2 text-sm text-fg-muted">
              Check your report. You can return to any step to make changes.
            </p>
            <dl className="mt-6 divide-y divide-border text-sm">
              {[
                ['Situation', draft.text || 'Description still needed', 0],
                [
                  'Category',
                  draft.category ? categoryMeta(draft.category).label : 'Choose a category',
                  0,
                ],
                ['Urgency', draft.urgency ? urgencyLabel(draft.urgency) : 'Choose an urgency', 0],
                [
                  'Location',
                  [
                    draft.location
                      ? `${draft.location.lat.toFixed(4)}, ${draft.location.lng.toFixed(4)}`
                      : '',
                    draft.locationHint,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Not provided',
                  1,
                ],
                ['Help needed', draft.subcategory || 'Not specified', 1],
                [
                  'Photo',
                  photoUploading
                    ? 'Uploading…'
                    : mediaKey
                      ? photoName
                      : photoName
                        ? 'Upload failed — photo will not be included'
                        : 'Not attached',
                  2,
                ],
                [
                  'Contact',
                  draft.anonymous
                    ? 'Anonymous report'
                    : draft.contact || 'No contact details provided',
                  2,
                ],
              ].map(([label, value, target]) => (
                <div key={String(label)} className="flex items-start justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <dt className="text-xs text-fg-muted">{label}</dt>
                    <dd className="mt-1.5 whitespace-pre-wrap break-words font-medium leading-relaxed">
                      {value}
                    </dd>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent-subtle"
                    aria-label={`Edit ${label}`}
                    onClick={() => {
                      if (!submitting) setStep(Number(target));
                    }}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </dl>
            <p className="mt-3 rounded-xl bg-accent-subtle p-4 text-xs leading-relaxed text-accent-subtle-fg">
              Your report will be sent for triage and coordinator review. If you are offline, we
              will try to save it on this device for retry.
            </p>
          </section>
        </div>
        <div
          role="alert"
          className={
            error
              ? 'rounded-xl border border-danger-border bg-danger-subtle px-4 py-3 text-sm font-medium text-danger'
              : 'sr-only'
          }
        >
          {error ?? ''}
        </div>

        <div className="sticky bottom-0 z-10 space-y-3 border-t border-border bg-bg/95 py-4 backdrop-blur-md">
          <div className="flex items-center gap-3">
            {step > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                aria-disabled={submitting}
                onClick={() => {
                  if (!submitting) {
                    setError(null);
                    setStep((current) => current - 1);
                  }
                }}
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
            ) : null}
            {step < 3 ? (
              <Button
                type="button"
                size="lg"
                className="ml-auto h-12 px-7"
                aria-disabled={Boolean(continueReason)}
                aria-describedby={continueReason ? 'report-continue-requirements' : undefined}
                onClick={nextStep}
              >
                {step === 2 ? 'Review report' : 'Continue'}
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                size="xl"
                className="ml-auto h-12 flex-1 rounded-xl text-base font-semibold"
                // `aria-disabled` rather than `disabled`: a disabled button leaves
                // the tab order, so the reason hanging off `aria-describedby` could
                // never be reached by the keyboard user who most needs it
                // (ADR-0037). The gate itself lives in `handleSubmit`.
                aria-disabled={!canSubmit}
                // Keyed to the blocking reason, not to `canSubmit` — while
                // submitting there is nothing outstanding to explain, and pointing
                // at an empty element would give the button a description that says
                // nothing.
                aria-describedby={blockedReason ? 'report-submit-requirements' : undefined}
              >
                {submitting ? <Loader2 aria-hidden="true" className="animate-spin size-5" /> : null}
                {submitting ? 'Sending…' : 'Send report'}
              </Button>
            )}
          </div>
          {continueReason ? (
            <span id="report-continue-requirements" className="sr-only">
              {continueReason}
            </span>
          ) : null}
          {blockedReason ? (
            <span id="report-submit-requirements" className="sr-only">
              {blockedReason}
            </span>
          ) : null}

          <p className="text-center text-xs text-fg-muted">
            Reports are encrypted in transit and at rest.
          </p>
        </div>
      </form>
    </>
  );
}
