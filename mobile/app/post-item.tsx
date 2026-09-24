import { useEffect, useState, type ReactNode } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Switch,
  useColorScheme, Alert, ScrollView, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { geocodeAddressOrThrow, getCurrentLocationOrThrow, LocationPermissionDeniedError } from '../lib/location';
import { EXPLAINER_BANNER_KEYS, useExplainerBanner } from '../lib/explainer-banners';
import { ExplainerBanner } from '../components/explainer-banner';

const BLUE = '#1877F2';
const RED = '#E41E3F';
const AMBER = '#B7791F';
const NEUTRAL = '#6b7280';

type DeliverySpeed = 'standard' | 'express' | 'super_fast';
type PricingMode = 'fixed' | 'auction';
type ParcelSize = 'small' | 'medium' | 'large';
type OrderType = 'parcel' | 'ride';
type VehicleType = 'bike' | 'auto' | 'car';

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
  { value: 'super_fast', label: 'Priority', color: RED },
];

const PARCEL_SIZES: { value: ParcelSize; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const VEHICLE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: 'bike', label: 'Bike' },
  { value: 'auto', label: 'Auto' },
  { value: 'car', label: 'Car' },
];

type Palette = {
  bg: string; text: string; muted: string; inputBg: string;
  card: string; border: string;
};

