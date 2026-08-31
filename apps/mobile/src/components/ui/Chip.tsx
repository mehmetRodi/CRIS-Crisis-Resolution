import { Pressable, StyleSheet, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { MIN_TOUCH_TARGET, colors, radii, space, type } from '../../theme';

/**
 * A selectable option chip (CRIS-57) — category and urgency pickers.
 *
 * `accessibilityRole="button"` with `state.selected` rather than a radio role:
 * these groups allow deselection (tapping the chosen category clears it), which
 * is not radio-group behaviour, and announcing them as radios would promise a
 * mutual exclusivity the control does not have.
 */
export function Chip({
  label,
  selected,
  onPress,
  icon: Icon,
  grow = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: LucideIcon;
  /** Share the row evenly — used by the four urgency options. */
  grow?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.base,
        grow && styles.grow,
        selected ? styles.selected : styles.idle,
        pressed && !selected && styles.pressed,
      ]}
    >
      {Icon ? <Icon size={16} color={selected ? colors.fgOnSolid : colors.fgMuted} /> : null}
      <Text style={[styles.label, selected ? styles.labelSelected : styles.labelIdle]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  grow: {
    flexGrow: 1,
    flexBasis: '45%',
  },
  idle: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfaceHover,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  label: {
    fontSize: type.small.fontSize,
    fontWeight: '600',
  },
  labelIdle: {
    color: colors.fg,
  },
  labelSelected: {
    color: colors.fgOnSolid,
  },
});
