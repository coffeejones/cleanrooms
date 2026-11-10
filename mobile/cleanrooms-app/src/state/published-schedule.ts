import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { offlineConnectionFailure, useMobileAuth } from '@/auth/mobile-auth';
import { MobileAuthError, type PublishedShift } from '@/auth/mobile-auth-api';
import { addDays, shiftOverlapsDates } from '@/domain/model';
import { offlineMaxAge, type OfflineKind, type OfflineRecord } from './employee-offline-cache';

type Resource<T> = { key: string; generation: number; data?: T; loading: boolean; refreshing: boolean; error?: string; offline?: boolean; savedAt?: number };
const inFlight = new Map<string, Promise<unknown>>();
const invalidations = new Set<(prefixes: string[]) => void>();
function observationFresh(savedAt: number | undefined, expiresAt: string) { const now = Date.now(); return savedAt !== undefined && savedAt <= now + 60_000 && savedAt + offlineMaxAge > now && Date.parse(expiresAt) > now; }
export function invalidateEmployeeResources(...prefixes: string[]) {
  for (const listener of invalidations) listener(prefixes);
}

export function usePublishedResource<T>(scope: string, load: () => Promise<T>, enabled = true, cacheKind?: OfflineKind) {
  const { state, sessionEpoch, offlineLease, readOfflineResource, saveOfflineResource } = useMobileAuth();
  const employee = state.mode === 'signedIn' ? state.session.employee : null;
  const expiresAt = state.mode === 'signedIn' ? state.session.expiresAt : '';
  const key = employee && enabled ? JSON.stringify([employee.workspaceId, employee.personId, sessionEpoch, state.mode === 'signedIn' ? state.session.expiresAt : '', scope]) : null;
  const [resource, setResource] = useState<Resource<T>>();
  const pending = useRef(0);

  const fetchResource = useCallback(async (manual = false) => {
    if (!key) return;
    const request = ++pending.current;
    let settled = false;
    const cached: Promise<OfflineRecord<T> | null> = cacheKind ? readOfflineResource<T>(cacheKind, scope, offlineLease).catch(() => null) : Promise.resolve(null);
    setResource(previous => {
      const keep = previous?.key === key && (!previous.offline || observationFresh(previous.savedAt, expiresAt));
      return { key, generation: request, data: keep ? previous.data : undefined, loading: true, refreshing: manual,
        offline: keep ? previous.offline : false, savedAt: keep ? previous.savedAt : undefined };
    });
    void cached.then(value => {
      if (value && observationFresh(value.savedAt, expiresAt) && !settled && pending.current === request) setResource(previous => {
        const keep = previous?.key === key && previous.data !== undefined && (!previous.offline || observationFresh(previous.savedAt, expiresAt));
        return { key, generation: request, data: keep ? previous.data : value.data, loading: true, refreshing: manual,
          offline: keep ? previous.offline : true, savedAt: keep ? previous.savedAt : value.savedAt };
      });
    });
    try {
      let requestData = manual ? undefined : inFlight.get(key);
      if (!requestData) {
        requestData = Promise.resolve().then(load);
        inFlight.set(key, requestData);
        const clear = () => { if (inFlight.get(key) === requestData) inFlight.delete(key); };
        void requestData.then(clear, clear);
      }
      const data = await requestData as T;
      settled = true;
      if (pending.current === request) {
        setResource({ key, generation: request, data, loading: false, refreshing: false, savedAt: Date.now() });
        if (cacheKind) void saveOfflineResource(cacheKind, scope, data, offlineLease);
      }
    } catch (error) {
      const downloaded = await cached, fallback = downloaded && observationFresh(downloaded.savedAt, expiresAt) ? downloaded : null; settled = true;
      if (pending.current !== request) return;
      const message = error instanceof MobileAuthError ? error.message : 'Oplysningerne kunne ikke hentes. Prøv igen.';
      const forbidden = error instanceof MobileAuthError && (error.status === 401 || error.status === 403);
      const offline = cacheKind && offlineConnectionFailure(error);
      setResource(previous => {
        const keep = previous?.key === key && (!previous.offline || observationFresh(previous.savedAt, expiresAt));
        const data = !forbidden && keep ? previous.data ?? fallback?.data : !forbidden && offline ? fallback?.data : undefined;
        const provisional = data !== undefined && (Boolean(previous?.key === key && previous.offline) || data === fallback?.data);
        return { key, generation: request, data, loading: false, refreshing: false,
          ...(offline && data !== undefined ? { offline: true, savedAt: fallback?.savedAt ?? previous?.savedAt } : { offline: provisional, savedAt: provisional ? previous?.savedAt ?? fallback?.savedAt : undefined, error: offline ? 'Disse oplysninger er ikke gemt offline endnu.' : message }),
        };
      });
    }
  }, [cacheKind, expiresAt, key, load, offlineLease, readOfflineResource, saveOfflineResource, scope]);

  useFocusEffect(useCallback(() => {
    if (!key) return;
    void fetchResource();
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') void fetchResource();
    });
    const invalidate = (prefixes: string[]) => { if (prefixes.some(prefix => scope.startsWith(prefix))) void fetchResource(true); };
    invalidations.add(invalidate);
    return () => { subscription.remove(); invalidations.delete(invalidate); pending.current++; };
  }, [fetchResource, key, scope]));

  const expiredObservation = resource?.key === key && resource.offline && !observationFresh(resource.savedAt, expiresAt);
  const current = resource?.key === key && !expiredObservation ? resource : undefined;
  return {
    live: key !== null,
    data: current?.data,
    loading: expiredObservation ? false : current?.loading ?? key !== null,
    refreshing: current?.refreshing ?? false,
    error: expiredObservation ? 'Offlineoplysningerne er udløbet. Opret forbindelse for at hente vagten igen.' : current?.error,
    generation: current?.generation ?? 0,
    offline: current?.offline === true,
    savedAt: current?.savedAt,
    refresh: () => { void fetchResource(true); },
  };
}

export function usePublishedSchedule(from: string, to: string) {
  const { readPublishedSchedule } = useMobileAuth();
  const load = useCallback(async () => {
    const shifts = new Map<string, PublishedShift>();
    let cursor: string | null = null;
    do {
      const page = await readPublishedSchedule(addDays(from, -1), to, cursor);
      for (const item of page.shifts) if (shiftOverlapsDates(item.shift, from, to)) shifts.set(item.shift.id, item);
      if (page.nextCursor && page.nextCursor === cursor) throw new Error('Ugyldig sidehenvisning.');
      cursor = page.nextCursor;
    } while (cursor);
    return [...shifts.values()];
  }, [from, readPublishedSchedule, to]);
  return usePublishedResource(JSON.stringify([from, to]), load, true, 'schedule');
}

export function usePublishedShift(shiftId: string) {
  const { readPublishedShift } = useMobileAuth();
  const load = useCallback(() => readPublishedShift(shiftId), [readPublishedShift, shiftId]);
  return usePublishedResource(shiftId, load, true, 'detail');
}
