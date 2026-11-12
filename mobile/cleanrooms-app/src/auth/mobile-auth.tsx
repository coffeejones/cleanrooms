import * as SecureStore from 'expo-secure-store';
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { PendingLogouts } from './pending-logouts';
import { closePushAccount } from '@/notifications/push-account-events';
import { clearEmployeeDrafts } from '@/state/private-drafts';
import type { Shift } from '@/domain/model';
import { clearEmployeeOffline, employeeOffline, offlineScope } from '@/state/employee-offline';
import { offlineMaxAge, type OfflineKind, type OfflineRecord } from '@/state/employee-offline-cache';

import { canUseMobileAuth, isSessionToken, mobileAuthApi, MobileAuthError, mobileAuthOrigin, type MobileSession, type PublishedShift, type PublishedShiftDetail, type ShiftTimeCommand, type ShiftTimeEntry } from './mobile-auth-api';

const sessionKey = 'cleanrooms.mobile-auth.v1';
const storageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const pendingLogoutKey = 'cleanrooms.mobile-auth.pending-logout.v1';
const pendingLogoutNotice = 'Logget ud på enheden. Serveradgangen lukkes, når der er forbindelse.';
const unconfirmedLogoutNotice = 'Logget ud på enheden. Serverlukning kunne ikke bekræftes.';
const pendingLogouts = new PendingLogouts({
  read: () => SecureStore.getItemAsync(pendingLogoutKey, storageOptions),
  write: value => SecureStore.setItemAsync(pendingLogoutKey, value, storageOptions),
  clear: () => SecureStore.deleteItemAsync(pendingLogoutKey, storageOptions),
});

type AuthState =
  | { mode: 'loading' }
  | { mode: 'signedOut'; notice?: string; retry?: boolean }
  | { mode: 'demo' }
  | { mode: 'signedIn'; session: MobileSession; offline?: boolean; connection?: 'checking' | 'offline' | 'online'; verifiedAt?: number };

