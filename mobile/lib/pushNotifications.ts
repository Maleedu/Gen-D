import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

// Registers this device for push notifications and links its Expo push
// token to the given profile in push_tokens. Best-effort only: nothing in
// here should ever throw or block the caller — a failure just means this
// device won't get pushes, not that the app breaks.
export async function registerForPushNotifications(profileId: string): Promise<void> {
  try {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }

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
