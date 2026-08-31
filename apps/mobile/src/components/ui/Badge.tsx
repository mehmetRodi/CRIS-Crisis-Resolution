import { StyleSheet, Text, View } from 'react-native';

import { radii, space, type } from '../../theme';
import { toneStyle, type Tone } from '../../lib/domain-display';

/**
 * Compact status chip (CRIS-57). Mirror of `apps/web/src/components/ui/badge.tsx`.
 *
 * Tinted fill with dark text rather than white-on-saturated: at badge size a
 * saturated fill competes with the severity signals around it, and a column of
 * them becomes unreadable. Severity has to come from hue, not from shouting.
 */
export function Badge({
  label,
  tone = 'neutral',
  accessibilityLabel,
}: {
  label: string;
  tone?: Tone;
  /** Overrides the announced text when the visible label is an abbreviation. */
  accessibilityLabel?: string;
}) {
  const palette = toneStyle(tone);
  return (
    <View
      style={[styles.base, { backgroundColor: palette.background, borderColor: palette.border }]}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.label, { color: palette.foreground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  label: {
    fontSize: type.caption.fontSize,
    fontWeight: '600',
  },
});
