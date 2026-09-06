import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { AgentAvatar } from '../../components/agent-avatar';
import { useViewMode } from '../../lib/view-mode';

const BLUE = '#1877F2';
const RED = '#E41E3F';

type Profile = {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  phone_number: string | null;
};

type Palette = {
  bg: string; text: string; muted: string;
  card: string; border: string;
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
  };

  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

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
    const { data, error } = await supabase
      .from('profiles')
      .select('first_name, last_name, avatar_url, phone_number')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      setLoadError(error.message);
      return;
    }
    setProfile(data as Profile);
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

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
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
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
      >
        <View style={styles.header}>
          <AgentAvatar
            firstName={profile.first_name}
            lastName={profile.last_name}
            avatarUrl={profile.avatar_url}
            size={72}
            color={BLUE}
          />
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

        <Pressable
          onPress={() => router.push('/my-orders')}
          style={({ pressed }) => [styles.secondaryButton, { borderColor: BLUE }, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.secondaryButtonText, { color: BLUE }]}>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  header: { alignItems: 'center', paddingVertical: 8, gap: 10 },
  name: { fontSize: 19, fontWeight: '800' },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '700' },
  contactLine: { fontSize: 14 },

  secondaryButton: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 13, alignItems: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '700' },
});
