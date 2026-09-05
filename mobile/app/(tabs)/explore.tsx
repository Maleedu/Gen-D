import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, useColorScheme, ActivityIndicator, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import {
  ALL_BADGE_CODES, BADGE_META, LEVEL_COLOR, fetchGamificationProfile, type GamificationProfile,
} from '../../lib/gamification';

const BLUE = '#1877F2';

// Index = level_number - 1. Used only to name the level one step up from the
// current one for the progress caption ("3/15 to Courier") — the RPC gives
// us the current label plus how many deliveries are left, not the next
// label itself.
const LEVEL_LABELS = ['Rookie', 'Runner', 'Courier', 'Pro', 'Elite', 'Legend'];

type Profile = {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  avg_rating_as_agent: number | null;
  completed_deliveries_count: number;
};

type Palette = {
  bg: string; text: string; muted: string;
  card: string; border: string; track: string;
};

function initials(firstName: string, lastName: string) {
  const s = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();
  return s || '?';
}

export default function AgentStatsScreen() {
  const isDark = useColorScheme() === 'dark';
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
    track: isDark ? '#2e2e32' : '#e9ebee',
  };

  const [profile, setProfile] = useState<Profile | null>(null);
  const [gami, setGami] = useState<GamificationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login');
      return;
    }
    const [{ data: p, error }, gamiProfile] = await Promise.all([
      supabase
        .from('profiles')
        .select('first_name, last_name, avatar_url, avg_rating_as_agent, completed_deliveries_count')
        .eq('id', user.id)
        .maybeSingle(),
      fetchGamificationProfile(user.id),
    ]);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setProfile(p as Profile);
    setGami(gamiProfile);
  }, []);

  useEffect(() => {
    let ignore = false;
    async function startLoading() {
      await load();
      if (!ignore) {
        setLoading(false);
      }
    }
    startLoading();
    return () => {
      ignore = true;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
          <Text style={[styles.errorText, { color: c.text }]}>{loadError ?? "Couldn't load your progress."}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const levelColor = gami ? (LEVEL_COLOR[gami.level_number] ?? BLUE) : BLUE;
  const isMaxLevel = gami?.deliveries_to_next_level == null;
  const totalForLevel =
    gami && !isMaxLevel ? gami.deliveries_into_level + (gami.deliveries_to_next_level as number) : null;
  const progress = totalForLevel ? Math.min(1, gami!.deliveries_into_level / totalForLevel) : 1;
  const nextLevelLabel = gami ? LEVEL_LABELS[gami.level_number] : null;

  const earnedByCode = new Map((gami?.badges ?? []).map((b) => [b.badge_code, b.earned_at]));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
      >
        <View style={styles.header}>
          {profile.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: BLUE }]}>
              <Text style={styles.avatarFallbackText}>{initials(profile.first_name, profile.last_name)}</Text>
            </View>
          )}
          <Text style={[styles.name, { color: c.text }]}>{profile.first_name} {profile.last_name}</Text>
          <Text style={[styles.meta, { color: c.muted }]}>
            {profile.avg_rating_as_agent != null ? `⭐ ${profile.avg_rating_as_agent.toFixed(1)}` : 'No rating yet'}
            {' · '}{profile.completed_deliveries_count} deliveries
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.levelRow}>
            <View style={[styles.levelBadge, { backgroundColor: `${levelColor}22` }]}>
              <Text style={[styles.levelBadgeText, { color: levelColor }]}>{gami?.level_number ?? 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.levelLabel, { color: c.text }]}>{gami?.level_label ?? 'Rookie'}</Text>
              <Text style={[styles.note, { color: c.muted }]}>
                {isMaxLevel
                  ? 'Max level reached'
                  : `${gami?.deliveries_into_level}/${totalForLevel} to ${nextLevelLabel}`}
              </Text>
            </View>
          </View>
          {!isMaxLevel && (
            <View style={[styles.progressTrack, { backgroundColor: c.track }]}>
              <View style={[styles.progressFill, { backgroundColor: levelColor, width: `${progress * 100}%` }]} />
            </View>
          )}
        </View>

        <View style={[styles.card, styles.streakCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={styles.streakFlame}>🔥</Text>
          <View>
            <Text style={[styles.streakCount, { color: c.text }]}>
              {gami?.current_streak ? `${gami.current_streak}-day streak` : 'No active streak'}
            </Text>
            <Text style={[styles.note, { color: c.muted }]}>
              {gami?.current_streak
                ? "Deliver something today to keep it going."
                : 'Complete a delivery today to start one.'}
            </Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: c.text }]}>Badges</Text>
        <View style={styles.badgeGrid}>
          {ALL_BADGE_CODES.map((code) => {
            const meta = BADGE_META[code];
            const earnedAt = earnedByCode.get(code);
            return (
              <View
                key={code}
                style={[
                  styles.badgeCard, { backgroundColor: c.card, borderColor: c.border },
                  !earnedAt && styles.badgeCardLocked,
                ]}
              >
                <Text style={[styles.badgeIcon, !earnedAt && styles.badgeIconLocked]}>{meta.icon}</Text>
                <Text style={[styles.badgeName, { color: c.text }]}>{meta.name}</Text>
                <Text style={[styles.badgeDescription, { color: c.muted }]}>{meta.description}</Text>
                {earnedAt && (
                  <Text style={[styles.badgeEarned, { color: BLUE }]}>
                    Earned {new Date(earnedAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },

  header: { alignItems: 'center', paddingVertical: 8, gap: 4 },
  avatar: { width: 72, height: 72, borderRadius: 36 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  name: { fontSize: 19, fontWeight: '800', marginTop: 8 },
  meta: { fontSize: 13 },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },

  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  levelBadge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  levelBadgeText: { fontSize: 20, fontWeight: '800' },
  levelLabel: { fontSize: 17, fontWeight: '800' },
  note: { fontSize: 12, marginTop: 2 },

  progressTrack: { height: 8, borderRadius: 4, marginTop: 14, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },

  streakCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  streakFlame: { fontSize: 32 },
  streakCount: { fontSize: 16, fontWeight: '800' },

  sectionTitle: { fontSize: 17, fontWeight: '800', marginTop: 6 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  badgeCard: {
    width: '47%', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    padding: 14, alignItems: 'center', gap: 4,
  },
  badgeCardLocked: { opacity: 0.4 },
  badgeIcon: { fontSize: 30 },
  badgeIconLocked: { opacity: 0.5 },
  badgeName: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  badgeDescription: { fontSize: 11, textAlign: 'center', lineHeight: 15 },
  badgeEarned: { fontSize: 10, fontWeight: '700', marginTop: 2 },
});
