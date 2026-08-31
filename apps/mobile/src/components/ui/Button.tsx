import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { MIN_TOUCH_TARGET, colors, radii, space, type } from '../../theme';

/**
 * The app's button (CRIS-57, ADR-0057). Mirror of `apps/web/src/components/ui/button.tsx`.
 *
 * ── `blocked` is not `disabled` ────────────────────────────────────────────
 * A React Native `Pressable` with `disabled` is removed from the accessibility
 * tree, so a screen reader cannot reach it to hear WHY it is unavailable, and
 * a sighted user gets no feedback at all from tapping it. ADR-0037 settled this
 * on web (`aria-disabled` over `disabled`); the same reasoning applies here.
 *
 * So `blocked` styles the control as unavailable while leaving it pressable and
 * announced, and the caller answers the press with something useful — normally
 * surfacing the reason and moving focus to the field at fault. Use `disabled`
 * only for a control that is genuinely inert and has nothing to explain.
 */
export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'md' | 'lg' | 'xl';
  /** Renders as unavailable but stays pressable and announced. See above. */
  blocked?: boolean;
  /** Genuinely inert. Removes the control from the accessibility tree. */
  disabled?: boolean;
  loading?: boolean;
  icon?: LucideIcon;
  /** Announced instead of `label` when the visible text cannot carry the state. */
  accessibilityLabel?: string;
  /** Announced after the name — the reason a blocked control is unavailable. */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  blocked = false,
  disabled = false,
  loading = false,
  icon: Icon,
  accessibilityLabel,
  accessibilityHint,
  style,
}: ButtonProps) {
  const unavailable = blocked || disabled || loading;
  const palette = VARIANTS[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      // Reported rather than enforced: the control stays reachable so the hint
      // above can actually be heard.
      accessibilityState={{ disabled: unavailable, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        SIZES[size],
        { backgroundColor: palette.background, borderColor: palette.border },
        pressed && !unavailable && { backgroundColor: palette.pressed },
        unavailable && styles.unavailable,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.foreground} size="small" />
      ) : Icon ? (
        <Icon size={18} color={palette.foreground} />
      ) : null}
      <Text style={[styles.label, TEXT_SIZES[size], { color: palette.foreground }]}>{label}</Text>
      {/* Balances the leading icon so the label stays optically centred. */}
      {Icon && !loading ? <View style={styles.iconBalance} /> : null}
    </Pressable>
  );
}

const VARIANTS = {
  primary: {
    background: colors.accent,
    pressed: colors.accentPressed,
    border: colors.accent,
    foreground: colors.fgOnSolid,
  },
  secondary: {
    background: colors.surface,
    pressed: colors.surfaceHover,
    border: colors.border,
    foreground: colors.fg,
  },
  ghost: {
    background: 'transparent',
    pressed: colors.surfaceHover,
    border: 'transparent',
    foreground: colors.fgMuted,
  },
  destructive: {
    background: colors.danger,
    pressed: colors.danger,
    border: colors.danger,
    foreground: colors.fgOnSolid,
  },
} as const;

const SIZES = StyleSheet.create({
  md: { minHeight: MIN_TOUCH_TARGET, paddingHorizontal: space.lg },
  lg: { minHeight: 48, paddingHorizontal: space.xl },
  // The citizen path's primary action: full width, generous target, operated
  // one-handed under stress.
  xl: { minHeight: 54, paddingHorizontal: space['3xl'], alignSelf: 'stretch' },
});

const TEXT_SIZES = StyleSheet.create({
  md: { fontSize: type.small.fontSize },
  lg: { fontSize: type.body.fontSize },
  xl: { fontSize: 17 },
});

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  label: {
    fontWeight: '600',
  },
  unavailable: {
    opacity: 0.5,
  },
  iconBalance: {
    width: 18,
    // Only balances the icon's own width; the row gap handles the rest.
    marginLeft: -space.md,
  },
});