type Result = { ok: true } | { ok: false; error: string };
type AuthContextValue = {
  state: AuthState;
  sessionEpoch: number;
  offlineLease: number;
  readOfflineResource: <T>(kind: OfflineKind, key: string, lease: number) => Promise<OfflineRecord<T> | null>;
  saveOfflineResource: (kind: OfflineKind, key: string, value: unknown, lease: number) => Promise<void>;
  signIn: (email: string, password: string) => Promise<Result>;
  changePassword: (current: string, next: string) => Promise<Result>;
  signOut: () => Promise<Result>;
  retrySession: () => Promise<void>;
  openDemo: () => void;
  leaveDemo: () => void;
  readPublishedSchedule: (from: string, to: string, cursor: string | null) => Promise<{ shifts: PublishedShift[]; nextCursor: string | null }>;
  readPublishedShift: (shiftId: string) => Promise<PublishedShiftDetail | null>;
  readActiveTime: () => Promise<PublishedShift | null>;
  readShiftTimeChange: (shift: Pick<Shift, 'id' | 'date' | 'start' | 'end' | 'personId'>) => Promise<{ start: string; end: string } | null>;
  writeShiftTime: (command: ShiftTimeCommand) => Promise<ShiftTimeEntry>;
  employeeRequest: <T>(payload: Record<string, unknown> & { action: string }) => Promise<T>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const sessionExpired = 'Din session er udløbet. Log ind igen.';
const storageError = 'Appen kunne ikke bruge sikker lagring. Prøv igen.';
const ok: Result = { ok: true };
const failure = (error: string): Result => ({ ok: false, error });
const inProgress = () => failure('Vent, til den forrige handling er færdig.');

async function readToken() {
  const raw = await SecureStore.getItemAsync(sessionKey, storageOptions);
  if (!raw) return null;
  const stored: unknown = JSON.parse(raw);
  if (stored === null || typeof stored !== 'object' || !('origin' in stored) || !('token' in stored)
    || stored.origin !== mobileAuthOrigin || !isSessionToken(stored.token)) return null;
  return stored.token;
}

function saveToken(token: string) {
  return SecureStore.setItemAsync(sessionKey, JSON.stringify({ origin: mobileAuthOrigin, token }), storageOptions);
}

function clearToken() {
  return SecureStore.deleteItemAsync(sessionKey, storageOptions);
}

export function offlineConnectionFailure(error: unknown) {
  return error instanceof MobileAuthError && (error.code === 'mobile_connection_failed' || error.code === 'mobile_unavailable' && [502, 503, 504].includes(error.status));
}

function sessionInvalid(error: unknown) {
  return error instanceof MobileAuthError && error.code === 'mobile_session_invalid';
}

function errorMessage(error: unknown) {
  return error instanceof MobileAuthError ? error.message : storageError;
}

export function MobileAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(canUseMobileAuth ? { mode: 'loading' } : { mode: 'signedOut' });
  const activeToken = useRef<string | null>(null);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const busy = useRef(false);
  const sessionValue = useRef<MobileSession | null>(null);
  const offlineMode = useRef(false);
  const deniedCacheToken = useRef<string | null>(null);
  const verifiedAt = useRef(0);
  const verifying = useRef<{ token: string; task: Promise<MobileSession> } | null>(null);
  const offlineSessionTask = useRef<Promise<unknown>>(Promise.resolve());
  const expiring = useRef<Promise<void> | null>(null);
  const flushLogouts = useCallback(async () => {
    if (!mobileAuthOrigin) return;
    try {
      await pendingLogouts.flush(mobileAuthOrigin, mobileAuthApi.logout);
      if (!await pendingLogouts.hasPending(mobileAuthOrigin)) setState(previous => previous.mode === 'signedOut' && previous.notice === pendingLogoutNotice
        ? { mode: 'signedOut' } : previous);
    } catch { /* Remains encrypted and is retried on foreground/start. */ }
  }, []);

  const expire = useCallback(async (expectedToken?: string | null) => {
    if (expiring.current) return expiring.current;
    if (expectedToken !== undefined && activeToken.current !== expectedToken) return;
    const wasBusy = busy.current;
    busy.current = true;
    // Fence old reads immediately and keep credential replacement serialized
    // until Keychain deletion and push teardown have both finished.
    activeToken.current = null;
    sessionValue.current = null; offlineMode.current = false;
    void clearEmployeeOffline().catch(() => undefined);
    setSessionEpoch(value => value + 1);
    setState({ mode: 'signedOut', notice: sessionExpired });
    void clearEmployeeDrafts().catch(() => undefined);
    const ending = (async () => {
      await closePushAccount(false).catch(() => undefined);
      await clearToken().catch(() => undefined);
    })();
    expiring.current = ending;
    try { await ending; }
    finally {
      if (expiring.current === ending) { expiring.current = null; busy.current = wasBusy; }
    }
  }, []);

  const acceptSession = useCallback((token: string, session: MobileSession) => {
    if (activeToken.current !== token) return;
    const old = sessionValue.current;
    if (old && (old.employee.workspaceId !== session.employee.workspaceId || old.employee.personId !== session.employee.personId)) {
      void clearEmployeeOffline().catch(() => undefined); setSessionEpoch(value => value + 1);
    }
    sessionValue.current = session; offlineMode.current = false; deniedCacheToken.current = null; verifiedAt.current = Date.now();
    setState({ mode: 'signedIn', session, connection: 'online', verifiedAt: verifiedAt.current });
    const lease = employeeOffline.lease();
    offlineSessionTask.current = (async () => {
      if (!mobileAuthOrigin) return;
      const scope = await offlineScope(mobileAuthOrigin, token);
      if (activeToken.current === token && employeeOffline.lease() === lease) await employeeOffline.remember(scope, session, lease);
    })().catch(() => undefined);
  }, []);

  const markOffline = useCallback((token: string) => {
    const session = sessionValue.current;
    if (activeToken.current !== token || !session) return;
    if (Date.parse(session.expiresAt) <= Date.now() || verifiedAt.current + offlineMaxAge <= Date.now()) { void expire(token); return; }
    offlineMode.current = true;
    setState({ mode: 'signedIn', session, offline: true, connection: 'offline', verifiedAt: verifiedAt.current });
  }, [expire]);

  const verifySession = useCallback((token: string): Promise<MobileSession> => {
    if (verifying.current?.token === token) return verifying.current.task;
    const lease = employeeOffline.lease();
    const task = mobileAuthApi.session(token).then(session => {
      if (activeToken.current !== token) throw new MobileAuthError('mobile_session_invalid', 401, sessionExpired);
      if (employeeOffline.lease() !== lease) throw new MobileAuthError('mobile_refresh_superseded', 409, 'Adgangen er opdateret. Hent oplysningerne igen.');
      acceptSession(token, session); return session;
    }).catch(async error => {
      if (activeToken.current === token && !busy.current) {
        if (sessionInvalid(error) || error instanceof MobileAuthError && [401, 403].includes(error.status)) await expire(token);
        else if (offlineConnectionFailure(error)) markOffline(token);
      }
      throw error;
    }).finally(() => { if (verifying.current?.task === task) verifying.current = null; });
    verifying.current = { token, task }; return task;
  }, [acceptSession, expire, markOffline]);

  const restoreSession = useCallback(async (isCurrent: () => boolean) => {
    try {
      const token = await readToken();
      if (!isCurrent()) return;
      if (token && mobileAuthOrigin && await pendingLogouts.contains(mobileAuthOrigin, token)) {
        // Recover an interrupted logout without ever restoring that credential.
        await clearToken();
        if (isCurrent()) setState({ mode: 'signedOut', notice: pendingLogoutNotice });
        return;
      }
      if (!token) {
        const waiting = mobileAuthOrigin && await pendingLogouts.hasPending(mobileAuthOrigin);
        if (!isCurrent()) return;
        setState({ mode: 'signedOut', ...(waiting ? { notice: pendingLogoutNotice } : {}) });
        return;
      }
      const lease = employeeOffline.lease();
      const cached = mobileAuthOrigin ? await employeeOffline.restore(await offlineScope(mobileAuthOrigin, token), lease).catch(() => null) : null;
      if (!isCurrent()) return;
      activeToken.current = token;
      if (cached) {
        // Cached identity unlocks only yesterday's read model while the server
        // checks this credential. It never unlocks a clock or other mutation.
        sessionValue.current = cached.session; verifiedAt.current = cached.verifiedAt; offlineMode.current = true;
        setSessionEpoch(value => value + 1);
        setState({ mode: 'signedIn', session: cached.session, offline: true, connection: 'checking', verifiedAt: cached.verifiedAt });
      }
      await verifySession(token);
      if (!isCurrent() || activeToken.current !== token) return;
      if (!cached) setSessionEpoch(value => value + 1);
    } catch (error) {
      if (!isCurrent()) return;
      if (sessionInvalid(error) || error instanceof MobileAuthError && [401, 403].includes(error.status)) { if (activeToken.current) await expire(); }
      else if (activeToken.current && sessionValue.current && offlineConnectionFailure(error)) markOffline(activeToken.current);
      else { activeToken.current = null; sessionValue.current = null; offlineMode.current = false; setState({ mode: 'signedOut', notice: errorMessage(error), retry: true }); }
    }
  }, [expire, markOffline, verifySession]);

  useEffect(() => {
    if (!canUseMobileAuth) return;
    let current = true;
    queueMicrotask(() => {
      if (current) void restoreSession(() => current).finally(() => { if (current) void flushLogouts(); });
    });
    return () => { current = false; };
  }, [flushLogouts, restoreSession]);

  const retrySession = useCallback(async () => {
    if (busy.current || !canUseMobileAuth) return;
    busy.current = true;
    setState({ mode: 'loading' });
    try {
      await restoreSession(() => true);
    } finally {
      busy.current = false;
    }
  }, [restoreSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') void flushLogouts();
      const token = activeToken.current;
      if (status !== 'active' || !token || busy.current) return;
      void verifySession(token).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [flushLogouts, verifySession]);

  const signIn = useCallback(async (email: string, password: string): Promise<Result> => {
    if (busy.current) return inProgress();
    busy.current = true;
    try {
      await clearEmployeeOffline().catch(() => undefined);
      const { token, session } = await mobileAuthApi.login(email, password);
      void clearEmployeeDrafts().catch(() => undefined);
      try {
        await saveToken(token);
      } catch (error) {
        void mobileAuthApi.logout(token).catch(() => undefined);
        throw error;
      }
      setSessionEpoch(value => value + 1);
      activeToken.current = token;
      acceptSession(token, session);
      return ok;
    } catch (error) {
      return failure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  }, [acceptSession]);

  const changePassword = useCallback(async (current: string, next: string): Promise<Result> => {
    const token = activeToken.current;
    if (busy.current) return inProgress();
    if (!token) return failure(sessionExpired);
    if (offlineMode.current) return failure('Opret forbindelse for at ændre adgangskoden.');
    busy.current = true;
    try {
      const { token: replacement, session } = await mobileAuthApi.changePassword(token, current, next);
      await clearEmployeeOffline().catch(() => undefined);
      void clearEmployeeDrafts().catch(() => undefined);
      try {
        await saveToken(replacement);
      } catch {
        setSessionEpoch(value => value + 1);
        activeToken.current = null;
        await clearToken().catch(() => undefined);
        void mobileAuthApi.logout(replacement).catch(() => undefined);
        setState({ mode: 'signedOut', notice: 'Adgangskoden er ændret. Log ind igen med den nye adgangskode.' });
        return ok;
      }
      setSessionEpoch(value => value + 1);
      activeToken.current = replacement;
      acceptSession(replacement, session);
      return ok;
    } catch (error) {
      if (sessionInvalid(error)) await expire(token);
      return failure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  }, [acceptSession, expire]);

  const signOut = useCallback(async (): Promise<Result> => {
    if (busy.current) return inProgress();
    busy.current = true;
    const token = activeToken.current;
    try {
      void clearEmployeeDrafts().catch(() => undefined);
      void clearEmployeeOffline().catch(() => undefined);
      await closePushAccount();
      let queued = false;
      if (token && mobileAuthOrigin) {
        try {
          await pendingLogouts.enqueue(mobileAuthOrigin, token, state.mode === 'signedIn' ? Date.parse(state.session.expiresAt) : undefined);
          queued = true;
        } catch { /* A failed revocation-queue write must never prevent local logout. */ }
      }
      await clearToken();
      setSessionEpoch(value => value + 1);
      activeToken.current = null; sessionValue.current = null; offlineMode.current = false;
      setState({ mode: 'signedOut', ...(token ? { notice: queued ? pendingLogoutNotice : unconfirmedLogoutNotice } : {}) });
      if (queued) void flushLogouts();
      else if (token) void mobileAuthApi.logout(token).then(() => setState(previous => previous.mode === 'signedOut' && previous.notice === unconfirmedLogoutNotice
        ? { mode: 'signedOut' } : previous)).catch(() => undefined);
      return ok;
    } catch (error) {
      // Local storage refused logout; the still-valid account may resume push.
      setSessionEpoch(value => value + 1);
      return failure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  }, [flushLogouts, state]);

  const openDemo = useCallback(() => {
    if (busy.current) return;
    void clearEmployeeOffline().catch(() => undefined);
    setState({ mode: 'demo' });
  }, []);

  const leaveDemo = useCallback(() => setState({ mode: 'signedOut' }), []);

  const readEmployeeData = useCallback(async <T,>(load: (token: string) => Promise<T>) => {
    const token = activeToken.current;
    const expired = () => new MobileAuthError('mobile_session_invalid', 401, sessionExpired);
    if (!token) throw expired();
    try {
      if (offlineMode.current) await verifySession(token);
      const result = await load(token);
      if (activeToken.current !== token) throw expired();
      return result;
    } catch (error) {
      if (activeToken.current === token && !busy.current) {
        if (sessionInvalid(error) || error instanceof MobileAuthError && error.status === 401) await expire(token);
        else if (error instanceof MobileAuthError && error.status === 403 && deniedCacheToken.current !== token) {
          deniedCacheToken.current = token; void clearEmployeeOffline().catch(() => undefined); setSessionEpoch(value => value + 1);
        }
        else if (offlineConnectionFailure(error)) markOffline(token);
      }
      throw error;
    }
  }, [expire, markOffline, verifySession]);
  const readPublishedSchedule = useCallback((from: string, to: string, cursor: string | null) =>
    readEmployeeData(token => mobileAuthApi.publishedSchedule(token, from, to, cursor)), [readEmployeeData]);
  const readPublishedShift = useCallback((shiftId: string) =>
    readEmployeeData(token => mobileAuthApi.publishedShift(token, shiftId)), [readEmployeeData]);
  const readActiveTime = useCallback(() => readEmployeeData(token => mobileAuthApi.activeTime(token)), [readEmployeeData]);
  const readShiftTimeChange = useCallback((shift: Pick<Shift, 'id' | 'date' | 'start' | 'end' | 'personId'>) =>
    readEmployeeData(token => mobileAuthApi.shiftTimeChange(token, shift)), [readEmployeeData]);
  const writeShiftTime = useCallback((command: ShiftTimeCommand) => {
    if (offlineMode.current) return Promise.reject(new MobileAuthError('mobile_offline_read_only', 503, 'Opret forbindelse for at stemple.'));
    return readEmployeeData(token => mobileAuthApi.shiftTime(token, command));
  }, [readEmployeeData]);
  const employeeRequest = useCallback(<T,>(payload: Record<string, unknown> & { action: string }) => {
    if (offlineMode.current && !['workflowRead', 'employeeInbox', 'employeeHours', 'employeePreferences', 'employeeCompanySettings', 'leaveRead', 'employeeColleagues', 'chatList', 'chatRead', 'chatSync'].includes(payload.action)) {
      return Promise.reject(new MobileAuthError('mobile_offline_read_only', 503, 'Opret forbindelse for at gemme ændringen.'));
    }
    return readEmployeeData(token => mobileAuthApi.employeeRequest<T>(token, payload));
  }, [readEmployeeData]);
  const readOfflineResource = useCallback(async <T,>(kind: OfflineKind, key: string, lease: number): Promise<OfflineRecord<T> | null> => {
    const token = activeToken.current; if (!token || !mobileAuthOrigin || lease !== employeeOffline.lease()) return null;
    const scope = await offlineScope(mobileAuthOrigin, token);
    const result = await employeeOffline.read<T>(scope, kind, key, lease).catch(() => null);
    return activeToken.current === token && lease === employeeOffline.lease() ? result : null;
  }, []);
  const saveOfflineResource = useCallback(async (kind: OfflineKind, key: string, value: unknown, lease: number) => {
    const token = activeToken.current; if (!token || !mobileAuthOrigin || offlineMode.current || lease !== employeeOffline.lease()) return;
    await offlineSessionTask.current;
    const scope = await offlineScope(mobileAuthOrigin, token);
    if (activeToken.current === token && !offlineMode.current && lease === employeeOffline.lease()) await employeeOffline.save(scope, kind, key, value, lease).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (state.mode !== 'signedIn' || !state.offline) return;
    const token = activeToken.current;
    const expires = Math.min(Date.parse(state.session.expiresAt), (state.verifiedAt ?? 0) + offlineMaxAge);
    const timer = setTimeout(() => { if (token && activeToken.current === token) void expire(token); }, Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [expire, state]);

  return <AuthContext value={{ state, sessionEpoch, offlineLease: employeeOffline.lease(), readOfflineResource, saveOfflineResource, signIn, changePassword, signOut, retrySession, openDemo, leaveDemo, readPublishedSchedule, readPublishedShift, readActiveTime, readShiftTimeChange, writeShiftTime, employeeRequest }}>{children}</AuthContext>;
}

export function useMobileAuth() {
  const context = use(AuthContext);
  if (!context) throw new Error('MobileAuthProvider mangler.');
  return context;
}
