import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMobileAuth } from '@/auth/mobile-auth';
import { createDemoState } from '../domain/demo';
import { clockInAvailability, type AppState, type ClockInLocation, type Person, type Preferences, type Result } from '../domain/model';
import { readClockInLocation } from '../location/clock-in-location';
import { decodeSnapshot } from './snapshot';
import { applyAction, rolloverDemoDay, type AppAction } from './transitions';

const STORAGE_KEY = 'cleanrooms.employee-demo.v1';
const unavailable = (): Result => ({ ok: false, error: 'Appen åbner. Prøv igen om et øjeblik.' });
export const demoNow = (state: AppState, realNow = Date.now()) => Date.parse(state.demoBaseAt) + Math.max(0, realNow - state.demoStartedAt);

export type AppActions = {
  clockIn: (shiftId: string, signal: AbortSignal) => Promise<Result>;
  clockOut: (shiftId: string, comment?: string) => Result;
  pause: (shiftId: string) => Result;
  resume: (shiftId: string) => Result;
  toggleTask: (shiftId: string, taskId: string) => Result;
  requestLeave: (shiftId: string, comment?: string) => Result;
  claimShift: (shiftId: string) => Result;
  sendMessage: (roomId: string, text: string) => Result;
  markRoomRead: (roomId: string) => Result;
  markNotificationRead: (id: string) => Result;
  setUnavailableDate: (date: string, unavailable: boolean) => Result;
  setPreference: (key: keyof Preferences, value: boolean) => Result;
  resetDemo: () => Result;
};
type StoreValue = {
  state: AppState; ready: boolean; self: Person; actions: AppActions; storageError: string | null;
  demoChatDrafts: ReadonlyMap<string, string>;
  setDemoChatDraft: (roomId: string, text: string) => void;
};
const StoreContext = createContext<StoreValue | null>(null);
const NowContext = createContext<number>(Date.now());

