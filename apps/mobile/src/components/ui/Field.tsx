import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { colors, space, type } from '../../theme';

/**
 * Form field furniture (CRIS-57) — labels, required markers, and hints.
 * Mirror of `apps/web/src/components/ui/label.tsx`.
 */

/**
 * Required-field marker.
 *
 * The asterisk is decoration — a screen reader either skips it or announces
 * "star", neither of which conveys "required" — so it is hidden from the
 * accessibility tree and paired with visually-hidden text that says the word.
 * React Native's equivalent of `aria-hidden` is `accessibilityElementsHidden` +
 * `importantForAccessibility`, one per platform.
 */
export function RequiredMark() {
  return (
    <>
      <Text
        style={styles.required}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {' *'}
      </Text>
      <Text style={styles.srOnlyInline}> (required)</Text>
    </>
  );
}

export function FieldLabel({
  children,
  required = false,
  nativeID,
}: {
  children: React.ReactNode;
  required?: boolean;
  /** Point a control's `accessibilityLabelledBy` at this. */
  nativeID?: string;
}) {
  return (
    <Text nativeID={nativeID} style={styles.label}>
      {children}
      {required ? <RequiredMark /> : null}
    </Text>
  );
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <Text style={styles.hint}>{children}</Text>;
}

/** A labelled field with consistent vertical rhythm. */
export function Field({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.field, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  field: {
    gap: space.sm,
  },
  label: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    color: colors.fg,
  },
  required: {
    color: colors.danger,
  },
  hint: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: colors.fgMuted,
  },
  /**
   * Inline variant of `srOnly`: sits inside a `<Text>` run, where `position:
   * absolute` would break the line box. Zero font size keeps it invisible while
   * leaving the string in the accessibility tree.
   */
  srOnlyInline: {
    fontSize: 0,
    lineHeight: 0,
    color: 'transparent',
  },
});
