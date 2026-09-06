import { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Modal,
} from 'react-native';

// Shared by the three auction/bidding explainer trigger points (see
// docs/auction-explainer-banners-handover.md): customer min-price input,
// customer bid-selection screen, agent bid-placement screen. `seen`/`onDismiss`
// come from useExplainerBanner (lib/explainer-banners.ts) — this component is
// purely presentational. First visit shows the banner; dismissing it (×)
// hides it and swaps in a small ⓘ icon in the same spot that reopens the
// same copy in a modal — the ⓘ never re-sets the flag back to unseen.
export function ExplainerBanner({
  seen, onDismiss, title, body, isDark,
}: {
  seen: boolean | null;
  onDismiss: () => void;
  title: string;
  body: string;
  isDark: boolean;
}) {
  const [modalVisible, setModalVisible] = useState(false);

  const c = isDark
    ? { bg: '#0d2436', border: '#1877F2', text: '#e8f1fc', muted: '#8e8e93', icon: '#1877F2' }
    : { bg: '#EAF3FF', border: '#BFDBFE', text: '#0f1720', muted: '#6b7280', icon: '#1877F2' };

  if (seen === null) return null;

  if (seen) {
    return (
      <>
        <Pressable
          onPress={() => setModalVisible(true)}
          hitSlop={8}
          style={[styles.infoButton, { borderColor: c.icon }]}
        >
          <Text style={[styles.infoButtonText, { color: c.icon }]}>ⓘ</Text>
        </Pressable>
        <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)}>
            <Pressable style={[styles.modalCard, { backgroundColor: c.bg, borderColor: c.border }]} onPress={() => {}}>
              <View style={styles.headerRow}>
                <Text style={[styles.title, { color: c.text }]}>{title}</Text>
                <Pressable onPress={() => setModalVisible(false)} hitSlop={8}>
                  <Text style={[styles.dismissText, { color: c.muted }]}>×</Text>
                </Pressable>
              </View>
              <Text style={[styles.body, { color: c.text }]}>{body}</Text>
            </Pressable>
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <View style={[styles.banner, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={[styles.dismissText, { color: c.muted }]}>×</Text>
        </Pressable>
      </View>
      <Text style={[styles.body, { color: c.text }]}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
  },
  dismissText: {
    fontSize: 18,
    lineHeight: 18,
    paddingLeft: 12,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  infoButton: {
    alignSelf: 'flex-start',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  infoButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
});
