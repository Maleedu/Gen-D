import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme,
  FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../../lib/supabase';

const BLUE = '#1877F2';

type SenderProfile = {
  first_name: string;
  last_name: string;
  avatar_url: string | null;
};

type ChatMessage = {
  id: string;
  order_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender: SenderProfile;
};

type Palette = {
  bg: string; text: string; muted: string; card: string; border: string;
};

function formatRelativeTime(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const orderId = Array.isArray(params.id) ? params.id[0] : params.id;

  const isDark = useColorScheme() === 'dark';
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
  };

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Static fetch only for this step — realtime updates and sending a new
  // message are separate follow-up steps, not built here.
  const loadMessages = useCallback(async () => {
    if (!orderId) return;
    const { data: rows, error } = await supabase
      .from('order_messages')
      .select('id, order_id, sender_id, body, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });
    if (error) {
      setLoadError(error.message);
      return;
    }
    // Joined the same way my-orders.tsx joins bids with bidder profiles:
    // one batched `in` query rather than a relational select, then merged
    // client-side. RLS ("profiles: anyone can read") already lets this
    // resolve for either party.
    const senderIds = [...new Set((rows ?? []).map((m) => m.sender_id))];
    const profilesById: Record<string, SenderProfile> = {};
    if (senderIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, avatar_url')
        .in('id', senderIds);
      for (const p of profiles ?? []) profilesById[p.id] = p as unknown as SenderProfile;
    }
    const merged: ChatMessage[] = (rows ?? [])
      .filter((m) => profilesById[m.sender_id])
      .map((m) => ({ ...m, sender: profilesById[m.sender_id] }));
    setMessages(merged);
  }, [orderId]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setCurrentUserId(user.id);
      await loadMessages();
      setLoading(false);
    })();
  }, [loadMessages]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>Chat</Text>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
        </View>
      ) : loadError ? (
        <View style={styles.centerFill}>
          <Text style={[styles.errorText, { color: c.text }]}>{loadError}</Text>
        </View>
      ) : (
        <FlatList
          data={messages ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.centerFill}>
              <Text style={[styles.emptyText, { color: c.muted }]}>No messages yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <MessageBubble message={item} isOwn={item.sender_id === currentUserId} c={c} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function MessageBubble({
  message, isOwn, c,
}: { message: ChatMessage; isOwn: boolean; c: Palette }) {
  return (
    <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
      <View
        style={[
          styles.bubble,
          isOwn
            ? { backgroundColor: BLUE, borderBottomRightRadius: 4 }
            : {
              backgroundColor: c.card,
              borderColor: c.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderBottomLeftRadius: 4,
            },
        ]}
      >
        <Text style={[styles.bubbleText, { color: isOwn ? '#ffffff' : c.text }]}>{message.body}</Text>
        <Text style={[styles.bubbleTime, { color: isOwn ? '#dbe8fe' : c.muted }]}>
          {formatRelativeTime(message.created_at)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  backText: { fontSize: 15, fontWeight: '700' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  emptyText: { fontSize: 14 },
  list: { padding: 16, paddingBottom: 40, gap: 10, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTime: { fontSize: 11 },
});
