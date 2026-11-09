import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { router, useRootNavigationState } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { createContext, use, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useMobileAuth } from '@/auth/mobile-auth';
import { mobileAuthOrigin, MobileAuthError } from '@/auth/mobile-auth-api';
import { RetryGate } from '@/state/retry-policy';
import { invalidateEmployeeResources } from '@/state/published-schedule';
import { onPushAccountClosing } from './push-account-events';
import { parsePushHint, PushOpenGuard, pushRoute, validInstallationId, validProjectId, type PushHint } from './push-wire';

type NativeNotifications = typeof import('expo-notifications');
type PushStatus = 'checking' | 'ready' | 'permission-required' | 'permission-denied' | 'disabled' | 'unavailable' | 'error';
type PushState = { status: PushStatus; message?: string };
type PushContextValue = PushState & { enable: () => Promise<boolean>; refresh: () => void; sendTest: () => Promise<void> };
const PushContext = createContext<PushContextValue | null>(null);
const installationKey = 'cleanrooms.push-installation.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let installationTask: Promise<string> | undefined;
async function installationId() {
  if (!installationTask) installationTask = (async () => {
    const raw = await SecureStore.getItemAsync(installationKey, options);
    if (raw) {
      try {
        const value: unknown = JSON.parse(raw);
        if (value && typeof value === 'object' && 'origin' in value && value.origin === mobileAuthOrigin
          && 'id' in value && validInstallationId(value.id)) return value.id;
      } catch { /* Replace malformed local metadata, never reuse credentials from another origin. */ }
    }
    const id = Crypto.randomUUID();
    await SecureStore.setItemAsync(installationKey, JSON.stringify({ origin: mobileAuthOrigin, id }), options);
    return id;
  })().catch(error => { installationTask = undefined;throw error; });
  return installationTask;
}
function permitted(permission: import('expo-notifications').NotificationPermissionsStatus, native: NativeNotifications) {
  if (process.env.EXPO_OS !== 'ios') return permission.granted;
  return permission.ios?.status === native.IosAuthorizationStatus.AUTHORIZED
    || permission.ios?.status === native.IosAuthorizationStatus.PROVISIONAL
    || permission.ios?.status === native.IosAuthorizationStatus.EPHEMERAL;
}
const unavailable = 'Beskeder er ikke tilgængelige på denne appversion.';
const retryMessage = 'Beskeder kunne ikke aktiveres. Prøv igen, når der er forbindelse.';

