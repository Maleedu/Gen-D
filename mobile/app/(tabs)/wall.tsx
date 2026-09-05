import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { geocodeAddressOrThrow, getCurrentLocationOrThrow, LocationPermissionDeniedError } from '../../lib/location';

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
type WallMode = 'all' | 'on_my_way';

type Order = {
  id: string;
  item_description: string;
  item_category: string;
  photo_urls: string[];
  point_a_address: string;
  point_b_address: string;
  point_a_lat: number | null;
  point_a_lng: number | null;
  point_b_lat: number | null;
  point_b_lng: number | null;
  delivery_speed: DeliverySpeed;
  pricing_mode: PricingMode;
  price_paise: number | null;
  min_bid_paise: number | null;
  weight_kg: number;
  parcel_size: ParcelSize;
  created_at: string;
};

type Destination = { address: string; lat: number; lng: number };

type OrderWithDistance = Order & { distanceKm: number | null };

type Coords = { latitude: number; longitude: number };

type Palette = {
  bg: string; text: string; muted: string; inputBg: string;
  card: string; border: string; skeleton: string;
};

// "On My Way" corridor match radius, in km, from the route between the
// agent's current location and their declared destination — tiered by
// delivery speed since Super fast implies staying close to the agent's
// actual path, not just loosely "in the area." Kept as its own lookup since
// these are exactly the kind of numbers product will want tuned after
// seeing them in practice.
const ON_MY_WAY_RADIUS_KM: Record<DeliverySpeed, number> = {
  standard: 5,
  express: 5,
  super_fast: 2,
};

const SPEED_RANK: Record<DeliverySpeed, number> = { super_fast: 0, express: 1, standard: 2 };

const SPEED_META: Record<DeliverySpeed, { label: string; color: string }> = {
  super_fast: { label: 'Super fast', color: RED },
  express: { label: 'Express', color: AMBER },
  standard: { label: 'Standard', color: NEUTRAL },
};

const ORDER_COLUMNS =
  'id, item_description, item_category, photo_urls, point_a_address, point_b_address, ' +
  'point_a_lat, point_a_lng, point_b_lat, point_b_lng, delivery_speed, pricing_mode, ' +
  'price_paise, min_bid_paise, weight_kg, parcel_size, created_at';

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

type LatLng = { lat: number; lng: number };

