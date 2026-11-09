import { useIsFocused } from 'expo-router/react-navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useMobileAuth } from '@/auth/mobile-auth';
import { mobileAuthOrigin, MobileAuthError } from '@/auth/mobile-auth-api';
import { RetryGate } from './retry-policy';
import { monotonicNow } from './attendance-runtime';
import { useEmployeeDraft } from './private-drafts';

import { integer, invalid, record, readLiveChatRooms, readLiveConversation, readMessage, readRoom, readSync, readViewer, mergeLiveMessages, type Conversation, type RoomPage } from './chat-wire';
export type { LiveChatMessage, LiveChatRoom } from './chat-wire';

type RoomsState = { key: string; data?: RoomPage; loading: boolean; more: boolean; refreshing: boolean; error?: string };
type ConversationState = { key: string; data?: Conversation; loading: boolean; more: boolean; sending: boolean; error?: string };

const problem = (error: unknown) => error instanceof Error ? error.message : 'Kunne ikke hente samtalen. Prøv igen.';
const forbidden = (error: unknown) => error instanceof MobileAuthError && (error.status === 401 || error.status === 403);

function useActiveScreen() {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}
function useChatScope(roomId = '') {
  const auth = useMobileAuth();
  const employee = auth.state.mode === 'signedIn' ? auth.state.session.employee : null;
  const expiresAt = auth.state.mode === 'signedIn' ? auth.state.session.expiresAt : '';
  const key = employee ? JSON.stringify([employee.workspaceId, employee.personId, auth.sessionEpoch, expiresAt, roomId]) : '';
  const persistentScope = employee && roomId ? JSON.stringify([mobileAuthOrigin, employee.workspaceId, employee.personId, expiresAt, 'chat', roomId]) : '';
  const epoch = useRef(0);
  useLayoutEffect(() => {
    const generation = epoch.current + 1;
    epoch.current = generation;
    return () => { epoch.current = generation + 1; };
  }, [key]);
  return { ...auth, key, epoch, persistentScope, expiresAt: Date.parse(expiresAt) };
}

export function useLiveChatRooms() {
  const { employeeRequest, key, epoch } = useChatScope();
  const active = useActiveScreen();
  const [resource, setResource] = useState<RoomsState>();
  const current = resource?.key === key ? resource : undefined;
  const pending = useRef(false);
  const retry = useRef(new RetryGate(15_000, 120_000));
  useLayoutEffect(() => { pending.current = false; retry.current = new RetryGate(15_000, 120_000); }, [key]);

  const load = useCallback(async (next: string | null = null, manual = false) => {
    if (!key || pending.current || !retry.current.ready(monotonicNow())) return;
    const request = epoch.current;
    const retryVersion = retry.current.version;
    pending.current = true;
    setResource(previous => ({ key, data: previous?.key === key ? previous.data : undefined, loading: !next, more: Boolean(next), refreshing: manual }));
    try {
      const response = await employeeRequest({ action: 'chatList', cursor: next, limit: 100 });
      if (epoch.current !== request) return;
      const page = readLiveChatRooms(response);
      retry.current.success(retryVersion);
      if (next && page.nextCursor === next) throw new Error('Samtalelisten kunne ikke indlæses. Prøv igen.');
      setResource(previous => {
        const old = previous?.key === key ? previous.data : undefined;
        const rooms = [...new Map([...(next && old ? old.rooms : []), ...page.rooms].map(item => [item.id, item])).values()]
          .sort((a, b) => a.id.localeCompare(b.id));
        return { key, data: { ...page, rooms }, loading: false, more: false, refreshing: false };
      });
    } catch (error) {
      if (epoch.current === request) {
        retry.current.fail(monotonicNow(), error instanceof MobileAuthError ? error.retryAfterMs : undefined);
        setResource(previous => ({ key, data: !forbidden(error) && previous?.key === key ? previous.data : undefined, loading: false, more: false, refreshing: false, error: problem(error) }));
      }
    } finally { if (epoch.current === request) pending.current = false; }
  }, [employeeRequest, epoch, key]);

  useEffect(() => {
    if (!active || !key) return;
    void load();
    const timer = setInterval(() => { void load(); }, 15_000);
    return () => clearInterval(timer);
  }, [active, key, load]);

  return { ...current, data: current?.data, loading: current?.loading ?? Boolean(key), more: current?.more ?? false,
    refresh: () => { void load(null, true); }, loadMore: () => { if (current?.data?.nextCursor) void load(current.data.nextCursor); } };
}