/** Domain writes persist separately from the display clock; a timer tick never writes storage. */
function AppClock({ state, live, onDayChange, children }: { state: AppState; live: boolean; onDayChange: (now: number) => void; children: ReactNode }) {
  const [realNow, setRealNow] = useState(Date.now);
  const { demoBaseAt, demoStartedAt } = state;
  useEffect(() => {
    const update = () => {
      const instant = Date.now();
      setRealNow(instant);
      if (!live) onDayChange(Date.parse(demoBaseAt) + Math.max(0, instant - demoStartedAt));
    };
    update();
    const timer = setInterval(update, 15_000);
    return () => clearInterval(timer);
  }, [demoBaseAt, demoStartedAt, live, onDayChange]);
  return <NowContext value={live ? realNow : demoNow(state, realNow)}>{children}</NowContext>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { state: auth } = useMobileAuth();
  const [state, setState] = useState<AppState>(() => createDemoState());
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [demoChatDrafts, setDemoChatDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());
  const stateRef = useRef(state), readyRef = useRef(false), canPersist = useRef(true), mounted = useRef(true);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    mounted.current = true;
    let canceled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (canceled) return;
        if (raw) {
          const decoded = decodeSnapshot(raw), restored = rolloverDemoDay(decoded, demoNow(decoded));
          stateRef.current = restored; setState(restored);
        }
      } catch {
        if (canceled) return;
        // Preserve a failed/unknown snapshot. Explicit reset is required before replacing it.
        canPersist.current = false;
        setStorageError('Gemte data kunne ikke indlæses. Dine ændringer gemmes ikke. Vælg Genskab startdata i Indstillinger for at starte igen.');
      } finally {
        if (!canceled) { readyRef.current = true; setReady(true); }
      }
    })();
    return () => { canceled = true; mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!ready || !canPersist.current) return;
    const snapshot = JSON.stringify(state);
    // Serialized writes prevent an older, slower save from overwriting a newer clock-out/chat message.
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      await AsyncStorage.setItem(STORAGE_KEY, snapshot);
      if (mounted.current) setStorageError(null);
    }).catch(() => {
      if (mounted.current) setStorageError('Ændringerne er kun gemt i denne session. Enheden kunne ikke gemme data.');
    });
  }, [ready, state]);

  const dispatch = useCallback((action: AppAction): Result => {
    if (!readyRef.current) return unavailable();
    const current = stateRef.current;
    const realNow = Date.now();
    const transition = applyAction(current, action, demoNow(current, realNow), realNow);
    if (transition.result.ok && transition.state !== current) { stateRef.current = transition.state; setState(transition.state); }
    return transition.result;
  }, []);
  const clockIn = useCallback(async (shiftId: string, signal: AbortSignal): Promise<Result> => {
    if (!readyRef.current) return unavailable();
    if (signal.aborted) return { ok: false };
    const current = stateRef.current;
    const shift = current.shifts.find(item => item.id === shiftId);
    if (!shift) return { ok: false, error: 'Vagten blev ikke fundet.' };
    const availability = clockInAvailability(current, shift, demoNow(current));
    if (!availability.allowed) return { ok: false, error: availability.reason };

    const site = current.sites.find(item => item.id === shift.siteId);
    if (!site) return { ok: false, error: 'Vagtens arbejdssted blev ikke fundet.' };
    const geofence = site.geofence;
    let location: ClockInLocation | undefined;
    if (geofence) {
      const reading = await readClockInLocation(signal, geofence.radiusMeters);
      if (signal.aborted) return { ok: false };
      if ('error' in reading) return { ok: false, error: reading.error };
      location = reading.location;
    }
    return dispatch({ type: 'clockIn', shiftId, location });
  }, [dispatch]);
  const onDayChange = useCallback((now: number) => {
    if (!readyRef.current) return;
    const current = stateRef.current, updated = rolloverDemoDay(current, now);
    if (updated !== current) { stateRef.current = updated; setState(updated); }
  }, []);
  const resetDemo = useCallback((): Result => {
    if (!readyRef.current) return unavailable();
    const seed = createDemoState();
    canPersist.current = true; stateRef.current = seed; setState(seed); setStorageError(null);
    setDemoChatDrafts(new Map());
    return { ok: true };
  }, []);
  const setDemoChatDraft = useCallback((roomId: string, text: string) => {
    if (auth.mode !== 'demo') return;
    const { rooms, selfId } = stateRef.current;
    if (!rooms.some(room => room.id === roomId && room.memberIds.includes(selfId))) return;
    setDemoChatDrafts(previous => {
      if ((previous.get(roomId) ?? '') === text) return previous;
      const next = new Map(previous);
      if (text) next.set(roomId, text);
      else next.delete(roomId);
      return next;
    });
  }, [auth.mode]);
  const actions = useMemo<AppActions>(() => ({
    clockIn,
    clockOut: (shiftId, comment) => dispatch({ type: 'clockOut', shiftId, comment }),
    pause: shiftId => dispatch({ type: 'pause', shiftId }),
    resume: shiftId => dispatch({ type: 'resume', shiftId }),
    toggleTask: (shiftId, taskId) => dispatch({ type: 'toggleTask', shiftId, taskId }),
    requestLeave: (shiftId, comment) => dispatch({ type: 'requestLeave', shiftId, comment }),
    claimShift: shiftId => dispatch({ type: 'claimShift', shiftId }),
    sendMessage: (roomId, text) => dispatch({ type: 'sendMessage', roomId, text }),
    markRoomRead: roomId => dispatch({ type: 'markRoomRead', roomId }),
    markNotificationRead: id => dispatch({ type: 'markNotificationRead', id }),
    setUnavailableDate: (date, unavailable) => dispatch({ type: 'setUnavailableDate', date, unavailable }),
    setPreference: (key, value) => dispatch({ type: 'setPreference', key, value }),
    resetDemo,
  }), [clockIn, dispatch, resetDemo]);
  const self = state.people.find(p => p.id === state.selfId)!;
  const value = useMemo(() => ({ state, ready, self, actions, storageError, demoChatDrafts, setDemoChatDraft }),
    [state, ready, self, actions, storageError, demoChatDrafts, setDemoChatDraft]);
  return <StoreContext value={value}><AppClock state={state} live={auth.mode === 'signedIn'} onDayChange={onDayChange}>{children}</AppClock></StoreContext>;
}

/** For static/data-only screens; avoids subscribing to the clock context. */
export function useAppData(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useAppData skal bruges under AppProvider.');
  return value;
}
export function useNow(): number { return useContext(NowContext); }
export function useApp(): StoreValue & { now: number } { return { ...useAppData(), now: useNow() }; }
