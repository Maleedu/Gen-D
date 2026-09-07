import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  useColorScheme, Alert, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from '../lib/supabase';

const BLUE = '#1877F2';

// Screen the password-reset deep link (gend://reset-password#access_token=...)
// opens. Follows Supabase's official Expo pattern: detectSessionInUrl is off
// in lib/supabase.ts, so the incoming URL's tokens are extracted here by hand
// and passed to setSession() instead of Supabase parsing the URL itself.
type Status = 'loading' | 'invalid' | 'ready';

export default function ResetPasswordScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#111214' : '#f5f6f8',
  };

  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const handledRef = useRef(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function handleUrl(url: string | null) {
      if (!url || handledRef.current) return;

      const { params, errorCode } = QueryParams.getQueryParams(url);

      if (errorCode || params.error) {
        handledRef.current = true;
        setErrorMessage(params.error_description || 'This reset link is invalid or has expired.');
        setStatus('invalid');
        return;
      }

      if (!params.access_token) return;

      handledRef.current = true;
      const { error } = await supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      });

      if (error) {
        setErrorMessage(error.message);
        setStatus('invalid');
        return;
      }

      setStatus('ready');
    }

    // Cold start (app opened by tapping the link) — the launching URL.
    Linking.getInitialURL().then(handleUrl);
    // App already open — the link arrives as an event instead.
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    // Neither of the above carried tokens within a moment — this screen was
    // opened without a reset link (e.g. direct navigation), not an actual
    // expired/invalid link, but the user-facing result is the same.
    const timeout = setTimeout(() => {
      if (!handledRef.current) {
        setErrorMessage('Open this screen using the reset link from your email.');
        setStatus('invalid');
      }
    }, 1500);

    return () => {
      subscription.remove();
      clearTimeout(timeout);
    };
  }, []);

  async function handleUpdatePassword() {
    if (newPassword.length < 6) {
      Alert.alert('Password too short', 'Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Passwords don't match", 'Make sure both passwords are the same.');
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);

    if (error) {
      Alert.alert('Could not update password', error.message);
      return;
    }

    // setSession() above already signed the user in with the new session —
    // updateUser() just changed the password on it, so go straight to Home.
    router.replace('/');
  }

  if (status === 'loading') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={BLUE} />
        </View>
      </SafeAreaView>
    );
  }

  if (status === 'invalid') {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]}>
        <View style={styles.centered}>
          <Text style={[styles.logo, { color: c.text }]}>Gen-D</Text>
          <Text style={[styles.note, { color: c.muted }]}>{errorMessage}</Text>
          <Pressable
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
            onPress={() => router.replace('/login')}
          >
            <Text style={styles.buttonText}>Back to login</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={[styles.logo, { color: c.text }]}>Gen-D</Text>
          <Text style={[styles.title, { color: c.text }]}>Set a new password</Text>

          <Text style={[styles.label, { color: c.muted }]}>New password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
            secureTextEntry
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="••••••••"
            placeholderTextColor={c.muted}
          />

          <Text style={[styles.label, { color: c.muted }]}>Confirm password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="••••••••"
            placeholderTextColor={c.muted}
          />

          <Pressable
            style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
            onPress={handleUpdatePassword}
            disabled={submitting}
          >
            <Text style={styles.buttonText}>{submitting ? 'Saving…' : 'Save new password'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  keyboardAvoider: { flex: 1 },
  container: { flexGrow: 1, padding: 24, paddingTop: 60 },
  logo: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 16, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 24 },
  note: { fontSize: 14, textAlign: 'center', marginTop: 8, marginBottom: 24, lineHeight: 20 },
  label: { fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  button: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 32, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