export default function PostItemScreen() {
  const isDark = useColorScheme() === 'dark';
  const params = useLocalSearchParams<{ type?: string }>();
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

  // Derived from the poster's own profile — never re-entered here, and
  // never toggled by the user on this screen.
  const [isBusinessProfile, setIsBusinessProfile] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);

  const [orderType, setOrderType] = useState<OrderType>(params.type === 'ride' ? 'ride' : 'parcel');
  const [requestedVehicleType, setRequestedVehicleType] = useState<VehicleType | null>(null);
  const [passengerCount, setPassengerCount] = useState('');

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
  const auctionPricingBanner = useExplainerBanner(EXPLAINER_BANNER_KEYS.auctionPricing);

  const [weightKg, setWeightKg] = useState('');
  const [parcelSize, setParcelSize] = useState<ParcelSize | null>(null);

  const [insuranceOptIn, setInsuranceOptIn] = useState(false);
  const [declaredValueInput, setDeclaredValueInput] = useState('');

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [legalConfirmed, setLegalConfirmed] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  // Field names currently showing a red border — cleared the moment that
  // field is edited again, not left stuck on until the next submit attempt.
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set());

  function clearFieldError(name: string) {
    setFieldErrors((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  const isPerishable = category === PERISHABLE_CATEGORY;

  // Perishable items are locked to Priority (matches the DB check
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

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_business, company_name')
        .eq('id', user.id)
        .maybeSingle();
      if (profile?.is_business) {
        setIsBusinessProfile(true);
        setCompanyName(profile.company_name);
      }

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

  async function handleSubmit() {
    if (!userId) return;

    const isRide = orderType === 'ride';
    const price = parseFloat(priceInput);
    const weight = parseFloat(weightKg);
    const declaredValue = parseFloat(declaredValueInput);
    const passengers = parseInt(passengerCount, 10);

    const errors = new Set<string>();
    if (!isRide && !description.trim()) errors.add('description');
    if (!pointAAddress.trim()) errors.add('pointAAddress');
    if (!pointBAddress.trim()) errors.add('pointBAddress');
    if (!(price > 0)) errors.add('priceInput');
    if (!isRide && !(weight > 0)) errors.add('weightKg');
    if (!isRide && insuranceOptIn && !(declaredValue > 0)) errors.add('declaredValueInput');
    if (isRide && !(passengers > 0)) errors.add('passengerCount');

    // Category, parcel size, vehicle type, and the legal checkbox aren't
    // TextInputs, so they can't get a red border — surface those by name in
    // the Alert instead, alongside the highlighted fields.
    const missingSelections: string[] = [];
    if (!isRide && !category) missingSelections.push('a category');
    if (!isRide && !parcelSize) missingSelections.push('a parcel size');
    if (isRide && !requestedVehicleType) missingSelections.push('a vehicle type');
    if (!legalConfirmed) missingSelections.push('the legal confirmation checkbox');

    if (errors.size > 0 || missingSelections.length > 0) {
      setFieldErrors(errors);
      const parts = [
        ...(errors.size > 0 ? ['the highlighted fields'] : []),
        ...missingSelections,
      ];
      Alert.alert('Missing information', `Please fill in ${parts.join(', ')}.`);
      return;
    }
    // Already validated above — narrows types for TS below (ride mode's
    // requestedVehicleType/passengers were checked above instead).
    if (!isRide && (!category || !parcelSize)) return;

    setSubmitting(true);
    try {
      const [pointA, pointB] = await Promise.all([
        pointACoords
          ? Promise.resolve(pointACoords)
          : geocodeAddressOrThrow('pickup (Point A)', pointAAddress.trim()),
        geocodeAddressOrThrow('dropoff (Point B)', pointBAddress.trim()),
      ]);

      let photoUrls: string[] = [];
      if (!isRide && photoUri) {
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

      const sharedOrderFields = {
        customer_id: userId,
        order_type: orderType,
        point_a_address: pointAAddress.trim(),
        point_b_address: pointBAddress.trim(),
        point_a_lat: pointA.lat,
        point_a_lng: pointA.lng,
        point_b_lat: pointB.lat,
        point_b_lng: pointB.lng,
        pricing_mode: pricingMode,
        price_paise: pricingMode === 'fixed' ? Math.round(price * 100) : null,
        min_bid_paise: pricingMode === 'auction' ? Math.round(price * 100) : null,
        business_name: isBusinessProfile ? companyName : null,
        legal_attestation_confirmed: legalConfirmed,
      };

      // Ride requests don't have speed tiers — force 'standard' under the
      // hood, same pattern as how perishable parcels force super_fast.
      // Each field branches by isRide individually (rather than picking
      // between two whole object literals) so every field keeps one
      // consistent type across both modes for the insert() call below.
      const orderPayload = {
        ...sharedOrderFields,
        delivery_speed: isRide ? ('standard' as DeliverySpeed) : effectiveDeliverySpeed,
        item_description: isRide ? (description.trim() || null) : description.trim(),
        item_category: isRide ? null : category,
        weight_kg: isRide ? null : weight,
        parcel_size: isRide ? null : parcelSize,
        is_perishable: isRide ? false : isPerishable,
        photo_urls: isRide ? [] : photoUrls,
        purchased_insurance: isRide ? false : insuranceOptIn,
        declared_value_paise: isRide ? null : (insuranceOptIn ? Math.round(declaredValue * 100) : null),
        requested_vehicle_type: isRide ? requestedVehicleType : null,
        passenger_count: isRide ? passengers : null,
      };

      const { data: insertedOrder, error: insertError } = await supabase
        .from('orders')
        .insert(orderPayload)
        .select('id')
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      // The order_fee_system DB trigger already fired synchronously as part
      // of the insert above — check what it did. 'waived' (free-tier) or
      // 'paid' (wallet covered it) need nothing further here. 'pending'
      // means the wallet was short, and the app opens Razorpay's UPI
      // checkout right now to settle the shortfall — not blocking the post
      // itself, which has already succeeded.
      const { data: feeCharge } = await supabase
        .from('fee_charges')
        .select('id, status')
        .eq('order_id', insertedOrder.id)
        .eq('fee_type', 'customer_post')
        .maybeSingle();

      if (feeCharge?.status === 'pending') {
        const { data: razorpayData, error: razorpayError } = await supabase.functions.invoke(
          'razorpay-create-order',
          { body: { fee_charge_id: feeCharge.id } },
        );
        if (!razorpayError && razorpayData?.payment_url) {
          await Linking.openURL(razorpayData.payment_url);
        }
      }

      Alert.alert(
        isRide ? 'Requested' : 'Posted',
        isRide ? 'Your ride request is live on the Wall.' : 'Your parcel is live on the Wall.',
      );

      // Best-effort only — the order is already posted at this point, so a
      // push failure here must never surface as an error or affect the
      // flow. No recipient_profile_id: nearby_agents_broadcast computes its
      // own recipients server-side via get_nearby_available_agents off the
      // order's own pickup coordinates.
      (async () => {
        try {
          await supabase.functions.invoke('send-push', {
            body: {
              event: 'nearby_agents_broadcast',
              order_id: insertedOrder.id,
              title: isRide ? 'New ride request nearby!' : 'New delivery nearby!',
              body: description.trim() || (isRide
                ? 'A new ride request is available near you.'
                : 'A new delivery request is available near you.'),
            },
          });
        } catch {
          // Silently ignored — see comment above.
        }
      })();

      // My Orders, not the Wall — Wall is Driver-mode-only content now (see
      // the customer-driver mode handover doc, section 8). My Orders
      // re-queries by customer_id, so the new row's id isn't needed here.
      router.replace('/my-orders');
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

        <OrderTypeToggle orderType={orderType} onChange={setOrderType} c={c} />

        {isBusinessProfile && (
          <Text style={[styles.businessCaption, { color: c.muted }]}>
            Posting as {companyName}
          </Text>
        )}

        <SectionLabel c={c}>{orderType === 'ride' ? 'Trip notes (optional)' : 'Item description'}</SectionLabel>
        <TextInput
          style={[
            styles.input,
            styles.multiline,
            { backgroundColor: c.inputBg, color: c.text },
            fieldErrors.has('description') && styles.inputError,
          ]}
          value={description}
          onChangeText={(v) => { setDescription(v); clearFieldError('description'); }}
          placeholder={orderType === 'ride' ? 'Please call on arrival' : 'What are you sending?'}
          placeholderTextColor={c.muted}
          multiline
        />

        {orderType === 'ride' ? (
          <>
            <SectionLabel c={c}>Vehicle type</SectionLabel>
            <View style={styles.chipRow}>
              {VEHICLE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={requestedVehicleType === opt.value}
                  onPress={() => setRequestedVehicleType(opt.value)}
                  c={c}
                />
              ))}
            </View>

            <SectionLabel c={c}>Passengers</SectionLabel>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: c.inputBg, color: c.text },
                fieldErrors.has('passengerCount') && styles.inputError,
              ]}
              value={passengerCount}
              onChangeText={(v) => { setPassengerCount(v); clearFieldError('passengerCount'); }}
              placeholder="e.g. 2"
              placeholderTextColor={c.muted}
              keyboardType="number-pad"
            />
          </>
        ) : (
          <>
            <SectionLabel c={c}>Category</SectionLabel>
            <View style={styles.chipRow}>
              {CATEGORIES.map((cat) => (
                <Chip key={cat} label={cat} selected={category === cat} onPress={() => setCategory(cat)} c={c} />
              ))}
            </View>
          </>
        )}

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
          style={[
            styles.input,
            { backgroundColor: c.inputBg, color: c.text },
            fieldErrors.has('pointAAddress') && styles.inputError,
          ]}
          value={pointAAddress}
          onChangeText={(text) => {
            setPointAAddress(text);
            setPointACoords(null);
            clearFieldError('pointAAddress');
          }}
          placeholder="e.g. Indiranagar 100 Feet Road, Bengaluru"
          placeholderTextColor={c.muted}
        />
        {pointACoords && (
          <Text style={[styles.note, { color: c.muted }]}>📍 Using your current location</Text>
        )}

        <SectionLabel c={c}>Dropoff address (Point B)</SectionLabel>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: c.inputBg, color: c.text },
            fieldErrors.has('pointBAddress') && styles.inputError,
          ]}
          value={pointBAddress}
          onChangeText={(v) => { setPointBAddress(v); clearFieldError('pointBAddress'); }}
          placeholder="e.g. Koramangala 5th Block, Bengaluru"
          placeholderTextColor={c.muted}
        />

        {orderType === 'parcel' && (
          <>
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
                Perishable ({PERISHABLE_CATEGORY}) items must ship Priority.
              </Text>
            )}
          </>
        )}

        <SectionLabel c={c}>Pricing</SectionLabel>
        <View style={styles.chipRow}>
          <Chip label="Fixed price" selected={pricingMode === 'fixed'} onPress={() => setPricingMode('fixed')} c={c} />
          <Chip label="Minimum bid (auction)" selected={pricingMode === 'auction'} onPress={() => setPricingMode('auction')} c={c} />
        </View>
        {pricingMode === 'auction' && (
          <ExplainerBanner
            seen={auctionPricingBanner.seen}
            onDismiss={auctionPricingBanner.dismiss}
            title="How bidding works"
            body="Set a starting price — agents can then bid at or above it. You'll see every bid and pick whichever one you want to accept: cheapest, fastest, most trusted, your choice."
            isDark={isDark}
          />
        )}
        <TextInput
          style={[
            styles.input,
            { backgroundColor: c.inputBg, color: c.text, marginTop: 10 },
            fieldErrors.has('priceInput') && styles.inputError,
          ]}
          value={priceInput}
          onChangeText={(v) => { setPriceInput(v); clearFieldError('priceInput'); }}
          placeholder={priceLabel}
          placeholderTextColor={c.muted}
          keyboardType="decimal-pad"
        />

        {orderType === 'parcel' && (
          <>
            <SectionLabel c={c}>Weight (kg)</SectionLabel>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: c.inputBg, color: c.text },
                fieldErrors.has('weightKg') && styles.inputError,
              ]}
              value={weightKg}
              onChangeText={(v) => { setWeightKg(v); clearFieldError('weightKg'); }}
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

            <View style={styles.switchRow}>
              <Switch value={insuranceOptIn} onValueChange={setInsuranceOptIn} trackColor={{ true: BLUE }} />
              <Text style={[styles.switchLabel, { color: c.text }]}>Insure this item</Text>
            </View>
            {insuranceOptIn && (
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: c.inputBg, color: c.text, marginTop: 10 },
                  fieldErrors.has('declaredValueInput') && styles.inputError,
                ]}
                value={declaredValueInput}
                onChangeText={(v) => { setDeclaredValueInput(v); clearFieldError('declaredValueInput'); }}
                placeholder="Declared value (₹)"
                placeholderTextColor={c.muted}
                keyboardType="decimal-pad"
              />
            )}

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
          </>
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
            {orderType === 'ride'
              ? 'I confirm the details of this ride request are accurate.'
              : 'I confirm this item is legal to ship'}
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.submitButton,
            (submitting || pressed) && { opacity: 0.6 },
          ]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          <Text style={styles.submitButtonText}>
            {submitting
              ? (orderType === 'ride' ? 'Requesting…' : 'Posting…')
              : (orderType === 'ride' ? 'Request Ride' : 'Post Order')}
          </Text>
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

