import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  FlatList, RefreshControl, TextInput, Animated, Easing, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import {
  useFonts,
  SpaceGrotesk_700Bold,
  SpaceGrotesk_600SemiBold,
} from '@expo-google-fonts/space-grotesk';
import { supabase } from '../../lib/supabase';

const BLUE = '#1877F2';
const RED = '#E41E3F';
const AMBER = '#B7791F';
const NEUTRAL = '#6b7280';

// Applied once these load; renders with the system font until then (no
// splash-screen gating — this is a cosmetic upgrade, not a blocking one).
const HEADING_FONT_BOLD = 'SpaceGrotesk_700Bold';
const HEADING_FONT_SEMIBOLD = 'SpaceGrotesk_600SemiBold';

type DeliverySpeed = 'super_fast' | 'express' | 'standard';
type PricingMode = 'fixed' | 'auction';
type ParcelSize = 'small' | 'medium' | 'large';

type Order = {
  id: string;
  item_description: string;
  item_category: string;
  photo_urls: string[];
  point_a_address: string;
  point_b_address: string;
  point_a_lat: number | null;
  point_a_lng: number | null;
  delivery_speed: DeliverySpeed;
  pricing_mode: PricingMode;
  price_paise: number | null;
  min_bid_paise: number | null;
  weight_kg: number;
  parcel_size: ParcelSize;
  created_at: string;
};

type OrderWithDistance = Order & { distanceKm: number | null };

type Coords = { latitude: number; longitude: number };

type Palette = {
  bg: string; text: string; muted: string; inputBg: string;
  card: string; border: string; skeleton: string;
};

const SPEED_RANK: Record<DeliverySpeed, number> = { super_fast: 0, express: 1, standard: 2 };

const SPEED_META: Record<DeliverySpeed, { label: string; color: string }> = {
  super_fast: { label: 'Super fast', color: RED },
  express: { label: 'Express', color: AMBER },
  standard: { label: 'Standard', color: NEUTRAL },
};

const ORDER_COLUMNS =
  'id, item_description, item_category, photo_urls, point_a_address, point_b_address, ' +
  'point_a_lat, point_a_lng, delivery_speed, pricing_mode, price_paise, min_bid_paise, ' +
  'weight_kg, parcel_size, created_at';

const PARCEL_SIZE_LABEL: Record<ParcelSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

