import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { useViewMode } from '../lib/view-mode';

const NOTICE_SEEN_KEY = 'gend_wall_presence_notice_seen';
const HEARTBEAT_MS = 60000;

// Foreground only — same constraint as driver-location-sharer.tsx; no
// background location permission is requested or used here.
export default function AgentWallPresence() {
  const [userId, setUserId] = useState<string | null>(null);
  const { mode } = useViewMode();

  // Guards against an in-flight tick overlapping the next interval fire
  // (e.g. a slow getCurrentPositionAsync call) — persists across the effect
  // below re-running, since it's a ref, not state scoped to one run.
  const tickingRef = useRef(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const sendHeartbeat = useCallback(async (agentId: string) => {
    if (tickingRef.current) return;
    tickingRef.current = true;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { error } = await supabase.from('agent_locations').upsert({
        profile_id: agentId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        updated_at: new Date().toISOString(),
      });
      if (error) console.warn('agent_locations upsert failed', error.message);
    } catch (err) {
      console.warn('agent_locations heartbeat failed', err);
    } finally {
      tickingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!userId || mode !== 'driver') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled || status !== 'granted') return;

      const seen = await AsyncStorage.getItem(NOTICE_SEEN_KEY).catch(() => null);
      if (!seen) {
        Alert.alert(
          'Location for nearby orders',
          "While you're in Agent mode, your approximate location is used to notify you about new orders nearby.",
        );
        AsyncStorage.setItem(NOTICE_SEEN_KEY, '1').catch(() => {});
      }

      if (cancelled) return;
      sendHeartbeat(userId);
      interval = setInterval(() => sendHeartbeat(userId), HEARTBEAT_MS);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [userId, mode, sendHeartbeat]);

  return null;
}
