import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useMobileAuth } from '@/auth/mobile-auth';
import { MobileAuthError, type PublishedShift } from '@/auth/mobile-auth-api';

type Resource<T> = { key: string; generation: number; data?: T; loading: boolean; refreshing: boolean; error?: string };
const inFlight = new Map<string, Promise<unknown>>();
const invalidations = new Set<(prefixes: string[]) => void>();
export function invalidateEmployeeResources(...prefixes: string[]) {
  for (const listener of invalidations) listener(prefixes);
}

export function usePublishedResource<T>(scope: string, load: () => Promise<T>, enabled = true) {
  const { state } = useMobileAuth();
  const employee = state.mode === 'signedIn' ? state.session.employee : null;
  const key = employee && enabled ? JSON.stringify([employee.workspaceId, employee.personId, state.mode === 'signedIn' ? state.session.expiresAt : '', scope]) : null;
  const [resource, setResource] = useState<Resource<T>>();
  const pending = useRef(0);

  const fetchResource = useCallback(async (manual = false) => {
    if (!key) return;
    const request = ++pending.current;
    setResource(previous => ({
      key, generation: request, data: previous?.key === key ? previous.data : undefined, loading: true, refreshing: manual,
    }));
    try {
      let requestData = manual ? undefined : inFlight.get(key);
      if (!requestData) {
        requestData = Promise.resolve().then(load);
        inFlight.set(key, requestData);
        const clear = () => { if (inFlight.get(key) === requestData) inFlight.delete(key); };
        void requestData.then(clear, clear);
      }
      const data = await requestData as T;
      if (pending.current === request) setResource({ key, generation: request, data, loading: false, refreshing: false });
    } catch (error) {
      if (pending.current !== request) return;
      const message = error instanceof MobileAuthError ? error.message : 'Oplysningerne kunne ikke hentes. Prøv igen.';
      setResource(previous => ({ key, generation: request, data: previous?.key === key ? previous.data : undefined, loading: false, refreshing: false, error: message }));
    }
  }, [key, load]);

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

  const current = resource?.key === key ? resource : undefined;
  return {
    live: key !== null,
    data: current?.data,
    loading: current?.loading ?? key !== null,
    refreshing: current?.refreshing ?? false,
    error: current?.error,
    generation: current?.generation ?? 0,
    refresh: () => { void fetchResource(true); },
  };
}

export function usePublishedSchedule(from: string, to: string) {
  const { readPublishedSchedule } = useMobileAuth();
  const load = useCallback(async () => {
    const shifts = new Map<string, PublishedShift>();
    let cursor: string | null = null;
    do {
      const page = await readPublishedSchedule(from, to, cursor);
      for (const item of page.shifts) shifts.set(item.shift.id, item);
      if (page.nextCursor && page.nextCursor === cursor) throw new Error('Ugyldig sidehenvisning.');
      cursor = page.nextCursor;
    } while (cursor);
    return [...shifts.values()];
  }, [from, readPublishedSchedule, to]);
  return usePublishedResource(JSON.stringify([from, to]), load);
}

export function usePublishedShift(shiftId: string) {
  const { readPublishedShift } = useMobileAuth();
  const load = useCallback(() => readPublishedShift(shiftId), [readPublishedShift, shiftId]);
  return usePublishedResource(shiftId, load);
}
