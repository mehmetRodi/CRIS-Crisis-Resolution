import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { radii, space, type } from '../../theme';
import { toneStyle, type Tone } from '../../lib/domain-display';

/**
 * An inline message block — errors, warnings, and confirmations (CRIS-57).
 *
 * `liveRegion` announces the message when it appears. `assertive` interrupts
 * whatever is being read (errors); `polite` waits for a pause (everything else).
 * A block that carries no message must not be rendered as an empty live region;
 * callers that need a persistently-mounted region use `srOnly` instead
 * (ADR-0037).
 */
export function Callout({
  tone,
  message,
  icon: Icon,
  assertive = false,
}: {
  tone: Tone;
  message: string;
  icon?: LucideIcon;
  assertive?: boolean;
}) {
  const palette = toneStyle(tone);
  return (
    <View
      accessibilityLiveRegion={assertive ? 'assertive' : 'polite'}
      accessibilityRole={assertive ? 'alert' : undefined}
      style={[styles.base, { backgroundColor: palette.background, borderColor: palette.border }]}
    >
      {Icon ? <Icon size={18} color={palette.foreground} style={styles.icon} /> : null}
      <Text style={[styles.message, { color: palette.foreground }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  icon: {
    marginTop: 1,
  },
  message: {
    flex: 1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
});
