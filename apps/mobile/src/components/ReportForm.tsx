import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  Category,
  LOCATION_HINT_MAX_LENGTH,
  REPORT_TEXT_MAX_LENGTH,
  ReportSubmitError,
  Urgency,
  createEmptyReportDraft,
  isReportDraftSubmittable,
  toReportSubmission,
} from '@crisismap/shared';

import { LocationPicker } from './LocationPicker';
import { OfflineQueueBanner } from './OfflineQueueBanner';
import { colors, radii } from '../theme';
import { useOfflineQueue } from '../lib/OfflineQueueContext';
import { uploadReportMedia } from '../lib/media-upload';
import { newClientRequestId, submitReport } from '../lib/submit-report';

const CATEGORY_OPTIONS = Object.values(Category);
const URGENCY_OPTIONS = Object.values(Urgency);

function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ');
}

interface ReportFormProps {
  /** Forwarded to LocationPicker so the parent ScrollView can yield the pan gesture to the map. */
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
  // 'submitted': the server confirmed it. 'queued': saved locally, offline or
  // after a retryable failure, will send automatically (CRIS-26). Both render
  // the same confirmation view with different copy.
  const [outcome, setOutcome] = useState<'submitted' | 'queued' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isOnline, enqueue } = useOfflineQueue();
  // Idempotency token (§5.4.4): stable across retries of the same report so a
  // flaky network can't create duplicates; re-minted only after success. Also
  // scopes the media upload's S3 key (CRIS-17) — a photo is picked before a
  // report exists, so there's no reportId yet to key it by.
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId);
  // Monotonic upload generation. Only the newest pick may write photo state, so
  // a slow upload that resolves after a newer pick — or after the form has been
  // reset by a successful submit — cannot attach its key to the wrong report.
  const uploadSeq = useRef(0);
  // Guards the window while the OS picker is open, which `photoUploading` does
  // not cover (it only flips once an asset has come back).
  const pickerOpen = useRef(false);

  const canSubmit = isReportDraftSubmittable(draft) && !submitting && !photoUploading;

  // Picking is also blocked while a submit is in flight: the success path resets
  // the draft and re-mints `clientRequestId`, so a photo picked during that
  // window would upload against a report that no longer exists.
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

  /** Control name, carrying the outcome the visible text can't convey. */
  const photoLabel = !photo
    ? 'Add a photo (optional)'
    : photoUploading
      ? `Uploading ${photoName ?? 'photo'}`
      : photoError
        ? `Retry photo upload, ${photoName ?? 'photo'} failed to upload`
        : `Change photo, ${photoName ?? 'photo'} attached`;

  async function pickPhoto() {
    // The picker is awaited *before* `photoUploading` flips, so the control stays
    // pressable for as long as the picker takes to appear. Guard re-entry here
    // rather than relying on the disabled state to sequence taps.
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
   * Common reset after either a real send or an offline save (CRIS-26): both
   * are "done" from the citizen's side, so they share every reset step —
   * only the confirmation copy (driven by `outcome`) differs.
   */
  function finishSubmission(outcome: 'submitted' | 'queued') {
    setOutcome(outcome);
    // Tell the user their photo didn't make it, rather than letting an
    // unqualified confirmation imply it did.
    setPhotoDropped(photo !== null && mediaKey === null);
    setDraft(createEmptyReportDraft());
    // Retire any upload still in flight along with the report it belonged to:
    // its key is scoped to the `clientRequestId` we are about to replace, so
    // letting it land would attach this report's photo to the next one.
    uploadSeq.current++;
    setPhoto(null);
    setMediaKey(null);
    setPhotoError(null);
    setPhotoUploading(false);
    setClientRequestId(newClientRequestId());
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const submission = toReportSubmission(draft, mediaKey ? [mediaKey] : []);

    try {
      // Known-offline: skip the network call entirely rather than waiting on
      // a call that can only time out (CRIS-26).
      if (!isOnline) {
        await enqueue(submission, clientRequestId);
        finishSubmission('queued');
        return;
      }
      await submitReport(submission, clientRequestId);
      finishSubmission('submitted');
    } catch (e) {
      if (e instanceof ReportSubmitError && !e.retryable) {
        // The server actively rejected this — retrying an identical payload
        // would too, so this stays a same-session error the citizen can see
        // and act on, not something silently queued.
        setError(e.message || 'Something went wrong. Please try again.');
      } else {
        // Either a transport failure (offline, DNS, timeout) or an unexpected
        // error of unknown shape — safe to assume retryable and queue it
        // rather than lose the report (CRIS-26 §5.4.4 idempotency).
        await enqueue(submission, clientRequestId);
        finishSubmission('queued');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (outcome) {
    return (
      <>
        <OfflineQueueBanner />
        <View style={styles.successBox}>
          <View style={styles.successBadge}>
            <Text style={styles.successCheck}>✓</Text>
          </View>
          <Text style={styles.successTitle}>
            {outcome === 'queued' ? 'Report Saved' : 'Report Submitted'}
          </Text>
          <Text style={styles.successBody}>
            {outcome === 'queued'
              ? "Your report has been saved on this device and will send automatically once you're back online."
              : 'Thank you for your report. Emergency coordinators will review it shortly.'}
          </Text>
          {photoDropped && (
            <Text style={styles.successCaveat}>
              Your photo could not be uploaded, so the report was sent without it.
            </Text>
          )}
          <Pressable onPress={() => setOutcome(null)} hitSlop={8}>
            <Text style={styles.successAgain}>Submit another report</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <View style={styles.form}>
      <OfflineQueueBanner />
      {/* Description */}
      <View style={styles.field}>
        <Text style={styles.label}>
          Description <Text style={styles.required}>*</Text>
        </Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Provide clear details about what's happening and what's needed."
          placeholderTextColor={colors.textMuted}
          value={draft.text}
          onChangeText={(text) => setDraft((d) => ({ ...d, text }))}
          multiline
          maxLength={REPORT_TEXT_MAX_LENGTH}
          textAlignVertical="top"
        />
        <Text style={styles.counter}>
          {draft.text.length}/{REPORT_TEXT_MAX_LENGTH} characters
        </Text>
      </View>

      {/* Category */}
      <View style={styles.field}>
        <Text style={styles.label}>
          Category <Text style={styles.required}>*</Text>
        </Text>
        <View style={styles.chipGrid}>
          {CATEGORY_OPTIONS.map((c) => {
            const selected = draft.category === c;
            return (
              <Pressable
                key={c}
                onPress={() => setDraft((d) => ({ ...d, category: selected ? '' : c }))}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {categoryLabel(c)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Subcategory */}
      <View style={styles.field}>
        <Text style={styles.label}>Supply Type (Subcategory)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Water, Food, Medical"
          placeholderTextColor={colors.textMuted}
          value={draft.subcategory}
          onChangeText={(subcategory) => setDraft((d) => ({ ...d, subcategory }))}
        />
      </View>

      {/* Location */}
      <View style={styles.field}>
        <Text style={styles.label}>Location (Optional)</Text>
        <LocationPicker
          value={draft.location}
          onChange={(location) => setDraft((d) => ({ ...d, location }))}
          onInteractionStart={onMapInteractionStart}
          onInteractionEnd={onMapInteractionEnd}
        />
      </View>

      {/* Location hint */}
      <View style={styles.field}>
        <Text style={styles.label}>Location Hint (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., near the blue bridge, 2nd floor"
          placeholderTextColor={colors.textMuted}
          value={draft.locationHint}
          onChangeText={(locationHint) => setDraft((d) => ({ ...d, locationHint }))}
          maxLength={LOCATION_HINT_MAX_LENGTH}
        />
      </View>

      {/* Photo */}
      <View style={styles.field}>
        <Text style={styles.label}>Add Photo (Optional)</Text>
        <Pressable
          onPress={pickPhoto}
          // Not `disabled`: that drops the control out of the accessibility tree
          // mid-interaction (ADR-0037's reasoning applies equally to RN). The
          // busy/disabled state is reported instead, and `pickPhoto` guards
          // re-entry itself.
          accessibilityState={{ disabled: photoBusy, busy: photoUploading }}
          accessibilityLabel={photoLabel}
          style={[
            styles.photoBox,
            photoBusy && styles.photoBoxBusy,
            mediaKey != null && styles.photoBoxFilled,
            photoError != null && styles.photoBoxError,
          ]}
          accessibilityRole="button"
        >
          {photoUploading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.photoIcon}>📷</Text>
          )}
          {photo ? (
            <>
              <Text
                style={[styles.photoName, mediaKey != null && styles.photoNameUploaded]}
                numberOfLines={1}
              >
                {photo.fileName ?? 'Photo attached'}
              </Text>
              <Text style={[styles.photoHint, photoError != null && styles.photoHintError]}>
                {photoUploading ? 'Uploading…' : (photoError ?? 'Tap to change photo')}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.photoPrompt}>Tap to add a photo</Text>
              <Text style={styles.photoHint}>Images help responders understand the situation</Text>
            </>
          )}
        </Pressable>
        {/* Always mounted, never conditionally rendered: a live region that
            appears at the same moment as its text is frequently missed. Carries
            the upload outcome, which `accessibilityLabel` hides from the box. */}
        <Text
          accessibilityLiveRegion="polite"
          style={styles.srOnly}
          importantForAccessibility={photoStatus ? 'yes' : 'no-hide-descendants'}
        >
          {photoStatus}
        </Text>
      </View>

      {/* Urgency */}
      <View style={styles.field}>
        <Text style={styles.label}>
          Urgency <Text style={styles.required}>*</Text>
        </Text>
        <View style={styles.chipGrid}>
          {URGENCY_OPTIONS.map((u) => {
            const selected = draft.urgency === u;
            return (
              <Pressable
                key={u}
                onPress={() => setDraft((d) => ({ ...d, urgency: u }))}
                style={[styles.urgencyButton, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{u}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Anonymous */}
      <View style={styles.anonymousRow}>
        <View style={styles.anonymousCopy}>
          <Text style={styles.label}>Anonymous Report</Text>
          <Text style={styles.hint}>Hide my identity from other users and responders</Text>
        </View>
        <Switch
          value={draft.anonymous}
          onValueChange={(anonymous) => setDraft((d) => ({ ...d, anonymous }))}
          trackColor={{ true: colors.primary }}
        />
      </View>

      {/* Contact (hidden when anonymous) */}
      {!draft.anonymous && (
        <View style={styles.field}>
          <Text style={styles.label}>Contact Info (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="Phone or email"
            placeholderTextColor={colors.textMuted}
            value={draft.contact}
            onChangeText={(contact) => setDraft((d) => ({ ...d, contact }))}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Submit */}
      <Pressable
        onPress={handleSubmit}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.submit,
          pressed && styles.submitPressed,
          !canSubmit && styles.submitDisabled,
        ]}
        accessibilityRole="button"
      >
        {submitting ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Text style={styles.submitText}>Submit Report</Text>
        )}
      </Pressable>

      <Text style={styles.footer}>All reports are secure and encrypted</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 20,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  required: {
    color: colors.required,
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  textArea: {
    minHeight: 110,
    paddingTop: 12,
  },
  counter: {
    alignSelf: 'flex-end',
    fontSize: 12,
    color: colors.textMuted,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  urgencyButton: {
    flexGrow: 1,
    flexBasis: '45%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: colors.onPrimary,
  },
  photoBox: {
    alignItems: 'center',
    gap: 2,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.inputBorder,
    borderRadius: radii.lg,
    padding: 20,
  },
  photoBoxBusy: {
    opacity: 0.7,
  },
  photoBoxFilled: {
    borderColor: colors.successAccent,
    backgroundColor: colors.successBg,
  },
  photoBoxError: {
    borderColor: colors.errorBorder,
    backgroundColor: colors.errorBg,
  },
  photoIcon: {
    fontSize: 28,
  },
  photoPrompt: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  photoName: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    maxWidth: '90%',
  },
  photoNameUploaded: {
    color: colors.successAccent,
  },
  photoHint: {
    fontSize: 12,
    color: colors.textMuted,
  },
  photoHintError: {
    color: colors.errorText,
  },
  anonymousRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.background,
    padding: 12,
  },
  anonymousCopy: {
    flex: 1,
    gap: 2,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.errorBorder,
    borderRadius: radii.lg,
    backgroundColor: colors.errorBg,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    color: colors.errorText,
  },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.primary,
    paddingVertical: 14,
  },
  submitPressed: {
    backgroundColor: colors.primaryPressed,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
  },
  successBox: {
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.successBorder,
    borderRadius: radii.lg,
    backgroundColor: colors.successBg,
    padding: 24,
  },
  successBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.successBorder,
    marginBottom: 8,
  },
  successCheck: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.successAccent,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.successText,
  },
  successBody: {
    textAlign: 'center',
    fontSize: 14,
    color: colors.successText,
  },
  successCaveat: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: colors.successText,
  },
  /**
   * Visually hidden but still in the accessibility tree — the RN counterpart of
   * web's `sr-only`. `display: 'none'` or zero opacity would take it out of the
   * tree entirely and silence the live region.
   */
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  successAgain: {
    marginTop: 8,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
