import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  useColorScheme, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

const BLUE = '#1877F2';
const RED = '#E41E3F';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Two-step, single-screen flow (same 'request' -> 'verify' pattern as
// login.tsx's phone tab) instead of the earlier deep-link screen — Expo Go
// can't register custom URL schemes, so gend://reset-password could never
// open there, and won't until there's a proper native build. An emailed
// 6-digit code sidesteps deep linking entirely.
type Step = 'request' | 'verify';

export default function ForgotPasswordScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#111214' : '#f5f6f8',
  };

  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Once verifyOtp succeeds it can't be replayed — track that separately so
  // a retry after a failed updateUser() (e.g. weak password) just retries
  // updateUser() on the session that's already set, without resubmitting
  // the one-time code.
  const [otpVerified, setOtpVerified] = useState(false);
  // Field names currently showing a red border — cleared the moment that
  // field is edited again, not left stuck on until the next submit attempt.
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  function clearFieldError(name: string) {
    setFieldErrors((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  async function handleSendCode() {
    const trimmed = email.trim();
    if (!trimmed || !EMAIL_RE.test(trimmed)) {
      setFieldErrors(new Set(['email']));
      Alert.alert('Enter your email', 'Enter the email address for your account.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
    setSubmitting(false);
    if (error) {
      Alert.alert('Could not send code', error.message);
      return;
    }
    setCode('');
    setOtpVerified(false);
    setFieldErrors(new Set());
    setStep('verify');
  }

  async function handleVerifyAndReset() {
    const errors = new Set<string>();
    if (!code.trim()) errors.add('code');
    if (!newPassword) errors.add('newPassword');
    if (!confirmPassword) errors.add('confirmPassword');
    if (errors.size > 0) {
      setFieldErrors(errors);
      Alert.alert('Missing information', 'Fill in the highlighted fields to continue.');
      return;
    }
    if (newPassword.length < 6) {
      setFieldErrors(new Set(['newPassword']));
      Alert.alert('Password too short', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors(new Set(['newPassword', 'confirmPassword']));
      Alert.alert("Passwords don't match", 'Make sure both passwords are the same.');
      return;
    }

    setSubmitting(true);

    if (!otpVerified) {
      const { error: otpError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: 'recovery',
      });
      if (otpError) {
        setSubmitting(false);
        Alert.alert('Invalid code', otpError.message);
        return;
      }
      setOtpVerified(true);
    }

    // verifyOtp already signed the user in with a recovery session — this
    // just changes the password on it.
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);

    if (updateError) {
      Alert.alert('Could not update password', updateError.message);
      return;
    }

    router.replace('/');
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={[styles.logo, { color: c.text }]}>Gen-D</Text>

          {step === 'request' ? (
            <>
              <Text style={[styles.title, { color: c.text }]}>Forgot password?</Text>
              <Text style={[styles.note, { color: c.muted }]}>
                Enter your email and we&apos;ll send you a code to reset your password.
              </Text>

              <Text style={[styles.label, { color: c.muted }]}>Email</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text },
                  fieldErrors.has('email') && styles.inputError,
                ]}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={(v) => { setEmail(v); clearFieldError('email'); }}
                placeholder="you@example.com"
                placeholderTextColor={c.muted}
              />

              <Pressable
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
                onPress={handleSendCode}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? 'Sending…' : 'Send code'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.note, { color: c.muted }]}>
                We sent a code to {email.trim()}. Enter it below along with your new password.
              </Text>

              <Text style={[styles.label, { color: c.muted }]}>Verification code</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text },
                  fieldErrors.has('code') && styles.inputError,
                ]}
                keyboardType="number-pad"
                maxLength={6}
                value={code}
                onChangeText={(v) => { setCode(v); clearFieldError('code'); }}
                placeholder="6-digit code"
                placeholderTextColor={c.muted}
              />

              <Text style={[styles.label, { color: c.muted }]}>New password</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text },
                  fieldErrors.has('newPassword') && styles.inputError,
                ]}
                secureTextEntry
                value={newPassword}
                onChangeText={(v) => { setNewPassword(v); clearFieldError('newPassword'); }}
                placeholder="••••••••"
                placeholderTextColor={c.muted}
              />

              <Text style={[styles.label, { color: c.muted }]}>Confirm password</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text },
                  fieldErrors.has('confirmPassword') && styles.inputError,
                ]}
                secureTextEntry
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); clearFieldError('confirmPassword'); }}
                placeholder="••••••••"
                placeholderTextColor={c.muted}
              />

              <Pressable
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
                onPress={handleVerifyAndReset}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? 'Saving…' : 'Reset password'}</Text>
              </Pressable>

              <Pressable onPress={handleSendCode} disabled={submitting}>
                <Text style={[styles.link, { color: BLUE }]}>Resend code</Text>
              </Pressable>

              <Pressable
                onPress={() => { setFieldErrors(new Set()); setStep('request'); }}
                disabled={submitting}
              >
                <Text style={[styles.link, { color: c.muted }]}>Edit email</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  backText: { fontSize: 15, fontWeight: '700' },
  keyboardAvoider: { flex: 1 },
  container: { flexGrow: 1, padding: 24, paddingTop: 40 },
  logo: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 40, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  note: { fontSize: 14, textAlign: 'center', marginBottom: 8, lineHeight: 20 },
  label: { fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  inputError: { borderWidth: 1.5, borderColor: RED },
  button: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 32, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  link: { textAlign: 'center', marginTop: 22, fontSize: 14, fontWeight: '600' },
});
