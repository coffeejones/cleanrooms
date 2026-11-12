/** Employee-facing, provider-independent contracts. Demo calculation rules are not a payroll engine. */
export type Person = { id: string; name: string; initials: string; role: string };
export type Geofence = { latitude: number; longitude: number; radiusMeters: number };
export type WorksiteInfo = { contactName?: string; contactPhone?: string; parking?: string; accessInstructions?: string };
export type Site = { id: string; name: string; address: string; geofence?: Geofence; worksiteInfo?: WorksiteInfo };
export type ClockInLocation = {
  latitude: number; longitude: number; accuracyMeters: number | null; timestamp: number; mocked?: boolean;
};
export type ChecklistItem = { id: string; text: string };
export type Shift = {
  id: string; personId: string | null; siteId: string; date: string; start: string; end: string;
  breakMinutes: number; role: string; description: string; checklist: ChecklistItem[];
  previousTime?: { start: string; end: string };
};
export type TimeEntry = {
  shiftId: string; clockIn: string; clockOut?: string; pauses: { start: string; end?: string }[];
  comment: string; completedTaskIds: string[]; status: 'running' | 'paused' | 'submitted' | 'approved';
};
export type Request = {
  id: string; kind: 'leave' | 'claim'; shiftId: string; status: 'pending' | 'approved' | 'rejected';
  createdAt: string; comment: string;
};
export type ChatRoom = { id: string; name: string; subtitle: string; memberIds: string[]; pinned?: string };
export type Message = { id: string; roomId: string; personId: string; text: string; createdAt: string; read?: boolean };
export type NotificationShiftSnapshot = Pick<Shift, 'date' | 'start' | 'end'> & { siteName: string; plannedBreakMinutes: number };
export type AppNotification = {
  id: string; title: string; body: string; createdAt: string; read: boolean;
  shiftId?: string; roomId?: string; kind: 'shift' | 'request' | 'chat' | 'system';
  shiftChange?: { before: NotificationShiftSnapshot; after: NotificationShiftSnapshot };
};
export type Preferences = { notifications: boolean; chatNotifications: boolean; biometricLock: boolean };
export type AppState = {
  schemaVersion: 1; selfId: string; today: string; demoStartedAt: number; demoBaseAt: string;
  shifts: Shift[]; people: Person[]; sites: Site[]; entries: TimeEntry[]; requests: Request[];
  rooms: ChatRoom[]; messages: Message[]; notifications: AppNotification[]; preferences: Preferences;
  unavailableDates: string[];
};
export type Result = { ok: boolean; error?: string; uncertain?: boolean };
export type PeriodSummary = {
  plannedMinutes: number; workedMinutes: number; approvedMinutes: number; shiftCount: number; completedCount: number;
  estimatedCents: number; earnedCents: number; approvedCents: number; progress: number;
  baseEarnedCents: number; allowanceEarnedCents: number; baseEstimatedCents: number; allowanceEstimatedCents: number;
};
export type ShiftPay = {
  kind: 'planned' | 'registered';
  minutes: number;
  baseCents: number;
  allowanceCents: number;
  totalCents: number;
};

export const TIME_ZONE = 'Europe/Copenhagen';
export const DEMO_HOURLY_CENTS = 18_750;
export const DEMO_EVENING_CENTS = 2_500;
export const DEMO_WEEKEND_CENTS = 3_500;
export const maxClockInLocationAgeMs = 30_000;
export const maxClockInAccuracyMeters = 50;
const MINUTE = 60_000;
const DAY = 86_400_000;
const EARTH_RADIUS_METERS = 6_371_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !datePattern.test(value)) return false;
  const instant = new Date(value + 'T12:00:00Z');
  return !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

