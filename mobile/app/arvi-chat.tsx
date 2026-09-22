import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  ScrollView, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { BlurView } from 'expo-blur';
import { supabase } from '../lib/supabase';
import { CUSTOMER_COLOR } from '../lib/colors';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type Palette = {
  bg: string; text: string; muted: string; card: string; border: string; inputBg: string;
};

export default function ArviChatScreen() {
  const isDark = useColorScheme() === 'dark';
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
    inputBg: isDark ? '#1a1a1a' : '#f5f6f8',
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  async function handleSend() {
    const trimmed = inputText.trim();
    if (!trimmed || sending) return;

    const updated = [...messages, { role: 'user' as const, content: trimmed }];
    setMessages(updated);
    setSending(true);
    setInputText('');

    try {
      const { data, error } = await supabase.functions.invoke('arvi-chat', {
        body: { messages: updated.map((m) => ({ role: m.role, content: m.content })) },
      });
      if (error || !data?.reply) {
        throw new Error(data?.error ?? error?.message ?? 'No reply');
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      Alert.alert("ARVI couldn't respond right now", 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={[styles.backText, { color: CUSTOMER_COLOR }]}>‹ Back</Text>
        </Pressable>
        <View style={styles.headerTextGroup}>
          <Text style={[styles.headerTitle, { color: c.text }]}>ARVI</Text>
          <Text style={[styles.headerSubtitle, { color: c.muted }]}>Ask me anything about Gen-D</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.messageList}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={styles.centerFill}>
              <Text style={[styles.emptyText, { color: c.muted }]}>
                Ask me anything about how Gen-D works — pricing, deliveries, rides, KYC, and more.
              </Text>
            </View>
          ) : (
            messages.map((message, i) => (
              <MessageBubble key={i} message={message} c={c} />
            ))
          )}
        </ScrollView>

        <BlurView intensity={40} tint={isDark ? 'dark' : 'light'} style={[styles.inputBar, { borderTopColor: c.border }]}>
          <TextInput
            style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message…"
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
        </BlurView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message, c }: { message: ChatMessage; c: Palette }) {
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: CUSTOMER_COLOR, borderBottomRightRadius: 4 }
            : {
              backgroundColor: c.card,
              borderColor: c.border,
              borderWidth: StyleSheet.hairlineWidth,
              borderBottomLeftRadius: 4,
            },
        ]}
      >
        <Text style={[styles.bubbleText, { color: isUser ? '#ffffff' : c.text }]}>{message.content}</Text>
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
  headerTextGroup: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  keyboardAvoider: { flex: 1 },

  messageList: { flex: 1 },
  list: { padding: 16, paddingBottom: 24, gap: 10, flexGrow: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText: { fontSize: 15, lineHeight: 20 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  sendButton: { backgroundColor: CUSTOMER_COLOR, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  sendButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
