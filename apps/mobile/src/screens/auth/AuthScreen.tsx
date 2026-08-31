import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Card } from '../../components/ui/Card';
import { Screen, ScreenHeader } from '../../components/Screen';
import { colors, space, type } from '../../theme';

/**
 * Shared frame for the sign-in, sign-up, and confirmation screens (CRIS-57).
 * Mirror of the web's `AuthLayout`.
 *
 * One layout for all three so the account flow does not visibly change shape
 * between steps — each screen previously rebuilt the same card with slightly
 * different spacing, which made three steps feel like three products.
 *
 * The escape hatch back to reporting is deliberate and prominent: someone who
 * lands here during an actual emergency must not conclude that reporting
 * requires an account. It does not (ADR-0024).
 */
export function AuthScreen({
  title,
  description,
  onBack,
  onSkipToReport,
  children,
  footer,
}: {
  title: string;
  description: string;
  onBack?: () => void;
  /** Navigates straight to the report form, bypassing the account flow. */
  onSkipToReport: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Screen>
      <ScreenHeader onBack={onBack} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Card style={styles.card}>
            <View style={styles.titleBlock}>
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
              <Text style={styles.description}>{description}</Text>
            </View>
            {children}
          </Card>

          {footer ? <View style={styles.footer}>{footer}</View> : null}

          <Pressable onPress={onSkipToReport} hitSlop={8} accessibilityRole="button">
            <Text style={styles.skip}>
              Reporting an emergency?{' '}
              <Text style={styles.skipAccent}>Go straight to the report form</Text> — no account
              required.
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** A tappable line of text under the card ("Already have an account? Sign in"). */
export function AuthFooterLink({
  prompt,
  action,
  onPress,
}: {
  prompt: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      <Text style={styles.footerText}>
        {prompt} <Text style={styles.footerAction}>{action}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: space.xl,
    paddingHorizontal: space.xl,
    paddingVertical: space['3xl'],
  },
  card: {
    gap: space.xl,
  },
  titleBlock: {
    gap: space.sm,
  },
  title: {
    fontSize: type.title.fontSize,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.fontWeight,
    letterSpacing: -0.4,
    color: colors.fg,
  },
  description: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    color: colors.fgMuted,
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    fontSize: type.small.fontSize,
    color: colors.fgMuted,
  },
  footerAction: {
    fontWeight: '600',
    color: colors.accent,
  },
  skip: {
    textAlign: 'center',
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    color: colors.fgSubtle,
  },
  skipAccent: {
    fontWeight: '600',
    color: colors.accent,
  },
});
