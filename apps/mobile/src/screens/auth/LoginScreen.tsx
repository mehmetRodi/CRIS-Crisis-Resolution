import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TriangleAlert } from 'lucide-react-native';

import { useAuth } from '../../lib/AuthContext';
import { Button } from '../../components/ui/Button';
import { Callout } from '../../components/ui/Callout';
import { Field, FieldLabel } from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';
import { AuthFooterLink, AuthScreen } from './AuthScreen';
import { space } from '../../theme';
import type { RootStackParamList } from '../../navigation/RootNavigator';

/** Mobile twin of `apps/web/src/LoginPage.tsx` (CRIS-7, ADR-0024). */
export function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const result = await signIn(email, password);
      if (result.isSignedIn) {
        navigation.navigate('Report');
      } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
        // The account exists but was never verified. Take them to confirmation
        // rather than reporting a credentials failure they cannot act on.
        navigation.navigate('ConfirmSignup', { email });
      } else {
        setError('Additional verification is required to finish signing in.');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'UserNotConfirmedException') {
        navigation.navigate('ConfirmSignup', { email });
      } else {
        setError('Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScreen
      title="Sign in"
      description="Signing in is optional. Reports can be submitted without an account."
      onBack={() => navigation.goBack()}
      onSkipToReport={() => navigation.navigate('Report')}
      footer={
        <AuthFooterLink
          prompt="Don't have an account?"
          action="Create one"
          onPress={() => navigation.navigate('Signup')}
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
            autoComplete="current-password"
            accessibilityLabel="Password"
          />
        </Field>
      </View>

      {error ? <Callout tone="danger" message={error} icon={TriangleAlert} assertive /> : null}

      <Button
        label={loading ? 'Signing in…' : 'Sign in'}
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
