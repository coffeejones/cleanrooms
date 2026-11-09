import { fetch } from 'expo/fetch';
import { validDate, type ChecklistItem, type ClockInLocation, type Shift, type Site } from '@/domain/model';
import { confirmsTimeCommand, monotonicNow } from '@/state/attendance-runtime';
import { retryAfterMilliseconds } from '@/state/retry-policy';

export type Employee = {
  workspaceId: string;
  personId: string;
  email: string;
  name: string;
};

export type MobileSession = {
  expiresAt: string;
  employee: Employee;
  temporaryPassword: boolean;
};

export const minimumPasswordLength = 8;
export const maximumPasswordLength = 128;

function resolveOrigin(value: string | undefined): string | null {
  const origin = value?.trim().replace(/\/$/, '');
  if (!origin) return null;
  if (/^https:\/\/[a-z\d](?:[a-z\d.-]*[a-z\d])?(?::[1-9]\d{0,4})?$/i.test(origin)) return origin;
  if (__DEV__ && /^http:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2):[1-9]\d{0,4}$/.test(origin)) return origin;
  return null;
}

export const mobileAuthOrigin = resolveOrigin(process.env.EXPO_PUBLIC_CLEANROOMS_AUTH_URL);
export const canUseMobileAuth = mobileAuthOrigin !== null && process.env.EXPO_OS !== 'web';

export const authUnavailableMessage = 'Medarbejderlogin er endnu ikke tilsluttet denne appversion.';

export class MobileAuthError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = 'MobileAuthError';
  }
}

type AuthAction = Record<string, unknown> & { action: string };
export type PublishedShift = { shift: Shift; site: Site; entry?: ShiftTimeEntry | null };
export type ShiftTimeOperation = 'start' | 'pause' | 'resume' | 'finish' | 'submit';
export type ShiftTimeCommand = {
  shiftId: string; operation: ShiftTimeOperation; version: number; comment: string | null; location: ClockInLocation | null;
  /** Local reconciliation context only; never part of the HTTP command. */
  previousComment?: string;
};
export type ShiftTimeEntry = {
  version: number; status: 'running' | 'paused' | 'submitted' | 'approved' | 'rejected';
  clockIn: string | null; clockOut: string | null; pauseAt: string | null;
  workedSeconds?: number; measuredAt?: number;
  receivedAtMonotonic?: number; comment?: string; rejectionReason?: string;
};
export type PublishedShiftDetail = PublishedShift & { clockInRadius: number | null; entry: ShiftTimeEntry | null; completedTaskIds: string[]; checklistToken: string | null };
export type ShiftTimeChangeTarget = Pick<Shift, 'id' | 'date' | 'start' | 'end'> & { personId?: string | null };
const shiftClock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function readTimePair(value: unknown): { start: string; end: string } | null {
  if (!isObject(value) || typeof value.start !== 'string' || !shiftClock.test(value.start)
    || typeof value.end !== 'string' || !shiftClock.test(value.end) || value.start === value.end) return null;
  return { start: value.start, end: value.end };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

export function isSessionToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z\d._~-]{22,512}$/.test(value);
}

function invalidResponse() {
  return new MobileAuthError('mobile_response_invalid', 503, 'Login kunne ikke bekræftes. Prøv igen.');
}

function readSession(value: unknown): MobileSession {
  if (!isObject(value) || !isObject(value.employee)) throw invalidResponse();
  const { employee, expiresAt, temporaryPassword } = value;
  const { workspaceId, personId, email, name } = employee;
  if (!isText(workspaceId, 512) || !isText(personId, 512) || !isText(email, 320) || !isText(name, 512)
    || !isText(expiresAt, 40) || !Number.isFinite(Date.parse(expiresAt)) || typeof temporaryPassword !== 'boolean') {
    throw invalidResponse();
  }
  return { employee: { workspaceId, personId, email, name }, expiresAt, temporaryPassword };
}

function readShift(value: unknown): PublishedShift {
  const invalid = () => new MobileAuthError('mobile_schedule_invalid', 503, 'Vagten kunne ikke læses. Prøv igen.');
  if (!isObject(value) || !isObject(value.site)) throw invalid();
  const { id, personId, date, start, end, breakMinutes, description, checklist, site } = value;
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!isText(id, 512) || !isText(personId, 512) || !validDate(date)
    || typeof start !== 'string' || !clock.test(start) || typeof end !== 'string' || !clock.test(end) || start === end
    || typeof breakMinutes !== 'number' || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 1440
    || !isText(site.id, 512) || typeof site.name !== 'string' || typeof site.address !== 'string'
    || (description !== undefined && typeof description !== 'string') || (checklist !== undefined && !Array.isArray(checklist))) throw invalid();
  const tasks: ChecklistItem[] = (checklist ?? []).map((task: unknown) => {
    if (!isObject(task) || !isText(task.id, 512) || typeof task.text !== 'string') throw invalid();
    return { id: task.id, text: task.text };
  });
  const previousTime = readTimePair(value.previousTime);
  return {
    shift: { id, personId, date, start, end, breakMinutes, siteId: site.id, role: '', description: description ?? '', checklist: tasks,
      ...(previousTime && (previousTime.start !== start || previousTime.end !== end) ? { previousTime } : {}),
    },
    site: { id: site.id, name: site.name, address: site.address },
    ...(value.entry !== undefined ? { entry: value.entry === null ? null : readTimeEntry(value.entry) } : {}),
  };
}