export function useLiveConversation(roomId: string) {
  const { employeeRequest, key, epoch, persistentScope, expiresAt } = useChatScope(roomId);
  const composer = useEmployeeDraft(key, persistentScope, expiresAt);
  const active = useActiveScreen();
  const [resource, setResource] = useState<ConversationState>();
  const current = resource?.key === key ? resource : undefined;
  const data = useRef<Conversation | undefined>(undefined);
  const stream = useRef({ afterSeq: 0, version: 1 });
  const reading = useRef(false);
  const syncing = useRef(false);
  const queuedRead = useRef<{ before: string | null } | null>(null);
  const sending = useRef(false);
  const marked = useRef(0);
  const denied = useRef(false);
  const retry = useRef(new RetryGate());
  const markTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  useLayoutEffect(() => {
    data.current = undefined; reading.current = false; syncing.current = false; queuedRead.current = null; sending.current = false;
    marked.current = 0; denied.current = false; stream.current = { afterSeq: 0, version: 1 };
    retry.current = new RetryGate();
    return () => { if (markTimer.current) clearTimeout(markTimer.current); };
  }, [key]);

  const accept = useCallback((next: Conversation) => {
    data.current = next;
    setResource(previous => ({ key, data: next, loading: false, more: false, sending: previous?.key === key ? previous.sending : false }));
  }, [key]);
  const fail = useCallback((error: unknown) => {
    retry.current.fail(monotonicNow(), error instanceof MobileAuthError ? error.retryAfterMs : undefined);
    if (forbidden(error)) { data.current = undefined; denied.current = true; }
    setResource(previous => ({ key, data: data.current, loading: false, more: false, sending: previous?.key === key ? previous.sending : false, error: problem(error) }));
  }, [key]);

  const read = useCallback(async (before: string | null = null) => {
    if (!key || !roomId || reading.current || denied.current || !retry.current.ready(monotonicNow())) return;
    if (syncing.current) {
      queuedRead.current = { before };
      setResource(previous => ({ key, data: data.current, loading: !before, more: Boolean(before), sending: previous?.key === key ? previous.sending : false }));
      return;
    }
    const request = epoch.current;
    const retryVersion = retry.current.version;
    reading.current = true;
    setResource(previous => ({ key, data: data.current, loading: !before, more: Boolean(before), sending: previous?.key === key ? previous.sending : false }));
    try {
      const response = await employeeRequest({ action: 'chatRead', roomId, before, limit: 50 });
      if (epoch.current !== request) return;
      const page = readLiveConversation(response, roomId, before ? data.current?.viewer.userId : undefined);
      retry.current.success(retryVersion);
      if (before && before === page.nextCursor) throw new Error('Ældre beskeder kunne ikke indlæses. Prøv igen.');
      const old = data.current?.viewer.userId === page.viewer.userId ? data.current : undefined;
      if (before && old) accept({ ...old, room: page.room, messages: mergeLiveMessages(old.messages, page.messages), pins: page.pins, nextCursor: page.nextCursor });
      else {
        stream.current = { afterSeq: page.messages.at(-1)?.seq ?? 0, version: page.room.version };
        accept({ ...page, messages: old ? mergeLiveMessages(old.messages, page.messages) : page.messages });
      }
    } catch (error) { if (epoch.current === request) fail(error); }
    finally { if (epoch.current === request) reading.current = false; }
  }, [accept, employeeRequest, epoch, fail, key, roomId]);

  const sync = useCallback(async () => {
    if (!key || !data.current || reading.current || syncing.current || !retry.current.ready(monotonicNow())) return;
    const request = epoch.current;
    const retryVersion = retry.current.version;
    syncing.current = true;
    try {
      for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
        const previous = stream.current;
        const response = await employeeRequest({ action: 'chatSync', roomId, afterSeq: previous.afterSeq, version: previous.version, limit: 50 });
        if (epoch.current !== request || !data.current) return;
        const page = readSync(response, roomId, { afterSeq: previous.afterSeq, viewerId: data.current.viewer.userId });
        retry.current.success(retryVersion);
        stream.current = { afterSeq: page.throughSeq, version: page.version };
        if (!page.unchanged) accept({ ...data.current, viewer: page.viewer, room: page.room ?? data.current.room,
          messages: mergeLiveMessages(data.current.messages, page.messages), pins: page.pins ?? data.current.pins });
        if (!page.hasMoreNew || !activeRef.current) break;
      }
    } catch (error) {
      if (epoch.current !== request) return;
      if (error instanceof MobileAuthError && error.status === 409) { void read(); }
      else fail(error);
    } finally {
      if (epoch.current === request) {
        syncing.current = false;
        const nextRead = queuedRead.current;
        queuedRead.current = null;
        if (nextRead && activeRef.current) void read(nextRead.before);
      }
    }
  }, [accept, employeeRequest, epoch, fail, key, read, roomId]);

  useEffect(() => {
    if (!active || !key) return;
    if (data.current) void sync(); else void read();
    const timer = setInterval(() => { if (data.current) void sync(); else void read(); }, 3_000);
    return () => { clearInterval(timer); if (markTimer.current) clearTimeout(markTimer.current); };
  }, [active, key, read, sync]);

  const send = useCallback(async (draft: string) => {
    if (!key || !data.current || sending.current || !draft.trim() || draft.length > 10_000 || !retry.current.ready(monotonicNow())) return false;
    const request = epoch.current;
    const retryVersion = retry.current.version;
    sending.current = true;
    setResource({ key, data: data.current, loading: false, more: false, sending: true, error: undefined });
    try {
      // Commit the idempotency key before HTTP. An explicit retry after reopening
      // then reuses the same command, even if the first server ACK was lost.
      const command = await composer.prepare(draft);
      if (epoch.current !== request || !data.current) return false;
      const result = await employeeRequest({ action: 'chatSend', roomId, ...command });
      if (epoch.current !== request || !data.current) return false;
      if (!record(result)) return invalid();
      const room = readRoom(result.room), message = readMessage(result.message), viewer = readViewer(result.viewer, data.current.viewer.userId);
      if (room.id !== roomId || message.authorId !== viewer.userId || message.text !== draft) return invalid();
      retry.current.success(retryVersion);
      accept({ ...data.current, viewer, room, messages: mergeLiveMessages(data.current.messages, [message]) });
      await composer.acknowledge(command).catch(() => undefined);
      return epoch.current === request;
    } catch (error) { if (epoch.current === request) fail(error); return false; }
    finally {
      if (epoch.current === request) {
        sending.current = false;
        setResource(previous => previous?.key === key ? { ...previous, sending: false } : previous);
      }
    }
  }, [accept, composer, employeeRequest, epoch, fail, key, roomId]);

  const markRead = useCallback((throughSeq: number) => {
    if (!activeRef.current || !data.current || !integer(throughSeq, 1) || throughSeq <= marked.current || throughSeq > data.current.room.latestSeq || !retry.current.ready(monotonicNow())) return;
    if (markTimer.current) clearTimeout(markTimer.current);
    const request = epoch.current;
    markTimer.current = setTimeout(() => {
      if (epoch.current !== request || !activeRef.current || !retry.current.ready(monotonicNow())) return;
      void employeeRequest({ action: 'chatReadMark', roomId, throughSeq }).then(result => {
        if (epoch.current !== request || !data.current) return;
        if (!record(result)) return invalid();
        const room = readRoom(result.room);
        readViewer(result.viewer, data.current.viewer.userId);
        if (room.id !== roomId) return invalid();
        if (throughSeq < marked.current) return;
        marked.current = Math.max(marked.current, throughSeq);
        accept({ ...data.current, room });
      }).catch(error => { if (epoch.current === request) { if (forbidden(error)) fail(error); else retry.current.fail(monotonicNow(), error instanceof MobileAuthError ? error.retryAfterMs : undefined); } });
    }, 350);
  }, [accept, employeeRequest, epoch, fail, roomId]);

  const [muting, setMuting] = useState(false);
  const mute = useCallback(async () => {
    if (!key || !data.current || muting || !retry.current.ready(monotonicNow())) return;
    const request = epoch.current;
    setMuting(true);
    try {
      const result = await employeeRequest({ action: 'chatMute', roomId, muted: !data.current.room.muted });
      if (epoch.current !== request || !data.current) return;
      if (!record(result)) return invalid();
      const room = readRoom(result.room);
      readViewer(result.viewer, data.current.viewer.userId);
      if (room.id !== roomId) return invalid();
      accept({ ...data.current, room });
    } catch (error) { if (epoch.current === request) fail(error); }
    finally { if (epoch.current === request) setMuting(false); }
  }, [accept, employeeRequest, epoch, fail, key, muting, roomId]);

  return { ...current, data: current?.data, loading: current?.loading ?? Boolean(key), more: current?.more ?? false,
    draft: composer.draft, setDraft: composer.setDraft, draftReady: composer.draftReady, draftError: composer.draftError,
    sending: current?.sending ?? false, send, markRead, mute, muting, refresh: () => { denied.current = false; void read(); },
    retryDraft: composer.restore,
    loadOlder: () => { if (data.current?.nextCursor) void read(data.current.nextCursor); } };
}
