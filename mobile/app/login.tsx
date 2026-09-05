import { useState } from 'react';
import { Text, TextInput, Pressable, StyleSheet, useColorScheme, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

const BLUE = '#1877F2';

export default function LoginScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#111214' : '#f5f6f8',
  };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      Alert.alert('Login failed', error.message);
      return;
    }
    router.replace('/');
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <Text style={[styles.logo, { color: c.text }]}>Gen-D</Text>

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

      <Text style={[styles.label, { color: c.muted }]}>Password</Text>
      <TextInput
        style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        placeholderTextColor={c.muted}
      />

      <Pressable
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
        onPress={handleLogin}
        disabled={submitting}
      >
        <Text style={styles.buttonText}>{submitting ? 'Logging in…' : 'Log in'}</Text>
      </Pressable>

      <Pressable onPress={() => router.push('/signup')}>
        <Text style={[styles.link, { color: BLUE }]}>New to Gen-D? Sign up</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  logo: { fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 40, letterSpacing: -0.5 },
  label: { fontSize: 13, marginBottom: 6, marginTop: 16 },
  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  button: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 32, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  link: { textAlign: 'center', marginTop: 22, fontSize: 14, fontWeight: '600' },
});