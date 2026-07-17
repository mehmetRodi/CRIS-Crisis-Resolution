import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../lib/AuthContext';
import { colors } from '../../theme';
import { authStyles as s } from './authStyles';
import type { RootStackParamList } from '../../navigation/RootNavigator';

function isPasswordValid(pw: string): boolean {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw);
}

/** Mobile twin of apps/web/src/SignupPage.tsx (CRIS-7, ADR-0022). */
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
      setError('Passwords do not match');
      return;
    }
    if (!isPasswordValid(password)) {
      setError(
        'Password must be at least 8 characters, with an uppercase letter, a lowercase letter, and a number.',
      );
      return;
    }

    setLoading(true);
    try {
      await signUp(email, password);
      navigation.navigate('ConfirmSignup', { email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
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

          <Text style={s.title}>Create Account</Text>
          <Text style={s.subtitle}>Sign up to submit emergency reports</Text>

          <View style={s.field}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Choose your email as username"
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
              placeholder="Minimum 8 characters"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
            <Text style={s.hint}>
              At least 8 characters, with an uppercase letter, a lowercase letter, and a number.
            </Text>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Confirm Password</Text>
            <TextInput
              style={s.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm your password"
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
            style={({ pressed }) => [s.submit, pressed && s.submitPressed, loading && s.submitDisabled]}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={s.submitText}>Create Account</Text>
            )}
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
            <Text style={s.link}>Already have an account? Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
