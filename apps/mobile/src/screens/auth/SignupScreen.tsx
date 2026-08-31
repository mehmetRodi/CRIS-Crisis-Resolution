import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PASSWORD_RULE_HINT, isPasswordValid } from '@crisismap/shared';
import { TriangleAlert } from 'lucide-react-native';

import { useAuth } from '../../lib/AuthContext';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Field, FieldHint, FieldLabel } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { AuthFooterLink, AuthScreen } from './AuthScreen';
import { space } from '../../theme';
import type { RootStackParamList } from '../../navigation/RootNavigator';

/** Mobile twin of `apps/web/src/SignupPage.tsx` (CRIS-7, ADR-0024). */
export function SignupScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!isPasswordValid(password)) {
      setError(PASSWORD_RULE_HINT);
      return;
    }

    setLoading(true);
    try {
      await signUp(email, password);
      navigation.navigate('ConfirmSignup', { email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen
      title="Create an account"
      description="An account lets you track your own reports. It is never required to submit one."
      onBack={() => navigation.goBack()}
      onSkipToReport={() => navigation.navigate('Report')}
      footer={
        <AuthFooterLink
          prompt="Already have an account?"
          action="Sign in"
          onPress={() => navigation.navigate('Login')}
        />
      }
    >
      <View style={styles.fields}>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.org"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            accessibilityLabel="Email"
          />
        </Field>

        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            // The rule is announced WITH the field, so the constraint is known
            // before a failed submit rather than after it.
            accessibilityLabel="Password"
            accessibilityHint={PASSWORD_RULE_HINT}
          />
          <FieldHint>{PASSWORD_RULE_HINT}</FieldHint>
        </Field>

        <Field>
          <FieldLabel>Confirm password</FieldLabel>
          <Input
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            accessibilityLabel="Confirm password"
          />
        </Field>
      </View>

      {error ? <Callout tone="danger" message={error} icon={TriangleAlert} assertive /> : null}

      <Button
        label={loading ? 'Creating account…' : 'Create account'}
        onPress={handleSubmit}
        variant="primary"
        size="lg"
        loading={loading}
        blocked={loading}
      />
    </AuthScreen>
  );
}

const styles = { fields: { gap: space.xl } } as const;
