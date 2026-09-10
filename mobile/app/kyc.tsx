import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, useColorScheme, Alert,
  ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router, Stack } from 'expo-router';
import { supabase } from '../lib/supabase';

const BLUE = '#1877F2';
const RED = '#E41E3F';
const AMBER = '#B7791F';
const GREEN = '#1F9254';
const NEUTRAL = '#6b7280';

// Only the two doc types this screen ever asks for. agent_documents.doc_type
// also has 'vehicle_rc' and 'other' in the DB enum, but those aren't part of
// the agent-facing KYC flow here (vehicle_rc is admin/KycQueue territory).
type DocType = 'aadhaar' | 'driving_licence';
type DocVerificationStatus = 'pending' | 'verified' | 'rejected';
type DocStatus = 'not_uploaded' | DocVerificationStatus;

type AgentDocumentRow = {
  doc_type: DocType;
  verification_status: DocVerificationStatus;
};

type Palette = {
  bg: string; text: string; muted: string;
  card: string; border: string;
};

const DOC_LABEL: Record<DocType, string> = {
  aadhaar: 'Aadhaar Card',
  driving_licence: 'Driving Licence',
};

const STATUS_META: Record<DocStatus, { label: string; color: string }> = {
  not_uploaded: { label: 'Not uploaded', color: NEUTRAL },
  pending: { label: 'Pending review', color: AMBER },
  verified: { label: '✓ Verified', color: GREEN },
  rejected: { label: 'Rejected', color: RED },
};

export default function KycScreen() {
  const isDark = useColorScheme() === 'dark';
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
  };

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Whether the agent has declared any vehicle other than 'none' — the one
  // thing that makes driving_licence a required doc alongside aadhaar.
  const [vehicleRequired, setVehicleRequired] = useState(false);

  // One row per doc_type at most (agent_documents has a unique constraint on
  // (profile_id, doc_type) — submit_agent_document upserts onto it), so a
  // plain by-type map is enough; there's never a history of rows to pick a
  // "latest" from.
  const [docsByType, setDocsByType] = useState<Partial<Record<DocType, AgentDocumentRow>>>({});

  const [uploadingDocType, setUploadingDocType] = useState<DocType | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace('/login');
      return;
    }
    setUserId(user.id);

    const [{ data: vehicles, error: vehiclesError }, { data: docs, error: docsError }] = await Promise.all([
      supabase.from('agent_vehicles').select('vehicle_type').eq('profile_id', user.id),
      supabase.from('agent_documents').select('doc_type, verification_status').eq('profile_id', user.id),
    ]);
    if (vehiclesError) {
      setLoadError(vehiclesError.message);
      return;
    }
    if (docsError) {
      setLoadError(docsError.message);
      return;
    }

    setVehicleRequired((vehicles ?? []).some((v) => v.vehicle_type !== 'none'));

    const byType: Partial<Record<DocType, AgentDocumentRow>> = {};
    for (const d of (docs ?? []) as AgentDocumentRow[]) {
      if (d.doc_type === 'aadhaar' || d.doc_type === 'driving_licence') {
        byType[d.doc_type] = d;
      }
    }
    setDocsByType(byType);
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      await load();
      if (!ignore) setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const requiredDocs: DocType[] = vehicleRequired ? ['aadhaar', 'driving_licence'] : ['aadhaar'];

  function statusFor(docType: DocType): DocStatus {
    return docsByType[docType]?.verification_status ?? 'not_uploaded';
  }

  async function uploadDocument(docType: DocType, source: 'camera' | 'library') {
    if (!userId) return;
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

      setUploadingDocType(docType);
      const image = await ImageManipulator.manipulate(result.assets[0].uri).renderAsync();
      const jpeg = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });

      // Path is fixed per doc_type (not timestamped like item/delivery
      // photos) so a resubmit reuses the exact same object — upsert: true is
      // required here or the second upload ever attempted fails with
      // "resource already exists". submit_agent_document's ON CONFLICT
      // (profile_id, doc_type) is what actually owns row identity; this just
      // keeps storage from rejecting the overwrite.
      const path = `${userId}/${docType}.jpg`;
      const fileData = await new File(jpeg.uri).arrayBuffer();
      const { error: uploadError } = await supabase.storage
        .from('agent-documents')
        .upload(path, fileData, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      const { error: rpcError } = await supabase.rpc('submit_agent_document', {
        p_doc_type: docType,
        p_storage_path: path,
      });
      if (rpcError) throw new Error(rpcError.message);

      // submit_agent_document always resets verification_status to 'pending'
      // (and clears verified_at/verified_by) on every upsert, so this is
      // exactly the row state the RPC just committed server-side.
      setDocsByType((prev) => ({ ...prev, [docType]: { doc_type: docType, verification_status: 'pending' } }));
      Alert.alert('Submitted', `${DOC_LABEL[docType]} was submitted for review.`);
    } catch (err) {
      Alert.alert("Couldn't submit document", err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingDocType(null);
    }
  }

  function pickDocumentSource(docType: DocType) {
    Alert.alert(DOC_LABEL[docType], undefined, [
      { text: 'Take Photo', onPress: () => uploadDocument(docType, 'camera') },
      { text: 'Choose from Library', onPress: () => uploadDocument(docType, 'library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: 'KYC Verification' }} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: 'KYC Verification' }} />
        <View style={styles.centerFill}>
          <Text style={[styles.errorText, { color: c.text }]}>{loadError}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ title: 'KYC Verification' }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BLUE} colors={[BLUE]} />}
      >
        <Text style={[styles.title, { color: c.text }]}>Verify your KYC</Text>

        {requiredDocs.map((docType) => {
          const status = statusFor(docType);
          const meta = STATUS_META[status];
          const isUploading = uploadingDocType === docType;
          const showButton = status === 'not_uploaded' || status === 'rejected';

          return (
            <View key={docType} style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.docLabel, { color: c.text }]}>{DOC_LABEL[docType]}</Text>
              <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>

              {showButton && (
                <Pressable
                  onPress={() => pickDocumentSource(docType)}
                  disabled={isUploading}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    { borderColor: BLUE },
                    (pressed || isUploading) && { opacity: 0.6 },
                  ]}
                >
                  {isUploading ? (
                    <ActivityIndicator size="small" color={BLUE} />
                  ) : (
                    <Text style={[styles.secondaryButtonText, { color: BLUE }]}>
                      {status === 'rejected' ? 'Resubmit' : 'Upload'}
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  scroll: { padding: 16, paddingBottom: 40, gap: 14 },

  title: { fontSize: 26, fontWeight: '800', marginBottom: 6, letterSpacing: -0.5 },

  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  docLabel: { fontSize: 16, fontWeight: '700' },
  statusText: { fontSize: 14, fontWeight: '600' },

  secondaryButton: { borderRadius: 12, borderWidth: 1.5, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  secondaryButtonText: { fontSize: 14, fontWeight: '700' },
});
