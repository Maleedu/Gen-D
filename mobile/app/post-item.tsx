import { useEffect, useState, type ReactNode } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet,
  useColorScheme, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { geocodeAddressOrThrow, getCurrentLocationOrThrow, LocationPermissionDeniedError } from '../lib/location';

const BLUE = '#1877F2';
const RED = '#E41E3F';
const AMBER = '#B7791F';
const NEUTRAL = '#6b7280';

type DeliverySpeed = 'standard' | 'express' | 'super_fast';
type PricingMode = 'fixed' | 'auction';
type ParcelSize = 'small' | 'medium' | 'large';

// Same free-text values used on the Wall's seed data / category badges
// (item_category has no enum or check constraint — this is a UI-level list,
// not a DB one).
const CATEGORIES = ['Documents', 'Food', 'Fragile', 'Electronics', 'Other'] as const;

// is_perishable is its own boolean column, independent of item_category in
// the schema — this is the one place that ties a category string to it,
// per the "Food = perishable" rule confirmed for this screen.
const PERISHABLE_CATEGORY = 'Food';

const SPEED_OPTIONS: { value: DeliverySpeed; label: string; color: string }[] = [
  { value: 'standard', label: 'Standard', color: NEUTRAL },
  { value: 'express', label: 'Express', color: AMBER },
  { value: 'super_fast', label: 'Super fast', color: RED },
];