function readTimeEntry(value: unknown): ShiftTimeEntry {
  const invalid = () => new MobileAuthError('mobile_time_invalid', 503, 'Tidsregistreringen kunne ikke læses. Prøv igen.');
  if (!isObject(value)) throw invalid();
  const { version, status, clockIn, clockOut, pauseAt } = value;
  const stamp = (time: unknown): time is string | null => time === null || (typeof time === 'string' && Number.isFinite(Date.parse(time)));
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1
    || (status !== 'running' && status !== 'paused' && status !== 'submitted' && status !== 'approved' && status !== 'rejected')
    || !stamp(clockIn) || !stamp(clockOut) || !stamp(pauseAt)) throw invalid();
  const workedSeconds = typeof value.workedSeconds === 'number' && Number.isSafeInteger(value.workedSeconds) && value.workedSeconds >= 0 ? value.workedSeconds : undefined;
  const measuredAt = typeof value.measuredAt === 'number' && Number.isSafeInteger(value.measuredAt) ? value.measuredAt : undefined;
  if (value.comment !== undefined && typeof value.comment !== 'string' || value.rejectionReason !== undefined && typeof value.rejectionReason !== 'string') throw invalid();
  return { version, status, clockIn, clockOut, pauseAt,
    ...(workedSeconds !== undefined && measuredAt !== undefined ? { workedSeconds, measuredAt, receivedAtMonotonic: monotonicNow() } : {}),
    ...(value.comment !== undefined ? { comment: value.comment } : {}),
    ...(value.rejectionReason !== undefined ? { rejectionReason: value.rejectionReason } : {}),
  };
}