function formatWeight(kg: number) {
  return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withDistance(rows: Order[], coords: Coords | null): OrderWithDistance[] {
  return rows
    .map((o) => ({
      ...o,
      distanceKm:
        coords && o.point_a_lat != null && o.point_a_lng != null
          ? haversineKm(coords.latitude, coords.longitude, o.point_a_lat, o.point_a_lng)
          : null,
    }))
    .sort((a, b) => {
      const da = a.distanceKm ?? Infinity;
      const db = b.distanceKm ?? Infinity;
      if (da !== db) return da - db;
      return SPEED_RANK[a.delivery_speed] - SPEED_RANK[b.delivery_speed];
    });
}

function formatRupees(paise: number | null) {
  if (paise == null) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function formatDistance(km: number | null) {
  if (km == null) return '—';
  return km < 1 ? `${Math.round(km * 1000)} m away` : `${km.toFixed(1)} km away`;
}

export default function WallScreen() {
  const isDark = useColorScheme() === 'dark';
  const [fontsLoaded] = useFonts({ SpaceGrotesk_700Bold, SpaceGrotesk_600SemiBold });
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#1a1a1a' : '#f5f6f8',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
    skeleton: isDark ? '#232326' : '#e9ebee',
  };

  const [agentId, setAgentId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [verified, setVerified] = useState<boolean | null>(null);

  const [coords, setCoords] = useState<Coords | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  const [orders, setOrders] = useState<OrderWithDistance[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [bidDrafts, setBidDrafts] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const coordsRef = useRef<Coords | null>(null);
  coordsRef.current = coords;

  async function loadProfile() {
    setProfileLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setProfileLoading(false);
      router.replace('/login');
      return;
    }
    setAgentId(user.id);
    const { data, error } = await supabase
      .from('profiles')
      .select('is_agent_verified')
      .eq('id', user.id)
      .single();
    setProfileLoading(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setVerified(!!data?.is_agent_verified);
  }

  async function acquireLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      setLocationDenied(true);
    }
  }

  const fetchOrders = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.from('orders').select(ORDER_COLUMNS).eq('status', 'open');
    if (error) {
      setLoadError(error.message);
      setOrders([]);
      return;
    }
    setOrders(withDistance((data ?? []) as unknown as Order[], coordsRef.current));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
  }, [fetchOrders]);

  useEffect(() => {
    loadProfile();
  }, []);

  useEffect(() => {
    if (verified) {
      acquireLocation().then(() => fetchOrders());
    }
  }, [verified, fetchOrders]);

  async function handleAccept(order: OrderWithDistance) {
    if (!agentId) return;
    setBusyOrderId(order.id);
    const { data, error } = await supabase
      .from('orders')
      .update({ accepted_agent_id: agentId, status: 'accepted' })
      .eq('id', order.id)
      .eq('status', 'open')
      .select('id');
    setBusyOrderId(null);

    if (error) {
      Alert.alert("Can't accept this order", error.message);
      return;
    }
    if (!data || data.length === 0) {
      Alert.alert('Too late', 'Someone else already accepted this order.');
      fetchOrders();
      return;
    }
    setOrders((prev) => (prev ? prev.filter((o) => o.id !== order.id) : prev));
  }

  async function handleBid(order: OrderWithDistance) {
    if (!agentId) return;
    const raw = bidDrafts[order.id];
    const rupees = raw ? parseFloat(raw) : NaN;
    if (!raw || Number.isNaN(rupees) || rupees <= 0) {
      Alert.alert('Enter a bid amount');
      return;
    }
    setBusyOrderId(order.id);
    const { error } = await supabase
      .from('bids')
      .upsert(
        { order_id: order.id, agent_id: agentId, offer_paise: Math.round(rupees * 100) },
        { onConflict: 'order_id,agent_id' },
      );
    setBusyOrderId(null);
    if (error) {
      Alert.alert('Could not place bid', error.message);
      return;
    }
    Alert.alert('Bid placed', `You bid ₹${raw} on this order.`);
  }

  if (profileLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
        </View>
      </SafeAreaView>
    );
  }

  if (verified === false) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centerFill}>
          <Text style={[styles.kycTitle, { color: c.text }]}>Complete KYC to accept orders</Text>
          <Text style={[styles.kycBody, { color: c.muted }]}>
            Your agent profile isn&apos;t verified yet. Once your documents are reviewed and
            approved, open orders will appear here for you to accept.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: c.text }, fontsLoaded && { fontFamily: HEADING_FONT_BOLD }]}>
          The Wall
        </Text>
        {locationDenied && (
          <Text style={[styles.headerNote, { color: c.muted }]}>
            Enable location to sort orders by distance
          </Text>
        )}
      </View>

      {orders === null ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => <SkeletonCard key={i} c={c} />)}
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />
          }
          ListEmptyComponent={
            <View style={styles.centerFill}>
              <Text style={{ color: c.muted, fontSize: 15 }}>
                {loadError ? loadError : 'No open orders near you right now.'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              c={c}
              fontsLoaded={fontsLoaded}
              busy={busyOrderId === item.id}
              bidValue={bidDrafts[item.id] ?? ''}
              onBidChange={(v) => setBidDrafts((prev) => ({ ...prev, [item.id]: v }))}
              onAccept={handleAccept}
              onBid={handleBid}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function SkeletonCard({ c }: { c: Palette }) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Animated.View style={[styles.skeletonBadge, { backgroundColor: c.skeleton, opacity: pulse }]} />
      <Animated.View style={[styles.skeletonPhoto, { backgroundColor: c.skeleton, opacity: pulse }]} />
      <View style={styles.body}>
        <Animated.View style={[styles.skeletonLine, { backgroundColor: c.skeleton, opacity: pulse, width: '85%' }]} />
        <Animated.View style={[styles.skeletonLine, { backgroundColor: c.skeleton, opacity: pulse, width: '95%' }]} />
        <Animated.View style={[styles.skeletonLine, { backgroundColor: c.skeleton, opacity: pulse, width: '50%' }]} />
      </View>
    </View>
  );
}

