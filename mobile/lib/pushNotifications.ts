import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// expo-notifications' remote (push) notification functionality was removed
// from Expo Go as of SDK 53 — importing/calling it there throws. We detect
// Expo Go via Constants.appOwnership and, when running under it, skip
// notifications entirely rather than let the import or any API call throw.
// A real device / dev-client build has appOwnership !== 'expo', so behavior
// there is unchanged.
const isExpoGo = Constants.appOwnership === 'expo';

// Registers this device for push notifications and links its Expo push
// token to the given profile in push_tokens. Best-effort only: nothing in
// here should ever throw or block the caller — a failure just means this
// device won't get pushes, not that the app breaks.
export async function registerForPushNotifications(profileId: string): Promise<void> {
  try {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }

    if (isExpoGo) {
      console.log('[pushNotifications] running in Expo Go, push notifications unavailable — skipping registration');
      return;
    }

    // Deferred until we know we're not in Expo Go, so the native module is
    // never loaded (and never throws) under Expo Go.
    const Notifications = await import('expo-notifications');

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') {
      console.log('[pushNotifications] permission not granted, skipping registration');
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // claim_push_token handles both clearing any other profile's row for
    // this exact token (shared device, account switch) and upserting this
    // profile's own row, server-side.
    const { error } = await supabase.rpc('claim_push_token', {
      p_token: token,
      p_platform: Platform.OS,
    });
    if (error) throw error;
  } catch (err) {
    console.log('[pushNotifications] registration failed:', err);
  }
}