const PARCEL_SIZES: { value: ParcelSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

type Palette = {
  bg: string; text: string; muted: string; inputBg: string;
  card: string; border: string;
};

export default function PostItemScreen() {
  const isDark = useColorScheme() === 'dark';
  const c: Palette = {
    bg: isDark ? '#000000' : '#ffffff',
    text: isDark ? '#ffffff' : '#0f1720',
    muted: isDark ? '#8e8e93' : '#6b7280',
    inputBg: isDark ? '#111214' : '#f5f6f8',
    card: isDark ? '#161616' : '#ffffff',
    border: isDark ? '#2e2e32' : '#e5e7eb',
  };

  const [userId, setUserId] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const [pointAAddress, setPointAAddress] = useState('');
  const [pointBAddress, setPointBAddress] = useState('');

  // Set only right after "Use My Location" succeeds — the coordinates that
  // came straight from the device. Cleared the moment the field is hand-
  // edited, so a stale GPS fix never rides along with a typed-over address;
  // handleSubmit geocodes from text whenever this is null.
  const [pointACoords, setPointACoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locatingPointA, setLocatingPointA] = useState(false);

  const [deliverySpeed, setDeliverySpeed] = useState<DeliverySpeed>('standard');
  const [pricingMode, setPricingMode] = useState<PricingMode>('fixed');
  const [priceInput, setPriceInput] = useState('');

  const [weightKg, setWeightKg] = useState('');
  const [parcelSize, setParcelSize] = useState<ParcelSize | null>(null);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [legalConfirmed, setLegalConfirmed] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const isPerishable = category === PERISHABLE_CATEGORY;

  // Perishable items are locked to Super fast (matches the DB check
  // constraint from 15_perishable_super_fast_only.sql). Derived at render
  // time rather than synced into deliverySpeed via an effect, so the
  // disabled state and the effective value can never disagree for a frame.
  const effectiveDeliverySpeed: DeliverySpeed = isPerishable ? 'super_fast' : deliverySpeed;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setUserId(user.id);
      setCheckingAuth(false);
    })();
  }, []);

  // The camera hands back HEIC on iOS, and library picks can be whatever
  // format the source file happens to be — re-encode to JPEG right away so
  // photoUri always points at something every client (and the Wall's
  // <Image>) can decode, and uploadPhoto below never has to think about it.
  async function normalizeToJpeg(uri: string): Promise<string> {
    const image = await ImageManipulator.manipulate(uri).renderAsync();
    const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    return result.uri;
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera access needed', 'Enable camera access to take a picture.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      try {
        setPhotoUri(await normalizeToJpeg(result.assets[0].uri));
      } catch {
        Alert.alert("Couldn't process photo", 'Please try taking the picture again.');
      }
    }
  }

  async function chooseFromLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Photo access needed', 'Enable photo library access to attach a picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      try {
        setPhotoUri(await normalizeToJpeg(result.assets[0].uri));
      } catch {
        Alert.alert("Couldn't process photo", 'Please choose a different picture.');
      }
    }
  }

  function pickPhoto() {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take Photo', onPress: takePhoto },
      { text: 'Choose from Library', onPress: chooseFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // Quick-fill for Point A: get the device's actual coordinates, store those
  // directly (skip re-geocoding them back through geocodeAddressOrThrow —
  // that would be redundant and could resolve to a slightly different point
  // than the GPS fix itself), and reverse-geocode just for a human-readable
  // label in the field.
  async function useMyLocationForPointA() {
    setLocatingPointA(true);
    try {
      const { lat, lng, label } = await getCurrentLocationOrThrow();
      setPointAAddress(label);
      setPointACoords({ lat, lng });
    } catch (err) {
      if (err instanceof LocationPermissionDeniedError) {
        Alert.alert(
          'Location access needed',
          'Enable location access for Gen-D in your device settings to use this, or type the pickup address in manually.',
        );
      } else {
        Alert.alert(
          "Couldn't get your location",
          'Check that location services are on and try again, or type the pickup address in manually.',
        );
      }
    } finally {
      setLocatingPointA(false);
    }
  }

  const priceLabel = pricingMode === 'fixed' ? 'Price (₹)' : 'Minimum bid (₹)';

  const canSubmit =
    !submitting &&
    description.trim().length > 0 &&
    category !== null &&
    pointAAddress.trim().length > 0 &&
    pointBAddress.trim().length > 0 &&
    parseFloat(priceInput) > 0 &&
    parseFloat(weightKg) > 0 &&
    parcelSize !== null &&
    legalConfirmed;

  async function handleSubmit() {
    if (!userId || !category || !parcelSize) return;
    const price = parseFloat(priceInput);
    const weight = parseFloat(weightKg);
    if (!(price > 0) || !(weight > 0)) {
      Alert.alert('Check your numbers', 'Price and weight both need to be greater than 0.');
      return;
    }

    setSubmitting(true);
    try {
      const [pointA, pointB] = await Promise.all([
        pointACoords
          ? Promise.resolve(pointACoords)
          : geocodeAddressOrThrow('pickup (Point A)', pointAAddress.trim()),
        geocodeAddressOrThrow('dropoff (Point B)', pointBAddress.trim()),
      ]);

      let photoUrls: string[] = [];
      if (photoUri) {
        // photoUri was already normalized to JPEG by normalizeToJpeg() when
        // it was picked, so the extension and content type are fixed here.
        // Read the file as an ArrayBuffer directly — fetch(uri).blob() looks
        // like it works in React Native but silently hands supabase-js an
        // empty payload, uploading a 0-byte file with no error.
        const path = `${userId}/${Date.now()}.jpg`;
        const fileData = await new File(photoUri).arrayBuffer();
        const { error: uploadError } = await supabase.storage
          .from('item-photos')
          .upload(path, fileData, { contentType: 'image/jpeg' });
        if (uploadError) {
          throw new Error(`Photo upload failed: ${uploadError.message}`);
        }
        const { data: publicUrlData } = supabase.storage.from('item-photos').getPublicUrl(path);
        photoUrls = [publicUrlData.publicUrl];
      }

      const { data: inserted, error: insertError } = await supabase.from('orders').insert({
        customer_id: userId,
        item_description: description.trim(),
        item_category: category,
        point_a_address: pointAAddress.trim(),
        point_b_address: pointBAddress.trim(),
        point_a_lat: pointA.lat,
        point_a_lng: pointA.lng,
        point_b_lat: pointB.lat,
        point_b_lng: pointB.lng,
        delivery_speed: effectiveDeliverySpeed,
        pricing_mode: pricingMode,
        price_paise: pricingMode === 'fixed' ? Math.round(price * 100) : null,
        min_bid_paise: pricingMode === 'auction' ? Math.round(price * 100) : null,
        weight_kg: weight,
        parcel_size: parcelSize,
        is_perishable: isPerishable,
        photo_urls: photoUrls,
        legal_attestation_confirmed: legalConfirmed,
      }).select('id').single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      Alert.alert('Posted', 'Your parcel is live on the Wall.');
      router.replace({ pathname: '/order/[id]', params: { id: inserted.id } });
    } catch (err) {
      Alert.alert('Could not post item', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingAuth) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={BLUE} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: c.text }]}>Post a parcel</Text>

        <SectionLabel c={c}>Item description</SectionLabel>
        <TextInput
          style={[styles.input, styles.multiline, { backgroundColor: c.inputBg, color: c.text }]}
          value={description}
          onChangeText={setDescription}
          placeholder="What are you sending?"
          placeholderTextColor={c.muted}
          multiline
        />

        <SectionLabel c={c}>Category</SectionLabel>
        <View style={styles.chipRow}>
          {CATEGORIES.map((cat) => (
            <Chip key={cat} label={cat} selected={category === cat} onPress={() => setCategory(cat)} c={c} />
          ))}
        </View>

        <SectionLabel
          c={c}
          right={
            <Pressable
              onPress={useMyLocationForPointA}
              disabled={locatingPointA}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              {locatingPointA ? (
                <ActivityIndicator size="small" color={BLUE} />
              ) : (
                <Text style={styles.locateButtonText}>📍 Use My Location</Text>
              )}
            </Pressable>
          }
        >
          Pickup address (Point A)
        </SectionLabel>
        <TextInput
          style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
          value={pointAAddress}
          onChangeText={(text) => {
            setPointAAddress(text);
            setPointACoords(null);
          }}
          placeholder="e.g. Indiranagar 100 Feet Road, Bengaluru"
          placeholderTextColor={c.muted}
        />
        {pointACoords && (
          <Text style={[styles.note, { color: c.muted }]}>📍 Using your current location</Text>
        )}

        <SectionLabel c={c}>Dropoff address (Point B)</SectionLabel>
        <TextInput
          style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
          value={pointBAddress}
          onChangeText={setPointBAddress}
          placeholder="e.g. Koramangala 5th Block, Bengaluru"
          placeholderTextColor={c.muted}
        />

        <SectionLabel c={c}>Delivery speed</SectionLabel>
        <View style={styles.chipRow}>
          {SPEED_OPTIONS.map((opt) => {
            const disabled = isPerishable && opt.value !== 'super_fast';
            return (
              <Chip
                key={opt.value}
                label={opt.label}
                selected={effectiveDeliverySpeed === opt.value}
                onPress={() => !disabled && setDeliverySpeed(opt.value)}
                c={c}
                color={opt.color}
                disabled={disabled}
              />
            );
          })}
        </View>
        {isPerishable && (
          <Text style={[styles.note, { color: c.muted }]}>
            Perishable ({PERISHABLE_CATEGORY}) items must ship Super fast.
          </Text>
        )}

        <SectionLabel c={c}>Pricing</SectionLabel>
        <View style={styles.chipRow}>
          <Chip label="Fixed price" selected={pricingMode === 'fixed'} onPress={() => setPricingMode('fixed')} c={c} />
          <Chip label="Minimum bid (auction)" selected={pricingMode === 'auction'} onPress={() => setPricingMode('auction')} c={c} />
        </View>
        <TextInput
          style={[styles.input, { backgroundColor: c.inputBg, color: c.text, marginTop: 10 }]}
          value={priceInput}
          onChangeText={setPriceInput}
          placeholder={priceLabel}
          placeholderTextColor={c.muted}
          keyboardType="decimal-pad"
        />

        <SectionLabel c={c}>Weight (kg)</SectionLabel>
        <TextInput
          style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
          value={weightKg}
          onChangeText={setWeightKg}
          placeholder="e.g. 1.5"
          placeholderTextColor={c.muted}
          keyboardType="decimal-pad"
        />

        <SectionLabel c={c}>Parcel size</SectionLabel>
        <View style={styles.chipRow}>
          {PARCEL_SIZES.map((size) => (
            <Chip
              key={size.value}
              label={size.label}
              selected={parcelSize === size.value}
              onPress={() => setParcelSize(size.value)}
              c={c}
            />
          ))}
        </View>

        <SectionLabel c={c}>Photo (optional)</SectionLabel>
        {photoUri ? (
          <View>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} contentFit="cover" />
            <Pressable onPress={pickPhoto} style={styles.replacePhoto}>
              <Text style={{ color: BLUE, fontWeight: '600' }}>Change photo</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.photoPicker,
              { backgroundColor: c.inputBg, borderColor: c.border },
              pressed && { opacity: 0.8 },
            ]}
            onPress={pickPhoto}
          >
            <Text style={{ color: c.muted }}>Tap to add a photo</Text>
          </Pressable>
        )}

        <Pressable style={styles.checkboxRow} onPress={() => setLegalConfirmed((v) => !v)}>
          <View
            style={[
              styles.checkbox,
              { borderColor: legalConfirmed ? BLUE : c.border },
              legalConfirmed && { backgroundColor: BLUE },
            ]}
          >
            {legalConfirmed && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={[styles.checkboxLabel, { color: c.text }]}>
            I confirm this item is legal to ship
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.submitButton,
            (!canSubmit || pressed) && { opacity: 0.6 },
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Text style={styles.submitButtonText}>{submitting ? 'Posting…' : 'Post Order'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({
  children, c, right,
}: { children: string; c: Palette; right?: ReactNode }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={[styles.sectionLabel, { color: c.muted }]}>{children}</Text>
      {right}
    </View>
  );
}

function Chip({
  label, selected, onPress, c, color, disabled,
}: {
  label: string; selected: boolean; onPress: () => void; c: Palette; color?: string; disabled?: boolean;
}) {
  const tint = color ?? BLUE;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        { borderColor: selected ? tint : c.border, backgroundColor: selected ? `${tint}22` : c.inputBg },
        disabled && styles.chipDisabled,
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? tint : c.text }, disabled && { color: c.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 20, letterSpacing: -0.5 },

  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 18, marginBottom: 8,
  },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  locateButtonText: { fontSize: 12, fontWeight: '700', color: BLUE },
  note: { fontSize: 12, marginTop: 6 },

  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5 },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 13, fontWeight: '700' },

  photoPicker: {
    borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed',
    height: 140, alignItems: 'center', justifyContent: 'center',
  },
  photoPreview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
  replacePhoto: { marginTop: 8, alignItems: 'center' },

  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  checkmark: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  checkboxLabel: { flex: 1, fontSize: 14 },

  submitButton: { backgroundColor: BLUE, borderRadius: 14, padding: 17, marginTop: 24, alignItems: 'center' },
  submitButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
});
