import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useViewMode, type ViewMode } from '../../lib/view-mode';

const BLUE = '#1877F2';   // Facebook blue — sending/posting
const AMBER = '#F59E0B';  // earning/delivering

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
        <View style={styles.routeDots}>
          <View style={[styles.dot, { backgroundColor: BLUE }]} />
          <View style={[styles.dotLine, { backgroundColor: c.muted }]} />
          <View style={[styles.dot, { backgroundColor: AMBER }]} />
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
          style={({ pressed }) => [styles.hero, { backgroundColor: AMBER }, pressed && styles.pressed]}
        >
          <Text style={styles.heroTitle}>Deliver a parcel</Text>
          <Text style={styles.heroSubtitle}>Browse The Wall and start earning</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={() => router.push('/post-item')}
          style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
        >
          <Text style={styles.heroTitle}>Post a parcel</Text>
          <Text style={styles.heroSubtitle}>Send something from point A to point B</Text>
        </Pressable>
      )}

      {isDriver ? (
        <Pressable
          onPress={() => router.push('/explore')}
          style={({ pressed }) => [
            styles.secondaryRow,
            { backgroundColor: c.row },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.secondaryDot, { backgroundColor: BLUE }]} />
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
            { backgroundColor: c.row },
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.secondaryDot, { backgroundColor: AMBER }]} />
          <View style={styles.secondaryTextGroup}>
            <Text style={[styles.secondaryTitle, { color: c.text }]}>My orders</Text>
            <Text style={[styles.secondarySubtitle, { color: c.muted }]}>
              Track what you&apos;ve sent, review bids
            </Text>
          </View>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function ModeToggle({
  mode, onChange, c,
}: { mode: ViewMode; onChange: (mode: ViewMode) => void; c: { text: string; row: string } }) {
  return (
    <View style={[styles.modeRow, { backgroundColor: c.row }]}>
      <ModePill label="Customer" active={mode === 'customer'} color={BLUE} onPress={() => onChange('customer')} c={c} />
      <ModePill label="Driver" active={mode === 'driver'} color={AMBER} onPress={() => onChange('driver')} c={c} />
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
  routeDots: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLine: { width: 40, height: 1.5, marginHorizontal: 6, opacity: 0.4 },
  logo: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { fontSize: 14, marginTop: 6 },

  modeRow: {
    flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4, marginBottom: 20,
  },
  modePill: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modePillText: { fontSize: 14, fontWeight: '700' },

  hero: {
    backgroundColor: BLUE,
    borderRadius: 22,
    paddingVertical: 30,
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  heroTitle: { fontSize: 24, fontWeight: '700', color: '#ffffff' },
  heroSubtitle: { fontSize: 14, color: '#dbe8fe', marginTop: 6 },

    secondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    padding: 24,
    gap: 14,
  },
  secondaryDot: { width: 10, height: 10, borderRadius: 5 },
  secondaryTextGroup: { flex: 1 },
  secondaryTitle: { fontSize: 18, fontWeight: '700' },
  secondarySubtitle: { fontSize: 13, marginTop: 2 },

  pressed: { opacity: 0.85 },
});
