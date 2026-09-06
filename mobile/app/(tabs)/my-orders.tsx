import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  FlatList, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { AgentAvatar } from '../../components/agent-avatar';
import { useViewMode } from '../../lib/view-mode';
import { EXPLAINER_BANNER_KEYS, useExplainerBanner } from '../../lib/explainer-banners';
import { ExplainerBanner } from '../../components/explainer-banner';

const BLUE = '#1877F2';
const AMBER = '#B7791F';
const GREEN = '#1F9254';
const NEUTRAL = '#6b7280';

type OrderStatus = 'open' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';
type PricingMode = 'fixed' | 'auction';

type MyOrder = {
  id: string;
  item_description: string;
  status: OrderStatus;
  pricing_mode: PricingMode;
  price_paise: number | null;
  created_at: string;
};

type BidderProfile = {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  avg_rating_as_agent: number | null;
  completed_deliveries_count: number;
};

type BidWithProfile = {
  id: string;
  agent_id: string;
  offer_paise: number;
  profile: BidderProfile;
};

type Palette = {
  bg: string; text: string; muted: string;
  card: string; border: string;
};

// Every status except `open`, whose label also depends on pricing_mode (see
// statusMetaFor below) — `open` bidding orders read "Bids open" instead of
// "Waiting for an agent".
const STATUS_META: Record<Exclude<OrderStatus, 'open'>, { label: string; color: string }> = {
  accepted: { label: 'Agent on the way to pickup', color: BLUE },
  picked_up: { label: 'In transit', color: BLUE },
  delivered: { label: 'Delivered', color: GREEN },
  cancelled: { label: 'Cancelled', color: NEUTRAL },
};

function statusMetaFor(order: MyOrder): { label: string; color: string } {
  if (order.status === 'open') {
    return { label: order.pricing_mode === 'auction' ? 'Bids open' : 'Waiting for an agent', color: AMBER };
  }
  return STATUS_META[order.status];
}

