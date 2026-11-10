/** A bounded read model, never a credential or an attendance-write journal. */
import { shiftOverlapsDates, validDate, type Shift } from '../domain/model';

export type OfflineSession = { expiresAt: string; employee: { workspaceId: string; personId: string; email: string; name: string }; temporaryPassword: boolean };
export type OfflineKind = 'schedule' | 'detail';
export type OfflineRecord<T> = { data: T; savedAt: number };
type RecordValue = { key: string; kind: OfflineKind; data: unknown; savedAt: number };
type Snapshot = { schema: 1; scope: string; session: OfflineSession; verifiedAt: number; records: RecordValue[] };
export type OfflineStorage = { read: (scope: string) => Promise<string | null>; write: (scope: string, value: string) => Promise<void>; clear: () => Promise<void> };
export const offlineMaxAge = 24 * 60 * 60 * 1000;
export const offlineMaxBytes = 2 * 1024 * 1024;
const maximumRecordBytes = 512 * 1024;
const maximumRecords = 24;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const clock = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validOfflineSession(value: unknown): value is OfflineSession {
  if (!object(value) || !object(value.employee)) return false;
  const person = value.employee;
  return text(value.expiresAt, 40) && Number.isFinite(Date.parse(value.expiresAt)) && typeof value.temporaryPassword === 'boolean'
    && text(person.workspaceId) && text(person.personId) && text(person.name) && text(person.email, 320);
}
function cleanPublished(value: unknown, personId: string): unknown {
  if (!object(value) || !object(value.shift) || !object(value.site)) throw Error('Invalid offline shift');
  const { shift, site } = value;
  if (!text(shift.id) || shift.personId !== personId || !validDate(shift.date) || !clock(shift.start) || !clock(shift.end) || shift.start === shift.end
    || !text(shift.siteId) || shift.siteId !== site.id || !text(site.id) || typeof site.name !== 'string' || typeof site.address !== 'string'
    || !Number.isSafeInteger(shift.breakMinutes) || Number(shift.breakMinutes) < 0 || Number(shift.breakMinutes) > 1440
    || typeof shift.description !== 'string' || !Array.isArray(shift.checklist) || shift.checklist.length > 5000) throw Error('Invalid offline shift');
  const checklist = shift.checklist.map(item => { if (!object(item) || !text(item.id) || typeof item.text !== 'string') throw Error('Invalid offline task'); return { id: item.id, text: item.text }; });
  const previousTime = object(shift.previousTime) && clock(shift.previousTime.start) && clock(shift.previousTime.end)
    ? { start: shift.previousTime.start, end: shift.previousTime.end } : undefined;
  const result: Record<string, unknown> = {
    shift: { id: shift.id, personId, date: shift.date, start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes, siteId: shift.siteId,
      role: typeof shift.role === 'string' ? shift.role : '', description: shift.description, checklist, ...(previousTime ? { previousTime } : {}) },
    site: { id: site.id, name: site.name, address: site.address },
    entry: null,
  };
  if (object(site.worksiteInfo)) {
    const info: Record<string, string> = {};
    for (const key of ['contactName', 'contactPhone', 'parking', 'accessInstructions']) {
      const item = site.worksiteInfo[key]; if (item !== undefined && (typeof item !== 'string' || item.length > 200000)) throw Error('Invalid offline worksite');
      if (typeof item === 'string') info[key] = item;
    }
    Object.assign(result.site as object, { worksiteInfo: info });
  }
  // Clock state, mutable progress signatures and precise timing are not offline
  // authority. Cached instructions remain readable; live state refreshes online.
  if (Object.hasOwn(value, 'clockInRadius')) {
    result.clockInRadius = null;
    const taskIds = new Set(checklist.map(item => item.id));
    result.completedTaskIds = Array.isArray(value.completedTaskIds) && value.completedTaskIds.length <= 5000 ? value.completedTaskIds.filter(id => typeof id === 'string' && taskIds.has(id)) : [];
    result.checklistToken = null;
  }
  return result;
}
function compactPublished(value: unknown, personId: string): unknown {
  const result = cleanPublished(value, personId) as { shift: Record<string, unknown>; site: { id: string; name: string; address: string } };
  return { shift: { ...result.shift, description: '', checklist: [] }, site: { id: result.site.id, name: result.site.name, address: result.site.address }, entry: null };
}
function cleanRecord(kind: OfflineKind, value: unknown, session: OfflineSession): unknown {
  if (kind === 'detail') {
    if (object(value) && value.offlineSummary === true) throw Error('An offline summary is not an acknowledged published detail');
    return value === null ? null : cleanPublished(value, session.employee.personId);
  }
  if (!Array.isArray(value) || value.length > 5000) throw Error('Invalid offline schedule');
  const ids = new Set<string>();
  return value.map(item => { const cleaned = compactPublished(item, session.employee.personId) as { shift: { id: string } }; if (ids.has(cleaned.shift.id)) throw Error('Duplicate offline shift'); ids.add(cleaned.shift.id); return cleaned; });
}
function rangeFromKey(key: string): [string, string] | null {
  try { const value: unknown = JSON.parse(key); return Array.isArray(value) && value.length === 2 && validDate(value[0]) && validDate(value[1])
    && value[0] <= value[1] && Date.parse(value[1]) - Date.parse(value[0]) < 56 * 86400000 ? [value[0], value[1]] : null; } catch { return null; }
}
function shiftFrom(value: unknown): Shift | null { return object(value) && object(value.shift) ? value.shift as unknown as Shift : null; }
export class EmployeeOfflineCache {
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private snapshot: Snapshot | null = null;
  private loadedScope: string | null = null;
  constructor(private storage: OfflineStorage, private now = Date.now) {}
  lease() { return this.epoch; }
  private current(lease: number) { if (lease !== this.epoch) throw Error('Offline account changed'); }
  private run<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work, work); this.queue = result.catch(() => undefined); return result; }
  private async load(scope: string, lease: number) {
    this.current(lease);
    if (this.loadedScope === scope) return this.snapshot;
    const raw = await this.storage.read(scope); this.current(lease);
    this.loadedScope = scope; this.snapshot = null;
    if (!raw || new TextEncoder().encode(raw).byteLength > offlineMaxBytes) return null;
    try {
      const value: unknown = JSON.parse(raw), now = this.now();
      if (!object(value) || value.schema !== 1 || value.scope !== scope || !validOfflineSession(value.session)
        || !Number.isSafeInteger(value.verifiedAt) || Number(value.verifiedAt) > now + 60_000 || Number(value.verifiedAt) + offlineMaxAge <= now
        || Date.parse(value.session.expiresAt) <= now || !Array.isArray(value.records) || value.records.length > maximumRecords) return null;
      const records: RecordValue[] = [];
      for (const record of value.records) {
        if (!object(record) || !text(record.key, 1024) || !['schedule', 'detail'].includes(String(record.kind)) || !Number.isSafeInteger(record.savedAt)
          || Number(record.savedAt) > now + 60_000 || Number(record.savedAt) + offlineMaxAge <= now) continue;
        const kind = record.kind as OfflineKind, data = cleanRecord(kind, record.data, value.session);
        if (bytes(data) <= maximumRecordBytes) records.push({ key: record.key, kind, data, savedAt: Number(record.savedAt) });
      }
      this.snapshot = { schema: 1, scope, session: clone(value.session), verifiedAt: Number(value.verifiedAt), records };
    } catch { /* Invalid or incompatible local data never substitutes for server reads. */ }
    return this.snapshot;
  }
  private fresh(snapshot: Snapshot) { const now = this.now(); return snapshot.verifiedAt + offlineMaxAge > now && snapshot.verifiedAt <= now + 60_000 && Date.parse(snapshot.session.expiresAt) > now; }
  remember(scope: string, session: OfflineSession, lease: number): Promise<void> {
    return this.run(async () => {
      this.current(lease); if (!/^[a-f0-9]{64}$/.test(scope) || !validOfflineSession(session) || Date.parse(session.expiresAt) <= this.now()) throw Error('Invalid offline session');
      const previous = await this.load(scope, lease);
      const same = previous?.session.employee.personId === session.employee.personId && previous?.session.employee.workspaceId === session.employee.workspaceId;
      const next: Snapshot = { schema: 1, scope, session: clone(session), verifiedAt: this.now(), records: same ? previous.records.filter(record => record.savedAt + offlineMaxAge > this.now()) : [] };
      await this.storage.write(scope, JSON.stringify(next)); this.current(lease); this.snapshot = next; this.loadedScope = scope;
    });
  }
  restore(scope: string, lease: number): Promise<{ session: OfflineSession; verifiedAt: number } | null> {
    return this.run(async () => { const stored = await this.load(scope, lease); return stored && this.fresh(stored) && stored.records.some(record => record.savedAt + offlineMaxAge > this.now()) ? { session: clone(stored.session), verifiedAt: stored.verifiedAt } : null; });
  }
  read<T>(scope: string, kind: OfflineKind, key: string, lease: number): Promise<OfflineRecord<T> | null> {
    return this.run(async () => {
      const stored = await this.load(scope, lease); if (!stored || !this.fresh(stored)) return null;
      const record = stored.records.find(record => record.kind === kind && record.key === key && record.savedAt + offlineMaxAge > this.now());
      if (record) return { data: clone(record.data) as T, savedAt: record.savedAt };
      if (kind !== 'detail') return null;
      // A complete own calendar already contains the shift's date/time/address.
      // Reuse only that compact observation when its full point was never opened.
      // This synthetic view is never written as an acknowledged detail record.
      for (const window of [...stored.records].sort((left, right) => right.savedAt - left.savedAt)) {
        if (window.kind !== 'schedule' || window.savedAt + offlineMaxAge <= this.now() || !Array.isArray(window.data)) continue;
        const match = window.data.find(value => shiftFrom(value)?.id === key);
        if (!match) continue;
        const summary = compactPublished(match, stored.session.employee.personId) as Record<string, unknown>;
        return { data: { ...clone(summary), clockInRadius: null, entry: null, completedTaskIds: [], checklistToken: null, offlineSummary: true } as T, savedAt: window.savedAt };
      }
      return null;
    });
  }
  save(scope: string, kind: OfflineKind, key: string, value: unknown, lease: number): Promise<boolean> {
    return this.run(async () => {
      const stored = await this.load(scope, lease); if (!stored || !this.fresh(stored) || !text(key, 1024)) return false;
      const data = cleanRecord(kind, value, stored.session); if (bytes(data) > maximumRecordBytes) return false;
      if (kind === 'detail' && data !== null && shiftFrom(data)?.id !== key) return false;
      const range = kind === 'schedule' ? rangeFromKey(key) : null;
      if (kind === 'schedule' && (!range || !(data as unknown[]).every(item => { const shift = shiftFrom(item); return shift && shiftOverlapsDates(shift, range[0], range[1]); }))) return false;
      let records = clone(stored.records.filter(record => !(record.kind === kind && record.key === key) && record.savedAt + offlineMaxAge > this.now()));
      if (kind === 'schedule' && range) {
        // An authoritative complete window removes cancelled/reassigned details.
        const ids = new Set((data as unknown[]).map(item => shiftFrom(item)?.id));
        records = records.filter(record => record.kind !== 'detail' || !shiftFrom(record.data) || !shiftOverlapsDates(shiftFrom(record.data)!, range[0], range[1]) || ids.has(shiftFrom(record.data)?.id));
      } else if (kind === 'detail') {
        const shift = shiftFrom(data);
        for (const record of records) if (record.kind === 'schedule' && Array.isArray(record.data)) {
          const period = rangeFromKey(record.key); if (!period) continue;
          const others = record.data.filter(item => shiftFrom(item)?.id !== key);
          if (shift && shiftOverlapsDates(shift, period[0], period[1])) others.push(compactPublished(data, stored.session.employee.personId));
          record.data = others;
        }
      }
      records.push({ kind, key, data, savedAt: this.now() });
      const next = { ...stored, records };
      while (records.length > maximumRecords || bytes(next) > offlineMaxBytes) records.shift();
      if (!records.length) return false;
      this.current(lease); await this.storage.write(scope, JSON.stringify(next)); this.current(lease); this.snapshot = next; return true;
    });
  }
  clear(): Promise<void> {
    this.epoch++; this.snapshot = null; this.loadedScope = null;
    return this.run(async () => { await this.storage.clear(); });
  }
}
