import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  ScrollView, RefreshControl, ActivityIndicator, TextInput, Share,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../lib/supabase';
import { AgentAvatar } from '../../components/agent-avatar';
import { ArviBubble } from '../../components/arvi-bubble';
import { useViewMode } from '../../lib/view-mode';

const RED = '#E41E3F';
const GREEN = '#1F9254';

type Profile = {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  phone_number: string | null;
  is_agent_verified: boolean;
  wallet_balance_paise: number;
};

type Palette = {
  bg: string; text: string; muted: string;
  card: string; border: string; inputBg: string;
};

// Customer-facing profile — separate from the agent-facing Progress screen
// (mobile/app/(tabs)/explore.tsx), which stays completely unchanged. This
// shows only identity/contact info and logout, no gamification stats.
export default function CustomerProfileScreen() {
  const isDark = useColorScheme() === 'dark';
  const { mode } = useViewMode();
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
    inputBg: isDark ? '#1a1a1a' : '#f5f6f8',
  };
  const accent = c.text;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [upiInput, setUpiInput] = useState('');
  const [savingUpi, setSavingUpi] = useState(false);
  const referralCode = userId ? userId.replace(/-/g, '').slice(0, 8).toUpperCase() : '';

  async function handleShareReferralCode() {
    try {
      await Share.share({
        message: `Join Gen-D and use my referral code ${referralCode} when you sign up!`,
      });
    } catch {
      // Best-effort — a failed/cancelled share sheet needs no error handling.
    }
  }

  const load = useCallback(async () => {
    setLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login');
      return;
    }
    // Own email comes straight off the auth session — auth.users isn't
    // exposed for a client-side join, but getUser() already returns the
    // caller's own email, which is all "my profile" ever needs.
    setEmail(user.email ?? null);
    setUserId(user.id);
    const { data, error } = await supabase
      .from('profiles')
      .select('first_name, last_name, avatar_url, phone_number, is_agent_verified, wallet_balance_paise')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      setLoadError(error.message);
      return;
    }
    setProfile(data as Profile);

    const { data: paymentInfo } = await supabase
      .from('agent_payment_info')
      .select('upi_id')
      .eq('profile_id', user.id)
      .maybeSingle();
    setUpiInput(paymentInfo?.upi_id ?? '');
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      await load();
      if (!ignore) setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function handleLogout() {
    setLoggingOut(true);
    const { error } = await supabase.auth.signOut();
    setLoggingOut(false);
    if (error) {
      Alert.alert("Couldn't log out", error.message);
      return;
    }
    router.replace('/login');
  }

  async function handleSaveUpi() {
    if (!userId) return;
    const trimmed = upiInput.trim();
    if (!trimmed) {
      Alert.alert('Enter a UPI ID', 'Add your UPI ID so customers can pay you directly.');
      return;
    }
    setSavingUpi(true);
    const { error } = await supabase
      .from('agent_payment_info')
      .upsert({ profile_id: userId, upi_id: trimmed, updated_at: new Date().toISOString() });
    setSavingUpi(false);
    if (error) {
      Alert.alert("Couldn't save UPI ID", error.message);
      return;
    }
    setUpiInput(trimmed);
  }

  async function handlePickAvatar() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to update your profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert("Couldn't update photo", 'No image data was returned.');
      return;
    }

    setUploadingAvatar(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      const path = `${user.id}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, decode(asset.base64), { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);
      if (updateError) throw updateError;

      setProfile((prev) => (prev ? { ...prev, avatar_url: publicUrl } : prev));
    } catch (err: any) {
      Alert.alert("Couldn't update photo", err?.message ?? 'Something went wrong.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !profile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centerFill}>
          <Text style={[styles.errorText, { color: c.text }]}>{loadError ?? "Couldn't load your profile."}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handlePickAvatar}
            disabled={uploadingAvatar}
            style={({ pressed }) => [styles.avatarWrap, pressed && { opacity: 0.7 }]}
          >
            <AgentAvatar
              firstName={profile.first_name}
              lastName={profile.last_name}
              avatarUrl={profile.avatar_url}
              size={72}
              color={accent}
            />
            {uploadingAvatar && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </Pressable>
          <Text style={[styles.name, { color: c.text }]}>{profile.first_name} {profile.last_name}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionLabel, { color: c.muted }]}>Contact</Text>
          {profile.phone_number && (
            <Text style={[styles.contactLine, { color: c.text }]}>📞 {profile.phone_number}</Text>
          )}
          {email && <Text style={[styles.contactLine, { color: c.text }]}>✉️ {email}</Text>}
          {!profile.phone_number && !email && (
            <Text style={[styles.contactLine, { color: c.muted }]}>No contact info on file.</Text>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionLabel, { color: c.muted }]}>Referrals & Wallet</Text>
          <Text style={[styles.walletBalance, { color: c.text }]}>₹{(profile.wallet_balance_paise / 100).toFixed(2)}</Text>
          <Text style={[styles.contactLine, { color: c.muted }]}>Share your code — earn wallet credit when they complete their first order.</Text>
          <View style={styles.referralRow}>
            <Text style={[styles.referralCode, { color: c.text }]}>{referralCode}</Text>
            <Pressable
              onPress={handleShareReferralCode}
              style={({ pressed }) => [styles.referralShareButton, { borderColor: accent }, pressed && { opacity: 0.6 }]}
            >
              <Text style={[styles.referralShareButtonText, { color: accent }]}>Share</Text>
            </Pressable>
          </View>
        </View>

        {mode === 'driver' && (
          profile.is_agent_verified ? (
            <Pressable
              onPress={() => router.push('/kyc')}
              style={({ pressed }) => [styles.kycBadge, { backgroundColor: c.card, borderColor: accent }, pressed && { opacity: 0.6 }]}
            >
              <Text style={[styles.kycBadgeText, { color: GREEN }]}>✓ KYC Verified</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push('/kyc')}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: accent }, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.primaryButtonText, { color: accent }]}>Complete KYC verification</Text>
            </Pressable>
          )
        )}

        {mode === 'driver' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Payment details</Text>
            <Text style={[styles.inputLabel, { color: c.muted }]}>UPI ID</Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
              value={upiInput}
              onChangeText={setUpiInput}
              placeholder="yourname@bank"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              onPress={handleSaveUpi}
              disabled={savingUpi}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: accent, marginTop: 10 }, (pressed || savingUpi) && { opacity: 0.7 }]}
            >
              <Text style={[styles.primaryButtonText, { color: accent }]}>{savingUpi ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => router.push('/my-orders')}
          style={({ pressed }) => [styles.secondaryButton, { borderColor: accent }, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.secondaryButtonText, { color: accent }]}>
            {mode === 'driver' ? 'View My Deliveries' : 'View My Orders'}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleLogout}
          disabled={loggingOut}
          style={({ pressed }) => [styles.secondaryButton, { borderColor: RED }, (pressed || loggingOut) && { opacity: 0.6 }]}
        >
          <Text style={[styles.secondaryButtonText, { color: RED }]}>{loggingOut ? 'Logging out…' : 'Log out'}</Text>
        </Pressable>

        <View style={styles.creditBlock}>
          <View style={styles.creditRow}>
            <Text style={[styles.creditText, { color: c.muted }]}>Made in India</Text>
            <Text style={styles.creditFlag}>🇮🇳</Text>
          </View>
          <Text style={[styles.creditSubtext, { color: c.muted }]}>By Navajyoth Maleedu</Text>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      <ArviBubble />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  creditBlock: { alignItems: 'center', gap: 2, marginTop: 24 },
  creditRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  creditFlag: { fontSize: 12 },
  creditText: { fontSize: 11 },
  creditSubtext: { fontSize: 10, opacity: 0.7 },

  header: { alignItems: 'center', paddingVertical: 8, gap: 10 },
  name: { fontSize: 19, fontWeight: '800' },

  avatarWrap: { borderRadius: 36 },
  avatarOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '700' },
  contactLine: { fontSize: 14 },
  walletBalance: { fontSize: 24, fontWeight: '800', marginTop: 2 },
  referralRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  referralCode: { fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  referralShareButton: { borderRadius: 10, borderWidth: 1.5, paddingVertical: 8, paddingHorizontal: 16 },
  referralShareButtonText: { fontSize: 13, fontWeight: '700' },
  inputLabel: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  input: { borderRadius: 12, padding: 14, fontSize: 15, marginTop: 6 },

  kycBadge: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 13, alignItems: 'center' },
  kycBadgeText: { fontSize: 14, fontWeight: '700' },

  primaryButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  secondaryButton: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 13, alignItems: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '700' },
});
