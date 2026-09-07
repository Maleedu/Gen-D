import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  useColorScheme, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

const BLUE = '#1877F2';

export default function ForgotPasswordScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#111214' : '#f5f6f8',
  };

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSendResetLink() {
    const trimmed = email.trim();
    if (!trimmed) {
      Alert.alert('Enter your email', 'Enter the email address for your account.');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'gend://reset-password',
    });
    setSubmitting(false);
    if (error) {
      Alert.alert('Could not send reset link', error.message);
      return;
    }
    setSent(true);
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

          {sent ? (
            <>
              <Text style={[styles.title, { color: c.text }]}>Check your email</Text>
              <Text style={[styles.note, { color: c.muted }]}>
                We sent a password reset link to {email.trim()}. Open it on this device to set a new password.
              </Text>

              <Pressable
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
                onPress={() => router.replace('/login')}
              >
                <Text style={styles.buttonText}>Back to login</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: c.text }]}>Forgot password?</Text>
              <Text style={[styles.note, { color: c.muted }]}>
                Enter your email and we&apos;ll send you a link to reset your password.
              </Text>

              <Text style={[styles.label, { color: c.muted }]}>Email</Text>
              <TextInput
                style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={c.muted}
              />

              <Pressable
                style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
                onPress={handleSendResetLink}
                disabled={submitting}
              >
                <Text style={styles.buttonText}>{submitting ? 'Sending…' : 'Send reset link'}</Text>
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
  button: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 32, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
