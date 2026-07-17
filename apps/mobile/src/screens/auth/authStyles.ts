import { StyleSheet } from 'react-native';

import { colors, radii } from '../../theme';

/** Shared styling for LoginScreen/SignupScreen/ConfirmSignupScreen — the three
 * auth screens are visually identical card forms, only the fields differ. */
export const authStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    gap: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    padding: 24,
  },
  back: {
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
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
  link: {
    textAlign: 'center',
    fontSize: 14,
    color: colors.primary,
  },
});
