import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportForm } from '../components/ReportForm';
import { colors, radii } from '../theme';

/**
 * Citizen emergency-report screen (CRIS-6). The mobile app's single surface
 * today; navigation (auth, report history) arrives with CRIS-7.
 */
export function ReportScreen() {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.kickerRow}>
            <View style={styles.kickerBar} />
            <Text style={styles.kicker}>Emergency Reporting</Text>
          </View>
          <Text style={styles.title}>CrisisMap AI</Text>
          <Text style={styles.subtitle}>
            Submit an emergency report to help responders act quickly
          </Text>
        </View>

        {/* Form card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Submit Report</Text>
            <Text style={styles.cardSubtitle}>
              Fill in the details below. All information is secure and encrypted.
            </Text>
          </View>
          <ReportForm />
        </View>

        <Text style={styles.footer}>
          In case of immediate danger, call emergency services first.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 16,
    gap: 24,
  },
  header: {
    gap: 6,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kickerBar: {
    width: 4,
    height: 24,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  kicker: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  card: {
    gap: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    padding: 20,
  },
  cardHeader: {
    gap: 4,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  footer: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textMuted,
  },
});
