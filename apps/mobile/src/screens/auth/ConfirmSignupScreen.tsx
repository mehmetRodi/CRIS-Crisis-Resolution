import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import { useAuth } from '../../lib/AuthContext';
import { colors } from '../../theme';
import { authStyles as s } from './authStyles';
import type { RootStackParamList } from '../../navigation/RootNavigator';

/** Mobile twin of apps/web/src/ConfirmSignupPage.tsx (CRIS-7, ADR-0024). */
export function ConfirmSignupScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { email } = useRoute<RouteProp<RootStackParamList, 'ConfirmSignup'>>().params;
  const { confirmSignUp, resendSignUpCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      navigation.navigate('Login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await resendSignUpCode(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code');
    } finally {
      setResending(false);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.title}>Verify Your Account</Text>
          <Text style={s.subtitle}>We sent a verification code to your email</Text>

          <View style={s.field}>
            <Text style={s.label}>Verification Code</Text>
            <TextInput
              style={s.input}
              value={code}
              onChangeText={setCode}
              placeholder="Enter 6-digit code"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              maxLength={6}
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
              <Text style={s.submitText}>Verify Email</Text>
            )}
          </Pressable>

          <Pressable onPress={handleResend} disabled={resending} hitSlop={8}>
            <Text style={s.link}>{resending ? 'Sending...' : "Didn't receive a code? Resend"}</Text>
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
            <Text style={s.link}>Back to Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
