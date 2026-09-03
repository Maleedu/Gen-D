import * as Location from 'expo-location';

// formattedAddress is Android-only (per expo-location's own type comment) —
// build a readable line from the individual components so iOS gets the same
// quality of display string instead of falling straight back to raw digits.
export function formatGeocodedAddress(addr: Location.LocationGeocodedAddress): string | null {
  if (addr.formattedAddress) return addr.formattedAddress;
  const streetLine = [addr.streetNumber, addr.street].filter(Boolean).join(' ') || addr.name;
  const parts = [streetLine, addr.district, addr.city, addr.region, addr.postalCode].filter(
    (p): p is string => !!p,
  );
  return parts.length > 0 ? parts.join(', ') : null;
}

// Resolves a typed address to a single lat/lng pair, or throws a
// user-facing error string. geocodeAsync doesn't return a confidence
// score, so "ambiguous" is treated as: more than one distinct match came
// back for the string as typed.
export async function geocodeAddressOrThrow(
  label: string,
  address: string,
): Promise<{ lat: number; lng: number }> {
  let results: Location.LocationGeocodedLocation[];
  try {
    results = await Location.geocodeAsync(address);
  } catch {
    throw new Error(`Couldn't verify the ${label} address. Check your connection and try again.`);
  }
  if (results.length === 0) {
    throw new Error(`Couldn't find "${address}" for ${label}. Try adding more detail (area, city, pincode).`);
  }
  if (results.length > 1) {
    throw new Error(`"${address}" for ${label} matched more than one place. Add more detail (area, city, pincode) to narrow it down.`);
  }
  return { lat: results[0].latitude, lng: results[0].longitude };
}

// Thrown by getCurrentLocationOrThrow specifically on a denied/undetermined
// permission, so callers can show a permission-specific message instead of
// the generic "couldn't get your location" one.
export class LocationPermissionDeniedError extends Error {}

export type CurrentLocationResult = { lat: number; lng: number; label: string };

// Gets the device's current position at the highest available accuracy and
// reverse-geocodes it into a display label. BestForNavigation (not Balanced
// or even Highest) because the fix becomes real stored data — an order's
// pickup coordinate, or an agent's declared destination — not just a map
// pin, so it's worth the extra fix time and battery draw. Reverse-geocoding
// failures are non-fatal: falls back to raw coordinates as the label rather
// than blocking the quick-fill on it.
export async function getCurrentLocationOrThrow(): Promise<CurrentLocationResult> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new LocationPermissionDeniedError();
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
  });
  const { latitude, longitude } = pos.coords;

  let label: string | null = null;
  try {
    const [addr] = await Location.reverseGeocodeAsync({ latitude, longitude });
    label = addr ? formatGeocodedAddress(addr) : null;
  } catch {
    // Reverse geocoding is display-only — fall through to raw coordinates.
  }

  return { lat: latitude, lng: longitude, label: label ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}` };
}
