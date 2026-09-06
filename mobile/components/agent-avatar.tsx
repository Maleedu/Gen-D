import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

// Shared by any screen that shows an agent's avatar with the same
// initials-on-a-colored-circle fallback when avatar_url is null — Order
// Tracking's AgentCard and the customer's bid-review view (My Orders) both
// use this rather than each reimplementing the fallback.
export function initials(firstName: string, lastName: string) {
  const s = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();
  return s || '?';
}

export function AgentAvatar({
  firstName, lastName, avatarUrl, size = 56, color = '#1877F2',
}: {
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  size?: number;
  color?: string;
}) {
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }
  return (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={[styles.fallbackText, { fontSize: size * 0.32 }]}>{initials(firstName, lastName)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#ffffff', fontWeight: '800' },
});
