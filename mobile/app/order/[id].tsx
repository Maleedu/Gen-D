import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  ActivityIndicator, ScrollView, RefreshControl, TextInput, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { fetchGamificationProfile, LEVEL_COLOR } from '../../lib/gamification';

const BLUE = '#1877F2';
const RED = '#E41E3F';
const AMBER = '#B7791F';
const GREEN = '#1F9254';
const NEUTRAL = '#6b7280';

type OrderStatus = 'open' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';
type DeliverySpeed = 'standard' | 'express' | 'super_fast';
type PricingMode = 'fixed' | 'auction';
type VehicleType = 'bike' | 'car' | 'bus' | 'other' | 'none';
type SealStatus = 'intact' | 'broken';
type ComplaintStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
type Role = 'customer' | 'agent';

type Order = {
  id: string;
  customer_id: string;
  accepted_agent_id: string | null;
  status: OrderStatus;
  item_description: string;
  item_category: string;
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
};

type AgentProfile = {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  avatar_url: string | null;
  avg_rating_as_agent: number | null;
  completed_deliveries_count: number;
  vehicle_type: VehicleType | null;
  registration_number: string | null;
  // Optional: absent while the gamification RPC is still loading, or if it
  // fails — the card renders fine without these, they're an accent only
  // (see the agent-gamification handover doc, "Where this shows").
  level_number?: number;
  level_label?: string;
  current_streak?: number;
};

type Palette = {
  bg: string; text: string; muted: string; inputBg: string;
  card: string; border: string;
};

const ORDER_COLUMNS =
  'id, customer_id, accepted_agent_id, status, item_description, item_category, ' +
  'point_a_address, point_b_address, point_a_lat, point_a_lng, point_b_lat, point_b_lng, ' +
  'delivery_speed, pricing_mode, price_paise, min_bid_paise';

const SPEED_META: Record<DeliverySpeed, { label: string; color: string }> = {
  super_fast: { label: 'Super fast', color: RED },
  express: { label: 'Express', color: AMBER },
  standard: { label: 'Standard', color: NEUTRAL },
};

const STATUS_META: Record<OrderStatus, { label: string; color: string }> = {
  open: { label: 'Waiting for an agent', color: AMBER },
  accepted: { label: 'Agent assigned', color: BLUE },
  picked_up: { label: 'Picked up · en route', color: BLUE },
  delivered: { label: 'Delivered', color: GREEN },
  cancelled: { label: 'Cancelled', color: NEUTRAL },
};

const VEHICLE_LABEL: Record<VehicleType, string> = {
  bike: '🏍️ Bike', car: '🚗 Car', bus: '🚌 Bus', other: '📦 Other vehicle', none: '',
};

