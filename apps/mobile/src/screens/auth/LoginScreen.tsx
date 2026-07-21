import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../lib/AuthContext';
import { colors } from '../../theme';
import { authStyles as s } from './authStyles';
import type { RootStackParamList } from '../../navigation/RootNavigator';

/** Mobile twin of apps/web/src/LoginPage.tsx (CRIS-7, ADR-0024). */
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
        // Account exists but was never verified — take them to confirmation.
        navigation.navigate('ConfirmSignup', { email });
      } else {
        setError('Additional verification is required to finish signing in.');
      }
    } catch (err) {
      // Cognito throws UserNotConfirmedException when the email was never
      // verified; route there rather than a misleading credentials error.
      if (err instanceof Error && err.name === 'UserNotConfirmedException') {
        navigation.navigate('ConfirmSignup', { email });
      } else {
        setError('Invalid email or password');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={s.back}>
            <Text style={s.backText}>← Back</Text>
          </Pressable>

          <Text style={s.title}>Welcome Back</Text>
          <Text style={s.subtitle}>Sign in to submit an emergency report</Text>

          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Password</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
          </View>

          {error ? (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={({ pressed }) => [
              s.submit,
              pressed && s.submitPressed,
              loading && s.submitDisabled,
            ]}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={s.submitText}>Sign In</Text>
            )}
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Signup')} hitSlop={8}>
            <Text style={s.link}>Don't have an account? Sign up</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
