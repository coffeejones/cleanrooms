export type PendingDraftCommand = { clientId: string; text: string };
export type EmployeeDraft = { text: string; pending: PendingDraftCommand | null };
export type DraftStorage = { read: (key: string) => Promise<string | null>; write: (key: string, value: string) => Promise<void>; remove: (key: string) => Promise<void> };
type Entry = { key: string; generation: string; count: number; expiresAt: number };
const indexKey = 'cleanrooms.private-drafts.v1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = /^[a-f0-9]{64}$/;
const maxChunks = 768;
const chunkKey = (entry: Entry, index: number) => `${indexKey}.${entry.key}.${entry.generation}.${index}`;
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).length;

function parseIndex(raw: string | null): Entry[] {
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 8) throw Error('Invalid chat draft index');
  const keys = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || !hash.test(entry.key) || !uuid.test(entry.generation)
      || !Number.isInteger(entry.count) || entry.count < 1 || entry.count > maxChunks || !Number.isSafeInteger(entry.expiresAt)
      || keys.has(entry.key)) throw Error('Invalid chat draft index');
    keys.add(entry.key);
  }
  return value;
}
function validateDraft(value: unknown): EmployeeDraft {
  if (!value || typeof value !== 'object' || !('text' in value) || typeof value.text !== 'string' || value.text.length > 100_000
    || !('pending' in value)) throw Error('Invalid chat draft');
  const pending = value.pending;
  if (pending === null) return { text: value.text, pending: null };
  if (!pending || typeof pending !== 'object' || !('clientId' in pending) || typeof pending.clientId !== 'string' || !uuid.test(pending.clientId)
    || !('text' in pending) || typeof pending.text !== 'string' || !pending.text.trim() || pending.text.length > 10_000) throw Error('Invalid chat command');
  return { text: value.text, pending: { clientId: pending.clientId, text: pending.text } };
}
/** Keychain items stay small even for a 10,000-character Unicode message. */
function chunks(value: string) {
  const result: string[] = [];
  let chunk = '', size = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    const length = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (size + length > 1024) { result.push(chunk); chunk = ''; size = 0; }
    chunk += character; size += length;
  }
  if (chunk) result.push(chunk);
  if (result.length > maxChunks) throw Error('Chat draft is too large');
  return result;
}

/** A pointer is committed only after all encrypted chunks; old account leases never write again. */
export class PrivateDraftStore {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  constructor(private storage: DraftStorage, private allocate: () => string) {}
  lease() { return this.epoch; }
  private current(lease: number) { if (lease !== this.epoch) throw Error('Chat draft account changed'); }
  private queue<T>(operation: () => Promise<T>) {
    const result = this.tail.then(operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async remove(entries: Entry[]) {
    await Promise.allSettled(entries.flatMap(entry => Array.from({ length: entry.count }, (_, index) => this.storage.remove(chunkKey(entry, index)))));
  }
  read(key: string, lease: number) {
    return this.queue(async () => {
      this.current(lease);
      if (!hash.test(key)) throw Error('Invalid draft scope');
      const entry = parseIndex(await this.storage.read(indexKey)).find(value => value.key === key);
      this.current(lease);
      if (!entry) return null;
      const values = await Promise.all(Array.from({ length: entry.count }, (_, index) => this.storage.read(chunkKey(entry, index))));
      this.current(lease);
      if (values.some(value => typeof value !== 'string' || bytes(value) > 1024)) throw Error('Incomplete chat draft');
      return validateDraft(JSON.parse(values.join('')));
    });
  }
  save(key: string, draft: EmployeeDraft, expiresAt: number, lease: number) {
    const snapshot = validateDraft(draft);
    return this.queue(async () => {
      this.current(lease);
      if (!hash.test(key) || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw Error('Invalid draft scope');
      const index = parseIndex(await this.storage.read(indexKey));
      const old = index.filter(value => value.key === key);
      const retained = index.filter(value => !old.includes(value));
      this.current(lease);
      if (!snapshot.text && !snapshot.pending) {
        await this.storage.write(indexKey, JSON.stringify(retained));
        await this.remove(old);
        return;
      }
      if (retained.length >= 8) throw Error('Too many saved chat drafts');
      const values = chunks(JSON.stringify(snapshot));
      const entry = { key, generation: this.allocate(), count: values.length, expiresAt };
      if (!uuid.test(entry.generation)) throw Error('Invalid draft generation');
      try {
        for (const [index, value] of values.entries()) { this.current(lease); await this.storage.write(chunkKey(entry, index), value); }
        this.current(lease);
        const next = JSON.stringify([...retained, entry]);
        if (bytes(next) > 1800) throw Error('Chat draft index too large');
        await this.storage.write(indexKey, next);
      } catch (error) { await this.remove([entry]); throw error; }
      await this.remove(old);
    });
  }
  /** Invalidate callers synchronously, before storage I/O or logout can yield. */
  clear() {
    this.epoch++;
    return this.queue(async () => {
      let old: Entry[] = [];
      try { old = parseIndex(await this.storage.read(indexKey)); } catch { /* A corrupt pointer must not prevent local logout. */ }
      await this.storage.write(indexKey, '[]');
      await this.remove(old);
    });
  }
}