function formatRupees(paise: number | null) {
  if (paise == null) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

// Deep link format locked in the handover doc — works without any Maps SDK
// or API key, and opens whatever maps app the device already has set as
// default for a `https://` link.
function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

function initials(firstName: string, lastName: string) {
  const s = `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();
  return s || '?';
}

export default function OrderTrackingScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const orderId = Array.isArray(params.id) ? params.id[0] : params.id;

  const isDark = useColorScheme() === 'dark';
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#1a1a1a' : '#f5f6f8',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
  };

  const [order, setOrder] = useState<Order | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Only ever populated for the customer — the agent view never shows a
  // card for themselves (see the handover doc's per-role table).
  const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);

  const [otp, setOtp] = useState<string | null>(null);
  const [revealingOtp, setRevealingOtp] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  // Whether a delivery_photos row exists for this order — gates the
  // customer's seal-check buttons (verify_delivery_seal hard-rejects until
  // one exists) and tells the agent whether their submission already went
  // through. Null until the first check resolves.
  const [photoExists, setPhotoExists] = useState<boolean | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [sealSubmitting, setSealSubmitting] = useState<SealStatus | null>(null);

  const [sealResult, setSealResult] = useState<SealStatus | null>(null);
  const [complaintStatus, setComplaintStatus] = useState<ComplaintStatus | null>(null);

  // Realtime callbacks are set up once (see the subscription effect below)
  // but need the latest role without resubscribing every render.
  const roleRef = useRef<Role | null>(null);
  roleRef.current = role;

  const loadAgentProfile = useCallback(async (agentId: string) => {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, phone_number, avatar_url, avg_rating_as_agent, completed_deliveries_count')
      .eq('id', agentId)
      .maybeSingle();
    if (error || !profile) return;
    const { data: vehicle } = await supabase
      .from('agent_vehicles')
      .select('vehicle_type, registration_number')
      .eq('profile_id', agentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setAgentProfile({
      ...profile,
      vehicle_type: (vehicle?.vehicle_type as VehicleType) ?? null,
      registration_number: vehicle?.registration_number ?? null,
    });
    // Small accent only (level + streak) — the dedicated stats screen is
    // where the agent sees their own full gamification picture, including
    // badges. Fetched separately so a slow/failed call never blocks the
    // rest of the card from showing.
    const gami = await fetchGamificationProfile(agentId);
    if (gami) {
      setAgentProfile((prev) =>
        prev ? { ...prev, level_number: gami.level_number, level_label: gami.level_label, current_streak: gami.current_streak } : prev,
      );
    }
  }, []);

  const checkPhotoExists = useCallback(async () => {
    if (!orderId) return;
    const { data } = await supabase.from('delivery_photos').select('order_id').eq('order_id', orderId).maybeSingle();
    setPhotoExists(!!data);
  }, [orderId]);

  const loadDeliveredSummary = useCallback(async () => {
    if (!orderId) return;
    const [{ data: verification }, { data: complaint }] = await Promise.all([
      supabase.from('delivery_verifications').select('seal_status').eq('order_id', orderId).maybeSingle(),
      supabase
        .from('complaints')
        .select('status')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setSealResult((verification?.seal_status as SealStatus) ?? null);
    setComplaintStatus((complaint?.status as ComplaintStatus) ?? null);
  }, [orderId]);

  const loadEverything = useCallback(async () => {
    if (!orderId) return;
    setLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login');
      return;
    }

    const { data, error } = await supabase.from('orders').select(ORDER_COLUMNS).eq('id', orderId).maybeSingle();
    if (error) {
      setLoadError(error.message);
      return;
    }
    if (!data) {
      setLoadError("This order doesn't exist, or you don't have access to it.");
      return;
    }
    const o = data as unknown as Order;

    let r: Role | null = null;
    if (o.customer_id === user.id) r = 'customer';
    else if (o.accepted_agent_id === user.id) r = 'agent';
    if (!r) {
      setLoadError("You don't have access to this order.");
      return;
    }

    setRole(r);
    setOrder(o);

    if (r === 'customer' && o.accepted_agent_id) loadAgentProfile(o.accepted_agent_id);
    if (o.status === 'picked_up') checkPhotoExists();
    if (o.status === 'delivered') loadDeliveredSummary();
  }, [orderId, loadAgentProfile, checkPhotoExists, loadDeliveredSummary]);

  useEffect(() => {
    setLoading(true);
    loadEverything().finally(() => setLoading(false));
  }, [loadEverything]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEverything();
    setRefreshing(false);
  }, [loadEverything]);

  // Subscribes to this order's own row so a status flip made by either RPC
  // (from this device or the other party's) updates the screen instantly,
  // plus a second feed for the delivery photo landing — see the handover
  // doc's realtime section.
  useEffect(() => {
    if (!orderId) return;
    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          const next = payload.new as Order;
          setOrder(next);
          if (roleRef.current === 'customer' && next.accepted_agent_id) loadAgentProfile(next.accepted_agent_id);
          if (next.status === 'picked_up') checkPhotoExists();
          if (next.status === 'delivered') loadDeliveredSummary();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'delivery_photos', filter: `order_id=eq.${orderId}` },
        () => setPhotoExists(true),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, loadAgentProfile, checkPhotoExists, loadDeliveredSummary]);

  async function handleRevealOtp() {
    if (!order) return;
    setRevealingOtp(true);
    const { data, error } = await supabase.rpc('get_pickup_otp', { p_order_id: order.id });
    setRevealingOtp(false);
    if (error) {
      Alert.alert("Couldn't get the pickup code", error.message);
      return;
    }
    setOtp(data as unknown as string);
  }

  async function handleVerifyOtp() {
    if (!order) return;
    const code = otpInput.trim();
    if (!code) {
      Alert.alert('Enter the code', 'Ask the customer to read out their pickup code.');
      return;
    }
    setVerifyingOtp(true);
    const { data, error } = await supabase.rpc('verify_pickup_otp', {
      p_order_id: order.id,
      p_submitted_otp: code,
    });
    setVerifyingOtp(false);
    if (error) {
      Alert.alert("Couldn't verify code", error.message);
      return;
    }
    if (!data) {
      Alert.alert('Incorrect code', 'Double check the code with the customer and try again.');
      return;
    }
    setOrder((prev) => (prev ? { ...prev, status: 'picked_up' } : prev));
    setOtpInput('');
  }

  async function captureAndSubmitPhoto(source: 'camera' | 'library') {
    if (!order) return;
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Camera access needed', 'Enable camera access to take a picture.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') {
          Alert.alert('Photo access needed', 'Enable photo library access to attach a picture.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
      }
      if (result.canceled || !result.assets?.[0]) return;

      setUploadingPhoto(true);
      const image = await ImageManipulator.manipulate(result.assets[0].uri).renderAsync();
      const jpeg = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });

      // delivery-photos is a private bucket (order participants + admin
      // only, per RLS) — store the storage path itself, not a public URL
      // that wouldn't actually resolve for a private bucket. Folder must be
      // the order id: that's what the bucket's own upload policy checks.
      const path = `${order.id}/${Date.now()}.jpg`;
      const fileData = await new File(jpeg.uri).arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('delivery-photos')
        .upload(path, fileData, { contentType: 'image/jpeg' });
      if (uploadError) throw new Error(uploadError.message);

      const { data, error } = await supabase.rpc('submit_delivery_photo', {
        p_order_id: order.id,
        p_photo_url: path,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Photo could not be recorded. Please try again.');

      setPhotoExists(true);
      Alert.alert('Photo submitted', 'Waiting for the customer to confirm the seal.');
    } catch (err) {
      Alert.alert("Couldn't submit photo", err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingPhoto(false);
    }
  }

  function pickDeliveryPhoto() {
    Alert.alert('Delivery photo', undefined, [
      { text: 'Take Photo', onPress: () => captureAndSubmitPhoto('camera') },
      { text: 'Choose from Library', onPress: () => captureAndSubmitPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function submitSeal(status: SealStatus) {
    if (!order) return;
    setSealSubmitting(status);
    const { data, error } = await supabase.rpc('verify_delivery_seal', {
      p_order_id: order.id,
      p_seal_status: status,
    });
    setSealSubmitting(null);
    if (error) {
      Alert.alert("Couldn't record seal check", error.message);
      return;
    }
    if (!data) {
      Alert.alert("Couldn't record seal check", 'Please try again.');
      return;
    }
    setOrder((prev) => (prev ? { ...prev, status: 'delivered' } : prev));
    setSealResult(status);
    if (status === 'broken') setComplaintStatus('open');
  }

  function handleSealCheck(status: SealStatus) {
    // Broken flips the order to delivered too (payment already happened
    // outside the app) but auto-raises a complaint — worth a confirm since
    // it can't be walked back from this screen.
    if (status === 'broken') {
      Alert.alert(
        'Report a broken seal?',
        'This marks the delivery complete and flags it for admin review.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Report broken', style: 'destructive', onPress: () => submitSeal('broken') },
        ],
      );
      return;
    }
    submitSeal('intact');
  }

  function handleContactAgent() {
    if (!agentProfile?.phone_number) return;
    Linking.openURL(`tel:${agentProfile.phone_number}`);
  }

  function handleOpenMaps(lat: number | null, lng: number | null) {
    if (lat == null || lng == null) {
      Alert.alert('No coordinates on file for this stop.');
      return;
    }
    Linking.openURL(mapsUrl(lat, lng));
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: 'Order' }} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !order || !role) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: 'Order' }} />
        <View style={styles.centerFill}>
          <Text style={[styles.errorText, { color: c.text }]}>{loadError ?? 'Something went wrong.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const speedMeta = SPEED_META[order.delivery_speed];
  const statusMeta = STATUS_META[order.status];
  const priceLabel =
    order.pricing_mode === 'fixed' ? formatRupees(order.price_paise) : `${formatRupees(order.min_bid_paise)}+ (auction)`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Order' }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
      >
        <View style={[styles.statusPill, { backgroundColor: `${statusMeta.color}22` }]}>
          <Text style={[styles.statusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.route, { color: c.text }]} numberOfLines={3}>
            {order.point_a_address} <Text style={{ color: c.muted }}>→</Text> {order.point_b_address}
          </Text>
          <Text style={[styles.description, { color: c.muted }]}>{order.item_description}</Text>
          <View style={styles.metaRow}>
            <View style={[styles.badge, { backgroundColor: `${speedMeta.color}22` }]}>
              <Text style={[styles.badgeText, { color: speedMeta.color }]}>{speedMeta.label}</Text>
            </View>
            <Text style={[styles.price, { color: c.text }]}>{priceLabel}</Text>
          </View>
        </View>

        {order.status === 'open' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionText, { color: c.muted }]}>
              Your order is live on the Wall. We&apos;ll update this screen the moment an agent accepts it.
            </Text>
          </View>
        )}

        {order.status === 'accepted' && role === 'customer' && (
          <>
            <AgentCard agent={agentProfile} c={c} onContact={handleContactAgent} />
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <MapsButton label="Open pickup location in Maps" onPress={() => handleOpenMaps(order.point_a_lat, order.point_a_lng)} />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Text style={[styles.sectionLabel, { color: c.muted }]}>Pickup code</Text>
              {otp ? (
                <Text style={[styles.otpDisplay, { color: c.text }]}>{otp}</Text>
              ) : (
                <Pressable
                  onPress={handleRevealOtp}
                  disabled={revealingOtp}
                  style={({ pressed }) => [styles.secondaryButton, { borderColor: BLUE }, (pressed || revealingOtp) && { opacity: 0.6 }]}
                >
                  {revealingOtp ? (
                    <ActivityIndicator size="small" color={BLUE} />
                  ) : (
                    <Text style={[styles.secondaryButtonText, { color: BLUE }]}>Show pickup code</Text>
                  )}
                </Pressable>
              )}
              <Text style={[styles.note, { color: c.muted }]}>Read this code aloud to your agent at handoff.</Text>
            </View>
          </>
        )}

        {order.status === 'accepted' && role === 'agent' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <MapsButton label="Open pickup location in Maps" onPress={() => handleOpenMaps(order.point_a_lat, order.point_a_lng)} />
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Enter pickup code</Text>
            <Text style={[styles.note, { color: c.muted, marginBottom: 10 }]}>
              Ask the customer to read out their pickup code.
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
              value={otpInput}
              onChangeText={setOtpInput}
              placeholder="6-digit code"
              placeholderTextColor={c.muted}
              keyboardType="number-pad"
            />
            <Pressable
              onPress={handleVerifyOtp}
              disabled={verifyingOtp}
              style={({ pressed }) => [styles.primaryButton, (pressed || verifyingOtp) && { opacity: 0.7 }]}
            >
              <Text style={styles.primaryButtonText}>{verifyingOtp ? 'Verifying…' : 'Verify & confirm pickup'}</Text>
            </Pressable>
          </View>
        )}

        {order.status === 'picked_up' && role === 'customer' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <MapsButton label="Open dropoff location in Maps" onPress={() => handleOpenMaps(order.point_b_lat, order.point_b_lng)} />
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Seal check</Text>
            {photoExists === null ? (
              <ActivityIndicator color={BLUE} style={{ marginTop: 8 }} />
            ) : photoExists ? (
              <>
                <Text style={[styles.note, { color: c.muted, marginBottom: 10 }]}>
                  Your agent has submitted a delivery photo. Confirm whether the seal arrived intact.
                </Text>
                <View style={styles.sealRow}>
                  <Pressable
                    onPress={() => handleSealCheck('intact')}
                    disabled={!!sealSubmitting}
                    style={({ pressed }) => [
                      styles.primaryButton, styles.sealButton, { backgroundColor: GREEN },
                      (pressed || sealSubmitting) && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>{sealSubmitting === 'intact' ? 'Confirming…' : 'Seal intact'}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleSealCheck('broken')}
                    disabled={!!sealSubmitting}
                    style={({ pressed }) => [
                      styles.primaryButton, styles.sealButton, { backgroundColor: RED },
                      (pressed || sealSubmitting) && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>{sealSubmitting === 'broken' ? 'Reporting…' : 'Seal broken'}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={[styles.note, { color: c.muted }]}>
                Waiting for your agent to submit a delivery photo before you can confirm the seal.
              </Text>
            )}
          </View>
        )}

        {order.status === 'picked_up' && role === 'agent' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <MapsButton label="Open dropoff location in Maps" onPress={() => handleOpenMaps(order.point_b_lat, order.point_b_lng)} />
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Delivery photo</Text>
            {photoExists ? (
              <Text style={[styles.note, { color: c.muted }]}>
                Photo submitted — waiting for the customer to confirm the seal.
              </Text>
            ) : (
              <Pressable
                onPress={pickDeliveryPhoto}
                disabled={uploadingPhoto}
                style={({ pressed }) => [styles.primaryButton, (pressed || uploadingPhoto) && { opacity: 0.7 }]}
              >
                <Text style={styles.primaryButtonText}>{uploadingPhoto ? 'Submitting…' : '📷 Submit delivery photo'}</Text>
              </Pressable>
            )}
          </View>
        )}

        {order.status === 'delivered' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Seal check result</Text>
            {sealResult ? (
              <Text style={[styles.sealResultText, { color: sealResult === 'intact' ? GREEN : RED }]}>
                {sealResult === 'intact' ? '✅ Seal was intact' : '⚠️ Seal was reported broken'}
              </Text>
            ) : (
              <Text style={[styles.note, { color: c.muted }]}>No seal check on file.</Text>
            )}
            {complaintStatus && (
              <View style={[styles.complaintBanner, { backgroundColor: `${AMBER}22`, borderColor: AMBER }]}>
                <Text style={[styles.complaintText, { color: AMBER }]}>
                  A complaint was raised for this order — status: {complaintStatus}.
                </Text>
              </View>
            )}
            <Text style={[styles.note, { color: c.muted, marginTop: 14 }]}>
              Rating isn&apos;t available yet — coming soon.
            </Text>
          </View>
        )}

        {order.status === 'cancelled' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionText, { color: c.muted }]}>This order was cancelled.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MapsButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, { borderColor: BLUE }, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.secondaryButtonText, { color: BLUE }]}>🗺️ {label}</Text>
    </Pressable>
  );
}

function AgentCard({ agent, c, onContact }: { agent: AgentProfile | null; c: Palette; onContact: () => void }) {
  if (!agent) {
    return (
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <ActivityIndicator color={BLUE} />
      </View>
    );
  }
  const vehicleLabel = agent.vehicle_type ? VEHICLE_LABEL[agent.vehicle_type] : '';
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.agentRow}>
        {agent.avatar_url ? (
          <Image source={{ uri: agent.avatar_url }} style={styles.avatar} contentFit="cover" />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: BLUE }]}>
            <Text style={styles.avatarFallbackText}>{initials(agent.first_name, agent.last_name)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.agentNameRow}>
            <Text style={[styles.agentName, { color: c.text }]}>{agent.first_name} {agent.last_name}</Text>
            {agent.level_number != null && (
              <View style={[styles.levelPill, { backgroundColor: `${LEVEL_COLOR[agent.level_number] ?? BLUE}22` }]}>
                <Text style={[styles.levelPillText, { color: LEVEL_COLOR[agent.level_number] ?? BLUE }]}>
                  Lvl {agent.level_number} · {agent.level_label}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.agentMeta, { color: c.muted }]}>
            {agent.avg_rating_as_agent != null ? `⭐ ${agent.avg_rating_as_agent.toFixed(1)}` : 'No rating yet'}
            {' · '}{agent.completed_deliveries_count} deliveries
            {!!agent.current_streak && ` · 🔥 ${agent.current_streak}`}
          </Text>
          {!!vehicleLabel && <Text style={[styles.agentMeta, { color: c.muted }]}>{vehicleLabel}{agent.registration_number ? ` · ${agent.registration_number}` : ''}</Text>}
        </View>
      </View>
      <Pressable
        onPress={onContact}
        disabled={!agent.phone_number}
        style={({ pressed }) => [
          styles.secondaryButton, { borderColor: BLUE, marginTop: 14 },
          (pressed || !agent.phone_number) && { opacity: 0.6 },
        ]}
      >
        <Text style={[styles.secondaryButtonText, { color: BLUE }]}>📞 Contact</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },

  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  statusPillText: { fontSize: 13, fontWeight: '700' },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 4 },

  route: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, lineHeight: 22 },
  description: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  price: { fontSize: 16, fontWeight: '800' },

  sectionText: { fontSize: 14, lineHeight: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '700', marginTop: 4, marginBottom: 8 },
  note: { fontSize: 12, lineHeight: 17, marginTop: 8 },

  divider: { height: StyleSheet.hairlineWidth, marginVertical: 14 },

  input: { borderRadius: 12, padding: 14, fontSize: 18, letterSpacing: 2, textAlign: 'center', marginBottom: 12 },

  primaryButton: { backgroundColor: BLUE, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  secondaryButton: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 13, alignItems: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '700' },

  otpDisplay: { fontSize: 32, fontWeight: '800', letterSpacing: 6, textAlign: 'center', marginVertical: 6 },

  sealRow: { flexDirection: 'row', gap: 10 },
  sealButton: { flex: 1 },
  sealResultText: { fontSize: 16, fontWeight: '700' },

  complaintBanner: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 12 },
  complaintText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },

  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  agentName: { fontSize: 16, fontWeight: '800' },
  agentMeta: { fontSize: 12, marginTop: 2 },
  levelPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  levelPillText: { fontSize: 11, fontWeight: '700' },
});