export function copenhagenDate(instant: number = Date.now()): string {
  const parts = dateFormatter.formatToParts(instant);
  const part = (kind: string) => parts.find(p => p.type === kind)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(date: string, days: number): string {
  if (!validDate(date) || !Number.isInteger(days)) throw new RangeError('Ugyldig dato.');
  return new Date(Date.parse(date + 'T12:00:00Z') + days * DAY).toISOString().slice(0, 10);
}

export function mondayOfWeek(date: string): string {
  const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export function isoWeekNumber(date: string): number {
  const monday = mondayOfWeek(date);
  const weekYear = addDays(monday, 3).slice(0, 4);
  const firstMonday = mondayOfWeek(`${weekYear}-01-04`);
  return 1 + (Date.parse(monday) - Date.parse(firstMonday)) / (7 * DAY);
}

export function dateLabel(date: string, options?: Intl.DateTimeFormatOptions): string {
  if (!validDate(date)) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: TIME_ZONE, day: 'numeric', month: 'short', ...options }).format(new Date(date + 'T12:00:00Z'));
}

export function clockTimeLabel(stamp: string | number): string {
  return clockFormatter.format(new Date(stamp));
}

export function minutesLabel(minutes: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const hours = Math.floor(total / 60), remainder = total % 60;
  return hours ? `${hours} t${remainder ? ` ${remainder} min` : ''}` : `${remainder} min`;
}

export function compactMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function currency(cents: number): string {
  return new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number.isFinite(cents) ? cents : 0) / 100);
}

const zonedFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function localParts(instant: number) {
  const parts = zonedFormatter.formatToParts(instant);
  const n = (kind: string) => Number(parts.find(p => p.type === kind)?.value);
  return { year: n('year'), month: n('month'), day: n('day'), hour: n('hour'), minute: n('minute') };
}

/** Resolve the first occurrence of an ambiguous fall-back time. Reject nonexistent spring-forward times. */
export function instantForLocal(date: string, time: string): number {
  if (!validDate(date) || !timePattern.test(time)) throw new RangeError('Ugyldigt tidspunkt.');
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  // Copenhagen uses UTC+1/+2. Trying both offsets also handles both DST boundary days deterministically.
  for (const offset of [120, 60]) {
    const candidate = target - offset * MINUTE, parts = localParts(candidate);
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute) return candidate;
  }
  throw new RangeError('Tidspunktet findes ikke ved skiftet til sommertid.');
}

export function shiftInterval(shift: Pick<Shift, 'date' | 'start' | 'end'>): { start: number; end: number } {
  if (shift.start === shift.end) throw new RangeError('Vagtens start og slut skal være forskellige.');
  const start = instantForLocal(shift.date, shift.start);
  const endDate = shift.end < shift.start ? addDays(shift.date, 1) : shift.date;
  return { start, end: instantForLocal(endDate, shift.end) };
}

/** Planning dates belong to the start day; a night shift also occupies the next calendar day. */
export function shiftDates(shift: Pick<Shift, 'date' | 'start' | 'end'>): string[] {
  shiftInterval(shift);
  return shift.end < shift.start && shift.end !== '00:00' ? [shift.date, addDays(shift.date, 1)] : [shift.date];
}

export function shiftTimeLabel(shift: Pick<Shift, 'start' | 'end'>): string {
  return `${shift.start}–${shift.end}${shift.end < shift.start ? ' (+1 dag)' : ''}`;
}

export function shiftOverlapsDates(shift: Pick<Shift, 'date' | 'start' | 'end'>, from: string, to: string): boolean {
  const interval = shiftInterval(shift);
  return interval.start < instantForLocal(addDays(to, 1), '00:00') && interval.end > instantForLocal(from, '00:00');
}

export function clockInAvailability(state: AppState, shift: Shift, now: number):
  { opensAt: number; allowed: true; reason?: undefined } | { opensAt: number; allowed: false; reason: string } {
  const { start, end } = shiftInterval(shift);
  const opensAt = Math.max(start - 30 * MINUTE, instantForLocal(shift.date, '00:00'));
  const unavailable = (reason: string) => ({ opensAt, allowed: false as const, reason });

  if (shift.personId !== state.selfId) return unavailable('Du kan kun ændre din egen vagt.');
  const entry = state.entries.find(item => item.shiftId === shift.id);
  if (entry) return unavailable(entry.clockOut ? 'Denne vagt er allerede afsluttet.' : 'Du er allerede stemplet ind.');
  if (state.entries.some(item => item.status === 'running' || item.status === 'paused')) {
    return unavailable('Afslut din igangværende vagt først.');
  }
  if (now < opensAt || now >= end) {
    return unavailable('Du kan stemple ind fra 30 minutter før vagten på vagtdagen.');
  }
  return { opensAt, allowed: true };
}

