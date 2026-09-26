import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const NOTICE_SEEN_KEY = 'gend_location_share_notice_seen';
const HEARTBEAT_INTERVAL_MS = 12000;

// Mounted once at the app root (see app/_layout.tsx) and renders nothing.
// While the signed-in user is the assigned agent on at least one order in
// 'accepted' or 'picked_up', it periodically reports their position via
// update_driver_location (RPC-enforced: only succeeds for that agent, only
// for those two statuses) so the customer's tracking screen can show it.
export default function DriverLocationSharer() {
  const [userId, setUserId] = useState<string | null>(null);
  const [activeOrderIds, setActiveOrderIds] = useState<string[]>([]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // This component lives for the whole app lifetime (mounted above the
  // login gate in _layout.tsx), so it tracks sign-in/out itself rather than
  // assuming a fixed user for its mounted lifetime.
  useEffect(() => {
    let ignore = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!ignore) setUserId(user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!ignore) setUserId(session?.user?.id ?? null);
    });
    return () => {
      ignore = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadActiveOrderIds = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('orders')
      .select('id')
      .eq('accepted_agent_id', uid)
      .in('status', ['accepted', 'picked_up']);
    if (error || !mountedRef.current) return;
    const next = (data ?? []).map((o) => o.id).sort();
    setActiveOrderIds((prev) => (prev.join(',') === next.join(',') ? prev : next));
  }, []);

  // Reloads the active-order list on user change, on any realtime change to
  // one of this agent's orders (debounced), and whenever the app returns to
  // the foreground — a status flip may have happened while backgrounded.
  useEffect(() => {
    if (!userId) {
      // No reset needed here — the heartbeat effect below independently
      // gates on !userId, so a stale non-empty activeOrderIds is inert
      // until loadActiveOrderIds overwrites it on the next sign-in.
      return;
    }
    loadActiveOrderIds(userId);

    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`driver-sharer-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `accepted_agent_id=eq.${userId}` },
        () => {
          if (refreshTimeout) clearTimeout(refreshTimeout);
          refreshTimeout = setTimeout(() => {
            loadActiveOrderIds(userId);
          }, 300);
        },
      )
      .subscribe();

    const appStateSub = AppState.addEventListener('change', (next) => {
      if (next === 'active') loadActiveOrderIds(userId);
    });

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      supabase.removeChannel(channel);
      appStateSub.remove();
    };
  }, [userId, loadActiveOrderIds]);

  // The actual heartbeat. tickInFlightRef guards against a slow
  // getCurrentPositionAsync call overlapping the next scheduled tick.
  const tickInFlightRef = useRef(false);
  const idsKey = activeOrderIds.join(',');
  // Foreground only: sharing pauses while the app is in the background.
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0 || !userId) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function sendLocationTick(ids: string[]) {
      if (tickInFlightRef.current) return;
      tickInFlightRef.current = true;
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        for (const id of ids) {
          const { error } = await supabase.rpc('update_driver_location', {
            p_order_id: id,
            p_lat: pos.coords.latitude,
            p_lng: pos.coords.longitude,
          });
          if (error) {
            console.warn('update_driver_location failed', error.message);
            if (userId) loadActiveOrderIds(userId);
          }
        }
      } catch (err) {
        console.warn('getCurrentPositionAsync failed', err);
      } finally {
        tickInFlightRef.current = false;
      }
    }

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled || status !== 'granted') return;

      let noticeSeen: string | null = null;
      try {
        noticeSeen = await AsyncStorage.getItem(NOTICE_SEEN_KEY);
      } catch {
        noticeSeen = null;
      }
      if (!noticeSeen) {
        Alert.alert(
          'Location sharing',
          'While you have an active delivery or ride, your live location is shared with the customer until it is completed.',
        );
        AsyncStorage.setItem(NOTICE_SEEN_KEY, '1').catch(() => {});
      }
      if (cancelled) return;

      sendLocationTick(ids);
      intervalId = setInterval(() => {
        sendLocationTick(ids);
      }, HEARTBEAT_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [idsKey, userId, loadActiveOrderIds]);

  return null;
}
