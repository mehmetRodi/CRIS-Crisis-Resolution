import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { StyleProp, ViewStyle } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { MIN_TOUCH_TARGET, colors, space, type } from '../theme';
import { Logo } from './brand/Logo';
import { Button } from './ui/Button';

/**
 * The citizen shell (CRIS-57, ADR-0055/0057). Mirror of the web's
 * `CitizenShell`.
 *
 * Deliberately minimal: a single back affordance, the wordmark, and one
 * optional trailing action. No navigation, no role chip, no connection
 * indicator. Somebody filing a report is doing one thing, once, often
 * one-handed and under stress, and every extra control is a place to get lost
 * on the way to the only action that matters.
 */
export function ScreenHeader({
  onBack,
  backLabel = 'Back',
  trailing,
}: {
  onBack?: () => void;
  backLabel?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>
        {onBack ? (
          <Button
            label={backLabel}
            onPress={onBack}
            variant="ghost"
            icon={ArrowLeft}
            style={styles.backButton}
          />
        ) : null}
      </View>
      <Logo />
      {/* Mirrors the leading slot's width so the lockup stays optically
          centred whether or not there is a trailing action. */}
      <View style={[styles.headerSide, styles.headerTrailing]}>{trailing}</View>
    </View>
  );
}

export function Screen({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={['top', 'bottom']}>
      {children}
    </SafeAreaView>
  );
}

/** A page title and its supporting sentence, with consistent rhythm. */
export function ScreenTitle({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.titleBlock}>
      {/* `header` role gives screen-reader users a landmark to jump to; without
          it a React Native screen is an undifferentiated run of text. */}
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET + space.md,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerSide: {
    minWidth: 84,
  },
  headerTrailing: {
    alignItems: 'flex-end',
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
  },
  titleBlock: {
    gap: space.md,
  },
  title: {
    fontSize: type.title.fontSize,
    lineHeight: type.title.lineHeight,
    fontWeight: type.title.fontWeight,
    letterSpacing: -0.4,
    color: colors.fg,
  },
  description: {
    fontSize: type.body.fontSize,
    lineHeight: type.body.lineHeight,
    color: colors.fgMuted,
  },
});
