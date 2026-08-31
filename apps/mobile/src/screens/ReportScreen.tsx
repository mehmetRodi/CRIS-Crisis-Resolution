import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LogIn, LogOut, Phone } from 'lucide-react-native';

import { ReportForm } from '../components/ReportForm';
import { Screen, ScreenHeader, ScreenTitle } from '../components/Screen';
import { Button } from '../components/ui/Button';
import { useAuth } from '../lib/AuthContext';
import { colors, space, type } from '../theme';
import type { RootStackParamList } from '../navigation/RootNavigator';

/**
 * The citizen report screen (CRIS-6, rebuilt in CRIS-57) — the app's home route.
 * Mirror of the web's `/report`.
 *
 * Auth is optional (CRIS-7, ADR-0024): sign-in is reachable from the header but
 * nothing here is gated behind it, and the header carries nothing else. A
 * person opening this app is doing one thing, once, under stress.
 *
 * The "call emergency services" notice sits ABOVE the form rather than in a
 * footer. It is the single most important sentence on the screen, and a footer
 * under a long form is read by nobody.
 */
export function ReportScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { email, isAuthenticated, signOut } = useAuth();
  // The location map (CRIS-16) has its own pan/zoom gestures that otherwise
  // fight this ScrollView for the same touch. Disabling scroll for the duration
  // of any touch that starts inside the map gives the map exclusive control of
  // that gesture; scrolling resumes the instant the touch ends.
  const [scrollEnabled, setScrollEnabled] = useState(true);

  return (
    <Screen>
      <ScreenHeader
        trailing={
          isAuthenticated ? (
            <Button
              label="Sign out"
              onPress={() => void signOut()}
              variant="ghost"
              icon={LogOut}
              accessibilityLabel={`Sign out of ${email ?? 'your account'}`}
            />
          ) : (
            <Button
              label="Sign in"
              onPress={() => navigation.navigate('Login')}
              variant="ghost"
              icon={LogIn}
            />
          )
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          scrollEnabled={scrollEnabled}
        >
          <ScreenTitle
            title="Report an emergency"
            description="Describe what is happening. It goes straight to emergency coordinators — no account needed, and you can stay anonymous."
          />

          <View style={styles.urgentNotice}>
            <Phone size={18} color={colors.danger} style={styles.urgentIcon} />
            <Text style={styles.urgentText}>
              If anyone is in immediate danger, call your local emergency number first, then file
              this report.
            </Text>
          </View>

          <ReportForm
            onMapInteractionStart={() => setScrollEnabled(false)}
            onMapInteractionEnd={() => setScrollEnabled(true)}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: space['3xl'],
    paddingHorizontal: space.xl,
    paddingTop: space['3xl'],
    paddingBottom: space['5xl'],
  },
  urgentNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSubtle,
    borderRadius: 8,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
  },
  urgentIcon: {
    marginTop: 1,
  },
  urgentText: {
    flex: 1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: '600',
    color: colors.fg,
  },
});
