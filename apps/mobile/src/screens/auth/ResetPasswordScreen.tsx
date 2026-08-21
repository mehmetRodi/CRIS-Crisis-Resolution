import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

import { PASSWORD_RULE_HINT, isPasswordValid } from '@crisismap/shared';

import { useAuth } from '../../lib/AuthContext';
import { colors } from '../../theme';
import { authStyles as s } from './authStyles';
import type { RootStackParamList } from '../../navigation/RootNavigator';

/** Mobile twin of apps/web/src/ResetPasswordPage.tsx. */
export function ResetPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { email } = useRoute<RouteProp<RootStackParamList, 'ResetPassword'>>().params;
  const { confirmResetPassword } = useAuth();
  const [code, setCode] = useState('');
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
      setError(PASSWORD_RULE_HINT);
      return;
    }

    setLoading(true);
    try {
      await confirmResetPassword(email, code, password);
      navigation.navigate('Login');
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === 'CodeMismatchException' || err.name === 'ExpiredCodeException')
      ) {
        setError('That code is invalid or has expired. Request a new one.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <Text style={s.title}>Enter Reset Code</Text>
          <Text style={s.subtitle}>Enter the code we emailed you and choose a new password</Text>

          <View style={s.field}>
            <Text style={s.label}>Reset Code</Text>
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

          <View style={s.field}>
            <Text style={s.label}>New Password</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Minimum 8 characters"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
            />
            <Text style={s.hint}>{PASSWORD_RULE_HINT}</Text>
          </View>

          <View style={s.field}>
            <Text style={s.label}>Confirm New Password</Text>
            <TextInput
              style={s.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm your new password"
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
              <Text style={s.submitText}>Reset Password</Text>
            )}
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Login')} hitSlop={8}>
            <Text style={s.link}>Back to Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