// Perpendicular ("cross-track") distance in km from a point to the straight
// line segment between routeStart and routeEnd — not just the distance to
// whichever endpoint happens to be nearer. Projects all three points onto a
// flat plane around the segment's own mean latitude (scaling longitude by
// cos(latitude) so degrees-of-lng aren't treated as the same length as
// degrees-of-lat) and does ordinary 2D point-to-segment math. A full
// great-circle cross-track formula would be more exact, but for a few-
// hundred-km road corridor and a 5km threshold this flat approximation is
// well within tolerance, and it stays consistent with the plain-haversine
// level of rigor already used above.
function distanceToRouteKm(point: LatLng, routeStart: LatLng, routeEnd: LatLng): number {
  const refLatRad = ((routeStart.lat + routeEnd.lat) / 2) * (Math.PI / 180);
  const KM_PER_DEG_LAT = 111.32;
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos(refLatRad);

  const toXY = (p: LatLng) => ({ x: p.lng * kmPerDegLng, y: p.lat * KM_PER_DEG_LAT });
  const a = toXY(routeStart);
  const b = toXY(routeEnd);
  const p = toXY(point);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;

  // Degenerate route (current location === destination) — falls back to
  // plain point-to-point distance from routeStart.
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));

  const closestX = a.x + t * abx;
  const closestY = a.y + t * aby;
  return Math.hypot(p.x - closestX, p.y - closestY);
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
  // False until acquireLocation has settled once (granted or denied) — lets
  // "On My Way" tell "still checking permission" apart from "denied", instead
  // of treating a null coords the same way in both cases.
  const [coordsResolved, setCoordsResolved] = useState(false);

  const [orders, setOrders] = useState<OrderWithDistance[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<WallMode>('all');
  // The agent's declared destination — loaded from profiles.active_destination_*
  // (11_agent_destination.sql) so it survives app restarts, not just local
  // screen state.
  const [destination, setDestination] = useState<Destination | null>(null);
  const [destinationInput, setDestinationInput] = useState('');
  const [editingDestination, setEditingDestination] = useState(false);
  const [savingDestination, setSavingDestination] = useState(false);
  const [locatingDestination, setLocatingDestination] = useState(false);

  const [bidDrafts, setBidDrafts] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  // This agent's own existing bid per order (order_id -> offer_paise). bids
  // has a unique(order_id, agent_id) constraint and handleBid upserts on
  // that same pair, so a second submission updates the one row rather than
  // creating another — a bid is never final. This is what lets the card
  // show "You bid ₹X" instead of just going silent after the alert closes.
  const [myBids, setMyBids] = useState<Record<string, number>>({});
  // Highest standing offer_paise per order, across every agent — not just
  // this agent's own. Needed for the real ascending-auction floor
  // (25_enforce_ascending_bid.sql enforces the same max(min_bid_paise,
  // highest offer) rule server-side) and so the input can show the real
  // current floor instead of the order's original minimum, which becomes
  // misleading the moment anyone's bid clears it. Sourced from the
  // highest_bids_for_orders RPC, not a plain select — RLS on bids only
  // lets an agent see their own rows, by design.
  const [highestBids, setHighestBids] = useState<Record<string, number>>({});

  const coordsRef = useRef<Coords | null>(null);
  useEffect(() => {
    coordsRef.current = coords;
  }, [coords]);

  async function acquireLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setLocationDenied(false);
    } catch {
      setLocationDenied(true);
    } finally {
      setCoordsResolved(true);
    }
  }

  // Current highest offer per order, across every agent, via the
  // highest_bids_for_orders RPC (see 25_enforce_ascending_bid.sql for why
  // this can't be a plain select). Merges into existing state rather than
  // replacing it wholesale, so a bid this agent just placed (see handleBid's
  // optimistic update) isn't briefly clobbered by a refresh for an order
  // that's since dropped out of the visible list.
  const fetchHighestBids = useCallback(async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    const { data, error } = await supabase.rpc('highest_bids_for_orders', { p_order_ids: orderIds });
    if (error) return;
    setHighestBids((prev) => {
      const next = { ...prev };
      for (const row of data ?? []) next[row.order_id] = row.highest_offer_paise;
      return next;
    });
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await supabase.from('orders').select(ORDER_COLUMNS).eq('status', 'open');
    if (error) {
      setLoadError(error.message);
      setOrders([]);
      return;
    }
    const rows = (data ?? []) as unknown as Order[];
    setOrders(withDistance(rows, coordsRef.current));
    fetchHighestBids(rows.filter((o) => o.pricing_mode === 'auction').map((o) => o.id));
  }, [fetchHighestBids]);

  // Own bids only — RLS ("bids: agent manages own bid") wouldn't return
  // anyone else's anyway, but this is also all the card needs to know.
  // Prefills bidDrafts with the existing amount (rupees) wherever the agent
  // hasn't already typed something this session, so reopening the screen
  // shows an editable field seeded with their current bid, not a blank one.
  const fetchMyBids = useCallback(async () => {
    if (!agentId) return;
    const { data, error } = await supabase.from('bids').select('order_id, offer_paise').eq('agent_id', agentId);
    if (error) return;
    const byOrder: Record<string, number> = {};
    for (const row of data ?? []) byOrder[row.order_id] = row.offer_paise;
    setMyBids(byOrder);
    setBidDrafts((prev) => {
      const next = { ...prev };
      for (const [orderId, paise] of Object.entries(byOrder)) {
        if (next[orderId] === undefined) next[orderId] = String(paise / 100);
      }
      return next;
    });
  }, [agentId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchOrders(), fetchMyBids()]);
    setRefreshing(false);
  }, [fetchOrders, fetchMyBids]);

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProfileLoading(false);
        router.replace('/login');
        return;
      }
      setAgentId(user.id);
      const { data, error } = await supabase
        .from('profiles')
        .select('is_agent_verified, active_destination_address, active_destination_lat, active_destination_lng')
        .eq('id', user.id)
        .single();
      setProfileLoading(false);
      if (error) {
        setLoadError(error.message);
        return;
      }
      setVerified(!!data?.is_agent_verified);
      if (data?.active_destination_address && data.active_destination_lat != null && data.active_destination_lng != null) {
        setDestination({
          address: data.active_destination_address,
          lat: data.active_destination_lat,
          lng: data.active_destination_lng,
        });
        setDestinationInput(data.active_destination_address);
      }
    }
    loadProfile();
  }, []);

  useEffect(() => {
    if (!verified) return;
    async function startLoading() {
      await Promise.all([
        acquireLocation().then(() => fetchOrders()),
        fetchMyBids(),
      ]);
    }
    startLoading();
  }, [verified, fetchOrders, fetchMyBids]);

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
    router.push({ pathname: '/order/[id]', params: { id: order.id } });
  }

  function retryLocation() {
    setCoordsResolved(false);
    acquireLocation();
  }

  async function handleBid(order: OrderWithDistance) {
    if (!agentId) return;
    const raw = bidDrafts[order.id];
    const rupees = raw ? parseFloat(raw) : NaN;
    if (!raw || Number.isNaN(rupees) || rupees <= 0) {
      Alert.alert('Enter a bid amount');
      return;
    }
    const offerPaise = Math.round(rupees * 100);
    // Same rule the database now enforces (25_enforce_ascending_bid.sql):
    // a bid must strictly exceed the higher of the order's minimum and the
    // current highest standing offer — including this agent's own bid if
    // they're already leading, so they can't quietly lower it.
    const floorPaise = Math.max(order.min_bid_paise ?? 0, highestBids[order.id] ?? 0);
    if (floorPaise > 0 && offerPaise <= floorPaise) {
      Alert.alert(
        'Bid too low',
        `This order's current floor is ${formatRupees(floorPaise)}. Enter an amount above that.`,
      );
      return;
    }
    const isUpdate = myBids[order.id] != null;
    setBusyOrderId(order.id);
    const { error } = await supabase
      .from('bids')
      .upsert(
        { order_id: order.id, agent_id: agentId, offer_paise: offerPaise },
        { onConflict: 'order_id,agent_id' },
      );
    setBusyOrderId(null);
    if (error) {
      Alert.alert('Could not place bid', error.message);
      return;
    }
    setMyBids((prev) => ({ ...prev, [order.id]: offerPaise }));
    setHighestBids((prev) => ({ ...prev, [order.id]: Math.max(prev[order.id] ?? 0, offerPaise) }));
    Alert.alert(isUpdate ? 'Bid updated' : 'Bid placed', `You bid ₹${raw} on this order.`);
  }

  function selectMode(next: WallMode) {
    setMode(next);
    // First time into "On My Way" with nothing saved yet — open the form
    // immediately instead of switching to a tab that's just a prompt to tap
    // something else.
    if (next === 'on_my_way' && !destination) {
      setEditingDestination(true);
    }
  }

  // Persists the destination to profiles.active_destination_* (11_agent_destination.sql)
  // so it survives app restarts, then updates local state. Shared by both the
  // typed-address and "Use My Location" paths below.
  async function persistDestination(address: string, lat: number, lng: number): Promise<void> {
    if (!agentId) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        active_destination_address: address,
        active_destination_lat: lat,
        active_destination_lng: lng,
        active_destination_set_at: new Date().toISOString(),
      })
      .eq('id', agentId);
    if (error) {
      Alert.alert("Couldn't save destination", error.message);
      return;
    }
    setDestination({ address, lat, lng });
    setEditingDestination(false);
  }

  async function handleSetDestination() {
    const address = destinationInput.trim();
    if (!address) {
      Alert.alert('Enter a destination', "Type where you're headed, or use your current location.");
      return;
    }
    setSavingDestination(true);
    try {
      const { lat, lng } = await geocodeAddressOrThrow('destination', address);
      await persistDestination(address, lat, lng);
    } catch (err) {
      Alert.alert('Could not set destination', err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDestination(false);
    }
  }

  // Coordinates come straight from the device fix — stored as-is, same as
  // Point A on Post Item, rather than round-tripped back through geocoding.
  async function handleUseCurrentLocationForDestination() {
    setLocatingDestination(true);
    try {
      const { lat, lng, label } = await getCurrentLocationOrThrow();
      setDestinationInput(label);
      await persistDestination(label, lat, lng);
    } catch (err) {
      if (err instanceof LocationPermissionDeniedError) {
        Alert.alert(
          'Location access needed',
          'Enable location access for Gen-D in your device settings to use this, or type your destination in manually.',
        );
      } else {
        Alert.alert(
          "Couldn't get your location",
          'Check that location services are on and try again, or type your destination in manually.',
        );
      }
    } finally {
      setLocatingDestination(false);
    }
  }

  // "On My Way" is a route corridor, not a single point: both pickup and
  // dropoff have to fall within that speed tier's ON_MY_WAY_RADIUS_KM of the
  // straight line between the agent's current location and their declared
  // destination, so an agent going Bangalore → Hyderabad can pick up jobs
  // anywhere along that road, not just ones clustered right next to
  // Hyderabad. All three speed tiers are included — Super fast just gets the
  // tighter radius, since it implies staying close to the agent's actual
  // path rather than loosely "in the area." Needs both coords (current
  // location) and destination — see the coordsResolved/locationDenied
  // gating in the render below for what happens when coords isn't
  // available. Orders missing either coordinate (pre-23_order_dropoff_coordinates.sql
  // seed rows have no dropoff) can't be measured, so they're excluded rather
  // than guessed at.
  const visibleOrders = useMemo(() => {
    if (mode === 'all' || !orders) return orders;
    if (!destination || !coords) return [];
    const routeStart: LatLng = { lat: coords.latitude, lng: coords.longitude };
    const routeEnd: LatLng = { lat: destination.lat, lng: destination.lng };
    return orders.filter((o) => {
      if (o.point_a_lat == null || o.point_a_lng == null || o.point_b_lat == null || o.point_b_lng == null) {
        return false;
      }
      const radiusKm = ON_MY_WAY_RADIUS_KM[o.delivery_speed];
      const pickupDistance = distanceToRouteKm({ lat: o.point_a_lat, lng: o.point_a_lng }, routeStart, routeEnd);
      const dropoffDistance = distanceToRouteKm({ lat: o.point_b_lat, lng: o.point_b_lng }, routeStart, routeEnd);
      return pickupDistance <= radiusKm && dropoffDistance <= radiusKm;
    });
  }, [mode, orders, destination, coords]);

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

      <View style={styles.modeRow}>
        <ModePill label="Browse All" active={mode === 'all'} onPress={() => selectMode('all')} c={c} />
        <ModePill label="On My Way" active={mode === 'on_my_way'} onPress={() => selectMode('on_my_way')} c={c} />
      </View>

      {mode === 'on_my_way' && (
        destination && !editingDestination ? (
          <View style={[styles.destinationBanner, { backgroundColor: c.inputBg, borderColor: c.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.destinationBannerText, { color: c.text }]} numberOfLines={1}>
                🎯 On your way to <Text style={{ fontWeight: '700' }}>{destination.address}</Text>
              </Text>
              <Text style={[styles.destinationBannerSubtext, { color: c.muted }]}>
                Orders along your route · Super fast must be within {ON_MY_WAY_RADIUS_KM.super_fast} km
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setDestinationInput(destination.address);
                setEditingDestination(true);
              }}
              hitSlop={8}
            >
              <Text style={styles.changeDestinationText}>Change</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.destinationForm, { backgroundColor: c.inputBg, borderColor: c.border }]}>
            <Text style={[styles.destinationPrompt, { color: c.text }]}>Where are you headed?</Text>
            <Text style={[styles.destinationHint, { color: c.muted }]}>
              We&apos;ll show orders with both pickup and dropoff within {ON_MY_WAY_RADIUS_KM.standard} km
              of the route between your current location and here (Super fast has to stay within{' '}
              {ON_MY_WAY_RADIUS_KM.super_fast} km).
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.bg, color: c.text, marginTop: 10 }]}
              value={destinationInput}
              onChangeText={setDestinationInput}
              placeholder="e.g. Whitefield, Bengaluru"
              placeholderTextColor={c.muted}
            />
            <View style={styles.destinationActions}>
              <Pressable
                onPress={handleUseCurrentLocationForDestination}
                disabled={locatingDestination || savingDestination}
                hitSlop={8}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                {locatingDestination ? (
                  <ActivityIndicator size="small" color={BLUE} />
                ) : (
                  <Text style={styles.locateButtonText}>📍 Use My Location</Text>
                )}
              </Pressable>
              <Pressable
                onPress={handleSetDestination}
                disabled={savingDestination || locatingDestination}
                style={({ pressed }) => [
                  styles.setDestinationButton,
                  (pressed || savingDestination || locatingDestination) && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.setDestinationButtonText}>{savingDestination ? 'Setting…' : 'Set'}</Text>
              </Pressable>
            </View>
            {destination && (
              <Pressable onPress={() => setEditingDestination(false)} hitSlop={8} style={{ marginTop: 12 }}>
                <Text style={[styles.cancelDestinationText, { color: c.muted }]}>Cancel</Text>
              </Pressable>
            )}
          </View>
        )
      )}

      {mode === 'on_my_way' && !destination ? null : mode === 'on_my_way' && !coordsResolved ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
          <Text style={[styles.locationWaitText, { color: c.muted }]}>Finding your current location…</Text>
        </View>
      ) : mode === 'on_my_way' && !coords ? (
        <View style={styles.centerFill}>
          <Text style={[styles.kycTitle, { color: c.text }]}>Location needed</Text>
          <Text style={[styles.kycBody, { color: c.muted }]}>
            On My Way matches orders against the route from where you are now — enable location
            access for Gen-D to use it.
          </Text>
          <Pressable onPress={retryLocation} style={styles.setDestinationButton}>
            <Text style={styles.setDestinationButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : orders === null ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => <SkeletonCard key={i} c={c} />)}
        </View>
      ) : (
        <FlatList
          data={mode === 'on_my_way' ? visibleOrders ?? [] : orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />
          }
          ListEmptyComponent={
            <View style={styles.centerFill}>
              <Text style={{ color: c.muted, fontSize: 15 }}>
                {loadError
                  ? loadError
                  : mode === 'on_my_way'
                    ? 'No open orders along your route to your destination right now.'
                    : 'No open orders near you right now.'}
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
              myBidPaise={myBids[item.id] ?? null}
              highestBidPaise={highestBids[item.id] ?? null}
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

function ModePill({
  label, active, onPress, c,
}: { label: string; active: boolean; onPress: () => void; c: Palette }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.modePill,
        { borderColor: active ? BLUE : c.border, backgroundColor: active ? `${BLUE}22` : c.inputBg },
      ]}
    >
      <Text style={[styles.modePillText, { color: active ? BLUE : c.text }]}>{label}</Text>
    </Pressable>
  );
}