function OrderCard({
  order, c, fontsLoaded, busy, bidValue, onBidChange, onAccept, onBid,
}: {
  order: OrderWithDistance;
  c: Palette;
  fontsLoaded: boolean;
  busy: boolean;
  bidValue: string;
  onBidChange: (v: string) => void;
  onAccept: (order: OrderWithDistance) => void;
  onBid: (order: OrderWithDistance) => void;
}) {
  const speedMeta = SPEED_META[order.delivery_speed];
  const photo = order.photo_urls?.[0];

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.metaRow}>
        <View style={[styles.badge, { backgroundColor: `${speedMeta.color}22` }]}>
          <Text style={[styles.badgeText, { color: speedMeta.color }]}>{speedMeta.label}</Text>
        </View>
        <Text style={[styles.distanceText, { color: c.muted }]}>{formatDistance(order.distanceKm)}</Text>
      </View>

      {photo ? (
        <Image source={{ uri: photo }} style={styles.photo} contentFit="cover" transition={150} />
      ) : null}

      <View style={styles.body}>
        <Text
          style={[styles.route, { color: c.text }, fontsLoaded && { fontFamily: HEADING_FONT_BOLD }]}
          numberOfLines={2}
        >
          {order.point_a_address} <Text style={{ color: c.muted }}>→</Text> {order.point_b_address}
        </Text>
        <Text style={[styles.description, { color: c.muted }]} numberOfLines={3}>
          {order.item_description}
        </Text>
        <View style={styles.tagRow}>
          <View style={[styles.badge, styles.categoryBadge, { backgroundColor: `${NEUTRAL}22` }]}>
            <Text
              style={[styles.badgeText, { color: NEUTRAL }, fontsLoaded && { fontFamily: HEADING_FONT_SEMIBOLD }]}
            >
              {order.item_category.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.parcelMeta, { color: c.muted }]}>
            {formatWeight(order.weight_kg)} · {PARCEL_SIZE_LABEL[order.parcel_size]}
          </Text>
        </View>
      </View>

      <View style={[styles.actionRow, { borderTopColor: c.border }]}>
        {order.pricing_mode === 'fixed' ? (
          <>
            <Text style={[styles.price, { color: c.text }]}>{formatRupees(order.price_paise)}</Text>
            <Pressable
              style={({ pressed }) => [styles.actionButton, (pressed || busy) && { opacity: 0.7 }]}
              onPress={() => onAccept(order)}
              disabled={busy}
            >
              <Text style={styles.actionButtonText}>{busy ? 'Accepting…' : 'Accept'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={[styles.bidInput, { backgroundColor: c.inputBg, color: c.text }]}
              keyboardType="decimal-pad"
              placeholder={order.min_bid_paise ? `Min ₹${Math.round(order.min_bid_paise / 100)}` : '₹ your bid'}
              placeholderTextColor={c.muted}
              value={bidValue}
              onChangeText={onBidChange}
            />
            <Pressable
              style={({ pressed }) => [styles.actionButton, (pressed || busy) && { opacity: 0.7 }]}
              onPress={() => onBid(order)}
              disabled={busy}
            >
              <Text style={styles.actionButtonText}>{busy ? 'Bidding…' : 'Bid'}</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  headerNote: { fontSize: 12, marginTop: 4 },
  list: { padding: 16, paddingBottom: 40, gap: 16, flexGrow: 1 },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },

  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  distanceText: { fontSize: 13, fontWeight: '600' },

  photo: { width: '100%', aspectRatio: 4 / 3, backgroundColor: '#00000010' },

  body: { padding: 12, gap: 4 },
  route: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, lineHeight: 22 },
  description: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  categoryBadge: { alignSelf: 'flex-start' },
  parcelMeta: { fontSize: 12, fontWeight: '600' },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  price: { fontSize: 18, fontWeight: '800' },
  bidInput: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  actionButton: { backgroundColor: BLUE, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11 },
  actionButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  kycTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  kycBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  skeletonBadge: { width: 90, height: 22, borderRadius: 20, margin: 12, marginBottom: 0 },
  skeletonPhoto: { width: '100%', aspectRatio: 4 / 3, marginTop: 12 },
  skeletonLine: { height: 13, borderRadius: 6, marginVertical: 4 },
});
