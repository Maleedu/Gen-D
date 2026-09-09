import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme,
  FlatList, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../../lib/supabase';

const BLUE = '#1877F2';
const RED = '#E41E3F';

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
  bg: string; text: string; muted: string; inputBg: string; card: string; border: string;
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
    inputBg: isDark ? '#1a1a1a' : '#f5f6f8',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
  };

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Read inside the realtime callback below instead of closing over
  // currentUserId directly — the channel subscribes once orderId is known,
  // before currentUserId is necessarily set, same guard shape as roleRef in
  // order/[id]/index.tsx.
  const currentUserIdRef = useRef<string | null>(null);
  // The logged-in user's own profile, fetched once — used to build the
  // optimistic message locally without a full refetch after sending.
  const [ownProfile, setOwnProfile] = useState<SenderProfile | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

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
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setCurrentUserId(user.id);
      const [{ data: profile }] = await Promise.all([
        supabase
          .from('profiles')
          .select('first_name, last_name, avatar_url')
          .eq('id', user.id)
          .maybeSingle(),
        loadMessages(),
      ]);
      if (profile) setOwnProfile(profile as SenderProfile);
      setLoading(false);
    })();
  }, [loadMessages]);

  // Live updates for messages the other party sends while this screen is
  // open. Only set up once orderId is known, same as loadBids in
  // my-orders.tsx only runs once reviewingOrderId is set.
  useEffect(() => {
    if (!orderId) return;
    const channel = supabase
      .channel(`order-messages-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_messages', filter: `order_id=eq.${orderId}` },
        async (payload) => {
          const row = payload.new as Omit<ChatMessage, 'sender'>;
          // Own inserts already landed optimistically via handleSend — skip
          // to avoid double-adding the same message. currentUserIdRef guards
          // against this firing before currentUserId is set during initial
          // load (nothing to compare against yet, so nothing to skip).
          if (!currentUserIdRef.current || row.sender_id === currentUserIdRef.current) return;
          const { data: profile } = await supabase
            .from('profiles')
            .select('first_name, last_name, avatar_url')
            .eq('id', row.sender_id)
            .maybeSingle();
          setMessages((prev) => [
            ...(prev ?? []),
            { ...row, sender: profile ?? { first_name: '', last_name: '', avatar_url: null } },
          ]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId]);

  async function handleSend() {
    const body = draft.trim();
    if (!body) {
      setFieldErrors(new Set(['draft']));
      return;
    }
    if (!orderId || !currentUserId) return;
    setSending(true);
    setSendError(null);
    const { data, error } = await supabase
      .from('order_messages')
      .insert({ order_id: orderId, sender_id: currentUserId, body })
      .select('id, order_id, sender_id, body, created_at')
      .single();
    setSending(false);
    if (error || !data) {
      setSendError(error?.message ?? 'Could not send message. Try again.');
      return;
    }
    setDraft('');
    setMessages((prev) => [
      ...(prev ?? []),
      { ...data, sender: ownProfile ?? { first_name: '', last_name: '', avatar_url: null } },
    ]);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.backText, { color: BLUE }]}>‹ Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>Chat</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={BLUE} />
          </View>
        ) : loadError ? (
          <View style={styles.centerFill}>
            <Text style={[styles.errorText, { color: c.text }]}>{loadError}</Text>
          </View>
        ) : (
          <>
            <FlatList
              style={styles.messageList}
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

            {sendError ? (
              <Text style={[styles.sendErrorText, { color: RED }]}>{sendError}</Text>
            ) : null}

            <View style={[styles.inputRow, { borderTopColor: c.border }]}>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text },
                  fieldErrors.has('draft') && styles.inputError,
                ]}
                value={draft}
                onChangeText={(v) => {
                  setDraft(v);
                  setSendError(null);
                  setFieldErrors((prev) => {
                    if (!prev.has('draft')) return prev;
                    const next = new Set(prev);
                    next.delete('draft');
                    return next;
                  });
                }}
                placeholder="Message…"
                placeholderTextColor={c.muted}
                multiline
              />
              <Pressable
                style={({ pressed }) => [styles.sendButton, (pressed || sending) && { opacity: 0.7 }]}
                onPress={handleSend}
                disabled={sending}
              >
                <Text style={styles.sendButtonText}>{sending ? 'Sending…' : 'Send'}</Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAvoidingView>
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
  keyboardAvoider: { flex: 1 },
  messageList: { flex: 1 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  inputError: { borderWidth: 1.5, borderColor: RED },
  sendButton: { backgroundColor: BLUE, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  sendButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  sendErrorText: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 },
});
