import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  useColorScheme, Alert, ScrollView, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

const BLUE = '#1877F2';

export default function SignupScreen() {
  const isDark = useColorScheme() === 'dark';
  const c = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#111214' : '#f5f6f8',
  };

  const [form, setForm] = useState({
    firstName: '', lastName: '', dob: '', phone: '', email: '',
    password: '', retypePassword: '', address: '', landmark: '', occupation: '',
  });
  const [isBusiness, setIsBusiness] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSignup() {
    if (form.password !== form.retypePassword) {
      Alert.alert('Passwords do not match');
      return;
    }
    if (!agreed) {
      Alert.alert('Please agree to the Terms & Conditions to continue');
      return;
    }

        const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
          date_of_birth: form.dob,
          phone_number: form.phone,
          address: form.address,
          landmark: form.landmark,
          occupation: form.occupation,
          is_business: isBusiness,
          company_name: isBusiness ? companyName : null,
        },
      },
    });

    setSubmitting(false);
    if (error) {
      Alert.alert('Signup failed', error.message);
      return;
    }
    Alert.alert('Welcome to Gen-D', 'Your account has been created.');
    router.replace('/login');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={[styles.logo, { color: c.text }]}>Join Gen-D</Text>

        <Field label="First name" value={form.firstName} onChangeText={(v) => update('firstName', v)} c={c} />
        <Field label="Last name" value={form.lastName} onChangeText={(v) => update('lastName', v)} c={c} />
        <Field label="Date of birth" value={form.dob} onChangeText={(v) => update('dob', v)} placeholder="YYYY-MM-DD" c={c} />
        <Field label="Phone number" value={form.phone} onChangeText={(v) => update('phone', v)} keyboardType="phone-pad" c={c} />
        <Field label="Email" value={form.email} onChangeText={(v) => update('email', v)} keyboardType="email-address" autoCapitalize="none" c={c} />
        <Field label="Password" value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry c={c} />
        <Field label="Retype password" value={form.retypePassword} onChangeText={(v) => update('retypePassword', v)} secureTextEntry c={c} />
        <Field label="Address" value={form.address} onChangeText={(v) => update('address', v)} c={c} />
        <Field label="Landmark" value={form.landmark} onChangeText={(v) => update('landmark', v)} c={c} />
        <Field label="Occupation" value={form.occupation} onChangeText={(v) => update('occupation', v)} c={c} />

        <View style={styles.switchRow}>
          <Switch value={isBusiness} onValueChange={setIsBusiness} trackColor={{ true: BLUE }} />
          <Text style={[styles.switchLabel, { color: c.text }]}>I&apos;m signing up as a business</Text>
        </View>

        {isBusiness && (
          <Field label="Company name" value={companyName} onChangeText={setCompanyName} c={c} />
        )}

        <View style={styles.switchRow}>
          <Switch value={agreed} onValueChange={setAgreed} trackColor={{ true: BLUE }} />
          <Text style={[styles.switchLabel, { color: c.muted }]}>
            I agree to the Terms & Conditions and User Agreement
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
          onPress={handleSignup}
          disabled={submitting}
        >
          <Text style={styles.buttonText}>{submitting ? 'Creating account…' : 'Sign up'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'sentences';
  c: { text: string; muted: string; inputBg: string };
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.label, { color: props.c.muted }]}>{props.label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: props.c.inputBg, color: props.c.text }]}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={props.c.muted}
        secureTextEntry={props.secureTextEntry}
        keyboardType={props.keyboardType}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingBottom: 48 },
  logo: { fontSize: 26, fontWeight: '800', marginBottom: 24, textAlign: 'center' },
  fieldWrapper: { marginBottom: 14 },
  label: { fontSize: 13, marginBottom: 6 },
  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, marginBottom: 4 },
  switchLabel: { flex: 1, fontSize: 14 },
  button: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 28, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});