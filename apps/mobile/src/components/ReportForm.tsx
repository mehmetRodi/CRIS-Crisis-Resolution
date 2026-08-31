import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  findNodeHandle,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
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
import { Camera, Check, CircleCheck, Send, TriangleAlert } from 'lucide-react-native';

import { LocationPicker } from './LocationPicker';
import { OfflineQueueBanner } from './OfflineQueueBanner';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Callout } from './ui/Callout';
import { Field, FieldHint, FieldLabel } from './ui/Field';
import { Chip } from './ui/Chip';
import { Input } from './ui/Input';
import { categoryIcon, categoryLabel, urgencyLabel } from '../lib/domain-display';
import { colors, numeric, radii, space, srOnly, type } from '../theme';
import { useOfflineQueue } from '../lib/OfflineQueueContext';
import { uploadReportMedia } from '../lib/media-upload';
import { newClientRequestId, submitReport } from '../lib/submit-report';

/**
 * The citizen report form (CRIS-6, rebuilt in CRIS-57).
 *
 * Behavioural twin of `apps/web/src/components/ReportForm.tsx`: same shared form
 * core, same submit gate, same offline queueing, same success/reset flow. Only
 * the presentation differs — React Native + StyleSheet here, DOM + Tailwind
 * there. Every rule lives in `@crisismap/shared`.
 *
 * ── Two changes in CRIS-57 ─────────────────────────────────────────────────
 *
 * 1. **Fields are grouped required-first**, matching web. Previously all nine
 *    sat in one flat column, so a reporter in an emergency had no way to see
 *    that five of them could be skipped — the fastest possible report looked
 *    like the longest one.
 *
 * 2. **The submit button explains itself.** It used to be plainly `disabled`:
 *    a citizen tapped it, nothing happened, and nothing said why. React Native
 *    removes a `disabled` Pressable from the accessibility tree, so a screen
 *    reader could not even reach it to hear the reason. It now follows the
 *    pattern ADR-0037 settled for web — the control stays pressable and
 *    announced, a press surfaces what is outstanding, and focus moves to the
 *    first field at fault. This closes the mobile half of the gap recorded in
 *    `docs/conventions.md` → Accessibility.
 */

const CATEGORY_OPTIONS = Object.values(Category);
const URGENCY_OPTIONS = Object.values(Urgency);

/**
 * Order in which outstanding fields are reported and focused — the form's own
 * top-to-bottom order, which `validateReportDraft`'s object key order does not
 * promise.
 */
const FIELD_ORDER = [
  'text',
  'category',
  'urgency',
  'locationHint',
] as const satisfies ReadonlyArray<keyof ReportDraft>;

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
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {optional ? <Badge label="Optional" tone="neutral" /> : null}
      </View>
      {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
      {children}
    </View>
  );
}

export interface ReportFormProps {
  /** Forwarded to LocationPicker so the parent ScrollView can yield the pan gesture. */
  onMapInteractionStart?: () => void;
  onMapInteractionEnd?: () => void;
}