export function PushNotificationsProvider({ children }: { children: ReactNode }) {
  const auth = useMobileAuth();
  const navigation = useRootNavigationState();
  const scope = auth.state.mode === 'signedIn'
    ? JSON.stringify([auth.state.session.employee.workspaceId, auth.state.session.employee.personId, auth.sessionEpoch]) : null;
  const supported = process.env.EXPO_OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
  const [status, setStatus] = useState<PushState>(supported ? { status: 'checking' } : { status: 'unavailable', message: unavailable });
  const [pendingHint, setPendingHint] = useState<PushHint | null>(null);
  const pendingHintRef = useRef<PushHint | null>(pendingHint);
  const [openAttempt, setOpenAttempt] = useState(0);
  const native = useRef<NativeNotifications | null>(null);
  const nativeId = useRef<string | null>(null);
  const deviceToken = useRef<import('expo-notifications').DevicePushToken | undefined>(undefined);
  const scopeRef = useRef<string | null>(scope);
  const requestRef = useRef(auth.employeeRequest);
  const lastSync = useRef(0);
  const lastRegistration = useRef<{ scope: string; token: string; at: number } | null>(null);
  const generation = useRef(0);
  const running = useRef<Promise<boolean> | null>(null);
  const refreshAfterCurrent = useRef(false);
  const retryGate = useRef(new RetryGate(3000, 300_000));
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openGuard = useRef(new PushOpenGuard());
  const closedScope = useRef<string | null>(null);
  const mounted = useRef(true);
  const syncRef = useRef<(prompt?: boolean, force?: boolean) => Promise<boolean>>(async () => false);
  const enabled = useRef(false);
  useLayoutEffect(() => {
    requestRef.current = auth.employeeRequest;scopeRef.current = scope;pendingHintRef.current = pendingHint;
    openGuard.current.setScope(scope);
  }, [auth.employeeRequest, pendingHint, scope]);

  const scheduleRetry = useCallback((binding: string, epoch: number, retryAfterMs?: number) => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const delay = retryGate.current.fail(Date.now(), retryAfterMs);
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      if (scopeRef.current === binding && closedScope.current !== binding && generation.current === epoch
        && mounted.current && AppState.currentState === 'active') {
        lastSync.current = 0;void syncRef.current();
      }
    }, delay);
  }, []);

  const sync = useCallback(async (prompt = false, force = false): Promise<boolean> => {
    if (running.current) { if (force) refreshAfterCurrent.current = true;return running.current; }
    const binding = scopeRef.current, module = native.current;
    if (!binding || closedScope.current === binding || !module || !nativeId.current) return false;
    if (!prompt && !force && !retryGate.current.ready(Date.now())) return false;
    if (!prompt && !force && Date.now() - lastSync.current < 15_000) return status.status === 'ready';
    lastSync.current = Date.now();
    const epoch = generation.current;
    const current = () => mounted.current && scopeRef.current === binding && closedScope.current !== binding && generation.current === epoch;
    const update = (value: PushState) => { if (current()) setStatus(value); };
    const settled = (value: PushState) => {
      if (!current()) return;
      retryGate.current.success();
      if (retryTimer.current) { clearTimeout(retryTimer.current);retryTimer.current = null; }
      update(value);
    };
    const task = (async () => {
      try {
        const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        if (!validProjectId(projectId)) { settled({ status: 'unavailable', message: unavailable });return false; }
        const preferences = await requestRef.current<{ notifications: boolean; chatNotifications: boolean }>({ action: 'employeePreferences' });
        if (!current()) return false;
        if (typeof preferences.notifications !== 'boolean' || typeof preferences.chatNotifications !== 'boolean') throw Error('Invalid preferences');
        enabled.current = preferences.notifications || preferences.chatNotifications;
        if (!enabled.current && !prompt) {
          await requestRef.current({ action: 'employeePushUnregister', installationId: nativeId.current });
          if (current()) lastRegistration.current = null;
          settled({ status: 'disabled' });return false;
        }
        let permissions = await module.getPermissionsAsync();
        if (!current()) return false;
        if (!permitted(permissions, module) && prompt && permissions.canAskAgain) {
          if (process.env.EXPO_OS === 'android') await module.setNotificationChannelAsync('cleanrooms', {
            name: 'Vagter og samtaler', importance: module.AndroidImportance.DEFAULT,
            lockscreenVisibility: module.AndroidNotificationVisibility.PRIVATE,
          });
          if (!current()) return false;
          permissions = await module.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
        }
        if (!current()) return false;
        if (!permitted(permissions, module)) {
          if (lastRegistration.current?.scope === binding) {
            await requestRef.current({ action: 'employeePushUnregister', installationId: nativeId.current });
            if (current()) lastRegistration.current = null;
          }
          settled({ status: permissions.canAskAgain ? 'permission-required' : 'permission-denied' });return false;
        }
        if (process.env.EXPO_OS === 'android') await module.setNotificationChannelAsync('cleanrooms', {
          name: 'Vagter og samtaler', importance: module.AndroidImportance.DEFAULT,
          lockscreenVisibility: module.AndroidNotificationVisibility.PRIVATE,
        });
        if (!current()) return false;
        const expoToken = await module.getExpoPushTokenAsync({ projectId, ...(deviceToken.current ? { devicePushToken: deviceToken.current } : {}) });
        if (!current()) return false;
        if (!/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{20,200}\]$/.test(expoToken.data)) throw Error('Invalid push token');
        const registered = lastRegistration.current;
        if (!registered || registered.scope !== binding || registered.token !== expoToken.data || Date.now() - registered.at > 6 * 60 * 60_000 || force) {
          const result = await requestRef.current<{ registered: boolean }>({ action: 'employeePushRegister', installationId: nativeId.current,
            expoPushToken: expoToken.data, platform: process.env.EXPO_OS, projectId });
          if (!current()) return false;
          if (result.registered !== true) throw Error('Unconfirmed registration');
          lastRegistration.current = { scope: binding, token: expoToken.data, at: Date.now() };
        }
        settled({ status: 'ready' });return true;
      } catch (error) {
        if (current() && !(error instanceof MobileAuthError && error.code === 'mobile_session_invalid')) {
          update({ status: 'error', message: retryMessage });
          scheduleRetry(binding, epoch, error instanceof MobileAuthError ? error.retryAfterMs : undefined);
        }
        return false;
      }
    })();
    running.current = task;
    try { return await task; } finally {
      if (running.current === task) {
        running.current = null;
        if (refreshAfterCurrent.current) {
          refreshAfterCurrent.current = false;
          queueMicrotask(() => { if (current()) void syncRef.current(false, true); });
        }
      }
    }
  }, [scheduleRetry, status.status]);
  useLayoutEffect(() => { syncRef.current = sync; }, [sync]);

  useEffect(() => {
    mounted.current = true;
    if (process.env.EXPO_OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      return () => { mounted.current = false; };
    }
    let current = true;
    const subscriptions: { remove: () => void }[] = [];
    void (async () => {
      try {
        const [module, id] = await Promise.all([import('expo-notifications'), installationId()]);
        if (!current) return;
        native.current = module;nativeId.current = id;
        // Keep in-app updates quiet. The OS displays the server's generic alert
        // while the app is closed; no payroll or message text is fetched here.
        module.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false,
          shouldPlaySound: false, shouldSetBadge: false }) });
        function receive(data: unknown) {
          const hint = parsePushHint(data);
          if (!hint || hint.installationId !== id || !scopeRef.current || closedScope.current === scopeRef.current) return;
          invalidateEmployeeResources('');
        }
        function response(value: import('expo-notifications').NotificationResponse) {
          if (value.actionIdentifier !== module.DEFAULT_ACTION_IDENTIFIER) return;
          const hint = parsePushHint(value.notification.request.content.data);
          if (hint?.installationId === id) setPendingHint(hint);
          else void module.clearLastNotificationResponseAsync().catch(() => undefined);
        }
        subscriptions.push(module.addPushTokenListener(value => { deviceToken.current = value;lastRegistration.current = null;void syncRef.current(false, true); }));
        subscriptions.push(module.addNotificationReceivedListener(value => receive(value.request.content.data)));
        subscriptions.push(module.addNotificationResponseReceivedListener(response));
        const initial = await module.getLastNotificationResponseAsync();
        if (current && initial) response(initial);
        if (current) void syncRef.current();
      } catch { if (current) setStatus({ status: 'unavailable', message: unavailable }); }
    })();
    return () => { current = false;mounted.current = false;native.current = null;if (retryTimer.current) clearTimeout(retryTimer.current);subscriptions.forEach(item => item.remove()); };
  }, []);

  useEffect(() => {
    generation.current++;lastSync.current = 0;lastRegistration.current = null;running.current = null;refreshAfterCurrent.current = false;
    retryGate.current.success();
    if (retryTimer.current) { clearTimeout(retryTimer.current);retryTimer.current = null; }
    if (!scope) { queueMicrotask(() => { if (scopeRef.current === null) setPendingHint(null); });return; }
    closedScope.current = null;
    void syncRef.current();
  }, [scope]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') { void syncRef.current();setOpenAttempt(value => value + 1); } });
    return () => subscription.remove();
  }, []);

  useEffect(() => onPushAccountClosing(async remote => {
    // Immediately invalidate old account reads, before logout/password teardown.
    const binding = scopeRef.current, id = nativeId.current;
    closedScope.current = binding;generation.current++;openGuard.current.setScope(null);lastRegistration.current = null;
    if (retryTimer.current) { clearTimeout(retryTimer.current);retryTimer.current = null; }
    setPendingHint(null);
    const module = native.current;
    void module?.dismissAllNotificationsAsync().catch(() => undefined);
    void module?.clearLastNotificationResponseAsync().catch(() => undefined);
    if (remote && id && binding) await requestRef.current({ action: 'employeePushUnregister', installationId: id }).catch(() => undefined);
  }), []);

  useEffect(() => {
    if (!pendingHint || !scope || !navigation?.key || !nativeId.current || closedScope.current === scope) return;
    const current = () => mounted.current && scopeRef.current === scope && pendingHintRef.current?.eventId === pendingHint.eventId;
    void openGuard.current.open(pendingHint, nativeId.current, () => requestRef.current({ action: 'employeePushOpen',
      eventId: pendingHint.eventId, installationId: pendingHint.installationId }), target => {
      if (!current()) return false;
      router.push(pushRoute(target));return true;
    }).then(opened => {
      if (current() && opened) {
        setPendingHint(null);void native.current?.clearLastNotificationResponseAsync().catch(() => undefined);
      }
    }).catch(error => {
      if (!current()) return;
      if (error instanceof MobileAuthError && [401, 403, 404].includes(error.status)) {
        setPendingHint(null);void native.current?.clearLastNotificationResponseAsync().catch(() => undefined);
      }
      // A temporary outage keeps the hint for the next foreground; it never
      // navigates to a raw URL, another account or an unconfirmed destination.
    });
  }, [navigation?.key, pendingHint, scope, openAttempt]);

  const enable = useCallback(() => syncRef.current(true, true), []);
  const refresh = useCallback(() => { void syncRef.current(false, true); }, []);
  const sendTest = useCallback(async () => {
    const binding = scopeRef.current, id = nativeId.current;
    if (!binding || !id || closedScope.current === binding || lastRegistration.current?.scope !== binding) {
      throw new Error('Tillad først beskeder på denne telefon.');
    }
    const result = await requestRef.current<{ queued: boolean }>({ action: 'employeePushTest', installationId: id });
    if (!mounted.current || scopeRef.current !== binding || closedScope.current === binding) throw new Error('Kontoen er ændret. Prøv igen.');
    if (result.queued !== true) throw new Error('Testbeskeden kunne ikke bekræftes. Prøv igen.');
  }, []);
  return <PushContext value={{ ...status, enable, refresh, sendTest }}>{children}</PushContext>;
}
export function usePushNotifications() {
  const context = use(PushContext);
  if (!context) throw new Error('PushNotificationsProvider mangler.');
  return context;
}