function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

export function isValidGeofence(value: unknown): value is Geofence {
  if (typeof value !== 'object' || !value) return false;
  const { latitude, longitude, radiusMeters } = value as Partial<Geofence>;
  return validCoordinate(latitude, 90) && validCoordinate(longitude, 180) &&
    typeof radiusMeters === 'number' && radiusMeters > 0 && radiusMeters <= 1_000;
}

function distanceMeters(from: Pick<Geofence, 'latitude' | 'longitude'>, to: Pick<Geofence, 'latitude' | 'longitude'>): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const fromLatitude = radians(from.latitude);
  const toLatitude = radians(to.latitude);
  const longitudeDelta = radians(to.longitude - from.longitude);
  const haversine = Math.sin((toLatitude - fromLatitude) / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function checkClockInLocation(geofence: Geofence, location: ClockInLocation | undefined, checkedAt: number): Result {
  if (!isValidGeofence(geofence)) return { ok: false, error: 'Arbejdsstedets GPS-område er ugyldigt. Kontakt planlæggeren.' };
  if (!location) return { ok: false, error: 'Der skal bruges en GPS-placering for at stemple ind på dette arbejdssted.' };
  if (location.mocked) return { ok: false, error: 'Appen kunne ikke bekræfte din placering. Slå eventuel simuleret placering fra og prøv igen.' };

  const age = checkedAt - location.timestamp;
  if (!Number.isFinite(age) || age < 0 || age > maxClockInLocationAgeMs) {
    return { ok: false, error: 'GPS-placeringen er ikke aktuel. Prøv igen.' };
  }
  const { accuracyMeters } = location;
  if (!validCoordinate(location.latitude, 90) || !validCoordinate(location.longitude, 180) ||
    accuracyMeters === null || !Number.isFinite(accuracyMeters) || accuracyMeters < 0 ||
    accuracyMeters > Math.min(maxClockInAccuracyMeters, geofence.radiusMeters)) {
    return { ok: false, error: 'Placeringen er for upræcis. Slå præcis placering til, eller gå et sted med bedre GPS-signal, og prøv igen.' };
  }

  const distance = distanceMeters(geofence, location);
  if (distance > geofence.radiusMeters) {
    return { ok: false, error: `Du er for langt fra arbejdsstedet. Gå inden for ${geofence.radiusMeters} m og prøv igen.` };
  }
  if (distance + accuracyMeters > geofence.radiusMeters) {
    return { ok: false, error: 'Placeringen er for tæt på grænsen til at kunne bekræftes. Gå tættere på arbejdsstedet og prøv igen.' };
  }
  return { ok: true };
}

export function plannedMinutes(shift: Shift): number {
  const { start, end } = shiftInterval(shift);
  return Math.max(0, Math.round((end - start) / MINUTE) - shift.breakMinutes);
}

type Interval = { start: number; end: number };
function clip(interval: Interval, from: number, to: number): Interval | null {
  const start = Math.max(interval.start, from), end = Math.min(interval.end, to);
  return end > start ? { start, end } : null;
}

/** Subtract the union of pauses; overlapping or out-of-order persisted pauses never double-deduct. */
function subtractPauses(interval: Interval, pauses: Interval[]): Interval[] {
  const spans = pauses.map(p => clip(p, interval.start, interval.end)).filter((p): p is Interval => Boolean(p)).sort((a, b) => a.start - b.start);
  const result: Interval[] = [];
  let cursor = interval.start;
  for (const pause of spans) {
    if (pause.start > cursor) result.push({ start: cursor, end: pause.start });
    cursor = Math.max(cursor, pause.end);
  }
  if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  return result;
}

export function workingIntervals(entry: TimeEntry, now: number): Interval[] {
  const start = Date.parse(entry.clockIn), end = Math.min(entry.clockOut ? Date.parse(entry.clockOut) : now, now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  return subtractPauses({ start, end }, entry.pauses.map(p => ({ start: Date.parse(p.start), end: p.end ? Date.parse(p.end) : end })).filter(p => Number.isFinite(p.start) && Number.isFinite(p.end)));
}

export function workedMinutes(entry: TimeEntry, now: number): number {
  return Math.floor(workingIntervals(entry, now).reduce((total, i) => total + i.end - i.start, 0) / MINUTE);
}

export function workedMinutesInPeriod(entry: TimeEntry, from: string, to: string, now: number): number {
  const start = instantForLocal(from, '00:00'), end = instantForLocal(addDays(to, 1), '00:00');
  return Math.floor(workingIntervals(entry, now).reduce((total, i) => total + Math.max(0, Math.min(i.end, end) - Math.max(i.start, start)), 0) / MINUTE);
}

function calendarMonth(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day, 12)).toISOString().slice(0, 10);
}

