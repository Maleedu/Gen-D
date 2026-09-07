import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  useColorScheme, Alert, ScrollView, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

const BLUE = '#1877F2';
const RED = '#E41E3F';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Every field in `form` is required — this is what handleSignup checks for
// emptiness on submit, driving which Field gets a red border.
const REQUIRED_FORM_FIELDS = [
  'firstName', 'lastName', 'dob', 'phone', 'email',
  'password', 'retypePassword', 'address', 'landmark', 'occupation',
] as const;

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
  // Field names currently showing a red border — cleared the moment that
  // field is edited again, not left stuck on until the next submit attempt.
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  // True once the account is created and we're waiting on phone
  // verification — swaps the whole screen into that view instead of
  // navigating to a new route, same pattern as my-orders.tsx's bid-review
  // view (see docs/phone-otp-login-handover.md).
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  function clearFieldError(name: string) {
    setFieldErrors((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    clearFieldError(key);
  }

  function finishSignup() {
    Alert.alert('Welcome to Gen-D', 'Your account has been created.');
    router.replace('/login');
  }

  // Verifying the phone number as a Supabase Auth identity right after
  // signup, so phone login works for this account from day one — existing
  // accounts are not retroactively linked (out of scope, see handover doc).
  async function requestPhoneVerification() {
    setSubmitting(true);
    const { error: phoneError } = await supabase.auth.updateUser({
      phone: `+91${form.phone}`,
    });
    setSubmitting(false);
    if (phoneError) {
      // Phone linking failing doesn't block signup — the account already
      // exists and works via email+password either way.
      Alert.alert('Phone verification failed', phoneError.message, [
        { text: 'Skip for now', onPress: finishSignup },
        { text: 'Try again', onPress: requestPhoneVerification },
      ]);
      return;
    }
    setOtpCode('');
    setShowPhoneVerification(true);
  }

  async function handleVerifyOtp() {
    if (!otpCode.trim()) {
      setFieldErrors(new Set(['otpCode']));
      Alert.alert('Enter the code', 'Enter the verification code sent to your phone.');
      return;
    }
    setSubmitting(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: `+91${form.phone}`,
      token: otpCode,
      type: 'phone_change',
    });
    setSubmitting(false);
    if (verifyError) {
      Alert.alert('Verification failed', verifyError.message);
      return;
    }
    finishSignup();
  }

  async function handleSignup() {
    const errors = new Set<string>();
    for (const key of REQUIRED_FORM_FIELDS) {
      if (!form[key].trim()) errors.add(key);
    }
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errors.add('email');
    if (isBusiness && !companyName.trim()) errors.add('companyName');
    if (errors.size > 0) {
      setFieldErrors(errors);
      Alert.alert('Missing information', 'Fill in the highlighted fields to continue.');
      return;
    }

    if (form.password !== form.retypePassword) {
      Alert.alert('Passwords do not match');
      return;
    }
    if (!agreed) {
      Alert.alert('Please agree to the Terms & Conditions to continue');
      return;
    }

    setSubmitting(true);
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
    await requestPhoneVerification();
  }

  if (showPhoneVerification) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView contentContainerStyle={styles.container}>
            <Text style={[styles.logo, { color: c.text }]}>Verify your number</Text>
            <Text style={[styles.verifyMessage, { color: c.muted }]}>
              We sent a code to +91{form.phone}. Enter it below to verify your number.
            </Text>

            <Field
              label="Verification code"
              value={otpCode}
              onChangeText={(v) => { setOtpCode(v); clearFieldError('otpCode'); }}
              keyboardType="number-pad"
              maxLength={6}
              c={c}
              error={fieldErrors.has('otpCode')}
            />

            <Pressable
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.85 }]}
              onPress={handleVerifyOtp}
              disabled={submitting}
            >
              <Text style={styles.buttonText}>{submitting ? 'Verifying…' : 'Verify'}</Text>
            </Pressable>

            <Pressable onPress={requestPhoneVerification} disabled={submitting}>
              <Text style={[styles.link, { color: BLUE }]}>Resend code</Text>
            </Pressable>

            <Pressable onPress={finishSignup} disabled={submitting}>
              <Text style={[styles.link, { color: c.muted }]}>Skip for now</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={[styles.logo, { color: c.text }]}>Join Gen-D</Text>

          <Field label="First name" value={form.firstName} onChangeText={(v) => update('firstName', v)} c={c} error={fieldErrors.has('firstName')} />
          <Field label="Last name" value={form.lastName} onChangeText={(v) => update('lastName', v)} c={c} error={fieldErrors.has('lastName')} />
          <Field label="Date of birth" value={form.dob} onChangeText={(v) => update('dob', v)} placeholder="YYYY-MM-DD" c={c} error={fieldErrors.has('dob')} />
          <Field
            label="Phone number"
            value={form.phone}
            onChangeText={(v) => update('phone', v)}
            keyboardType="phone-pad"
            prefix="+91"
            maxLength={10}
            c={c}
            error={fieldErrors.has('phone')}
          />
          <Field label="Email" value={form.email} onChangeText={(v) => update('email', v)} keyboardType="email-address" autoCapitalize="none" c={c} error={fieldErrors.has('email')} />
          <Field label="Password" value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry c={c} error={fieldErrors.has('password')} />
          <Field label="Retype password" value={form.retypePassword} onChangeText={(v) => update('retypePassword', v)} secureTextEntry c={c} error={fieldErrors.has('retypePassword')} />
          <Field label="Address" value={form.address} onChangeText={(v) => update('address', v)} c={c} error={fieldErrors.has('address')} />
          <Field label="Landmark" value={form.landmark} onChangeText={(v) => update('landmark', v)} c={c} error={fieldErrors.has('landmark')} />
          <Field label="Occupation" value={form.occupation} onChangeText={(v) => update('occupation', v)} c={c} error={fieldErrors.has('occupation')} />

          <View style={styles.switchRow}>
            <Switch value={isBusiness} onValueChange={setIsBusiness} trackColor={{ true: BLUE }} />
            <Text style={[styles.switchLabel, { color: c.text }]}>I&apos;m signing up as a business</Text>
          </View>

          {isBusiness && (
            <Field
              label="Company name"
              value={companyName}
              onChangeText={(v) => { setCompanyName(v); clearFieldError('companyName'); }}
              c={c}
              error={fieldErrors.has('companyName')}
            />
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences';
  prefix?: string;
  maxLength?: number;
  c: { text: string; muted: string; inputBg: string };
  error?: boolean;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.label, { color: props.c.muted }]}>{props.label}</Text>
      {props.prefix ? (
        <View style={[styles.inputRow, { backgroundColor: props.c.inputBg }, props.error && styles.inputError]}>
          <Text style={[styles.inputPrefix, { color: props.c.muted }]}>{props.prefix}</Text>
          <TextInput
            style={[styles.inputFlex, { color: props.c.text }]}
            value={props.value}
            onChangeText={props.onChangeText}
            placeholder={props.placeholder}
            placeholderTextColor={props.c.muted}
            secureTextEntry={props.secureTextEntry}
            keyboardType={props.keyboardType}
            autoCapitalize={props.autoCapitalize ?? 'sentences'}
            maxLength={props.maxLength}
          />
        </View>
      ) : (
        <TextInput
          style={[
            styles.input,
            { backgroundColor: props.c.inputBg, color: props.c.text },
            props.error && styles.inputError,
          ]}
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          placeholderTextColor={props.c.muted}
          secureTextEntry={props.secureTextEntry}
          keyboardType={props.keyboardType}
          autoCapitalize={props.autoCapitalize ?? 'sentences'}
          maxLength={props.maxLength}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAvoider: { flex: 1 },
  container: { padding: 24, paddingBottom: 48 },
  logo: { fontSize: 26, fontWeight: '800', marginBottom: 24, textAlign: 'center' },
  verifyMessage: { fontSize: 14, marginBottom: 24, textAlign: 'center' },
  fieldWrapper: { marginBottom: 14 },
  label: { fontSize: 13, marginBottom: 6 },
  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  inputError: { borderWidth: 1.5, borderColor: RED },
  inputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 14 },
  inputPrefix: { fontSize: 16, marginRight: 6 },
  inputFlex: { flex: 1, paddingVertical: 14, fontSize: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, marginBottom: 4 },
  switchLabel: { flex: 1, fontSize: 14 },
  button: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 28, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  link: { textAlign: 'center', marginTop: 16, fontSize: 14, fontWeight: '600' },
});
