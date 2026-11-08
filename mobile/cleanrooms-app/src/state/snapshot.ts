import { withDemoShiftChange, withDemoSiteGeofences } from '../domain/demo';
import { isValidGeofence, shiftInterval, validDate, type AppState } from '../domain/model';

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max = 512): value is string => typeof value === 'string' && value.length <= max;
const instant = (value: unknown): value is string => text(value, 40) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const list = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;
const stringList = (value: unknown, max: number) => list(value, max) && value.every(v => text(v));
const distinct = (values: string[]) => new Set(values).size === values.length;

/** AsyncStorage contains only local demo state, never credentials or real employee records. */
export function validateSnapshot(value: unknown): value is AppState {
  if (!record(value) || value.schemaVersion !== 1 || !validDate(value.today) || !text(value.selfId) || !instant(value.demoBaseAt) || typeof value.demoStartedAt !== 'number' || !Number.isFinite(value.demoStartedAt)) return false;
  if (!Array.isArray(value.unavailableDates) || !value.unavailableDates.every(validDate) || !distinct(value.unavailableDates)) return false;
  if (!list(value.people, 500) || !value.people.every(p => record(p) && text(p.id) && text(p.name) && text(p.initials, 8) && text(p.role))) return false;
  if (!list(value.sites, 200) || !value.sites.every(s =>
    record(s) && text(s.id) && text(s.name) && text(s.address) &&
    (s.geofence === undefined || isValidGeofence(s.geofence)),
  )) return false;
  const people = new Set((value.people as { id: string }[]).map(p => p.id)), sites = new Set((value.sites as { id: string }[]).map(s => s.id));
  if (!people.has(value.selfId) || people.size !== value.people.length || sites.size !== value.sites.length) return false;
  if (!list(value.shifts, 5000) || !value.shifts.every(s => {
    if (!record(s) || !text(s.id) || !(s.personId === null || text(s.personId) && people.has(s.personId)) || !text(s.siteId) || !sites.has(s.siteId) || !validDate(s.date) || !text(s.start, 5) || !text(s.end, 5) || !Number.isInteger(s.breakMinutes) || (s.breakMinutes as number) < 0 || (s.breakMinutes as number) > 1440 || !text(s.role) || !text(s.description, 100_000) || !list(s.checklist, 200) || !s.checklist.every(t => record(t) && text(t.id) && text(t.text, 10_000))) return false;
    try {
      const interval = shiftInterval({ date: s.date, start: s.start, end: s.end });
      const previous = s.previousTime;
      if (previous !== undefined) {
        if (!record(previous) || !text(previous.start, 5) || !text(previous.end, 5) ||
          (previous.start === s.start && previous.end === s.end)) return false;
        shiftInterval({ date: s.date, start: previous.start, end: previous.end });
      }
      return (interval.end - interval.start) / 60_000 >= (s.breakMinutes as number) && distinct((s.checklist as { id: string }[]).map(t => t.id));
    } catch { return false; }
  })) return false;
  const shifts = value.shifts as AppState['shifts'], ids = new Set(shifts.map(s => s.id));
  if (ids.size !== shifts.length || !list(value.entries, 5000) || !value.entries.every(e => {
    if (!record(e) || !text(e.shiftId) || !ids.has(e.shiftId) || !instant(e.clockIn) || e.clockOut !== undefined && !instant(e.clockOut) || !['running', 'paused', 'submitted', 'approved'].includes(e.status as string) || !text(e.comment, 100_000) || !stringList(e.completedTaskIds, 200) || !list(e.pauses, 200)) return false;
    const shift = shifts.find(s => s.id === e.shiftId)!;
    if (shift.personId !== value.selfId || !(e.completedTaskIds as string[]).every(t => shift.checklist.some(task => task.id === t)) || !distinct(e.completedTaskIds as string[])) return false;
    const closed = e.status === 'submitted' || e.status === 'approved';
    if (closed !== Boolean(e.clockOut) || e.clockOut && Date.parse(e.clockOut as string) < Date.parse(e.clockIn)) return false;
    let previousEnd = Date.parse(e.clockIn), open = 0;
    for (const p of e.pauses) {
      if (!record(p) || !instant(p.start) || p.end !== undefined && !instant(p.end)) return false;
      const start = Date.parse(p.start), end = p.end ? Date.parse(p.end as string) : Infinity;
      if (start < previousEnd || end < start || e.clockOut && end > Date.parse(e.clockOut as string)) return false;
      if (!p.end) open++;
      previousEnd = end;
    }
    return e.status === 'paused' ? open === 1 : open === 0;
  })) return false;
  const entries = value.entries as AppState['entries'];
  if (!distinct(entries.map(e => e.shiftId)) || entries.filter(e => e.status === 'running' || e.status === 'paused').length > 1) return false;
  if (!list(value.requests, 5000) || !value.requests.every(r => record(r) && text(r.id) && text(r.shiftId) && ids.has(r.shiftId) && ['leave', 'claim'].includes(r.kind as string) && ['pending', 'approved', 'rejected'].includes(r.status as string) && instant(r.createdAt) && text(r.comment, 100_000))) return false;
  if (!list(value.rooms, 100) || !value.rooms.every(r => record(r) && text(r.id) && text(r.name) && text(r.subtitle) && stringList(r.memberIds, 500) && (r.memberIds as string[]).every(p => people.has(p)) && (r.pinned === undefined || text(r.pinned, 10_000)))) return false;
  const rooms = value.rooms as AppState['rooms'], roomIds = new Set(rooms.map(r => r.id));
  if (roomIds.size !== rooms.length || !list(value.messages, 5000) || !value.messages.every(m => record(m) && text(m.id) && text(m.roomId) && roomIds.has(m.roomId) && text(m.personId) && people.has(m.personId) && rooms.find(r => r.id === m.roomId)!.memberIds.includes(m.personId) && text(m.text, 10_000) && instant(m.createdAt) && (m.read === undefined || typeof m.read === 'boolean'))) return false;
  if (!list(value.notifications, 1000) || !value.notifications.every(n => record(n) && text(n.id) && text(n.title) && text(n.body, 10_000) && instant(n.createdAt) && typeof n.read === 'boolean' && ['shift', 'request', 'chat', 'system'].includes(n.kind as string) && (n.shiftId === undefined || text(n.shiftId) && ids.has(n.shiftId)) && (n.roomId === undefined || text(n.roomId) && roomIds.has(n.roomId)))) return false;
  if (!record(value.preferences) || !['notifications', 'chatNotifications', 'biometricLock'].every(k => typeof value.preferences === 'object' && value.preferences && typeof (value.preferences as Record<string, unknown>)[k] === 'boolean')) return false;
  return distinct((value.requests as { id: string }[]).map(v => v.id)) && distinct((value.messages as { id: string }[]).map(v => v.id)) && distinct((value.notifications as { id: string }[]).map(v => v.id));
}

export function decodeSnapshot(raw: string): AppState {
  if (raw.length > 2_500_000) throw new Error('Demoens gemte data er for store.');
  const parsed: unknown = JSON.parse(raw);
  const normalized = record(parsed) ? {
    ...parsed,
    unavailableDates: Object.hasOwn(parsed, 'unavailableDates') ? parsed.unavailableDates : [],
    ...(Array.isArray(parsed.sites) ? {
      sites: parsed.sites.map(site => {
        if (!record(site) || !Object.hasOwn(site, 'workplacePolicyLink')) return site;
        // Retire the browser pilot without discarding saved shifts or GPS areas.
        const restored = { ...site };
        delete restored.workplacePolicyLink;
        return restored;
      }),
    } : {}),
  } : parsed;
  if (!validateSnapshot(normalized)) throw new Error('De gemte demodata har et ukendt eller ugyldigt format.');
  return withDemoShiftChange(withDemoSiteGeofences(normalized));
}