export function payPeriod(date: string, offset = 0, startDay = 26): { from: string; to: string; label: string } {
  if (!validDate(date) || !Number.isInteger(offset) || !Number.isInteger(startDay) || startDay < 1 || startDay > 31) throw new RangeError('Ugyldig lønperiode.');
  const [year, month, day] = date.split('-').map(Number);
  const start = (monthIndex: number) => calendarMonth(year, monthIndex, Math.min(startDay, new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate()));
  const currentStartDay = Number(start(month - 1).slice(-2));
  const startMonth = month - 1 - (day < currentStartDay ? 1 : 0) + offset;
  const from = start(startMonth), to = addDays(start(startMonth + 1), -1);
  return { from, to, label: `${dateLabel(from)} – ${dateLabel(to, { year: 'numeric' })}` };
}

function plannedIntervals(shift: Shift): Interval[] {
  const interval = shiftInterval(shift);
  // Demo rule: an unpaid planned break begins after four hours (or at the midpoint for short shifts).
  const duration = interval.end - interval.start, pauseLength = Math.min(duration, shift.breakMinutes * MINUTE);
  const pauseStart = interval.start + Math.min(4 * 60 * MINUTE, Math.max(0, (duration - pauseLength) / 2));
  return pauseLength ? subtractPauses(interval, [{ start: pauseStart, end: pauseStart + pauseLength }]) : [interval];
}

export function plannedMinutesInPeriod(shift: Shift, from: string, to: string): number {
  const start = instantForLocal(from, '00:00'), end = instantForLocal(addDays(to, 1), '00:00');
  return Math.floor(plannedIntervals(shift).reduce((total, i) => total + Math.max(0, Math.min(i.end, end) - Math.max(i.start, start)), 0) / MINUTE);
}

function earnings(intervals: Interval[]): { minutes: number; base: number; allowance: number } {
  let duration = 0, allowanceUnits = 0;
  for (const interval of intervals) {
    duration += interval.end - interval.start;
    // Rates change on whole-hour boundaries; bounded segments avoid a minute-by-minute render cost.
    for (let at = interval.start; at < interval.end;) {
      const hourMs = 60 * MINUTE, end = Math.min(interval.end, Math.floor(at / hourMs) * hourMs + hourMs);
      const { hour } = localParts(at), weekday = new Date(copenhagenDate(at) + 'T12:00:00Z').getUTCDay();
      const hourlyAllowance = (hour >= 18 ? DEMO_EVENING_CENTS : 0) + (weekday === 0 || weekday === 6 ? DEMO_WEEKEND_CENTS : 0);
      allowanceUnits += hourlyAllowance * (end - at);
      at = end;
    }
  }
  return { minutes: Math.floor(duration / MINUTE), base: Math.round(duration * DEMO_HOURLY_CENTS / (60 * MINUTE)), allowance: Math.round(allowanceUnits / (60 * MINUTE)) };
}

type ClosedEntry = TimeEntry & { clockOut: string };

function isClosedEntry(entry: TimeEntry): entry is ClosedEntry {
  return Boolean(entry.clockOut) && (entry.status === 'submitted' || entry.status === 'approved');
}

function periodBounds(from: string, to: string): Interval {
  if (!validDate(from) || !validDate(to) || from > to) throw new RangeError('Vælg et gyldigt datointerval.');
  return { start: instantForLocal(from, '00:00'), end: instantForLocal(addDays(to, 1), '00:00') };
}

