import { useState } from 'react';
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
  REPORT_TEXT_MAX_LENGTH,
  Urgency,
  createEmptyReportDraft,
  isReportDraftSubmittable,
  toReportSubmission,
} from '@crisismap/shared';

import { colors, radii } from '../theme';
import { newClientRequestId, submitReport } from '../lib/submit-report';

const CATEGORY_OPTIONS = Object.values(Category);
const URGENCY_OPTIONS = Object.values(Urgency);

function categoryLabel(category: string): string {
  return category.replace(/_/g, ' ');
}

export function ReportForm() {
  const [draft, setDraft] = useState(createEmptyReportDraft());
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Idempotency token (§5.4.4): stable across retries of the same report so a
  // flaky network can't create duplicates; re-minted only after success.
  const [clientRequestId, setClientRequestId] = useState(newClientRequestId);

  const canSubmit = isReportDraftSubmittable(draft) && !submitting;

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0] ?? null);
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      // TODO(CRIS-17): upload the photo via presigned S3 and pass mediaKeys.
      await submitReport(toReportSubmission(draft), clientRequestId);
      setSubmitted(true);
      setDraft(createEmptyReportDraft());
      setPhoto(null);
      setClientRequestId(newClientRequestId());
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : null;
      setError(message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <View style={styles.successBox}>
        <View style={styles.successBadge}>
          <Text style={styles.successCheck}>✓</Text>
        </View>
        <Text style={styles.successTitle}>Report Submitted</Text>
        <Text style={styles.successBody}>
          Thank you for your report. Emergency coordinators will review it shortly.
        </Text>
        <Pressable onPress={() => setSubmitted(false)} hitSlop={8}>
          <Text style={styles.successAgain}>Submit another report</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.form}>
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

      {/* Photo */}
      <View style={styles.field}>
        <Text style={styles.label}>Add Photo (Optional)</Text>
        <Pressable
          onPress={pickPhoto}
          style={[styles.photoBox, photo != null && styles.photoBoxFilled]}
          accessibilityRole="button"
        >
          <Text style={styles.photoIcon}>📷</Text>
          {photo ? (
            <>
              <Text style={styles.photoName} numberOfLines={1}>
                {photo.fileName ?? 'Photo attached'}
              </Text>
              <Text style={styles.photoHint}>Tap to change photo</Text>
            </>
          ) : (
            <>
              <Text style={styles.photoPrompt}>Tap to add a photo</Text>
              <Text style={styles.photoHint}>Images help responders understand the situation</Text>
            </>
          )}
        </Pressable>
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
  photoBoxFilled: {
    borderColor: colors.successAccent,
    backgroundColor: colors.successBg,
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
    color: colors.successAccent,
    maxWidth: '90%',
  },
  photoHint: {
    fontSize: 12,
    color: colors.textMuted,
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
  successAgain: {
    marginTop: 8,
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});
