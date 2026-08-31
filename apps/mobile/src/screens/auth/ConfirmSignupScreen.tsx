import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { TriangleAlert } from 'lucide-react-native';

import { useAuth } from '../../lib/AuthContext';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Field, FieldLabel } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { AuthFooterLink, AuthScreen } from './AuthScreen';
import { colors, numeric, space, type } from '../../theme';
import type { RootStackParamList } from '../../navigation/RootNavigator';

/** Mobile twin of `apps/web/src/ConfirmSignupPage.tsx` (CRIS-7, ADR-0024). */
export function ConfirmSignupScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { email } = useRoute<RouteProp<RootStackParamList, 'ConfirmSignup'>>().params;
  const { confirmSignUp, resendSignUpCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      navigation.navigate('Login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError('');
    setNotice('');
    setResending(true);
    try {
      await resendSignUpCode(email);
      // Confirm the resend explicitly. Without it the only feedback is the
      // label briefly changing, and users re-tap it repeatedly.
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend the code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthScreen
      title="Verify your email"
      description={`We sent a six-digit code to ${email}.`}
      onBack={() => navigation.goBack()}
      onSkipToReport={() => navigation.navigate('Report')}
      footer={
        <AuthFooterLink
          prompt="Finished verifying?"
          action="Back to sign in"
          onPress={() => navigation.navigate('Login')}
        />
      }
    >
      <Field>
        <FieldLabel>Verification code</FieldLabel>
        <Input
          value={code}
          onChangeText={setCode}
          placeholder="000000"
          keyboardType="number-pad"
          // Lets the OS offer the emailed code from the notification shade.
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          accessibilityLabel="Six digit verification code"
          style={styles.codeInput}
        />
      </Field>

      {error ? <Callout tone="danger" message={error} icon={TriangleAlert} assertive /> : null}
      {notice ? <Callout tone="success" message={notice} /> : null}

      <Button
        label={loading ? 'Verifying…' : 'Verify email'}
        onPress={handleSubmit}
        variant="primary"
        size="lg"
        loading={loading}
        blocked={loading}
      />

      <Pressable onPress={handleResend} hitSlop={8} accessibilityRole="button">
        <Text style={styles.resend}>
          Didn&apos;t get a code?{' '}
          <Text style={styles.resendAction}>{resending ? 'Sending…' : 'Resend it'}</Text>
        </Text>
      </Pressable>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  codeInput: {
    textAlign: 'center',
    fontSize: 22,
    letterSpacing: 8,
    ...numeric,
  },
  resend: {
    textAlign: 'center',
    fontSize: type.small.fontSize,
    color: colors.fgMuted,
    paddingVertical: space.sm,
  },
  resendAction: {
    fontWeight: '600',
    color: colors.accent,
  },
});
