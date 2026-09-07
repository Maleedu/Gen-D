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

type LoginTab = 'email' | 'phone';

export default function LoginScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#111214' : '#f5f6f8',
  };

  const [tab, setTab] = useState<LoginTab>('email');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Field names currently showing a red border — cleared the moment that
  // field is edited again, not left stuck on until the next submit attempt.
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  // Phone tab: 'request' shows the number entry + "Send code", 'verify'
  // shows the OTP entry once a code has been sent — swapped inline on this
  // same screen rather than navigating, same pattern used in signup.tsx's
  // phone-verification step (see docs/phone-otp-login-handover.md).
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneStep, setPhoneStep] = useState<'request' | 'verify'>('request');
  const [phoneOtp, setPhoneOtp] = useState('');

  function clearFieldError(name: string) {
    setFieldErrors((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function switchTab(nextTab: LoginTab) {
    setTab(nextTab);
    setPhoneStep('request');
    setPhoneOtp('');
    setFieldErrors(new Set());
  }

  async function handleLogin() {
    const errors = new Set<string>();
    if (!email.trim() || !EMAIL_RE.test(email.trim())) errors.add('email');
    if (!password) errors.add('password');
    if (errors.size > 0) {
      setFieldErrors(errors);
      Alert.alert('Missing information', 'Enter a valid email and password to continue.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      Alert.alert('Login failed', error.message);
      return;
    }
    router.replace('/');
  }

  async function handleSendCode() {
    if (phoneNumber.length !== 10) {
      setFieldErrors(new Set(['phoneNumber']));
      Alert.alert('Enter a valid phone number', 'Phone number must be 10 digits.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: `+91${phoneNumber}`,
      options: { shouldCreateUser: false },
    });
    setSubmitting(false);
    if (error) {
      // shouldCreateUser: false makes Supabase error out instead of
      // silently creating an account — surface that case with a clearer
      // message and a way to go sign up, rather than the raw error.
      const noAccount = /not found|no user|signups? not allowed/i.test(error.message);
      if (noAccount) {
        Alert.alert(
          'No account found',
          'No account found with this number. Sign up first.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign up', onPress: () => router.push('/signup') },
          ],
        );
      } else {
        Alert.alert('Could not send code', error.message);
      }
      return;
    }
    setPhoneOtp('');
    setPhoneStep('verify');
  }

  async function handleVerifyPhoneOtp() {
    if (!phoneOtp.trim()) {
      setFieldErrors(new Set(['phoneOtp']));
      Alert.alert('Enter the code', 'Enter the verification code sent to your phone.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: `+91${phoneNumber}`,
      token: phoneOtp,
      type: 'sms',
    });
    setSubmitting(false);
    if (error) {
      Alert.alert('Verification failed', error.message);
      return;
    }
    router.replace('/');
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/')} hitSlop={8}>
          <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={[styles.logo, { color: c.text }]}>Gen-D</Text>

          <View style={[styles.modeRow, { backgroundColor: c.inputBg }]}>
            <ModePill label="Email" active={tab === 'email'} onPress={() => switchTab('email')} c={c} />
            <ModePill label="Phone" active={tab === 'phone'} onPress={() => switchTab('phone')} c={c} />
          </View>

          {tab === 'email' ? (
            <>
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

              <Text style={[styles.label, { color: c.muted }]}>Password</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text },
                  fieldErrors.has('password') && styles.inputError,
                ]}
                secureTextEntry
                value={password}
                onChangeText={(v) => { setPassword(v); clearFieldError('password'); }}
                placeholder="••••••••"
                placeholderTextColor={c.muted}
              />

              <Pressable onPress={() => router.push('/forgot-password')} hitSlop={4}>
                <Text style={[styles.forgotLink, { color: BLUE }]}>Forgot password?</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
                onPress={handleLogin}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? 'Logging in…' : 'Log in'}</Text>
              </Pressable>

              <Pressable onPress={() => router.push('/signup')}>
                <Text style={[styles.signupLinkBig, { color: BLUE }]}>New to Gen-D? Sign up</Text>
              </Pressable>
            </>
          ) : phoneStep === 'request' ? (
            <>
              <Text style={[styles.label, { color: c.muted }]}>Phone number</Text>
              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: c.inputBg },
                  fieldErrors.has('phoneNumber') && styles.inputError,
                ]}
              >
                <Text style={[styles.inputPrefix, { color: c.muted }]}>+91</Text>
                <TextInput
                  style={[styles.inputFlex, { color: c.text }]}
                  keyboardType="phone-pad"
                  maxLength={10}
                  value={phoneNumber}
                  onChangeText={(v) => { setPhoneNumber(v); clearFieldError('phoneNumber'); }}
                  placeholder="10-digit number"
                  placeholderTextColor={c.muted}
                />
              </View>

              <Pressable
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
                onPress={handleSendCode}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? 'Sending…' : 'Send code'}</Text>
              </Pressable>

              <Pressable onPress={() => router.push('/signup')}>
                <Text style={[styles.signupLinkBig, { color: BLUE }]}>New to Gen-D? Sign up</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.note, { color: c.muted }]}>
                We sent a code to +91{phoneNumber}. Enter it below to verify.
              </Text>

              <Text style={[styles.label, { color: c.muted }]}>Verification code</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text },
                  fieldErrors.has('phoneOtp') && styles.inputError,
                ]}
                keyboardType="number-pad"
                maxLength={6}
                value={phoneOtp}
                onChangeText={(v) => { setPhoneOtp(v); clearFieldError('phoneOtp'); }}
                placeholder="6-digit code"
                placeholderTextColor={c.muted}
              />

              <Pressable
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
                onPress={handleVerifyPhoneOtp}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? 'Verifying…' : 'Verify'}</Text>
              </Pressable>

              <Pressable onPress={handleSendCode} disabled={submitting}>
                <Text style={[styles.link, { color: BLUE }]}>Resend code</Text>
              </Pressable>

              <Pressable onPress={() => setPhoneStep('request')} disabled={submitting}>
                <Text style={[styles.link, { color: c.muted }]}>Edit phone number</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ModePill({
  label, active, onPress, c,
}: { label: string; active: boolean; onPress: () => void; c: { text: string } }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.modePill, active && { backgroundColor: BLUE }]}
    >
      <Text style={[styles.modePillText, { color: active ? '#ffffff' : c.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  backText: { fontSize: 15, fontWeight: '700' },
  keyboardAvoider: { flex: 1 },
  container: { flexGrow: 1, padding: 24, paddingTop: 40 },
  logo: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 40, letterSpacing: -0.5 },

  modeRow: {
    flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4, marginBottom: 20,
  },
  modePill: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modePillText: { fontSize: 14, fontWeight: '700' },

  label: { fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  inputError: { borderWidth: 1.5, borderColor: RED },
  forgotLink: { textAlign: 'right', marginTop: 10, fontSize: 13, fontWeight: '600' },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14 },
  inputPrefix: { fontSize: 16, marginRight: 6 },
  inputFlex: { flex: 1, paddingVertical: 14, fontSize: 16 },
  note: { fontSize: 14, textAlign: 'center', marginTop: 16 },
  button: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 32, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  link: { textAlign: 'center', marginTop: 22, fontSize: 14, fontWeight: '600' },
  signupLinkBig: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 20,
    fontWeight: '800',
  },
});