export function ReportForm({ onMapInteractionStart, onMapInteractionEnd }: ReportFormProps) {
  const [draft, setDraft] = useState(createEmptyReportDraft());
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [mediaKey, setMediaKey] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Set on a submit that went out without the photo the user had picked, so the
  // confirmation can say so rather than claiming an unqualified success.
  const [photoDropped, setPhotoDropped] = useState(false);
  const [contactDropped, setContactDropped] = useState(false);
  // 'submitted': the server confirmed it. 'queued': saved locally, offline or
  // after a retryable failure, and will send automatically (CRIS-26). Both show
  // the same confirmation with different copy — from the citizen's side, either
  // way they are done.
  const [outcome, setOutcome] = useState<'submitted' | 'queued' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when a blocked submit was attempted, so the reason becomes visible. */
  const [showBlockedReason, setShowBlockedReason] = useState(false);
  const { isOnline, enqueue } = useOfflineQueue();
  // Idempotency token (§5.4.4): stable across retries of the same report so a
  // flaky network cannot create duplicates; re-minted only after success. Also
  // scopes the media upload's S3 key (CRIS-17) — a photo is picked before a
  // report exists, so there is no reportId yet to key it by.
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId);
  // Monotonic upload generation. Only the newest pick may write photo state, so
  // a slow upload resolving after a newer pick — or after a successful submit
  // has reset the form — cannot attach its key to the wrong report.
  const uploadSeq = useRef(0);
  // Guards the window while the OS picker is open, which `photoUploading` does
  // not cover (it only flips once an asset has come back).
  const pickerOpen = useRef(false);

  // Focus targets for the blocked-submit path. Text fields take focus directly;
  // the two chip groups have no focusable control, so accessibility focus is
  // moved to the group's label instead.
  const textRef = useRef<TextInput>(null);
  const locationHintRef = useRef<TextInput>(null);
  const categoryLabelRef = useRef<Text>(null);
  const urgencyLabelRef = useRef<Text>(null);
  const confirmationRef = useRef<Text>(null);

  const errors = validateReportDraft(draft);
  const outstanding = FIELD_ORDER.filter((field) => errors[field]);
  const canSubmit = outstanding.length === 0 && !submitting && !photoUploading;

  /**
   * What blocks submission, in form order. Sourced from `validateReportDraft`
   * rather than restated here, so the announced reason cannot drift from the
   * rule that actually gates the submit.
   *
   * An in-flight photo upload also gates the submit but is not a draft
   * validation failure, so it is appended separately — otherwise an
   * upload-blocked submit would have no reason to give and no field to focus.
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
  const photoName = photo?.fileName ?? null;
  const photoStatus = photoUploading
    ? `Uploading ${photoName ?? 'photo'}.`
    : photoError
      ? `Photo upload failed. ${photoError} You can still submit the report without it.`
      : mediaKey
        ? `Photo ${photoName ?? ''} attached.`
        : '';

  /** Control name, carrying the outcome the visible text cannot convey. */
  const photoLabel = !photo
    ? 'Add a photo (optional)'
    : photoUploading
      ? `Uploading ${photoName ?? 'photo'}`
      : photoError
        ? `Retry photo upload, ${photoName ?? 'photo'} failed to upload`
        : `Change photo, ${photoName ?? 'photo'} attached`;

  /**
   * Sends focus to the first field still holding submission up.
   *
   * Text inputs take real focus, which both shows the caret and scrolls the
   * field into view. The chip groups have no focusable element, so
   * `setAccessibilityFocus` moves the screen reader's cursor to the group's
   * label — the closest equivalent React Native offers.
   */
  function focusFirstOutstandingField() {
    const target = outstanding[0];
    if (target === 'text') {
      textRef.current?.focus();
      return;
    }
    if (target === 'locationHint') {
      locationHintRef.current?.focus();
      return;
    }
    const groupLabel = target === 'category' ? categoryLabelRef.current : urgencyLabelRef.current;
    const handle = groupLabel && findNodeHandle(groupLabel);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }

  // The confirmation replaces the form in place. Without moving focus, a screen
  // reader user is left on a control that no longer exists and hears nothing.
  useEffect(() => {
    if (!outcome) return;
    const handle = confirmationRef.current && findNodeHandle(confirmationRef.current);
    if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
  }, [outcome]);

  // Once the form becomes submittable there is nothing left to explain, so the
  // blocked notice retires itself rather than lingering as a stale warning.
  useEffect(() => {
    if (outstanding.length === 0 && !photoUploading) setShowBlockedReason(false);
  }, [outstanding.length, photoUploading]);

  async function pickPhoto() {
    // The picker is awaited BEFORE `photoUploading` flips, so the control stays
    // pressable for as long as the picker takes to appear. Guard re-entry here
    // rather than relying on a disabled state to sequence taps.
    if (photoBusy || pickerOpen.current) return;
    pickerOpen.current = true;
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
    } finally {
      pickerOpen.current = false;
    }
    if (result.canceled) return;

    // Claim a generation before the upload; the guards below drop any result a
    // newer pick — or a completed submit — has since superseded.
    const seq = ++uploadSeq.current;

    const asset = result.assets[0] ?? null;
    setPhoto(asset);
    setMediaKey(null);
    setPhotoError(null);
    if (!asset) return;

    setPhotoUploading(true);
    try {
      const key = await uploadReportMedia(asset, clientRequestId);
      if (seq !== uploadSeq.current) return;
      setMediaKey(key);
    } catch (e) {
      if (seq !== uploadSeq.current) return;
      setPhotoError(e instanceof Error ? e.message : 'Could not upload the photo.');
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
    setPhotoDropped(photo !== null && mediaKey === null);
    setDraft(createEmptyReportDraft());
    // Retire any upload still in flight along with the report it belonged to:
    // its key is scoped to the `clientRequestId` about to be replaced, so
    // letting it land would attach this report's photo to the next one.
    uploadSeq.current++;
    setPhoto(null);
    setMediaKey(null);
    setPhotoError(null);
    setPhotoUploading(false);
    setShowBlockedReason(false);
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

  async function handleSubmit() {
    if (submitting) return;
    // The control is reported as unavailable but stays pressable (ADR-0037), so
    // a press still reaches us while the form is incomplete. Answer it: show the
    // reason and move focus to the field at fault, rather than doing nothing.
    if (!canSubmit) {
      setShowBlockedReason(true);
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
    } catch (e) {
      if (e instanceof ReportSubmitError && !e.retryable) {
        // The server actively rejected this — retrying an identical payload
        // would too — so it stays a same-session error the citizen can act on.
        setError(e.message || 'Something went wrong. Please try again.');
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
      <View style={styles.form}>
        <OfflineQueueBanner />
        <View style={styles.successBox}>
          <CircleCheck size={44} color={colors.success} />
          <Text ref={confirmationRef} accessibilityRole="header" style={styles.successTitle}>
            {outcome === 'queued' ? 'Report saved' : 'Report sent'}
          </Text>
          <Text style={styles.successBody}>
            {outcome === 'queued'
              ? 'Your report is saved on this device and will send automatically as soon as you are back online. You can close the app.'
              : 'Emergency coordinators have it. It is being classified and ranked now.'}
          </Text>
          {photoDropped ? (
            <Text style={styles.successCaveat}>
              Your photo could not be uploaded, so the report was{' '}
              {outcome === 'queued' ? 'saved' : 'sent'} without it.
            </Text>
          ) : null}
          {contactDropped ? (
            <Text style={styles.successCaveat}>
              For your privacy, contact details are not stored on this device with an offline
              report.
            </Text>
          ) : null}
          <Button
            label="Submit another report"
            onPress={() => setOutcome(null)}
            variant="secondary"
            style={styles.successAction}
          />
        </View>
      </View>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Form                                                                    */
  /* ---------------------------------------------------------------------- */
  return (
    <View style={styles.form}>
      <OfflineQueueBanner />

      <FormSection title="What is happening">
        <Field>
          <FieldLabel required>Describe the situation</FieldLabel>
          <Input
            ref={textRef}
            value={draft.text}
            onChangeText={(text) => setDraft((d) => ({ ...d, text }))}
            placeholder="What has happened, who is affected, and what is needed."
            multiline
            multilineRows={5}
            maxLength={REPORT_TEXT_MAX_LENGTH}
            accessibilityLabel="Describe the situation, required"
          />
          <Text style={styles.counter}>
            {draft.text.length} / {REPORT_TEXT_MAX_LENGTH}
          </Text>
        </Field>

        <Field>
          <FieldLabel required>Type of emergency</FieldLabel>
          {/* The target for programmatic accessibility focus. A separate node
              from the visible label so that focusing the group announces the
              group, without the screen reader re-reading the whole field. */}
          <Text ref={categoryLabelRef} style={srOnly}>
            Type of emergency, required
          </Text>
          <View style={styles.chipGrid} accessibilityRole="radiogroup">
            {CATEGORY_OPTIONS.map((category) => {
              const selected = draft.category === category;
              return (
                <Chip
                  key={category}
                  label={categoryLabel(category)}
                  icon={categoryIcon(category)}
                  selected={selected}
                  onPress={() => setDraft((d) => ({ ...d, category: selected ? '' : category }))}
                />
              );
            })}
          </View>
        </Field>

        <Field>
          <FieldLabel required>How urgent is it</FieldLabel>
          <Text ref={urgencyLabelRef} style={srOnly}>
            How urgent is it, required
          </Text>
          <View style={styles.chipGrid} accessibilityRole="radiogroup">
            {URGENCY_OPTIONS.map((urgency) => (
              <Chip
                key={urgency}
                label={urgencyLabel(urgency)}
                selected={draft.urgency === urgency}
                onPress={() => setDraft((d) => ({ ...d, urgency }))}
                grow
              />
            ))}
          </View>
        </Field>
      </FormSection>

      <FormSection
        title="Where"
        optional
        description="Anything here helps responders find you faster, but none of it is required."
      >
        <Field>
          <FieldLabel>Location</FieldLabel>
          <LocationPicker
            value={draft.location}
            onChange={(location) => setDraft((d) => ({ ...d, location }))}
            onInteractionStart={onMapInteractionStart}
            onInteractionEnd={onMapInteractionEnd}
          />
        </Field>

        <Field>
          <FieldLabel>Landmark or detail</FieldLabel>
          <Input
            ref={locationHintRef}
            value={draft.locationHint}
            onChangeText={(locationHint) => setDraft((d) => ({ ...d, locationHint }))}
            placeholder="Near the blue bridge, second floor"
            maxLength={LOCATION_HINT_MAX_LENGTH}
            accessibilityLabel="Landmark or detail"
          />
        </Field>

        <Field>
          <FieldLabel>What is needed</FieldLabel>
          <Input
            value={draft.subcategory}
            onChangeText={(subcategory) => setDraft((d) => ({ ...d, subcategory }))}
            placeholder="Water, food, medical supplies"
            accessibilityLabel="What is needed"
          />
        </Field>
      </FormSection>

      <FormSection title="Photo" optional>
        <Button
          label={
            photo
              ? photoUploading
                ? 'Uploading…'
                : (photo.fileName ?? 'Photo attached')
              : 'Add a photo'
          }
          onPress={pickPhoto}
          icon={photoUploading ? undefined : mediaKey ? Check : Camera}
          loading={photoUploading}
          // Reported as unavailable but still reachable, so the state above can
          // actually be heard; `pickPhoto` holds the re-entry guard.
          blocked={photoBusy}
          accessibilityLabel={photoLabel}
          variant="secondary"
          style={[
            styles.photoButton,
            mediaKey != null && styles.photoButtonDone,
            photoError != null && styles.photoButtonError,
          ]}
        />
        <FieldHint>{photoError ?? 'Images help responders understand the situation.'}</FieldHint>
        {/* Always mounted, never conditionally rendered (ADR-0037): a live
            region that appears at the same moment as its text is frequently
            missed. Carries the upload outcome, which the button's
            `accessibilityLabel` hides from assistive tech. */}
        <Text accessibilityLiveRegion="polite" style={srOnly}>
          {photoStatus}
        </Text>
      </FormSection>

      <FormSection title="About you" optional>
        <View style={styles.anonymousRow}>
          <View style={styles.anonymousCopy}>
            <FieldLabel>Report anonymously</FieldLabel>
            <FieldHint>
              Your identity is hidden from responders and never appears on the map.
            </FieldHint>
          </View>
          <Switch
            value={draft.anonymous}
            onValueChange={(anonymous) => setDraft((d) => ({ ...d, anonymous }))}
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
            thumbColor={colors.surface}
            accessibilityLabel="Report anonymously"
          />
        </View>

        {!draft.anonymous ? (
          <Field>
            <FieldLabel>Contact details</FieldLabel>
            <Input
              value={draft.contact}
              onChangeText={(contact) => setDraft((d) => ({ ...d, contact }))}
              placeholder="Phone or email"
              autoCapitalize="none"
              keyboardType="email-address"
              accessibilityLabel="Contact details"
            />
            <FieldHint>
              Used only if a responder needs to reach you. Never shown publicly and never sent to
              the classification model.
            </FieldHint>
          </Field>
        ) : null}
      </FormSection>

      {error ? <Callout tone="danger" message={error} icon={TriangleAlert} assertive /> : null}

      {/* Surfaced only after a blocked press, so an incomplete form is not
          scolding someone who is still filling it in. */}
      {showBlockedReason && blockedReason ? (
        <Callout tone="warning" message={blockedReason} icon={TriangleAlert} assertive />
      ) : null}

      <Button
        label={submitting ? 'Sending…' : 'Send report'}
        onPress={handleSubmit}
        variant="primary"
        size="xl"
        icon={submitting ? undefined : Send}
        loading={submitting}
        blocked={!canSubmit}
        accessibilityHint={blockedReason || undefined}
      />

      <Text style={styles.footer}>Reports are encrypted in transit and at rest.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: space['3xl'],
  },
  section: {
    gap: space.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  sectionTitle: {
    fontSize: type.heading.fontSize,
    lineHeight: type.heading.lineHeight,
    fontWeight: type.heading.fontWeight,
    color: colors.fg,
  },
  sectionDescription: {
    marginTop: -space.md,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: colors.fgMuted,
  },
  counter: {
    alignSelf: 'flex-end',
    fontSize: type.caption.fontSize,
    color: colors.fgSubtle,
    ...numeric,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  photoButton: {
    minHeight: 72,
    borderStyle: 'dashed',
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  photoButtonDone: {
    borderStyle: 'solid',
    borderColor: colors.successBorder,
    backgroundColor: colors.successSubtle,
  },
  photoButtonError: {
    borderStyle: 'solid',
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSubtle,
  },
  anonymousRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSunken,
    padding: space.lg,
  },
  anonymousCopy: {
    flex: 1,
    gap: space['2xs'],
  },
  footer: {
    textAlign: 'center',
    fontSize: type.caption.fontSize,
    color: colors.fgSubtle,
  },
  successBox: {
    alignItems: 'center',
    gap: space.lg,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: radii.lg,
    backgroundColor: colors.successSubtle,
    paddingHorizontal: space.xl,
    paddingVertical: space['4xl'],
  },
  successTitle: {
    fontSize: type.title.fontSize,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.fontWeight,
    color: colors.fg,
  },
  successBody: {
    textAlign: 'center',
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: colors.fgMuted,
  },
  successCaveat: {
    textAlign: 'center',
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: '600',
    color: colors.fg,
  },
  successAction: {
    marginTop: space.md,
  },
});