async function request(body: AuthAction, token?: string): Promise<unknown> {
  if (!canUseMobileAuth) throw new MobileAuthError('mobile_unconfigured', 503, authUnavailableMessage);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${mobileAuthOrigin}/api/mobile-auth`, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    const payload: unknown = response.headers.get('content-type')?.includes('application/json')
      ? await response.json().catch(() => null)
      : null;
    if (response.ok) {
      if (!isObject(payload)) throw invalidResponse();
      return payload;
    }

    if (response.status === 429) {
      throw new MobileAuthError('mobile_throttled', 429, 'For mange forsøg. Vent lidt, og prøv igen.', retryAfterMilliseconds(response.headers.get('retry-after')));
    }
    if (isObject(payload) && isText(payload.error, 100) && isText(payload.message, 300) && response.status < 500) {
      throw new MobileAuthError(payload.error, response.status, payload.message);
    }
    throw new MobileAuthError('mobile_unavailable', response.status, 'Login er midlertidigt utilgængeligt. Prøv igen.', retryAfterMilliseconds(response.headers.get('retry-after')));
  } catch (error) {
    if (error instanceof MobileAuthError) throw error;
    throw new MobileAuthError('mobile_connection_failed', 503, 'Kunne ikke få forbindelse. Tjek dit netværk, og prøv igen.');
  } finally {
    clearTimeout(timer);
  }
}

async function authenticate(body: AuthAction, token?: string) {
  const value = await request(body, token);
  if (!isObject(value) || !isSessionToken(value.token)) throw invalidResponse();
  return { token: value.token, session: readSession(value) };
}

export const mobileAuthApi = {
  employeeRequest: async <T,>(token: string, payload: AuthAction): Promise<T> => await request(payload, token) as T,
  login: (email: string, password: string) => authenticate({ action: 'login', email, password }),
  session: async (token: string) => readSession(await request({ action: 'session' }, token)),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    authenticate({ action: 'changePassword', currentPassword, newPassword }, token),
  logout: async (token: string) => { await request({ action: 'logout' }, token); },
  activeTime: async (token: string): Promise<PublishedShift | null> => {
    const value = await request({ action: 'employeeActiveTime' }, token);
    if (!isObject(value) || !Object.hasOwn(value, 'shift')) throw invalidResponse();
    if (value.shift === null) return null;
    const result = readShift(value.shift);
    if (!result.entry || !['running', 'paused'].includes(result.entry.status)) throw invalidResponse();
    return result;
  },
  publishedSchedule: async (token: string, from: string, to: string, cursor: string | null) => {
    const value = await request({ action: 'publishedSchedule', from, to, cursor }, token);
    if (!isObject(value) || !Array.isArray(value.shifts) || (value.nextCursor !== null && !isText(value.nextCursor, 1024))) {
      throw new MobileAuthError('mobile_schedule_invalid', 503, 'Vagtplanen kunne ikke læses. Prøv igen.');
    }
    return { shifts: value.shifts.map(readShift), nextCursor: value.nextCursor };
  },
  publishedShift: async (token: string, shiftId: string) => {
    const value = await request({ action: 'publishedShift', shiftId }, token);
    if (!isObject(value)) throw invalidResponse();
    if (value.shift === null) return null;
    const shift = readShift(value.shift);
    if (!isObject(value.shift)) throw invalidResponse();
    const { clockInRadius, entry } = value.shift;
    if (clockInRadius !== null && (typeof clockInRadius !== 'number' || !Number.isSafeInteger(clockInRadius) || clockInRadius < 1)) {
      throw invalidResponse();
    }
    const completedTaskIds = value.shift.completedTaskIds;
    if (completedTaskIds !== undefined && (!Array.isArray(completedTaskIds) || !completedTaskIds.every(id => typeof id === 'string'))) throw invalidResponse();
    const checklistToken = value.shift.checklistToken;
    if (checklistToken !== undefined && (typeof checklistToken !== 'string' || !/^[a-f0-9]{64}$/.test(checklistToken))) throw invalidResponse();
    return { ...shift, clockInRadius, entry: entry === null ? null : readTimeEntry(entry), completedTaskIds: completedTaskIds ?? [], checklistToken: checklistToken ?? null };
  },
  shiftTimeChange: async (token: string, shift: ShiftTimeChangeTarget): Promise<{ start: string; end: string } | null> => {
    const invalid = () => new MobileAuthError('mobile_shift_change_invalid', 503, 'Vagtændringen kunne ikke læses. Prøv igen.');
    if (!isText(shift.id, 512) || !validDate(shift.date) || !readTimePair(shift)) throw invalid();
    if (shift.personId === null) return null;
    if (shift.personId !== undefined && !isText(shift.personId, 512)) throw invalid();
    let messageCursor: string | null = null;
    const cursors = new Set<string>();
    let latest: { start: string; end: string; at: number; id: string } | null = null;
    // Unread notifications are sorted before read ones. A matching first page
    // does not establish which time change was most recently published.
    for (let page = 0; page < 10; page++) {
      const value = await request({ action: 'workflowRead', from: shift.date, to: shift.date, limit: 50,
        ...(messageCursor ? { messageCursor } : {}),
      }, token);
      if (!isObject(value) || !Array.isArray(value.notifications) || value.notifications.length > 50
        || !isObject(value.pagination) || value.pagination.messages !== null && !isText(value.pagination.messages, 2048)) throw invalid();
      for (const message of value.notifications) {
        if (!isObject(message) || !['changed', 'moved'].includes(String(message.kind)) || !isText(message.id, 512)
          || !isText(message.personId, 512) || shift.personId !== undefined && message.personId !== shift.personId
          || !isObject(message.before) || !isObject(message.after)) continue;
        const before = message.before, after = message.after, previous = readTimePair(before), current = readTimePair(after);
        const at = typeof message.createdAt === 'string' ? Date.parse(message.createdAt) : NaN;
        if (!previous || !current || !Number.isFinite(at) || !validDate(before.date)
          || before.id !== shift.id || after.id !== shift.id || before.person !== message.personId || after.person !== message.personId
          || after.date !== shift.date || current.start !== shift.start || current.end !== shift.end
          || previous.start === current.start && previous.end === current.end) continue;
        if (!latest || at > latest.at || at === latest.at && message.id > latest.id) latest = { ...previous, at, id: message.id };
      }
      const next = value.pagination.messages;
      if (next === null) return latest ? { start: latest.start, end: latest.end } : null;
      if (cursors.has(next)) throw invalid();
      cursors.add(next);
      messageCursor = next;
    }
    throw new MobileAuthError('mobile_shift_change_incomplete', 503, 'Vagtændringen kunne ikke bekræftes. Prøv igen.');
  },
  shiftTime: async (token: string, command: ShiftTimeCommand): Promise<ShiftTimeEntry> => {
    const { previousComment, ...payload } = command;
    try {
      const value = await request({ action: 'shiftTime', ...payload }, token);
      if (!isObject(value)) throw invalidResponse();
      return readTimeEntry(value.entry);
    } catch (error) {
      if (!(error instanceof MobileAuthError) || error.status < 500 && error.status !== 409) throw error;
      // A timeout can arrive after commit. Never repeat a clock command before
      // asking the server; the original CAS version also fences a later retry.
      try {
        const latest = await mobileAuthApi.publishedShift(token, command.shiftId);
        if (confirmsTimeCommand(command.operation, command.version, latest?.entry, command.comment, previousComment)) return latest!.entry!;
      } catch (readError) {
        if (readError instanceof MobileAuthError && readError.status === 401) throw readError;
        // The result remains uncertain, never invent a local receipt.
      }
      if (error.status === 409) throw error;
      throw new MobileAuthError('mobile_time_unconfirmed', error.status,
        'Stemplingens status kunne ikke bekræftes. Hent vagten igen, før du prøver igen.');
    }
  },
};
