import { checkClockInLocation, clockInAvailability, copenhagenDate, shiftInterval, validDate, type AppState, type ClockInLocation, type Preferences, type Result, type TimeEntry } from '../domain/model';

export type AppAction =
  | { type: 'clockIn'; shiftId: string; location?: ClockInLocation }
  | { type: 'clockOut'; shiftId: string; comment?: string }
  | { type: 'pause' | 'resume'; shiftId: string }
  | { type: 'toggleTask'; shiftId: string; taskId: string }
  | { type: 'requestLeave'; shiftId: string; comment?: string }
  | { type: 'claimShift'; shiftId: string }
  | { type: 'sendMessage'; roomId: string; text: string }
  | { type: 'markRoomRead'; roomId: string }
  | { type: 'markNotificationRead'; id: string }
  | { type: 'setUnavailableDate'; date: string; unavailable: boolean }
  | { type: 'setPreference'; key: keyof Preferences; value: boolean };

export type Transition = { state: AppState; result: Result };
const id = (prefix: string, now: number) => `${prefix}-${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export function rolloverDemoDay(state: AppState, now: number): AppState {
  const today = copenhagenDate(now);
  return state.today === today ? state : { ...state, today };
}

/** Pure local demo commands; a future authenticated repository must let the server enforce these rules. */
export function applyAction(state: AppState, action: AppAction, now: number, locationCheckedAt = now): Transition {
  const fail = (error: string): Transition => ({ state, result: { ok: false, error } });
  const success = (next: AppState): Transition => ({ state: next, result: { ok: true } });
  if (action.type === 'setUnavailableDate') {
    const { date, unavailable } = action;
    if (!validDate(date) || typeof unavailable !== 'boolean') return fail('Vælg en gyldig dato.');
    if (state.unavailableDates.includes(date) === unavailable) return success(state);
    if (unavailable && date < copenhagenDate(now)) return fail('Du kan kun markere i dag eller en kommende dato.');
    const unavailableDates = unavailable
      ? [...state.unavailableDates, date].sort()
      : state.unavailableDates.filter(day => day !== date);
    return success({ ...state, unavailableDates });
  }

  const stamp = new Date(now).toISOString();
  if (action.type === 'setPreference') {
    if (!Object.hasOwn(state.preferences, action.key) || typeof action.value !== 'boolean') return fail('Indstillingen findes ikke.');
    return success({ ...state, preferences: { ...state.preferences, [action.key]: action.value } });
  }
  if (action.type === 'markNotificationRead') {
    if (!state.notifications.some(n => n.id === action.id)) return fail('Beskeden findes ikke.');
    return success({ ...state, notifications: state.notifications.map(n => n.id === action.id ? { ...n, read: true } : n) });
  }
  if (action.type === 'sendMessage' || action.type === 'markRoomRead') {
    const room = state.rooms.find(r => r.id === action.roomId && r.memberIds.includes(state.selfId));
    if (!room) return fail('Du er ikke medlem af denne samtale.');
    if (action.type === 'markRoomRead') return success({ ...state, messages: state.messages.map(m => m.roomId === room.id ? { ...m, read: true } : m), notifications: state.notifications.map(n => n.roomId === room.id ? { ...n, read: true } : n) });
    const text = action.text.trim();
    if (!text || text.length > 10_000) return fail('Skriv en besked på højst 10.000 tegn.');
    if (state.messages.length >= 5000) return fail('Det lokale beskedarkiv er fuldt. Genskab startdata i Indstillinger for at starte igen.');
    return success({ ...state, messages: [...state.messages, { id: id('message', now), roomId: room.id, personId: state.selfId, text, createdAt: stamp, read: true }] });
  }

  const shift = state.shifts.find(s => s.id === action.shiftId);
  if (!shift) return fail('Vagten findes ikke.');
  const interval = shiftInterval(shift);
  if (action.type === 'claimShift') {
    if (shift.personId !== null) return fail('Vagten er ikke længere ledig.');
    if (interval.start <= now) return fail('Vagten er allerede begyndt.');
    if (state.requests.some(r => r.shiftId === shift.id && r.kind === 'claim' && r.status === 'pending')) return fail('Du har allerede meldt dig til denne vagt.');
    const overlapping = state.shifts.some(s => {
      if (s.personId !== state.selfId) return false;
      const own = shiftInterval(s); return own.start < interval.end && own.end > interval.start;
    });
    if (overlapping) return fail('Vagten overlapper en af dine andre vagter.');
    if (state.requests.length >= 5000 || state.notifications.length >= 1000) return fail('Det lokale arkiv er fuldt. Genskab startdata i Indstillinger for at starte igen.');
    return success({ ...state,
      requests: [...state.requests, { id: id('request', now), kind: 'claim', shiftId: shift.id, status: 'pending', createdAt: stamp, comment: '' }],
      notifications: [{ id: id('notice', now), kind: 'request', title: 'Anmodning sendt', body: 'Planlæggeren skal godkende den ledige vagt, før den bliver din.', createdAt: stamp, read: false, shiftId: shift.id }, ...state.notifications],
    });
  }
  if (shift.personId !== state.selfId) return fail('Du kan kun ændre din egen vagt.');
  if (action.type === 'requestLeave') {
    if (interval.start <= now) return fail('Du kan kun ønske fri fra en kommende vagt.');
    if ((action.comment?.length ?? 0) > 100_000) return fail('Kommentaren er for lang.');
    if (state.requests.some(r => r.shiftId === shift.id && r.kind === 'leave' && r.status === 'pending')) return fail('Du har allerede ønsket fri fra denne vagt.');
    if (state.requests.length >= 5000 || state.notifications.length >= 1000) return fail('Det lokale arkiv er fuldt. Genskab startdata i Indstillinger for at starte igen.');
    return success({ ...state,
      requests: [...state.requests, { id: id('request', now), kind: 'leave', shiftId: shift.id, status: 'pending', createdAt: stamp, comment: (action.comment ?? '').trim() }],
      notifications: [{ id: id('notice', now), kind: 'request', title: 'Dit friønske er sendt', body: 'Vagten gælder stadig, indtil planlæggeren har godkendt dit friønske.', createdAt: stamp, read: false, shiftId: shift.id }, ...state.notifications],
    });
  }

  const entry = state.entries.find(e => e.shiftId === shift.id);
  const replace = (replacement: TimeEntry): Transition => success({ ...state, entries: entry ? state.entries.map(e => e === entry ? replacement : e) : [...state.entries, replacement] });
  if (action.type === 'clockIn') {
    const availability = clockInAvailability(state, shift, now);
    if (!availability.allowed) return fail(availability.reason);
    const site = state.sites.find(item => item.id === shift.siteId);
    const geofence = site?.geofence;
    if (geofence != null) {
      const locationResult = checkClockInLocation(geofence, action.location, locationCheckedAt);
      if (!locationResult.ok) return { state, result: locationResult };
    }
    return replace({ shiftId: shift.id, clockIn: stamp, pauses: [], comment: '', completedTaskIds: [], status: 'running' });
  }
  if (!entry) return fail('Start vagten, før du registrerer opgaver eller pauser.');
  if (action.type === 'toggleTask') {
    if (!shift.checklist.some(t => t.id === action.taskId)) return fail('Opgaven findes ikke.');
    const done = entry.completedTaskIds.includes(action.taskId);
    return replace({ ...entry, completedTaskIds: done ? entry.completedTaskIds.filter(t => t !== action.taskId) : [...entry.completedTaskIds, action.taskId] });
  }
  if (entry.clockOut || entry.status === 'approved' || entry.status === 'submitted') return fail('Vagten er afsluttet. Kontakt planlæggeren, hvis tiderne er forkerte.');
  const latestActivity = Math.max(Date.parse(entry.clockIn), ...entry.pauses.flatMap(p => [Date.parse(p.start), ...(p.end ? [Date.parse(p.end)] : [])]));
  if (now < latestActivity) return fail('Enhedens ur er flyttet baglæns. Vent, eller genskab startdata i Indstillinger.');
  if (action.type === 'pause') {
    if (entry.status !== 'running') return fail('Du holder allerede pause.');
    return replace({ ...entry, status: 'paused', pauses: [...entry.pauses, { start: stamp }] });
  }
  if (action.type === 'resume') {
    if (entry.status !== 'paused') return fail('Du er ikke på pause.');
    return replace({ ...entry, status: 'running', pauses: entry.pauses.map(p => p.end ? p : { ...p, end: stamp }) });
  }
  if (action.type === 'clockOut') {
    if ((action.comment?.length ?? 0) > 100_000) return fail('Kommentaren er for lang.');
    return replace({ ...entry, status: 'submitted', clockOut: stamp, comment: (action.comment ?? '').trim(), pauses: entry.pauses.map(p => p.end ? p : { ...p, end: stamp }) });
  }
  return fail('Handlingen findes ikke.');
}
