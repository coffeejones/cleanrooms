import type { LocationSubscription } from 'expo-location';
import { AppState } from 'react-native';

import { maxClockInAccuracyMeters, maxClockInLocationAgeMs, type ClockInLocation } from '@/domain/model';

type Reading = { location: ClockInLocation } | { error: string };
type WatchPosition = (
  onPosition: (location: ClockInLocation) => void,
  onError: (message: string) => void,
) => Promise<LocationSubscription>;

const timeoutMs = 12_000;
const canceled = 'Placeringstjekket blev afbrudt. Prøv igen.';
const unavailable = 'Vi kunne ikke finde din placering. Tjek lokationstjenesterne, og prøv igen.';

function waitForPosition(signal: AbortSignal, accuracyLimit: number, watch: WatchPosition): Promise<Reading> {
  if (signal.aborted) return Promise.resolve({ error: canceled });

  return new Promise(resolve => {
    let subscription: LocationSubscription | undefined;
    let lastFix: ClockInLocation | undefined;
    let finished = false;
    const timer = setTimeout(() => finish(lastFix ? { location: lastFix } : { error: unavailable }), timeoutMs);
    const onAbort = () => finish({ error: canceled });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'background') onAbort();
    });

    function finish(reading: Reading) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      appState.remove();
      subscription?.remove();
      resolve(reading);
    }

    signal.addEventListener('abort', onAbort, { once: true });
    void watch(fix => {
      const age = Date.now() - fix.timestamp;
      if (age < 0 || age > maxClockInLocationAgeMs) return;
      // Core Location can return fractional milliseconds; the API uses whole epoch milliseconds.
      // Keep its measured time (never replace it with Date.now(), which would refresh stale fixes).
      lastFix = { ...fix, timestamp: Math.trunc(fix.timestamp) };
      if (fix.mocked || (fix.accuracyMeters !== null && fix.accuracyMeters >= 0 && fix.accuracyMeters <= accuracyLimit)) {
        finish({ location: lastFix });
      }
    }, message => finish({ error: message })).then(active => {
      if (finished) active.remove();
      else subscription = active;
    }).catch(() => finish({ error: unavailable }));
  });
}

export async function readClockInLocation(signal: AbortSignal, radiusMeters: number): Promise<Reading> {
  if (signal.aborted) return { error: canceled };
  const accuracyLimit = Math.min(maxClockInAccuracyMeters, radiusMeters);

  if (process.env.EXPO_OS === 'web') {
    if (!navigator.geolocation) return { error: 'Placering kræver CleanRooms-appen eller en sikker browserforbindelse.' };
    return waitForPosition(signal, accuracyLimit, async (onPosition, onError) => {
      const id = navigator.geolocation.watchPosition(({ coords, timestamp }) => onPosition({
        latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy, timestamp,
      }), error => onError(error.code === error.PERMISSION_DENIED
        ? 'Giv webstedet adgang til din placering i browseren, og prøv igen.'
        : unavailable), { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });
      return { remove: () => navigator.geolocation.clearWatch(id) };
    });
  }

  try {
    const Location = await import('expo-location');
    if (!await Location.hasServicesEnabledAsync()) {
      return { error: 'Slå lokationstjenester til i telefonens indstillinger, og prøv igen.' };
    }
    const current = await Location.getForegroundPermissionsAsync();
    if (signal.aborted) return { error: canceled };
    const permission = !current.granted && current.canAskAgain
      ? await Location.requestForegroundPermissionsAsync()
      : current;
    if (signal.aborted || AppState.currentState === 'background') return { error: canceled };
    if (!permission.granted) {
      return { error: 'Giv CleanRooms adgang til din placering i telefonens indstillinger, og prøv igen.' };
    }

    return await waitForPosition(signal, accuracyLimit, (onPosition, onError) => Location.watchPositionAsync({
      accuracy: Location.Accuracy.High,
      timeInterval: 500,
      distanceInterval: 0,
      mayShowUserSettingsDialog: false,
    }, ({ coords, timestamp, mocked }) => onPosition({
      latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy, timestamp, mocked,
    }), () => onError(unavailable)));
  } catch {
    return { error: unavailable };
  }
}
