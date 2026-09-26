import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  ActivityIndicator, ScrollView, RefreshControl, TextInput, Linking, Image,
  KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../lib/supabase';
import { fetchGamificationProfile, LEVEL_COLOR } from '../../../lib/gamification';
import { AgentAvatar } from '../../../components/agent-avatar';

const BLUE = '#1877F2';
const RED = '#E41E3F';
const AMBER = '#B7791F';
const GREEN = '#1F9254';
const NEUTRAL = '#6b7280';

type OrderStatus = 'open' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';
type DeliverySpeed = 'standard' | 'express' | 'super_fast';
type PricingMode = 'fixed' | 'auction';
type VehicleType = 'bike' | 'car' | 'auto' | 'bus' | 'other' | 'none';
type SealStatus = 'intact' | 'broken';
type ComplaintStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
type Role = 'customer' | 'agent';

type Order = {
  id: string;
  customer_id: string;
  accepted_agent_id: string | null;
  status: OrderStatus;
  order_type: 'parcel' | 'ride';
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
  // Only ever nonzero once status is 'accepted' — cancel_order itself only
  // charges it past that point (see handleCancelOrder). Null/0 pre-accept.
  cancellation_penalty_paise: number | null;
  arrived_at: string | null;
  rider_paid_at: string | null;
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
  upi_id: string | null;
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
  'id, customer_id, accepted_agent_id, status, order_type, item_description, item_category, ' +
  'point_a_address, point_b_address, point_a_lat, point_a_lng, point_b_lat, point_b_lng, ' +
  'delivery_speed, pricing_mode, price_paise, min_bid_paise, cancellation_penalty_paise, arrived_at, rider_paid_at';

const SPEED_META: Record<DeliverySpeed, { label: string; color: string }> = {
  super_fast: { label: 'Priority', color: RED },
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

// `accepted`'s label above is customer-only — an agent viewing their own
// delivery gets a role-specific override here rather than reading "Agent
// assigned" about themselves in third person. The other four statuses are
// neutral state labels either way; `open` in particular is never actually
// shown to the agent role, since accepted_agent_id (what makes role
// 'agent') is only ever set atomically together with the accepted-status
// transition.
function statusMetaFor(status: OrderStatus, role: Role): { label: string; color: string } {
  if (status === 'accepted' && role === 'agent') {
    return { label: 'Assigned to you', color: STATUS_META.accepted.color };
  }
  return STATUS_META[status];
}

const VEHICLE_LABEL: Record<VehicleType, string> = {
  bike: '🏍️ Bike', car: '🚗 Car', auto: '🛺 Auto', bus: '🚌 Bus', other: '📦 Other vehicle', none: '🚶 On foot',
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

// AsyncStorage key for this order's last-seen-chat timestamp — there's no
// read-receipt column on order_messages, so "unread" is purely a local,
// per-device comparison against this.
const chatSeenKey = (id: string) => `gend_chat_seen_${id}`;

type DriverLoc = { lat: number; lng: number; updated_at: string };

// Hermes-safe: Postgres timestamps can carry more than 3 fractional-second
// digits, which Hermes' Date parser rejects outright (returns Invalid
// Date) — trim to milliseconds before parsing.
function parseTs(s: string): number {
  return new Date(s.replace(/(\.\d{3})\d+/, '$1')).getTime();
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// Assumes about 20 km/h city speed.
function formatEta(km: number): string {
  const minutes = Math.max(1, Math.round((km / 20) * 60));
  return `${minutes} min`;
}

function formatAge(seconds: number): string {
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)} min ago`;
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
  // Only ever populated for the agent — mirrors agentProfile above but for
  // the other direction (agent contacting the customer).
  const [customerProfile, setCustomerProfile] = useState<{ phone_number: string | null } | null>(null);

  // Amount payable to the agent for this order, resolved once status hits
  // 'accepted' — fixed price directly, or the accepted agent's own winning
  // bid for an auction order. Feeds the UPI pay button/QR on AgentCard;
  // null means either not yet resolved or (auction) no matching bid found.
  const [resolvedAmountPaise, setResolvedAmountPaise] = useState<number | null>(null);

  // Auction orders only, customer-only, while status is still 'open' — a
  // quick count/lowest-offer glance here; actually selecting a bid happens
  // on my-orders.tsx (see bid-selection-accept-bid-handover.md), not here.
  const [bidSummary, setBidSummary] = useState<{ count: number; lowestPaise: number | null } | null>(null);

  const [otp, setOtp] = useState<string | null>(null);
  const [revealingOtp, setRevealingOtp] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  // Customer-side reveal of the delivery photo itself — on-demand, so the
  // customer isn't asked to attest to the seal from the text description
  // alone.
  const [deliveryPhotoUrl, setDeliveryPhotoUrl] = useState<string | null>(null);
  const [loadingDeliveryPhoto, setLoadingDeliveryPhoto] = useState(false);
  // Field names currently showing a red border — cleared the moment that
  // field is edited again, not left stuck on until the next submit attempt.
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());
  const [showAgentCancelForm, setShowAgentCancelForm] = useState(false);
  const [agentCancelReason, setAgentCancelReason] = useState('');
  const [cancellingOrder, setCancellingOrder] = useState(false);

  // Whether a delivery_photos row exists for this order — gates the
  // customer's seal-check buttons (verify_delivery_seal hard-rejects until
  // one exists) and tells the agent whether their submission already went
  // through. Null until the first check resolves.
  const [photoExists, setPhotoExists] = useState<boolean | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [sealSubmitting, setSealSubmitting] = useState<SealStatus | null>(null);

  const [sealResult, setSealResult] = useState<SealStatus | null>(null);
  const [complaintStatus, setComplaintStatus] = useState<ComplaintStatus | null>(null);

  // Ride-only state for the pay-at-dropoff flow. paymentSheetDismissed is
  // local-only UI state; the payment itself is recorded server-side via
  // rider_mark_paid (order.rider_paid_at) and arrive_at_dropoff
  // (order.arrived_at) — see handleRiderPaid / handleArriveAtDropoff below.
  const [markingPaid, setMarkingPaid] = useState(false);
  const [paymentSheetDismissed, setPaymentSheetDismissed] = useState(false);
  const [arrivingAtDropoff, setArrivingAtDropoff] = useState(false);
  const [completingRide, setCompletingRide] = useState(false);

  // "New message" indicator for every Chat button on this screen — true
  // when the OTHER party has a message newer than our stored seen
  // timestamp (see chatSeenKey above).
  const [chatUnread, setChatUnread] = useState(false);
  // True once this device has actually opened the chat screen for this
  // order — gates the focus-effect below so returning to this screen
  // without ever having opened chat can't mark anything seen.
  const chatOpenedRef = useRef(false);

  // Customer-only: the accepted agent's last-reported live position for
  // this order (see order_live_locations) — null while none has arrived
  // yet, or once the order leaves 'accepted'/'picked_up'. nowTick just
  // forces the age/distance text below to re-render periodically without
  // needing driverLoc itself to change.
  const [driverLoc, setDriverLoc] = useState<DriverLoc | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Own auth id — needed as `rater_id` when submitting a rating (RLS
  // requires it match auth.uid(), so it has to come from the client's own
  // session, not be trusted from anywhere else).
  const [userId, setUserId] = useState<string | null>(null);

  // The current viewer's own rating of the other party on this order, if
  // any. Null legitimately means "hasn't rated yet" once ratingLoading is
  // false — see the ratings handover doc's per-role branching.
  const [myRating, setMyRating] = useState<{ stars: number; comment: string | null } | null>(null);
  const [ratingLoading, setRatingLoading] = useState(true);
  // Agent-only: raw completed_deliveries_count, fetched fresh rather than
  // reused from the gamification level breakpoints (5/20/50/100/250) since
  // the rating gate is a plain "count >= 10" check.
  const [myDeliveryCount, setMyDeliveryCount] = useState<number | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

  // Realtime callbacks are set up once (see the subscription effect below)
  // but need the latest role/user without resubscribing every render.
  const roleRef = useRef<Role | null>(null);
  const userIdRef = useRef<string | null>(null);
  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

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
    const { data: payment } = await supabase
      .from('agent_payment_info')
      .select('upi_id')
      .eq('profile_id', agentId)
      .maybeSingle();
    setAgentProfile({
      ...profile,
      vehicle_type: (vehicle?.vehicle_type as VehicleType) ?? null,
      registration_number: vehicle?.registration_number ?? null,
      upi_id: payment?.upi_id ?? null,
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

  const loadCustomerProfile = useCallback(async (customerId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('phone_number')
      .eq('id', customerId)
      .maybeSingle();
    if (error || !data) return;
    setCustomerProfile(data);
  }, []);

  const checkPhotoExists = useCallback(async () => {
    if (!orderId) return;
    const { data } = await supabase.from('delivery_photos').select('order_id').eq('order_id', orderId).maybeSingle();
    setPhotoExists(!!data);
  }, [orderId]);

  const loadBidSummary = useCallback(async (orderId: string) => {
    const { data, error } = await supabase
      .from('bids')
      .select('offer_paise')
      .eq('order_id', orderId);
    if (error || !data) return;
    const lowest = data.length > 0 ? Math.min(...data.map((b) => b.offer_paise)) : null;
    setBidSummary({ count: data.length, lowestPaise: lowest });
  }, []);

  // Resolves what the customer owes this order's accepted agent — the fixed
  // price as-is, or (auction) that agent's own winning offer_paise off the
  // bids table. Leaves resolvedAmountPaise null if no matching bid is found.
  const resolvePayableAmount = useCallback(async (o: Order) => {
    if (o.pricing_mode === 'fixed') {
      setResolvedAmountPaise(o.price_paise);
      return;
    }
    if (!o.accepted_agent_id) {
      setResolvedAmountPaise(null);
      return;
    }
    const { data } = await supabase
      .from('bids')
      .select('offer_paise')
      .eq('order_id', o.id)
      .eq('agent_id', o.accepted_agent_id)
      .maybeSingle();
    setResolvedAmountPaise(data?.offer_paise ?? null);
  }, []);

  // Both roles render it at the same size (styles.deliveryPhoto) — full-size
  // for the customer's seal decision, and the same for the agent to confirm
  // what they uploaded. Silently no-ops if the row/signed URL isn't there
  // yet — callers don't gate on photoExists first, same tolerance
  // checkPhotoExists has. delivery-photos is a private bucket (see
  // captureAndSubmitPhoto's note) so the stored path needs a signed URL,
  // not a public one.
  const loadDeliveryPhoto = useCallback(async (orderId: string) => {
    setLoadingDeliveryPhoto(true);
    const { data: row, error: rowError } = await supabase
      .from('delivery_photos')
      .select('photo_url')
      .eq('order_id', orderId)
      .maybeSingle();
    if (rowError || !row) {
      setLoadingDeliveryPhoto(false);
      return;
    }
    const { data: signed, error: signError } = await supabase.storage
      .from('delivery-photos')
      .createSignedUrl(row.photo_url, 3600);
    setLoadingDeliveryPhoto(false);
    if (signError || !signed) return;
    setDeliveryPhotoUrl(signed.signedUrl);
  }, []);

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

  // Own rating on this order, plus (agent only) the raw delivery count that
  // gates whether they can rate the customer at all. `r`/`uid` are passed
  // explicitly rather than read from state, since this can run right after
  // loadEverything determines them but before the corresponding setState
  // calls have flushed.
  const loadRatingInfo = useCallback(
    async (r: Role, uid: string) => {
      if (!orderId) return;
      setRatingLoading(true);
      const ratingPromise = supabase
        .from('ratings')
        .select('stars, comment')
        .eq('order_id', orderId)
        .eq('rater_id', uid)
        .maybeSingle();
      if (r === 'agent') {
        const [{ data: rating }, { data: profile }] = await Promise.all([
          ratingPromise,
          supabase.from('profiles').select('completed_deliveries_count').eq('id', uid).maybeSingle(),
        ]);
        setMyRating(rating ? { stars: rating.stars, comment: rating.comment } : null);
        setMyDeliveryCount(profile?.completed_deliveries_count ?? 0);
      } else {
        const { data: rating } = await ratingPromise;
        setMyRating(rating ? { stars: rating.stars, comment: rating.comment } : null);
      }
      setRatingLoading(false);
    },
    [orderId],
  );

  // Compares the other party's newest order_messages row against our
  // stored seen timestamp for this order (see chatSeenKey above).
  const checkChatUnread = useCallback(async (oid: string, uid: string) => {
    let seen: string | null = null;
    try {
      seen = await AsyncStorage.getItem(chatSeenKey(oid));
    } catch {
      seen = null;
    }
    const { data: lastMessage } = await supabase
      .from('order_messages')
      .select('created_at')
      .eq('order_id', oid)
      .neq('sender_id', uid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setChatUnread(!!lastMessage && (!seen || parseTs(lastMessage.created_at) > parseTs(seen)));
  }, []);

  const loadDriverLocation = useCallback(async (oid: string) => {
    const { data } = await supabase.from('order_live_locations').select('lat, lng, updated_at').eq('order_id', oid).maybeSingle();
    setDriverLoc(data ? (data as DriverLoc) : null);
  }, []);

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
    setUserId(user.id);

    if (r === 'customer' && o.accepted_agent_id) loadAgentProfile(o.accepted_agent_id);
    if (r === 'agent') loadCustomerProfile(o.customer_id);
    if (r === 'customer' && o.status === 'open' && o.pricing_mode === 'auction') loadBidSummary(orderId);
    if (o.status === 'accepted' || o.status === 'picked_up') resolvePayableAmount(o);
    if (o.status === 'picked_up') {
      checkPhotoExists();
      loadDeliveryPhoto(orderId);
    }
    if (o.status === 'delivered') {
      if (o.order_type !== 'ride') loadDeliveredSummary();
      loadRatingInfo(r, user.id);
    }
    if (o.status !== 'open' && o.status !== 'cancelled' && o.accepted_agent_id) {
      checkChatUnread(orderId, user.id);
    }
    if (r === 'customer' && (o.status === 'accepted' || o.status === 'picked_up')) loadDriverLocation(orderId);
  }, [orderId, loadAgentProfile, loadCustomerProfile, loadBidSummary, resolvePayableAmount, checkPhotoExists, loadDeliveryPhoto, loadDeliveredSummary, loadRatingInfo, checkChatUnread, loadDriverLocation]);

  useEffect(() => {
    let ignore = false;
    async function startLoading() {
      await loadEverything();
      if (!ignore) {
        setLoading(false);
      }
    }
    startLoading();
    return () => {
      ignore = true;
    };
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
      .channel(`order-${orderId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` },
        (payload) => {
          const next = payload.new as Order;
          setOrder(next);
          if (roleRef.current === 'customer' && next.accepted_agent_id) loadAgentProfile(next.accepted_agent_id);
          if (roleRef.current === 'agent') loadCustomerProfile(next.customer_id);
          if (next.status === 'accepted' || next.status === 'picked_up') resolvePayableAmount(next);
          if (next.status === 'picked_up') {
            checkPhotoExists();
            loadDeliveryPhoto(orderId);
          }
          if (next.status === 'delivered') {
            if (next.order_type !== 'ride') loadDeliveredSummary();
            if (roleRef.current && userIdRef.current) loadRatingInfo(roleRef.current, userIdRef.current);
          }
          if (roleRef.current === 'customer') {
            if (next.status === 'accepted' || next.status === 'picked_up') {
              loadDriverLocation(orderId);
            } else {
              setDriverLoc(null);
            }
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'delivery_photos', filter: `order_id=eq.${orderId}` },
        () => {
          setPhotoExists(true);
          loadDeliveryPhoto(orderId);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids', filter: `order_id=eq.${orderId}` },
        () => {
          if (roleRef.current === 'customer') loadBidSummary(orderId);
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
        (payload) => {
          if (payload.new.sender_id !== userIdRef.current) setChatUnread(true);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_live_locations', filter: `order_id=eq.${orderId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setDriverLoc(null);
            return;
          }
          const row = payload.new as DriverLoc;
          setDriverLoc({ lat: row.lat, lng: row.lng, updated_at: row.updated_at });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, loadAgentProfile, loadCustomerProfile, loadBidSummary, resolvePayableAmount, checkPhotoExists, loadDeliveryPhoto, loadDeliveredSummary, loadRatingInfo, loadDriverLocation]);

  // Covers messages that arrived while the chat screen was open on this
  // device (the realtime INSERT handler above would have already flipped
  // chatUnread back to true for those) — re-mark everything seen the
  // moment this screen regains focus after chat was actually opened.
  useFocusEffect(
    useCallback(() => {
      if (!chatOpenedRef.current || !orderId) return;
      chatOpenedRef.current = false;
      setChatUnread(false);
      (async () => {
        try {
          await AsyncStorage.setItem(chatSeenKey(orderId), new Date().toISOString());
        } catch {
          // Storage unavailable — worst case the unread flag re-appears
          // until the next real message.
        }
      })();
    }, [orderId]),
  );

  // Re-renders the driver-location card's age/distance text every 15s
  // without needing driverLoc itself to change (it only changes when a new
  // position actually arrives).
  useEffect(() => {
    if (role !== 'customer') return;
    if (order?.status !== 'accepted' && order?.status !== 'picked_up') return;
    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 15000);
    return () => {
      clearInterval(interval);
    };
  }, [role, order?.status]);

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
      setFieldErrors(new Set(['otpInput']));
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
      setFieldErrors((prev) => new Set(prev).add('otpInput'));
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

      // Best-effort only — the photo is already submitted at this point, so
      // a push failure here must never surface as an error or affect the
      // upload flow.
      (async () => {
        try {
          await supabase.functions.invoke('send-push', {
            body: {
              event: 'photo_submitted',
              order_id: order.id,
              recipient_profile_id: order.customer_id,
              title: 'Delivery photo submitted',
              body: 'Check the photo and confirm the seal is intact.',
            },
          });
        } catch {
          // Silently ignored — see comment above.
        }
      })();
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
    const { error } = await supabase.rpc('verify_delivery_seal', {
      p_order_id: order.id,
      p_seal_status: status,
    });
    setSealSubmitting(null);
    if (error) {
      Alert.alert("Couldn't record seal check", error.message);
      return;
    }
    setOrder((prev) => (prev ? { ...prev, status: 'delivered' } : prev));
    setSealResult(status);
    if (status === 'broken') setComplaintStatus('open');

    // Best-effort only — the seal check is already recorded at this point,
    // so a push failure here must never surface as an error or affect the
    // flow.
    (async () => {
      try {
        await supabase.functions.invoke('send-push', {
          body: {
            event: 'order_delivered',
            order_id: order.id,
            recipient_profile_id: order.accepted_agent_id,
            title: status === 'intact' ? 'Delivery confirmed' : 'Seal reported broken',
            body: status === 'intact'
              ? 'The customer confirmed the seal was intact. Delivery complete.'
              : 'The customer reported a broken seal. This delivery is now under review.',
          },
        });
      } catch {
        // Silently ignored — see comment above.
      }
    })();
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

  // cancel_order (customer-only, RPC-enforced) allows 'open' or 'accepted'
  // only, and inserts a cancellation_fees row itself when accepted with a
  // nonzero cancellation_penalty_paise — nothing extra to do here for that,
  // just show the same amount up front in the confirm dialog below.
  async function handleCancelOrder() {
    if (!order) return;
    const { error } = await supabase.rpc('cancel_order', { p_order_id: order.id });
    if (error) {
      Alert.alert("Couldn't cancel order", error.message);
      return;
    }
    setOrder((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));

    // Best-effort only — the order is already cancelled at this point, so a
    // push failure here must never surface as an error or affect the flow.
    // Skip entirely for an 'open' order with no agent assigned — no one to
    // notify.
    if (order.accepted_agent_id) {
      const agentId = order.accepted_agent_id;
      (async () => {
        try {
          await supabase.functions.invoke('send-push', {
            body: {
              event: 'order_cancelled',
              order_id: order.id,
              recipient_profile_id: agentId,
              title: 'Order cancelled',
              body: 'The customer has cancelled this delivery.',
            },
          });
        } catch {
          // Silently ignored — see comment above.
        }
      })();
    }
  }

  // The penalty only ever applies once status is 'accepted' (see
  // cancel_order's source) — 'open' orders always cancel free.
  function handleCancelOrderPress() {
    if (!order) return;
    const penalty = order.status === 'accepted' ? order.cancellation_penalty_paise : null;
    Alert.alert(
      'Cancel this order?',
      penalty && penalty > 0
        ? `A cancellation fee of ${formatRupees(penalty)} applies since an agent has already been assigned. This can't be undone.`
        : "This can't be undone.",
      [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: handleCancelOrder },
      ],
    );
  }

  async function handleAgentCancelOrder() {
    if (!order) return;
    const reason = agentCancelReason.trim();
    if (!reason) {
      Alert.alert('Enter a reason', 'A cancellation reason is required.');
      return;
    }
    setCancellingOrder(true);
    const { data: stage, error } = await supabase.rpc('agent_cancel_order', {
      p_order_id: order.id,
      p_reason: reason,
    });
    setCancellingOrder(false);
    if (error) {
      Alert.alert("Couldn't cancel this delivery", error.message);
      return;
    }
    setOrder((prev) => (prev ? { ...prev, status: 'open', accepted_agent_id: null } : prev));
    setShowAgentCancelForm(false);
    setAgentCancelReason('');

    // Best-effort only — the order is already reopened at this point, so a
    // push failure here must never surface as an error or affect the flow.
    const customerId = order.customer_id;
    (async () => {
      try {
        await supabase.functions.invoke('send-push', {
          body: {
            event: 'agent_backed_out',
            order_id: order.id,
            recipient_profile_id: customerId,
            title: 'Finding you a new agent',
            body: "Your agent could not complete this delivery. We're finding you a new one.",
          },
        });
      } catch {
        // Silently ignored — see comment above.
      }
    })();

    // The agent has no more relationship to this order once cancelled —
    // send them back to the Wall rather than leaving them on a screen that
    // no longer has a role-appropriate view for them.
    Alert.alert('Delivery cancelled', 'This order has been reopened for another agent.', [
      { text: 'OK', onPress: () => router.replace('/wall') },
    ]);
  }

  function handleAgentCancelPress() {
    Alert.alert(
      'Cancel this delivery?',
      "This reopens the order for another agent to accept. This can't be undone.",
      [
        { text: 'Never mind', style: 'cancel' },
        { text: 'Continue', onPress: () => setShowAgentCancelForm(true) },
      ],
    );
  }

  // Ride-only: fires when the customer taps "I've paid" on the picked_up
  // card or the payment sheet. Records rider_paid_at server-side via
  // rider_mark_paid (RPC-enforced: only while picked_up and after
  // arrived_at), then best-effort nudges the agent — the ride only
  // actually completes once the agent confirms via agent_complete_ride, so
  // a failed push here just means a slower nudge, never a stuck flow.
  async function handleRiderPaid() {
    if (!order) return;
    setMarkingPaid(true);
    const { error } = await supabase.rpc('rider_mark_paid', { p_order_id: order.id });
    setMarkingPaid(false);
    if (error) {
      Alert.alert("Couldn't send", error.message);
      return;
    }
    setOrder((prev) => (prev ? { ...prev, rider_paid_at: new Date().toISOString() } : prev));

    (async () => {
      try {
        await supabase.functions.invoke('send-push', {
          body: {
            event: 'agent_status_change',
            order_id: order.id,
            recipient_profile_id: order.accepted_agent_id,
            title: "Rider says they've paid",
            body: "Confirm you've received the payment, then complete the ride.",
          },
        });
      } catch {
        // Silently ignored — see comment above.
      }
    })();
    Alert.alert('Sent', 'Your driver has been told you have paid. They will end the ride once they confirm.');
  }

  // Ride-only: agent marks themselves as physically at the drop-off, which
  // unlocks the "payment received" step below and nudges the customer to
  // pay.
  async function handleArriveAtDropoff() {
    if (!order) return;
    setArrivingAtDropoff(true);
    const { error } = await supabase.rpc('arrive_at_dropoff', { p_order_id: order.id });
    setArrivingAtDropoff(false);
    if (error) {
      Alert.alert("Couldn't mark arrival", error.message);
      return;
    }
    const arrivedAt = new Date().toISOString();
    setOrder((prev) => (prev ? { ...prev, arrived_at: arrivedAt } : prev));

    // Best-effort only — arrival is already recorded at this point, so a
    // push failure here must never surface as an error or affect the flow.
    (async () => {
      try {
        await supabase.functions.invoke('send-push', {
          body: {
            event: 'agent_status_change',
            order_id: order.id,
            recipient_profile_id: order.customer_id,
            title: 'Your driver has arrived',
            body: 'Please pay your driver to end the ride.',
          },
        });
      } catch {
        // Silently ignored — see comment above.
      }
    })();
  }

  function handleCompleteRidePress() {
    Alert.alert(
      'Confirm you have received the payment?',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: handleCompleteRide },
      ],
    );
  }

  // Ride-only: agent's final step — ends the ride once payment is
  // confirmed. Mirrors submitSeal's parcel-side role (both flip the order
  // to 'delivered'), just via a different RPC since rides have no seal to
  // check.
  async function handleCompleteRide() {
    if (!order) return;
    setCompletingRide(true);
    const { error } = await supabase.rpc('agent_complete_ride', { p_order_id: order.id });
    setCompletingRide(false);
    if (error) {
      Alert.alert("Couldn't complete ride", error.message);
      return;
    }
    setOrder((prev) => (prev ? { ...prev, status: 'delivered' } : prev));

    // Best-effort only — the ride is already completed at this point, so a
    // push failure here must never surface as an error or affect the flow.
    (async () => {
      try {
        await supabase.functions.invoke('send-push', {
          body: {
            event: 'order_delivered',
            order_id: order.id,
            recipient_profile_id: order.customer_id,
            title: 'Ride completed',
            body: 'Thanks for riding with Gen-D. Please rate your driver.',
          },
        });
      } catch {
        // Silently ignored — see comment above.
      }
    })();
  }

  async function handleSubmitRating() {
    if (!order || !role || !userId) return;
    if (ratingStars < 1) {
      Alert.alert('Pick a rating', 'Tap a star to rate before submitting.');
      return;
    }
    const rateeId = role === 'customer' ? order.accepted_agent_id : order.customer_id;
    if (!rateeId) return; // shouldn't happen once delivered — every delivered order has both parties

    setSubmittingRating(true);
    const { error } = await supabase.from('ratings').insert({
      order_id: order.id,
      rater_id: userId,
      ratee_id: rateeId,
      rater_role: role,
      stars: ratingStars,
      comment: ratingComment.trim() || null,
    });
    setSubmittingRating(false);

    if (error) {
      // 23505 = unique-violation on (order_id, rater_id) — a real safety
      // net (e.g. a stale UI after rating from another device), not just a
      // UI convenience. Resync from the server rather than trusting local
      // state once this happens.
      if (error.code === '23505') {
        Alert.alert('Already rated', "You've already submitted a rating for this order.");
        loadRatingInfo(role, userId);
      } else {
        Alert.alert("Couldn't submit rating", error.message);
      }
      return;
    }
    setMyRating({ stars: ratingStars, comment: ratingComment.trim() || null });
    Alert.alert('Thanks for rating', 'Your rating has been saved.');
  }

  function handleContactAgent() {
    if (!agentProfile?.phone_number) return;
    Linking.openURL(`tel:${agentProfile.phone_number}`);
  }

  function handleContactCustomer() {
    if (!customerProfile?.phone_number) return;
    Linking.openURL(`tel:${customerProfile.phone_number}`);
  }

  // Every Chat button on this screen goes through here instead of a direct
  // router.push, so opening chat always marks it seen (both immediately
  // and, via chatOpenedRef + the focus-effect above, for anything that
  // arrives while chat is still open).
  async function openChat() {
    if (!order) return;
    chatOpenedRef.current = true;
    setChatUnread(false);
    try {
      await AsyncStorage.setItem(chatSeenKey(order.id), new Date().toISOString());
    } catch {
      // Storage unavailable — worst case the unread flag re-appears until
      // the next real message.
    }
    router.push({ pathname: '/order/[id]/chat', params: { id: order.id } });
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
        <Stack.Screen options={{ title: 'Order', headerBackTitle: 'Back' }} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !order || !role) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: 'Order', headerBackTitle: 'Back' }} />
        <View style={styles.centerFill}>
          <Text style={[styles.errorText, { color: c.text }]}>{loadError ?? 'Something went wrong.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isRide = order.order_type === 'ride';
  const speedMeta = SPEED_META[order.delivery_speed];
  const statusMeta = statusMetaFor(order.status, role);
  const priceLabel =
    order.pricing_mode === 'fixed' ? formatRupees(order.price_paise) : `${formatRupees(order.min_bid_paise)}+ (auction)`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ title: 'Order', headerBackTitle: 'Back' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
      >
        <View style={[styles.statusPill, { backgroundColor: `${statusMeta.color}22` }]}>
          <Text style={[styles.statusPillText, { color: statusMeta.color }]}>
            {isRide && order.status === 'delivered' ? 'Completed' : statusMeta.label}
          </Text>
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

        {role === 'customer' && (order.status === 'accepted' || order.status === 'picked_up') && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Driver location</Text>
            {driverLoc == null ? (
              <Text style={[styles.note, { color: c.muted }]}>Waiting for your driver to share their location.</Text>
            ) : (() => {
              const ageSec = Math.max(0, Math.floor((nowTick - parseTs(driverLoc.updated_at)) / 1000));
              const target = order.status === 'accepted'
                ? { lat: order.point_a_lat, lng: order.point_a_lng, label: 'pickup' }
                : { lat: order.point_b_lat, lng: order.point_b_lng, label: 'drop-off' };
              const km = target.lat != null && target.lng != null
                ? haversineKm(driverLoc.lat, driverLoc.lng, target.lat, target.lng)
                : null;
              return (
                <>
                  {ageSec > 120 ? (
                    <>
                      <Text style={[styles.sectionText, { color: AMBER }]}>
                        Location not updating — the driver may have switched apps.
                      </Text>
                      <Text style={[styles.note, { color: c.muted }]}>Last seen {formatAge(ageSec)}</Text>
                    </>
                  ) : km != null ? (
                    <>
                      <Text style={[styles.sectionText, { color: c.text, fontWeight: '700' }]}>
                        Driver is {formatDistance(km)} from {target.label} · about {formatEta(km)}
                      </Text>
                      <Text style={[styles.note, { color: c.muted }]}>Estimate at city speed · updated {formatAge(ageSec)}</Text>
                    </>
                  ) : (
                    <Text style={[styles.note, { color: c.muted }]}>Driver location updated {formatAge(ageSec)}</Text>
                  )}
                  <Pressable
                    onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${driverLoc.lat},${driverLoc.lng}`)}
                    style={({ pressed }) => [styles.secondaryButton, { borderColor: BLUE, marginTop: 10 }, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: BLUE }]}>📍 See driver in Maps</Text>
                  </Pressable>
                </>
              );
            })()}
          </View>
        )}

        {order.status === 'open' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionText, { color: c.muted }]}>
              Your order is live on the Wall. We&apos;ll update this screen the moment an agent accepts it.
            </Text>
            {order.pricing_mode === 'auction' && bidSummary && bidSummary.count > 0 && (
              <>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <Text style={[styles.sectionText, { color: c.text }]}>
                  {bidSummary.count} {bidSummary.count === 1 ? 'bid' : 'bids'} so far
                  {bidSummary.lowestPaise != null ? ` — lowest offer ${formatRupees(bidSummary.lowestPaise)}` : ''}
                </Text>
                <Pressable
                  onPress={() => router.push('/my-orders')}
                  style={({ pressed }) => [styles.secondaryButton, { borderColor: BLUE, marginTop: 10 }, pressed && { opacity: 0.6 }]}
                >
                  <Text style={[styles.secondaryButtonText, { color: BLUE }]}>Review and accept a bid</Text>
                </Pressable>
              </>
            )}
            <Pressable
              onPress={handleCancelOrderPress}
              style={({ pressed }) => [styles.primaryButton, { backgroundColor: RED, marginTop: 12 }, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.primaryButtonText}>Cancel order</Text>
            </Pressable>
          </View>
        )}

        {order.status === 'accepted' && role === 'customer' && (
          <>
            <AgentCard
              agent={agentProfile}
              c={c}
              onContact={handleContactAgent}
              resolvedAmountPaise={resolvedAmountPaise}
              showPayment={true}
              chatUnread={chatUnread}
              onOpenChat={openChat}
            />
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
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <Pressable
                onPress={handleCancelOrderPress}
                style={({ pressed }) => [styles.primaryButton, { backgroundColor: RED }, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.primaryButtonText}>Cancel order</Text>
              </Pressable>
            </View>
          </>
        )}

        {order.status === 'accepted' && role === 'agent' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <MapsButton label="Open pickup location in Maps" onPress={() => handleOpenMaps(order.point_a_lat, order.point_a_lng)} />
            <Pressable
              onPress={handleContactCustomer}
              disabled={!customerProfile?.phone_number}
              style={({ pressed }) => [
                styles.secondaryButton, { borderColor: BLUE, marginTop: 10 },
                (pressed || !customerProfile?.phone_number) && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: BLUE }]}>📞 Contact</Text>
            </Pressable>
            <Pressable
              onPress={openChat}
              style={({ pressed }) => [
                styles.secondaryButton, { borderColor: chatUnread ? RED : BLUE, marginTop: 10 },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: chatUnread ? RED : BLUE }]}>
                {chatUnread ? '💬 Chat • New message' : '💬 Chat'}
              </Text>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Enter pickup code</Text>
            <Text style={[styles.note, { color: c.muted, marginBottom: 10 }]}>
              Ask the customer to read out their pickup code.
            </Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: c.inputBg, color: c.text },
                fieldErrors.has('otpInput') && styles.inputError,
              ]}
              value={otpInput}
              onChangeText={(v) => {
                setOtpInput(v);
                setFieldErrors((prev) => {
                  if (!prev.has('otpInput')) return prev;
                  const next = new Set(prev);
                  next.delete('otpInput');
                  return next;
                });
              }}
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
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            {showAgentCancelForm ? (
              <>
                <Text style={[styles.sectionLabel, { color: c.muted }]}>Reason for cancelling</Text>
                <TextInput
                  style={[styles.input, styles.commentInput, { backgroundColor: c.inputBg, color: c.text }]}
                  value={agentCancelReason}
                  onChangeText={setAgentCancelReason}
                  placeholder="Why can't you complete this delivery?"
                  placeholderTextColor={c.muted}
                  multiline
                />
                <Pressable
                  onPress={handleAgentCancelOrder}
                  disabled={cancellingOrder}
                  style={({ pressed }) => [styles.primaryButton, { backgroundColor: RED }, (pressed || cancellingOrder) && { opacity: 0.7 }]}
                >
                  <Text style={styles.primaryButtonText}>{cancellingOrder ? 'Cancelling…' : 'Confirm Cancellation'}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={handleAgentCancelPress}
                style={({ pressed }) => [styles.secondaryButton, { borderColor: RED }, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.secondaryButtonText, { color: RED }]}>Cancel this delivery</Text>
              </Pressable>
            )}
          </View>
        )}

        {order.status === 'picked_up' && role === 'customer' && !isRide && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <MapsButton label="Open dropoff location in Maps" onPress={() => handleOpenMaps(order.point_b_lat, order.point_b_lng)} />
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <Text style={[styles.sectionLabel, { color: c.muted }]}>Seal check</Text>
            {photoExists === null ? (
              <ActivityIndicator color={BLUE} style={{ marginTop: 8 }} />
            ) : photoExists ? (
              <>
                <Text style={[styles.note, { color: c.muted, marginBottom: 10 }]}>
                  Your agent has submitted a delivery photo. Check it, then confirm whether the seal arrived
                  intact.
                </Text>
                {deliveryPhotoUrl ? (
                  <Image
                    source={{ uri: deliveryPhotoUrl }}
                    style={styles.deliveryPhoto}
                    resizeMode="cover"
                  />
                ) : loadingDeliveryPhoto ? (
                  <ActivityIndicator color={BLUE} style={{ marginBottom: 12 }} />
                ) : null}
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

        {order.status === 'picked_up' && role === 'customer' && isRide && (
          <>
            <AgentCard
              agent={agentProfile}
              c={c}
              onContact={handleContactAgent}
              resolvedAmountPaise={resolvedAmountPaise}
              showPayment={true}
              chatUnread={chatUnread}
              onOpenChat={openChat}
            />
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <MapsButton label="Open dropoff location in Maps" onPress={() => handleOpenMaps(order.point_b_lat, order.point_b_lng)} />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Text style={[styles.sectionText, { color: c.muted }]}>Trip in progress</Text>
              {order.arrived_at != null && (
                <>
                  <View style={[styles.divider, { backgroundColor: c.border }]} />
                  <Text style={[styles.sectionText, { color: c.text }]}>
                    Your driver has arrived. Pay your driver, then they will end the ride.
                  </Text>
                  <Pressable
                    onPress={handleRiderPaid}
                    disabled={order.rider_paid_at != null || markingPaid}
                    style={({ pressed }) => [
                      styles.primaryButton, { marginTop: 12 },
                      (pressed || order.rider_paid_at != null || markingPaid) && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {order.rider_paid_at != null ? "Paid ✓ Waiting for your driver to confirm" : (markingPaid ? 'Sending…' : "I've paid")}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </>
        )}

        {order.status === 'picked_up' && role === 'agent' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <MapsButton label="Open dropoff location in Maps" onPress={() => handleOpenMaps(order.point_b_lat, order.point_b_lng)} />
            <Pressable
              onPress={handleContactCustomer}
              disabled={!customerProfile?.phone_number}
              style={({ pressed }) => [
                styles.secondaryButton, { borderColor: BLUE, marginTop: 10 },
                (pressed || !customerProfile?.phone_number) && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: BLUE }]}>📞 Contact</Text>
            </Pressable>
            <Pressable
              onPress={openChat}
              style={({ pressed }) => [
                styles.secondaryButton, { borderColor: chatUnread ? RED : BLUE, marginTop: 10 },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.secondaryButtonText, { color: chatUnread ? RED : BLUE }]}>
                {chatUnread ? '💬 Chat • New message' : '💬 Chat'}
              </Text>
            </Pressable>
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            {isRide ? (
              order.arrived_at == null ? (
                <Pressable
                  onPress={handleArriveAtDropoff}
                  disabled={arrivingAtDropoff}
                  style={({ pressed }) => [styles.primaryButton, (pressed || arrivingAtDropoff) && { opacity: 0.7 }]}
                >
                  <Text style={styles.primaryButtonText}>{arrivingAtDropoff ? 'Marking arrival…' : "📍 I've arrived at drop-off"}</Text>
                </Pressable>
              ) : (
                <>
                  {order.rider_paid_at != null ? (
                    <Text style={[styles.sectionText, { color: GREEN, fontWeight: '700' }]}>
                      ✅ Customer says they&apos;ve paid. Check your UPI app, then complete the ride.
                    </Text>
                  ) : (
                    <Text style={[styles.note, { color: c.muted }]}>Waiting for the customer to pay</Text>
                  )}
                  <Pressable
                    onPress={handleCompleteRidePress}
                    disabled={completingRide}
                    style={({ pressed }) => [
                      styles.primaryButton, { backgroundColor: GREEN, marginTop: 10 },
                      (pressed || completingRide) && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>{completingRide ? 'Completing…' : 'Payment received & complete ride'}</Text>
                  </Pressable>
                </>
              )
            ) : (
              <>
                <Text style={[styles.sectionLabel, { color: c.muted }]}>Delivery photo</Text>
                {photoExists ? (
                  <>
                    <Text style={[styles.note, { color: c.muted }]}>
                      Photo submitted — waiting for the customer to confirm the seal.
                    </Text>
                    {deliveryPhotoUrl && (
                      <Image
                        source={{ uri: deliveryPhotoUrl }}
                        style={styles.deliveryPhoto}
                        resizeMode="cover"
                      />
                    )}
                  </>
                ) : (
                  <Pressable
                    onPress={pickDeliveryPhoto}
                    disabled={uploadingPhoto}
                    style={({ pressed }) => [styles.primaryButton, (pressed || uploadingPhoto) && { opacity: 0.7 }]}
                  >
                    <Text style={styles.primaryButtonText}>{uploadingPhoto ? 'Submitting…' : '📷 Submit delivery photo'}</Text>
                  </Pressable>
                )}
              </>
            )}
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            {showAgentCancelForm ? (
              <>
                <Text style={[styles.sectionLabel, { color: c.muted }]}>Reason for cancelling</Text>
                <TextInput
                  style={[styles.input, styles.commentInput, { backgroundColor: c.inputBg, color: c.text }]}
                  value={agentCancelReason}
                  onChangeText={setAgentCancelReason}
                  placeholder="Why can't you complete this delivery?"
                  placeholderTextColor={c.muted}
                  multiline
                />
                <Pressable
                  onPress={handleAgentCancelOrder}
                  disabled={cancellingOrder}
                  style={({ pressed }) => [styles.primaryButton, { backgroundColor: RED }, (pressed || cancellingOrder) && { opacity: 0.7 }]}
                >
                  <Text style={styles.primaryButtonText}>{cancellingOrder ? 'Cancelling…' : 'Confirm Cancellation'}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                onPress={handleAgentCancelPress}
                style={({ pressed }) => [styles.secondaryButton, { borderColor: RED }, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.secondaryButtonText, { color: RED }]}>Cancel this delivery</Text>
              </Pressable>
            )}
          </View>
        )}

        {order.status === 'delivered' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {isRide ? (
              <Text style={[styles.sealResultText, { color: GREEN }]}>✅ Ride completed</Text>
            ) : (
              <>
                <Text style={[styles.sectionLabel, { color: c.muted }]}>Seal check result</Text>
                {sealResult ? (
                  <Text style={[styles.sealResultText, { color: sealResult === 'intact' ? GREEN : RED }]}>
                    {sealResult === 'intact' ? '✅ Seal was intact' : '⚠️ Seal was reported broken'}
                  </Text>
                ) : (
                  <Text style={[styles.note, { color: c.muted }]}>No seal check on file.</Text>
                )}
              </>
            )}
            {complaintStatus && (
              <View style={[styles.complaintBanner, { backgroundColor: `${AMBER}22`, borderColor: AMBER }]}>
                <Text style={[styles.complaintText, { color: AMBER }]}>
                  A complaint was raised for this order — status: {complaintStatus}.
                </Text>
              </View>
            )}
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <Text style={[styles.sectionLabel, { color: c.muted }]}>
              {role === 'customer' ? 'Rate your agent' : 'Rate the customer'}
            </Text>
            {ratingLoading ? (
              <ActivityIndicator color={BLUE} style={{ marginTop: 4 }} />
            ) : myRating ? (
              <>
                <Text style={[styles.starDisplay, { color: AMBER }]}>
                  {'★'.repeat(myRating.stars)}
                  {'☆'.repeat(5 - myRating.stars)}
                </Text>
                {!!myRating.comment && <Text style={[styles.note, { color: c.muted }]}>{myRating.comment}</Text>}
              </>
            ) : role === 'agent' && (myDeliveryCount ?? 0) < 10 ? (
              <Text style={[styles.note, { color: c.muted }]}>
                Rate customers once you&apos;ve completed 10 deliveries — {10 - (myDeliveryCount ?? 0)} to go.
              </Text>
            ) : (
              <>
                <StarPicker value={ratingStars} onChange={setRatingStars} c={c} />
                <Text style={[styles.note, { color: c.muted, marginTop: -4, marginBottom: 8 }]}>{ratingStars > 0 ? `${ratingStars} of 5` : 'Tap a star to rate'}</Text>
                <TextInput
                  style={[styles.input, styles.commentInput, { backgroundColor: c.inputBg, color: c.text }]}
                  value={ratingComment}
                  onChangeText={setRatingComment}
                  placeholder="Add a comment (optional)"
                  placeholderTextColor={c.muted}
                  multiline
                />
                <Pressable
                  onPress={handleSubmitRating}
                  disabled={submittingRating}
                  style={({ pressed }) => [styles.primaryButton, (pressed || submittingRating) && { opacity: 0.7 }]}
                >
                  <Text style={styles.primaryButtonText}>{submittingRating ? 'Submitting…' : 'Submit rating'}</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {order.status === 'cancelled' && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.sectionText, { color: c.muted }]}>This order was cancelled.</Text>
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={role === 'customer' && isRide && order.status === 'picked_up' && order.arrived_at != null && !paymentSheetDismissed}
        animationType="slide"
        transparent
        onRequestClose={() => setPaymentSheetDismissed(true)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>You&apos;ve arrived</Text>
            <Text style={[styles.modalAmount, { color: c.text }]}>{formatRupees(resolvedAmountPaise)}</Text>
            {agentProfile && (
              <UpiPayBlock agent={agentProfile} resolvedAmountPaise={resolvedAmountPaise} c={c} />
            )}
            <Pressable
              onPress={handleRiderPaid}
              disabled={order.rider_paid_at != null || markingPaid}
              style={({ pressed }) => [
                styles.primaryButton, { marginTop: 14 },
                (pressed || order.rider_paid_at != null || markingPaid) && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {order.rider_paid_at != null ? "Paid ✓ Waiting for your driver to confirm" : (markingPaid ? 'Sending…' : "I've paid")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setPaymentSheetDismissed(true)}
              style={({ pressed }) => [styles.secondaryButton, { borderColor: BLUE, marginTop: 10 }, pressed && { opacity: 0.6 }]}
            >
              <Text style={[styles.secondaryButtonText, { color: BLUE }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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

function StarPicker({ value, onChange, c }: { value: number; onChange: (n: number) => void; c: Palette }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} hitSlop={12}>
          <Text style={[styles.starChar, { color: n <= value ? AMBER : c.muted }]}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Shared by AgentCard's accepted/picked_up (ride) states and the ride
// payment sheet — same upi://pay URI, same fallback note when the agent
// hasn't set up UPI or the amount hasn't resolved yet.
function UpiPayBlock({
  agent, resolvedAmountPaise, c,
}: {
  agent: AgentProfile;
  resolvedAmountPaise: number | null;
  c: Palette;
}) {
  const upiUri =
    agent.upi_id && resolvedAmountPaise != null
      ? `upi://pay?pa=${encodeURIComponent(agent.upi_id)}&pn=${encodeURIComponent(`${agent.first_name} ${agent.last_name}`)}&am=${(resolvedAmountPaise / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent('Gen-D order')}`
      : null;

  async function handlePayViaUpi() {
    if (!upiUri) return;
    try {
      await Linking.openURL(upiUri);
    } catch {
      Alert.alert('No UPI app found', 'Install a UPI payment app to pay directly, or use the QR code below.');
    }
  }

  if (!upiUri) {
    return (
      <Text style={[styles.note, { color: c.muted, marginTop: 10 }]}>
        Your driver hasn&apos;t shared a UPI ID. Ask them in chat or pay in cash.
      </Text>
    );
  }

  return (
    <>
      <Pressable
        onPress={handlePayViaUpi}
        style={({ pressed }) => [styles.secondaryButton, { borderColor: GREEN, marginTop: 10 }, pressed && { opacity: 0.6 }]}
      >
        <Text style={[styles.secondaryButtonText, { color: GREEN }]}>💳 Pay via UPI</Text>
      </Pressable>
      <View style={styles.qrWrap}>
        <QRCode value={upiUri} size={180} />
        <Text style={[styles.qrCaption, { color: c.muted }]}>Or scan to pay</Text>
      </View>
    </>
  );
}

function AgentCard({
  agent, c, onContact, resolvedAmountPaise, showPayment, chatUnread, onOpenChat,
}: {
  agent: AgentProfile | null;
  c: Palette;
  onContact: () => void;
  resolvedAmountPaise: number | null;
  showPayment: boolean;
  chatUnread: boolean;
  onOpenChat: () => void;
}) {
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
        <AgentAvatar firstName={agent.first_name} lastName={agent.last_name} avatarUrl={agent.avatar_url} size={56} color={BLUE} />
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
      <Pressable
        onPress={onOpenChat}
        style={({ pressed }) => [
          styles.secondaryButton, { borderColor: chatUnread ? RED : BLUE, marginTop: 10 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={[styles.secondaryButtonText, { color: chatUnread ? RED : BLUE }]}>
          {chatUnread ? '💬 Chat • New message' : '💬 Chat'}
        </Text>
      </Pressable>
      {showPayment && <UpiPayBlock agent={agent} resolvedAmountPaise={resolvedAmountPaise} c={c} />}
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
  inputError: { borderWidth: 1.5, borderColor: RED },

  primaryButton: { backgroundColor: BLUE, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },

  secondaryButton: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 13, alignItems: 'center' },
  secondaryButtonText: { fontSize: 14, fontWeight: '700' },

  otpDisplay: { fontSize: 32, fontWeight: '800', letterSpacing: 6, textAlign: 'center', marginVertical: 6 },

  deliveryPhoto: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, marginBottom: 12 },

  sealRow: { flexDirection: 'row', gap: 10 },
  sealButton: { flex: 1 },
  sealResultText: { fontSize: 16, fontWeight: '700' },

  complaintBanner: { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 12 },
  complaintText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },

  starRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  starChar: { fontSize: 34 },
  starDisplay: { fontSize: 24, marginVertical: 2 },
  commentInput: {
    textAlign: 'left', letterSpacing: 0, fontSize: 14, minHeight: 70, textAlignVertical: 'top',
  },

  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  agentNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  agentName: { fontSize: 16, fontWeight: '800' },
  agentMeta: { fontSize: 12, marginTop: 2 },
  levelPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  levelPillText: { fontSize: 11, fontWeight: '700' },
  qrWrap: { alignItems: 'center', marginTop: 14, gap: 6 },
  qrCaption: { fontSize: 12, alignSelf: 'stretch', textAlign: 'center' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 20, paddingBottom: 32, gap: 4 },
  modalTitle: { fontSize: 20, fontWeight: '800' },
  modalAmount: { fontSize: 28, fontWeight: '800', marginTop: 4, marginBottom: 6 },
});