function SkeletonCard({ c }: { c: Palette }) {
  const [pulse] = useState(() => new Animated.Value(0.4));

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
  order, c, fontsLoaded, busy, bidValue, myBidPaise, highestBidPaise, onBidChange, onAccept, onBid,
}: {
  order: OrderWithDistance;
  c: Palette;
  fontsLoaded: boolean;
  busy: boolean;
  bidValue: string;
  myBidPaise: number | null;
  highestBidPaise: number | null;
  onBidChange: (v: string) => void;
  onAccept: (order: OrderWithDistance) => void;
  onBid: (order: OrderWithDistance) => void;
}) {
  const speedMeta = SPEED_META[order.delivery_speed];
  const photo = order.photo_urls?.[0];
  // The real current floor a new bid has to clear — the order's minimum
  // until anyone's bid clears it, then whatever the highest standing bid
  // is (25_enforce_ascending_bid.sql enforces this same number server-side).
  const bidFloorPaise = Math.max(order.min_bid_paise ?? 0, highestBidPaise ?? 0);

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

      {order.pricing_mode === 'auction' && (myBidPaise != null || highestBidPaise != null) && (
        <Text style={[styles.myBidNote, { color: c.muted }]}>
          {myBidPaise != null && highestBidPaise != null && myBidPaise >= highestBidPaise
            ? `You bid ${formatRupees(myBidPaise)} — currently the highest · tap Update to raise`
            : myBidPaise != null
              ? `You bid ${formatRupees(myBidPaise)} — outbid, current highest is ${formatRupees(highestBidPaise)}`
              : `Current highest: ${formatRupees(highestBidPaise)} · your bid must exceed this`}
        </Text>
      )}

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
              placeholder={bidFloorPaise > 0 ? `More than ₹${Math.round(bidFloorPaise / 100)}` : '₹ your bid'}
              placeholderTextColor={c.muted}
              value={bidValue}
              onChangeText={onBidChange}
            />
            <Pressable
              style={({ pressed }) => [styles.actionButton, (pressed || busy) && { opacity: 0.7 }]}
              onPress={() => onBid(order)}
              disabled={busy}
            >
              <Text style={styles.actionButtonText}>
                {busy ? (myBidPaise != null ? 'Updating…' : 'Bidding…') : myBidPaise != null ? 'Update' : 'Bid'}
              </Text>
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

  modeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 12 },
  modePill: { flex: 1, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, alignItems: 'center' },
  modePillText: { fontSize: 13, fontWeight: '700' },

  destinationBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  destinationBannerText: { fontSize: 14 },
  destinationBannerSubtext: { fontSize: 12, marginTop: 2 },
  changeDestinationText: { color: BLUE, fontWeight: '700', fontSize: 13 },

  destinationForm: {
    marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
  },
  destinationPrompt: { fontSize: 15, fontWeight: '700' },
  destinationHint: { fontSize: 12, marginTop: 4, lineHeight: 17 },
  destinationActions: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
  },
  cancelDestinationText: { fontSize: 12, fontWeight: '600' },

  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  locateButtonText: { fontSize: 12, fontWeight: '700', color: BLUE },
  setDestinationButton: { backgroundColor: BLUE, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 9 },
  setDestinationButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },

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

  myBidNote: { fontSize: 12, fontWeight: '600', paddingHorizontal: 12, paddingTop: 10 },

  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  price: { fontSize: 18, fontWeight: '800' },
  bidInput: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  actionButton: { backgroundColor: BLUE, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11 },
  actionButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },

  kycTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  kycBody: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
  locationWaitText: { fontSize: 14, marginTop: 12 },

  skeletonBadge: { width: 90, height: 22, borderRadius: 20, margin: 12, marginBottom: 0 },
  skeletonPhoto: { width: '100%', aspectRatio: 4 / 3, marginTop: 12 },
  skeletonLine: { height: 13, borderRadius: 6, marginVertical: 4 },
});