function OrderTypeToggle({
  orderType, onChange, c,
}: { orderType: OrderType; onChange: (t: OrderType) => void; c: Palette }) {
  return (
    <View style={[styles.modeRow, { backgroundColor: c.inputBg }]}>
      <ModePill label="Send a parcel" active={orderType === 'parcel'} onPress={() => onChange('parcel')} c={c} />
      <ModePill label="Book a ride" active={orderType === 'ride'} onPress={() => onChange('ride')} c={c} />
    </View>
  );
}

function ModePill({
  label, active, onPress, c,
}: { label: string; active: boolean; onPress: () => void; c: Palette }) {
  return (
    <Pressable onPress={onPress} style={[styles.modePill, active && { backgroundColor: BLUE }]}>
      <Text style={[styles.modePillText, { color: active ? '#ffffff' : c.text }]}>{label}</Text>
    </Pressable>
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
  businessCaption: { fontSize: 13, marginTop: -14, marginBottom: 18 },

  modeRow: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4, marginBottom: 4 },
  modePill: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  modePillText: { fontSize: 14, fontWeight: '700' },

  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 18, marginBottom: 8,
  },
  sectionLabel: { fontSize: 13, fontWeight: '600' },
  locateButtonText: { fontSize: 12, fontWeight: '700', color: BLUE },
  note: { fontSize: 12, marginTop: 6 },

  input: { borderRadius: 12, padding: 14, fontSize: 16 },
  inputError: { borderWidth: 1.5, borderColor: RED },
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

  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, marginBottom: 4 },
  switchLabel: { flex: 1, fontSize: 14 },
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
