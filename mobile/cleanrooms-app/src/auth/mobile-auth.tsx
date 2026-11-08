import * as SecureStore from 'expo-secure-store';
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { canUseMobileAuth, isSessionToken, mobileAuthApi, MobileAuthError, mobileAuthOrigin, type MobileSession, type PublishedShift, type PublishedShiftDetail, type ShiftTimeCommand, type ShiftTimeEntry } from './mobile-auth-api';

const sessionKey = 'cleanrooms.mobile-auth.v1';
const storageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

type AuthState =
  | { mode: 'loading' }
  | { mode: 'signedOut'; notice?: string; retry?: boolean }
  | { mode: 'demo' }
  | { mode: 'signedIn'; session: MobileSession };

type Result = { ok: true } | { ok: false; error: string };
type AuthContextValue = {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<Result>;
  changePassword: (current: string, next: string) => Promise<Result>;
  signOut: () => Promise<Result>;
  retrySession: () => Promise<void>;
  openDemo: () => void;
  leaveDemo: () => void;
  readPublishedSchedule: (from: string, to: string, cursor: string | null) => Promise<{ shifts: PublishedShift[]; nextCursor: string | null }>;
  readPublishedShift: (shiftId: string) => Promise<PublishedShiftDetail | null>;
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

function sessionInvalid(error: unknown) {
  return error instanceof MobileAuthError && error.code === 'mobile_session_invalid';
}

function errorMessage(error: unknown) {
  return error instanceof MobileAuthError ? error.message : storageError;
}

export function MobileAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(canUseMobileAuth ? { mode: 'loading' } : { mode: 'signedOut' });
  const activeToken = useRef<string | null>(null);
  const busy = useRef(false);

  const expire = useCallback(async () => {
    activeToken.current = null;
    await clearToken().catch(() => undefined);
    setState({ mode: 'signedOut', notice: sessionExpired });
  }, []);

  const restoreSession = useCallback(async (isCurrent: () => boolean) => {
    try {
      const token = await readToken();
      if (!isCurrent()) return;
      if (!token) {
        setState({ mode: 'signedOut' });
        return;
      }
      const session = await mobileAuthApi.session(token);
      if (!isCurrent()) return;
      activeToken.current = token;
      setState({ mode: 'signedIn', session });
    } catch (error) {
      if (!isCurrent()) return;
      if (sessionInvalid(error)) await expire();
      else setState({ mode: 'signedOut', notice: errorMessage(error), retry: true });
    }
  }, [expire]);

  useEffect(() => {
    if (!canUseMobileAuth) return;
    let current = true;
    queueMicrotask(() => {
      if (current) void restoreSession(() => current);
    });
    return () => { current = false; };
  }, [restoreSession]);

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
      const token = activeToken.current;
      if (status !== 'active' || !token || busy.current) return;
      void mobileAuthApi.session(token).then(session => {
        if (activeToken.current === token && !busy.current) setState({ mode: 'signedIn', session });
      }).catch(error => {
        if (sessionInvalid(error) && activeToken.current === token && !busy.current) void expire();
      });
    });
    return () => subscription.remove();
  }, [expire]);

  const signIn = useCallback(async (email: string, password: string): Promise<Result> => {
    if (busy.current) return inProgress();
    busy.current = true;
    try {
      const { token, session } = await mobileAuthApi.login(email, password);
      try {
        await saveToken(token);
      } catch (error) {
        void mobileAuthApi.logout(token).catch(() => undefined);
        throw error;
      }
      activeToken.current = token;
      setState({ mode: 'signedIn', session });
      return ok;
    } catch (error) {
      return failure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  }, []);

  const changePassword = useCallback(async (current: string, next: string): Promise<Result> => {
    const token = activeToken.current;
    if (busy.current) return inProgress();
    if (!token) return failure(sessionExpired);
    busy.current = true;
    try {
      const { token: replacement, session } = await mobileAuthApi.changePassword(token, current, next);
      try {
        await saveToken(replacement);
      } catch {
        activeToken.current = null;
        await clearToken().catch(() => undefined);
        void mobileAuthApi.logout(replacement).catch(() => undefined);
        setState({ mode: 'signedOut', notice: 'Adgangskoden er ændret. Log ind igen med den nye adgangskode.' });
        return ok;
      }
      activeToken.current = replacement;
      setState({ mode: 'signedIn', session });
      return ok;
    } catch (error) {
      if (sessionInvalid(error)) await expire();
      return failure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  }, [expire]);

  const signOut = useCallback(async (): Promise<Result> => {
    if (busy.current) return inProgress();
    busy.current = true;
    const token = activeToken.current;
    try {
      await clearToken();
      activeToken.current = null;
      setState({ mode: 'signedOut' });
      if (token) void mobileAuthApi.logout(token).catch(() => undefined);
      return ok;
    } catch (error) {
      return failure(errorMessage(error));
    } finally {
      busy.current = false;
    }
  }, []);

  const openDemo = useCallback(() => {
    if (busy.current) return;
    setState({ mode: 'demo' });
  }, []);

  const leaveDemo = useCallback(() => setState({ mode: 'signedOut' }), []);

  const readEmployeeData = useCallback(async <T,>(load: (token: string) => Promise<T>) => {
    const token = activeToken.current;
    const expired = () => new MobileAuthError('mobile_session_invalid', 401, sessionExpired);
    if (!token) throw expired();
    try {
      const result = await load(token);
      if (activeToken.current !== token) throw expired();
      return result;
    } catch (error) {
      if (sessionInvalid(error) && activeToken.current === token && !busy.current) await expire();
      throw error;
    }
  }, [expire]);
  const readPublishedSchedule = useCallback((from: string, to: string, cursor: string | null) =>
    readEmployeeData(token => mobileAuthApi.publishedSchedule(token, from, to, cursor)), [readEmployeeData]);
  const readPublishedShift = useCallback((shiftId: string) =>
    readEmployeeData(token => mobileAuthApi.publishedShift(token, shiftId)), [readEmployeeData]);
  const writeShiftTime = useCallback((command: ShiftTimeCommand) =>
    readEmployeeData(token => mobileAuthApi.shiftTime(token, command)), [readEmployeeData]);
  const employeeRequest = useCallback(<T,>(payload: Record<string, unknown> & { action: string }) =>
    readEmployeeData(token => mobileAuthApi.employeeRequest<T>(token, payload)), [readEmployeeData]);

  return <AuthContext value={{ state, signIn, changePassword, signOut, retrySession, openDemo, leaveDemo, readPublishedSchedule, readPublishedShift, writeShiftTime, employeeRequest }}>{children}</AuthContext>;
}

export function useMobileAuth() {
  const context = use(AuthContext);
  if (!context) throw new Error('MobileAuthProvider mangler.');
  return context;
}