function formatRupees(paise: number | null) {
  if (paise == null) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export default function MyOrdersScreen() {
  const isDark = useColorScheme() === 'dark';
  const { mode } = useViewMode();
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
  };

  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [bidCounts, setBidCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Non-null while the bid-review view for that order is open — swaps the
  // whole screen into that view instead of pushing a separate route (see the
  // customer-driver mode handover doc, section 6).
  const [reviewingOrderId, setReviewingOrderId] = useState<string | null>(null);
  const [bids, setBids] = useState<BidWithProfile[] | null>(null);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [bidsError, setBidsError] = useState<string | null>(null);
  const [submittingBidId, setSubmittingBidId] = useState<string | null>(null);
  const bidSelectionBanner = useExplainerBanner(EXPLAINER_BANNER_KEYS.bidSelection);

  const loadOrders = useCallback(async () => {
    setLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login');
      return;
    }
    // Customer mode ("View My Orders"): orders this person posted.
    // Agent mode ("View My Deliveries"): orders this person was accepted to
    // deliver — a different column entirely, not just a different filter
    // value on the same one.
    const filterColumn = mode === 'driver' ? 'accepted_agent_id' : 'customer_id';
    const { data, error } = await supabase
      .from('orders')
      .select('id, item_description, status, pricing_mode, price_paise, created_at')
      .eq(filterColumn, user.id)
      .order('created_at', { ascending: false });
    if (error) {
      setLoadError(error.message);
      setOrders([]);
      return;
    }
    const rows = (data ?? []) as unknown as MyOrder[];
    setOrders(rows);

    // Bid counts only matter for orders still open to bidding — bounded
    // query rather than one per card.
    const openAuctionIds = rows.filter((o) => o.status === 'open' && o.pricing_mode === 'auction').map((o) => o.id);
    if (openAuctionIds.length > 0) {
      const { data: bidRows } = await supabase.from('bids').select('order_id').in('order_id', openAuctionIds);
      const counts: Record<string, number> = {};
      for (const row of bidRows ?? []) counts[row.order_id] = (counts[row.order_id] ?? 0) + 1;
      setBidCounts(counts);
    } else {
      setBidCounts({});
    }
  }, [mode]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      await loadOrders();
      if (!ignore) setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [loadOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  // Bids joined with the bidding agent's profile — RLS ("bids: customer
  // views bids on their order", "profiles: anyone can read") already scopes
  // this correctly, no extra filtering needed client-side.
  const loadBids = useCallback(async (orderId: string) => {
    setBidsLoading(true);
    setBidsError(null);
    const { data: bidRows, error } = await supabase
      .from('bids')
      .select('id, agent_id, offer_paise')
      .eq('order_id', orderId)
      .order('offer_paise', { ascending: true });
    if (error) {
      setBidsError(error.message);
      setBidsLoading(false);
      return;
    }
    const agentIds = [...new Set((bidRows ?? []).map((b) => b.agent_id))];
    const profilesById: Record<string, BidderProfile> = {};
    if (agentIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url, avg_rating_as_agent, completed_deliveries_count')
        .in('id', agentIds);
      for (const p of profiles ?? []) profilesById[p.id] = p as unknown as BidderProfile;
    }
    const merged: BidWithProfile[] = (bidRows ?? [])
      .filter((b) => profilesById[b.agent_id])
      .map((b) => ({ id: b.id, agent_id: b.agent_id, offer_paise: b.offer_paise, profile: profilesById[b.agent_id] }));
    setBids(merged);
    setBidsLoading(false);
  }, []);

  useEffect(() => {
    if (!reviewingOrderId) return;
    const orderId = reviewingOrderId;
    async function startLoadingBids() {
      await loadBids(orderId);
    }
    startLoadingBids();
  }, [reviewingOrderId, loadBids]);

  function handleOrderPress(order: MyOrder) {
    if (order.status === 'open' && order.pricing_mode === 'auction') {
      setReviewingOrderId(order.id);
      return;
    }
    router.push({ pathname: '/order/[id]', params: { id: order.id } });
  }

  function handleSelectBid(bid: BidWithProfile) {
    // Irreversible from this screen (there's no "un-accept" flow) — confirm
    // before submitting, per the handover doc's explicit call-out.
    Alert.alert(
      'Accept this bid?',
      `Accept ${formatRupees(bid.offer_paise)} for this delivery? This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => confirmSelectBid(bid.id) },
      ],
    );
  }

  async function confirmSelectBid(bidId: string) {
    if (!reviewingOrderId) return;
    setSubmittingBidId(bidId);
    // accept_bid does all the verification (caller is the customer, order
    // still open, bid belongs to this order) and fires the same DB-side
    // logic as the direct agent-accept flow (pickup OTP, priority/speed
    // gates) — no client-side re-implementation of any of that, see the
    // handover doc. The one exception: if the order is no longer open (e.g.
    // someone else got assigned first), that's stale-state on this screen,
    // not a bid-specific rejection — recover the same way the old
    // "order changed" branch used to, by leaving the review view.
    const { error } = await supabase.rpc('accept_bid', {
      p_order_id: reviewingOrderId,
      p_bid_id: bidId,
    });
    setSubmittingBidId(null);
    if (error) {
      Alert.alert('Could not accept this bid', error.message);
      if (/no longer open/i.test(error.message)) {
        setReviewingOrderId(null);
        loadOrders();
      }
      return;
    }
    setReviewingOrderId(null);
    loadOrders();
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <BackButton />
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
        </View>
      </SafeAreaView>
    );
  }

  if (reviewingOrderId) {
    const reviewedOrder = orders?.find((o) => o.id === reviewingOrderId);
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
        <View style={styles.reviewHeader}>
          <Pressable onPress={() => setReviewingOrderId(null)} hitSlop={8}>
            <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
          </Pressable>
          <Text style={[styles.reviewTitle, { color: c.text }]} numberOfLines={1}>
            {reviewedOrder?.item_description ?? 'Review bids'}
          </Text>
        </View>
        {bidsLoading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : bidsError ? (
          <View style={styles.centerFill}>
            <Text style={[styles.errorText, { color: c.text }]}>{bidsError}</Text>
          </View>
        ) : (
          <FlatList
            data={bids ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              (bids?.length ?? 0) > 0 ? (
                <ExplainerBanner
                  seen={bidSelectionBanner.seen}
                  onDismiss={bidSelectionBanner.dismiss}
                  title="Choosing a bid"
                  body="These are all the offers agents have made on your order. Tap any bid to accept it — the agent is notified immediately and your order moves to pickup."
                  isDark={isDark}
                />
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.centerFill}>
                <Text style={{ color: c.muted, fontSize: 15 }}>No bids yet — check back soon.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <BidRow
                bid={item}
                c={c}
                submitting={submittingBidId === item.id}
                disabled={submittingBidId !== null}
                onSelect={() => handleSelectBid(item)}
              />
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <BackButton />
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: c.text }]}>{mode === 'driver' ? 'My Deliveries' : 'My Orders'}</Text>
      </View>
      <FlatList
        data={orders ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
        ListEmptyComponent={
          <View style={styles.centerFill}>
            <Text style={{ color: c.muted, fontSize: 15 }}>
              {loadError ?? (mode === 'driver'
                ? "You haven't delivered any parcels yet."
                : "You haven't posted any parcels yet.")}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <OrderRow order={item} bidCount={bidCounts[item.id]} onPress={() => handleOrderPress(item)} c={c} />
        )}
      />
    </SafeAreaView>
  );
}

function OrderRow({
  order, bidCount, onPress, c,
}: { order: MyOrder; bidCount: number | undefined; onPress: () => void; c: Palette }) {
  const meta = statusMetaFor(order);
  const isOpenBidding = order.status === 'open' && order.pricing_mode === 'auction';
  const rightText = isOpenBidding
    ? `${bidCount ?? 0} bid${(bidCount ?? 0) === 1 ? '' : 's'}`
    : formatRupees(order.price_paise);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: c.card, borderColor: c.border }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.statusPill, { backgroundColor: `${meta.color}22` }]}>
        <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
      </View>
      <Text style={[styles.description, { color: c.text }]} numberOfLines={2}>{order.item_description}</Text>
      <Text style={[styles.rightText, { color: c.muted }]}>{rightText}</Text>
    </Pressable>
  );
}

function BidRow({
  bid, c, submitting, disabled, onSelect,
}: { bid: BidWithProfile; c: Palette; submitting: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.bidRow}>
        <AgentAvatar
          firstName={bid.profile.first_name}
          lastName={bid.profile.last_name}
          avatarUrl={bid.profile.avatar_url}
          size={48}
          color={BLUE}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.agentName, { color: c.text }]}>{bid.profile.first_name} {bid.profile.last_name}</Text>
          <Text style={[styles.agentMeta, { color: c.muted }]}>
            {bid.profile.avg_rating_as_agent != null ? `⭐ ${bid.profile.avg_rating_as_agent.toFixed(1)}` : 'No rating yet'}
            {' · '}{bid.profile.completed_deliveries_count} deliveries
          </Text>
        </View>
        <Text style={[styles.offer, { color: c.text }]}>{formatRupees(bid.offer_paise)}</Text>
      </View>
      <Pressable
        onPress={onSelect}
        disabled={disabled}
        style={({ pressed }) => [styles.primaryButton, (pressed || disabled) && { opacity: 0.7 }]}
      >
        <Text style={styles.primaryButtonText}>{submitting ? 'Selecting…' : 'Select this bid'}</Text>
      </Pressable>
    </View>
  );
}

function BackButton() {
  return (
    <View style={styles.backRow}>
      <Pressable onPress={() => router.replace('/')} hitSlop={8}>
        <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },

  backRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },

  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },

  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  backText: { fontSize: 15, fontWeight: '700' },
  reviewTitle: { flex: 1, fontSize: 17, fontWeight: '800' },

  list: { padding: 16, paddingBottom: 40, gap: 14, flexGrow: 1 },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 6 },

  statusPill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  description: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  rightText: { fontSize: 13, fontWeight: '600' },

  bidRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  agentName: { fontSize: 15, fontWeight: '800' },
  agentMeta: { fontSize: 12, marginTop: 2 },
  offer: { fontSize: 16, fontWeight: '800' },

  primaryButton: { backgroundColor: BLUE, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
