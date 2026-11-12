import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { PrivateDraftStore, type EmployeeDraft, type PendingDraftCommand } from './private-draft-store';

const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const drafts = new PrivateDraftStore({
  read: key => SecureStore.getItemAsync(key, options),
  write: (key, value) => SecureStore.setItemAsync(key, value, options),
  remove: key => SecureStore.deleteItemAsync(key, options),
}, randomUUID);
const previewListeners = new Set<() => void>();
const emptyPreviews: ReadonlyMap<string, string> = new Map();

function refreshPreviews() {
  for (const listener of previewListeners) listener();
}

export function clearEmployeeDrafts() {
  const clearing = drafts.clear();
  refreshPreviews();
  return clearing;
}

export function useEmployeeDraftPreviews(
  key: string,
  rooms: readonly { id: string }[] | undefined,
  scopeForRoom: (roomId: string) => string,
  active: boolean,
) {
  const [snapshot, setSnapshot] = useState<{ key: string; lease: number; previews: ReadonlyMap<string, string> }>();
  // Chat polling replaces room objects even when the list of room IDs is unchanged.
  const roomIds = JSON.stringify(rooms?.map(room => room.id) ?? []);

  useLayoutEffect(() => {
    if (!key || !active || roomIds === '[]') return;
    const lease = drafts.lease();
    let version = 0;
    let closed = false;
    const ids: string[] = JSON.parse(roomIds);
    const hashes = Promise.all(ids.map(async id =>
      [id, await digestStringAsync(CryptoDigestAlgorithm.SHA256, scopeForRoom(id))] as const));

    async function refresh() {
      const request = ++version;
      if (drafts.lease() !== lease) {
        setSnapshot(undefined);
        return;
      }
      try {
        const entries = await hashes;
        if (closed || request !== version || drafts.lease() !== lease) return;
        const stored = await drafts.readPreviews(entries.map(([, hash]) => hash), lease);
        if (closed || request !== version || drafts.lease() !== lease) return;
        const previews = new Map<string, string>();
        for (const [roomId, hash] of entries) {
          const text = stored.get(hash);
          if (text) previews.set(roomId, text);
        }
        setSnapshot({ key, lease, previews });
      } catch {
        if (!closed && request === version) setSnapshot(undefined);
      }
    }

    const listener = () => { void refresh(); };
    previewListeners.add(listener);
    listener();
    return () => {
      closed = true;
      previewListeners.delete(listener);
    };
  }, [active, key, roomIds, scopeForRoom]);

  return snapshot?.key === key && snapshot.lease === drafts.lease() ? snapshot.previews : emptyPreviews;
}

type Composer = { key: string; text: string; loading: boolean; error?: string };
type Local = { key: string; hash: Promise<string>; expiresAt: number; lease: number; revision: number; savedRevision: number; hydrated: boolean; draft: EmployeeDraft; loading: Promise<void>; writing?: Promise<void> };
const problem = 'Udkastet kunne ikke gemmes sikkert på telefonen. Prøv igen.';

export function useEmployeeDraft(key: string, persistentScope: string, expiresAt: number) {
  const [state, setState] = useState<Composer>();
  const local = useRef<Local | null>(null);
  const epoch = useRef(0);
  const current = state?.key === key ? state : undefined;
  const persist = useCallback(async (value: Local) => {
    while (value.savedRevision < value.revision) {
      if (!value.writing) {
        const revision = value.revision, snapshot = value.draft;
        value.writing = (async () => {
          await drafts.save(await value.hash, snapshot, value.expiresAt, value.lease);
          value.savedRevision = revision;
          if (value.lease === drafts.lease()) refreshPreviews();
        })().finally(() => { value.writing = undefined; });
      }
      await value.writing;
    }
  }, []);
  const restore = useCallback(() => {
    const version = ++epoch.current;
    if (!key || !persistentScope) { local.current = null; return; }
    const previous = local.current?.key === key ? local.current : null;
    const value: Local = { key, hash: digestStringAsync(CryptoDigestAlgorithm.SHA256, persistentScope), expiresAt,
      lease: drafts.lease(), revision: previous ? Math.max(1, previous.revision) : 0, savedRevision: 0, hydrated: previous?.hydrated ?? false, draft: previous?.draft ?? { text: '', pending: null }, loading: Promise.resolve() };
    local.current = value;
    queueMicrotask(() => { if (epoch.current === version && local.current === value) setState({ key, text: value.draft.text, loading: true }); });
    value.loading = (async () => {
      const stored = await drafts.read(await value.hash, value.lease);
      if (epoch.current !== version || local.current !== value) return;
      value.draft = value.revision === 0 ? stored ?? { text: '', pending: null } : { ...value.draft, pending: value.hydrated ? value.draft.pending : value.draft.pending ?? stored?.pending ?? null };
      value.hydrated = true;
      if (value.revision) await persist(value);
      if (epoch.current === version && local.current === value) setState({ key, text: value.draft.text, loading: false });
    })().catch(() => {
      if (epoch.current === version && local.current === value) setState({ key, text: value.draft.text, loading: false, error: problem });
      throw Error(problem);
    });
    void value.loading.catch(() => undefined);
    return () => { epoch.current++; local.current = null; };
  }, [expiresAt, key, persist, persistentScope]);
  useLayoutEffect(restore, [restore]);

  const setDraft = useCallback((text: string) => {
    const value = local.current;
    if (!value || value.key !== key || text.length > 100_000) return;
    value.draft = { text, pending: text ? value.draft.pending : null }; value.revision++;
    setState({ key, text, loading: false });
    void value.loading.then(() => persist(value)).catch(() => {
      if (local.current === value) setState(previous => previous?.key === key ? { ...previous, error: problem } : previous);
    });
  }, [key, persist]);
  const prepare = useCallback(async (text: string): Promise<PendingDraftCommand> => {
    const value = local.current;
    if (!value || value.key !== key) throw Error('Samtalen er ændret. Åbn den igen.');
    await value.loading;
    if (local.current !== value || drafts.lease() !== value.lease) throw Error('Samtalen er ændret. Åbn den igen.');
    const command = value.draft.pending?.text === text ? value.draft.pending : { clientId: randomUUID(), text };
    value.draft = { text, pending: command }; value.revision++;
    await persist(value);
    if (local.current !== value || drafts.lease() !== value.lease) throw Error('Samtalen er ændret. Åbn den igen.');
    return command;
  }, [key, persist]);
  const acknowledge = useCallback(async (command: PendingDraftCommand) => {
    const value = local.current;
    if (!value || value.key !== key || drafts.lease() !== value.lease || value.draft.pending?.clientId !== command.clientId) return;
    value.draft = { text: value.draft.text === command.text ? '' : value.draft.text, pending: null }; value.revision++;
    setState({ key, text: value.draft.text, loading: false });
    try { await persist(value); }
    catch {
      if (local.current === value) setState(previous => previous?.key === key ? { ...previous, error: problem } : previous);
      throw Error(problem);
    }
  }, [key, persist]);
  const clear = useCallback(async (submittedText: string) => {
    const value = local.current;
    if (!value || value.key !== key || drafts.lease() !== value.lease || value.draft.text !== submittedText) return;
    value.draft = { text: '', pending: null }; value.revision++;
    setState({ key, text: '', loading: false });
    try { await persist(value); }
    catch {
      if (local.current === value) setState(previous => previous?.key === key ? { ...previous, error: problem } : previous);
      throw Error(problem);
    }
  }, [key, persist]);
  return { draft: current?.text ?? '', draftReady: Boolean(current && !current.loading), draftError: current?.error,
    setDraft, prepare, acknowledge, clear, restore };
}
