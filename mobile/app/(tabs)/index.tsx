import { View, Text, Pressable, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

const BLUE = '#1877F2';   // Facebook blue — sending/posting
const AMBER = '#F59E0B';  // earning/delivering

export default function HomeScreen() {
  const isDark = useColorScheme() === 'dark';
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

      <Pressable
        onPress={() => router.push('/post-item')}
        style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
      >
        <Text style={styles.heroTitle}>Post a parcel</Text>
        <Text style={styles.heroSubtitle}>Send something from point A to point B</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/wall')}
        style={({ pressed }) => [
          styles.secondaryRow,
          { backgroundColor: c.row },
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.secondaryDot, { backgroundColor: AMBER }]} />
        <View style={styles.secondaryTextGroup}>
          <Text style={[styles.secondaryTitle, { color: c.text }]}>Deliver &amp; earn</Text>
          <Text style={[styles.secondarySubtitle, { color: c.muted }]}>
            Browse The Wall near you
          </Text>
        </View>
      </Pressable>

      <Pressable onPress={() => router.push('/login')}>
  <Text style={[styles.profileLink, { color: c.muted }]}>My profile &amp; orders (tap to test login)</Text>
</Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { marginBottom: 44, alignItems: 'center' },
  routeDots: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLine: { width: 40, height: 1.5, marginHorizontal: 6, opacity: 0.4 },
  logo: { fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { fontSize: 14, marginTop: 6 },

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

  profileLink: { fontSize: 13, textAlign: 'center', marginTop: 36 },
});