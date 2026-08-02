import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ReportForm } from '../components/ReportForm';
import { useAuth } from '../lib/AuthContext';
import { colors, radii } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * Citizen emergency-report screen (CRIS-6). The mobile app's home route.
 * Auth is optional (CRIS-7, ADR-0024): a Sign In link is available but
 * nothing here is gated behind it — citizens submit as guests by default.
 */
export function ReportScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { email, isAuthenticated, signOut } = useAuth();
  // The location map (CRIS-16) has its own pan/zoom gestures that otherwise
  // fight this ScrollView for the same touch. Disabling scroll for the
  // duration of any touch that starts inside the map gives the map exclusive
  // control of that gesture; scrolling resumes the instant the touch ends.
  const [scrollEnabled, setScrollEnabled] = useState(true);

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
        scrollEnabled={scrollEnabled}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.kickerRow}>
              <View style={styles.kickerBar} />
              <Text style={styles.kicker}>Emergency Reporting</Text>
            </View>
            {isAuthenticated ? (
              <Pressable onPress={signOut} hitSlop={8}>
                <Text style={styles.authLink}>Sign Out</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
                <Text style={styles.authLink}>Sign In</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.title}>CrisisMap AI</Text>
          {isAuthenticated && email ? (
            <Text style={styles.signedInAs}>Signed in as {email}</Text>
          ) : null}
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
          <ReportForm
            onMapInteractionStart={() => setScrollEnabled(false)}
            onMapInteractionEnd={() => setScrollEnabled(true)}
          />
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
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authLink: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  signedInAs: {
    fontSize: 13,
    color: colors.textSecondary,
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
