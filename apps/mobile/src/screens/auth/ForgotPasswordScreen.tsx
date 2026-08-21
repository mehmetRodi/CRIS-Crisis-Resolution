import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from '../../lib/AuthContext';
import { colors } from '../../theme';
import { authStyles as s } from './authStyles';
import type { RootStackParamList } from '../../navigation/RootNavigator';

/** Mobile twin of apps/web/src/ForgotPasswordPage.tsx. */
export function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      await resetPassword(email);
      setSubmitted(true);
    } catch (err) {
      // Same rule as the web page: an account-existence error must never look
      // different from success, or this screen becomes an enumeration oracle.
      if (err instanceof TypeError) {
        setError('Something went wrong. Check your connection and try again.');
      } else {
        setSubmitted(true);
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

          <Text style={s.title}>Reset Password</Text>
          <Text style={s.subtitle}>Enter your email and we'll send you a reset code</Text>

          {submitted ? (
            <>
              <Text style={s.hint}>
                If an account exists for that email, we've sent a reset code. Check your inbox.
              </Text>
              <Pressable
                onPress={() => navigation.navigate('ResetPassword', { email })}
                style={({ pressed }) => [s.submit, pressed && s.submitPressed]}
                accessibilityRole="button"
              >
                <Text style={s.submitText}>I have a code</Text>
              </Pressable>
            </>
          ) : (
            <>
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
                  <Text style={s.submitText}>Send Reset Code</Text>
                )}
              </Pressable>
            </>
          )}

          <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
            <Text style={s.link}>Back to Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
