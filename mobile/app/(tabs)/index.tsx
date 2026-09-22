import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useViewMode, type ViewMode } from '../../lib/view-mode';
import { CUSTOMER_COLOR, AGENT_COLOR } from '../../lib/colors';
import { ArviBubble } from '../../components/arvi-bubble';
import { GendLogo } from '../../components/gend-logo';

// Converts a '#rrggbb' hex color to an rgba() string at the given opacity —
// used for secondaryRow's border, which needs a translucent version of
// whichever accent color is active for the current mode.
function withOpacity(hex: string, opacity: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export default function HomeScreen() {
  const isDark = useColorScheme() === 'dark';
  const { mode, setMode } = useViewMode();
  const isDriver = mode === 'driver';
  const c = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    row: isDark ? '#111214' : '#f5f6f8',
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <View style={{ marginBottom: 20 }}>
          <GendLogo size={56} />
        </View>
        <Text style={[styles.logo, { color: c.text }]}>Gen-D</Text>
        <Text style={[styles.tagline, { color: c.muted }]}>
          flexible prices, delivered your way
        </Text>
      </View>

      <ModeToggle mode={mode} onChange={setMode} c={c} />

      {isDriver ? (
        <Pressable
          onPress={() => router.push('/wall')}
          style={({ pressed }) => [styles.hero, { backgroundColor: AGENT_COLOR }, pressed && styles.pressed]}
        >
          <Text style={styles.heroTitle}>Deliver or drive</Text>
          <Text style={styles.heroSubtitle}>Browse The Wall and start earning</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            onPress={() => router.push('/post-item')}
            style={({ pressed }) => [styles.hero, styles.heroSpacingTight, pressed && styles.pressed]}
          >
            <View style={styles.heroRow}>
              <MaterialIcons name="inventory-2" size={26} color="#ffffff" />
              <View style={styles.heroTextGroup}>
                <Text style={styles.heroTitle}>Post a parcel</Text>
                <Text style={styles.heroSubtitle}>Send something from point A to point B</Text>
              </View>
            </View>
          </Pressable>

          {/* Same destination as the parcel hero — ride booking now lives in
              post-item.tsx behind the orderType toggle, and that screen
              defaults to parcel mode regardless of entry point. Passing a
              param to pre-select ride mode would be a nice follow-up but is
              out of scope here. */}
          <Pressable
            onPress={() => router.push({ pathname: '/post-item', params: { type: 'ride' } })}
            style={({ pressed }) => [styles.hero, styles.rideHero, { backgroundColor: c.row }, pressed && styles.pressed]}
          >
            <View style={styles.heroRow}>
              <MaterialIcons name="two-wheeler" size={26} color={CUSTOMER_COLOR} />
              <View style={styles.heroTextGroup}>
                <Text style={[styles.heroTitle, { color: c.text }]}>Book a ride</Text>
                <Text style={[styles.heroSubtitle, { color: c.muted }]}>Get where you're going</Text>
              </View>
            </View>
          </Pressable>
        </>
      )}

      {isDriver ? (
        <Pressable
          onPress={() => router.push('/explore')}
          style={({ pressed }) => [
            styles.secondaryRow,
            { backgroundColor: c.row, borderColor: withOpacity(AGENT_COLOR, 0.35) },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.secondaryDot, { backgroundColor: AGENT_COLOR }]} />
          <View style={styles.secondaryTextGroup}>
            <Text style={[styles.secondaryTitle, { color: c.text }]}>Your progress</Text>
            <Text style={[styles.secondarySubtitle, { color: c.muted }]}>
              Level, streak &amp; badges
            </Text>
          </View>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.push('/my-orders')}
          style={({ pressed }) => [
            styles.secondaryRow,
            { backgroundColor: c.row, borderColor: withOpacity(CUSTOMER_COLOR, 0.35) },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.secondaryDot, { backgroundColor: CUSTOMER_COLOR }]} />
          <View style={styles.secondaryTextGroup}>
            <Text style={[styles.secondaryTitle, { color: c.text }]}>My orders</Text>
            <Text style={[styles.secondarySubtitle, { color: c.muted }]}>
              Track what you&apos;ve sent, review bids
            </Text>
          </View>
        </Pressable>
      )}

      <ArviBubble />
    </SafeAreaView>
  );
}

function ModeToggle({
  mode, onChange, c,
}: { mode: ViewMode; onChange: (mode: ViewMode) => void; c: { text: string; row: string } }) {
  return (
    <View style={[styles.modeRow, { backgroundColor: c.row }]}>
      <ModePill label="Customer" active={mode === 'customer'} color={CUSTOMER_COLOR} onPress={() => onChange('customer')} c={c} />
      <ModePill label="Agent" active={mode === 'driver'} color={AGENT_COLOR} onPress={() => onChange('driver')} c={c} />
    </View>
  );
}

function ModePill({
  label, active, color, onPress, c,
}: { label: string; active: boolean; color: string; onPress: () => void; c: { text: string } }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.modePill, active && { backgroundColor: color }]}
    >
      <Text style={[styles.modePillText, { color: active ? '#ffffff' : c.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { marginBottom: 32, alignItems: 'center' },
  logo: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { fontSize: 14, marginTop: 6 },

  modeRow: {
    flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4, marginBottom: 20,
  },
  modePill: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modePillText: { fontSize: 14, fontWeight: '700' },

  hero: {
    backgroundColor: CUSTOMER_COLOR,
    borderRadius: 22,
    paddingVertical: 30,
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  heroTitle: { fontSize: 24, fontWeight: '700', color: '#ffffff' },
  heroSubtitle: { fontSize: 14, color: '#dbe8fe', marginTop: 6 },

  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroTextGroup: { flex: 1 },
  heroSpacingTight: { marginBottom: 10 },
  rideHero: { borderWidth: 2, borderColor: CUSTOMER_COLOR },

    secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1.5,
    padding: 24,
    gap: 14,
  },
  secondaryDot: { width: 10, height: 10, borderRadius: 5 },
  secondaryTextGroup: { flex: 1 },
  secondaryTitle: { fontSize: 18, fontWeight: '700' },
  secondarySubtitle: { fontSize: 13, marginTop: 2 },

  pressed: { opacity: 0.85 },
});