/** Gross pay for one shift. A completed registration replaces the planned estimate at clock-out. */
export function shiftPay(shift: Shift, entry?: TimeEntry, period?: { from: string; to: string }): ShiftPay {
  const closed = entry?.shiftId === shift.id && isClosedEntry(entry) ? entry : undefined;
  let spans = closed ? workingIntervals(closed, Date.parse(closed.clockOut)) : plannedIntervals(shift);
  if (period) {
    const { start, end } = periodBounds(period.from, period.to);
    spans = spans.map(span => clip(span, start, end)).filter((span): span is Interval => span !== null);
  }
  const { minutes, base, allowance } = earnings(spans);
  return {
    kind: closed ? 'registered' : 'planned',
    minutes,
    baseCents: base,
    allowanceCents: allowance,
    totalCents: base + allowance,
  };
}

/** Period totals accrue on clock-out, including entries still awaiting approval. The display clock is deliberately irrelevant. */
export function summarizePeriod(state: AppState, from: string, to: string, _now: number): PeriodSummary {
  const { start: rangeStart, end: rangeEnd } = periodBounds(from, to);
  const ownShifts = state.shifts.filter(s => s.personId === state.selfId);
  const inRange = ownShifts.filter(s => { const i = shiftInterval(s); return i.start < rangeEnd && i.end > rangeStart; });
  const plannedSpans = inRange.flatMap(plannedIntervals).map(i => clip(i, rangeStart, rangeEnd)).filter((i): i is Interval => Boolean(i));
  const ownShiftIds = new Set(ownShifts.map(s => s.id));
  const entries = state.entries.filter(e => ownShiftIds.has(e.shiftId)).filter(isClosedEntry);
  // A closed record has a fixed end. Never truncate it with a minute-rounded UI clock or let it grow on later renders.
  const entrySpans = (entry: ClosedEntry) => workingIntervals(entry, Date.parse(entry.clockOut)).map(i => clip(i, rangeStart, rangeEnd)).filter((i): i is Interval => Boolean(i));
  const planned = earnings(plannedSpans), earned = earnings(entries.flatMap(entrySpans));
  const approved = earnings(entries.filter(e => e.status === 'approved').flatMap(entrySpans));
  return {
    plannedMinutes: planned.minutes, workedMinutes: earned.minutes, approvedMinutes: approved.minutes,
    estimatedCents: planned.base + planned.allowance, earnedCents: earned.base + earned.allowance, approvedCents: approved.base + approved.allowance,
    baseEarnedCents: earned.base, allowanceEarnedCents: earned.allowance, baseEstimatedCents: planned.base, allowanceEstimatedCents: planned.allowance,
    progress: planned.minutes ? Math.min(1, earned.minutes / planned.minutes) : 0,
    shiftCount: inRange.length, completedCount: entries.filter(e => entrySpans(e).length > 0).length,
  };
}

/** The whole local day, including a previous day's overnight shift crossing into this date. */
export function coworkerShiftsForDay(state: AppState, shift: Shift, personId?: string): Shift[] {
  const start = instantForLocal(shift.date, '00:00'), end = instantForLocal(addDays(shift.date, 1), '00:00');
  return state.shifts.filter(s => {
    if (s.siteId !== shift.siteId || !s.personId || s.personId === state.selfId || personId && s.personId !== personId) return false;
    const span = shiftInterval(s);
    return span.start < end && span.end > start;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

/** All coworkers at this worksite on this date, including non-overlapping morning/evening shifts. */
export function coworkersForDay(state: AppState, shift: Shift): Person[] {
  const ids = new Set(coworkerShiftsForDay(state, shift).map(s => s.personId));
  return state.people.filter(p => ids.has(p.id));
}

export function upcoming(state: AppState, from = state.today): Shift[] {
  return state.shifts.filter(s => s.personId === state.selfId && (s.date >= from || s.date === addDays(from, -1) && shiftDates(s).includes(from))).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

export function futureOpenShifts(shifts: Shift[], now: number): Shift[] {
  return shifts.filter(shift => shift.personId === null && shiftInterval(shift).start > now);
}
