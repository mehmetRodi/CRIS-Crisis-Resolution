import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';

import { MIN_TOUCH_TARGET, colors, radii, space, type } from '../../theme';

/**
 * Text input (CRIS-57). Mirror of `apps/web/src/components/ui/input.tsx`.
 *
 * React Native has no `:focus` selector, so the focus ring is state-driven.
 * It matters more here than on web: without a visible focus treatment there is
 * no indication which field a hardware keyboard or switch-control user is on.
 */
export interface InputProps extends TextInputProps {
  /** Renders the error treatment. Pair it with a message the field describes. */
  invalid?: boolean;
  multilineRows?: number;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid = false, multilineRows, style, onFocus, onBlur, multiline, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      ref={ref}
      multiline={multiline}
      placeholderTextColor={colors.fgSubtle}
      // Without this the caret and selection stay the platform blue, which on
      // this palette reads as the `info` colour rather than the accent.
      selectionColor={colors.accent}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        styles.base,
        multiline && styles.multiline,
        multilineRows ? { minHeight: multilineRows * 22 + space['2xl'] } : null,
        focused && styles.focused,
        invalid && styles.invalid,
        style,
      ]}
      {...props}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontSize: type.body.fontSize,
    color: colors.fg,
  },
  multiline: {
    // iOS centres multiline text vertically without this.
    textAlignVertical: 'top',
    paddingTop: space.lg,
  },
  focused: {
    borderColor: colors.ring,
    // A second inset ring, so focus is visible even against a tinted field.
    borderWidth: 2,
    paddingHorizontal: space.lg - 1,
  },
  invalid: {
    borderColor: colors.danger,
  },
});
