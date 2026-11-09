import { useCallback } from 'react';
import { useMobileAuth } from '@/auth/mobile-auth';
import type { PublishedShift, ShiftTimeEntry } from '@/auth/mobile-auth-api';
import { validDate, type Shift, type PeriodSummary } from '@/domain/model';
import { usePublishedResource } from './published-schedule';
import { parseEmployeeCompanySettings } from './company-settings-wire';
import { parseEmployeePreferences } from './employee-preferences-wire';
export type { EmployeePreferences } from './employee-preferences-wire';

export type EmployeeHoursRow = PublishedShift & {
  entry: ShiftTimeEntry | null;
  pay: { kind: 'registered' | 'planned'; minutes: number; baseCents: number; allowanceCents: number; totalCents: number; unavailableReason?: string; interval?: { startAt: string; endAt: string } };
  sourceLabel?: string;
};
export type EmployeeHours = {
  from: string; to: string; currency: 'DKK';
  summary: PeriodSummary & { missingPayCount: number; missingEarnedPayCount: number; missingEstimatedPayCount: number; monthlyCents: number };
  rows: EmployeeHoursRow[]; warnings: string[];
  monthlyLines: { label: string; amountCents: number }[];
};
export type EmployeeWorkflowShift = { id: string; person: string; site: number; date: string; start: string; end: string; plannedBreakMinutes: number; siteName: string; fingerprint: string };
export type EmployeeWorkflowMessage = { id: string; kind: string; before: EmployeeWorkflowShift | null; after: EmployeeWorkflowShift | null; summary: string; createdAt: string; readAt: string | null; requestId?: string };
export type EmployeeRequest = { id: string; version: number; kind: string; status: string; fromPersonId: string; toPersonId: string; fromName: string; toName: string; shift: EmployeeWorkflowShift; comment: string; decisionReason?: string; blockedReason?: string };
export type EmployeeWorkflow = {
  notifications: EmployeeWorkflowMessage[]; unreadCount: number;
  requests: EmployeeRequest[];
  openShifts: EmployeeWorkflowShift[]; ownShifts: EmployeeWorkflowShift[];
  colleagues: { id: string; name: string; initials: string }[];
  pagination: { messages?: string | null; requests?: string | null; openShifts?: string | null; colleagues?: string | null }; serverNow: string;
};
export type EmployeeInbox = { notifications: EmployeeWorkflowMessage[]; unreadCount: number; nextCursor: string | null; serverNow: string };
export function useEmployeeInbox() {
  const { employeeRequest } = useMobileAuth();
  const load = useCallback(() => employeeRequest<EmployeeInbox>({ action: 'employeeInbox', cursor: null, limit: 50 }), [employeeRequest]);
  return usePublishedResource('inbox', load);
}
export function useEmployeeActiveTime() {
  const { readActiveTime } = useMobileAuth();
  return usePublishedResource('active-time', readActiveTime);
}
export function useEmployeeWorkflow(from?: string, to?: string) {
  const { employeeRequest } = useMobileAuth();
  const load = useCallback(() => employeeRequest<EmployeeWorkflow>({ action: 'workflowRead', ...(from && to ? { from, to } : {}), limit: 50 }), [employeeRequest, from, to]);
  return usePublishedResource('workflow:' + (from ?? 'all') + ':' + (to ?? 'all'), load);
}

export function useEmployeeHours(from: string, to: string) {
  const { employeeRequest } = useMobileAuth();
  const load = useCallback(async () => {
    const result = await employeeRequest<EmployeeHours>({ action: 'employeeHours', from, to });
    if (!result || result.from !== from || result.to !== to || result.currency !== 'DKK' || !Array.isArray(result.rows)
      || !result.summary || !Number.isSafeInteger(result.summary.workedMinutes) || !Number.isSafeInteger(result.summary.earnedCents)) {
      throw new Error('Timerne kunne ikke læses. Prøv igen.');
    }
    return result;
  }, [employeeRequest, from, to]);
  return usePublishedResource('hours:' + from + ':' + to, load, validDate(from) && validDate(to));
}

export function useEmployeePreferences() {
  const { employeeRequest } = useMobileAuth();
  const load = useCallback(async () => parseEmployeePreferences(await employeeRequest({ action: 'employeePreferences' })), [employeeRequest]);
  return usePublishedResource('preferences', load);
}

export function useEmployeeCompanySettings() {
  const { employeeRequest } = useMobileAuth();
  const load = useCallback(async () => parseEmployeeCompanySettings(await employeeRequest({ action: 'employeeCompanySettings' })), [employeeRequest]);
  return usePublishedResource('company-settings', load);
}


export type ShiftLeaveRequest = {
  id: string; version: number; personId: string; days: string[]; type: string;
  status: 'pending' | 'approved' | 'rejected'; comment: string; createdAt: string;
  decision?: { reason: string };
};
export function parseShiftLeave(value: unknown, personId: string): ShiftLeaveRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Friønsket kunne ikke læses. Prøv igen.');
  const row = value as Record<string, unknown>;
  const decision = row.decision as Record<string, unknown> | undefined;
  if (typeof row.id !== 'string' || !row.id || row.id.length > 512 || !Number.isSafeInteger(row.version) || Number(row.version) < 1
    || row.p !== personId || !Array.isArray(row.days) || row.days.length > 366 || !row.days.every(validDate)
    || typeof row.type !== 'string' || !['pending', 'approved', 'rejected'].includes(String(row.status))
    || row.comment !== undefined && typeof row.comment !== 'string'
    || row.createdAt !== undefined && (typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)))
    || decision !== undefined && (!decision || typeof decision !== 'object' || Array.isArray(decision) || typeof decision.reason !== 'string')) {
    throw new Error('Friønsket kunne ikke læses. Prøv igen.');
  }
  return { id: row.id, version: Number(row.version), personId, days: row.days as string[], type: row.type,
    status: row.status as ShiftLeaveRequest['status'], comment: row.comment as string ?? '', createdAt: row.createdAt as string ?? '',
    ...(decision ? { decision: { reason: decision.reason as string } } : {}) };
}
export function currentShiftLeave(requests: ShiftLeaveRequest[], date: string): ShiftLeaveRequest | null {
  return requests.filter(item => item.days.includes(date)).sort((a, b) =>
    Number(b.status === 'pending') - Number(a.status === 'pending')
    || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0] ?? null;
}
export async function readShiftLeaveRequests(request: (payload: Record<string, unknown> & { action: string }) => Promise<unknown>, date: string, personId: string) {
  if (!validDate(date) || !personId) throw new Error('Vælg en gyldig vagt.');
  const result = new Map<string, ShiftLeaveRequest>(), seen = new Set<string>();let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const value = await request({ action: 'leaveRead', from: date, to: date, limit: 50, cursor });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Friønskerne kunne ikke læses. Prøv igen.');
    const data = value as { requests?: unknown; nextCursor?: unknown };
    if (!Array.isArray(data.requests) || data.requests.length > 50 || data.nextCursor !== null && (typeof data.nextCursor !== 'string' || !data.nextCursor || data.nextCursor.length > 16384)) throw new Error('Friønskerne kunne ikke læses. Prøv igen.');
    for (const item of data.requests) { const parsed = parseShiftLeave(item, personId);if (parsed.days.includes(date)) result.set(parsed.id, parsed); }
    if (data.nextCursor === null) return [...result.values()];
    if (seen.has(data.nextCursor as string)) throw new Error('Friønskerne er ændret. Hent vagten igen.');
    cursor = data.nextCursor as string;seen.add(cursor);
  }
  throw new Error('Der er mange friønsker på dagen. Kontakt planlæggeren.');
}
export function useShiftLeaves(date: string) {
  const { employeeRequest, state } = useMobileAuth();
  const personId = state.mode === 'signedIn' ? state.session.employee.personId : '';
  const load = useCallback(() => readShiftLeaveRequests(employeeRequest, date, personId), [employeeRequest, date, personId]);
  const resource = usePublishedResource('leave:' + date, load, validDate(date));
  return { ...resource, read: load };
}
export function useShiftTimeChange(shift: Shift | undefined) {
  const { readShiftTimeChange } = useMobileAuth();
  const id = shift?.id, date = shift?.date, start = shift?.start, end = shift?.end, personId = shift?.personId;
  const load = useCallback(() => id && date && start && end && personId ? readShiftTimeChange({ id, date, start, end, personId }) : Promise.resolve(null), [readShiftTimeChange, id, date, start, end, personId]);
  return usePublishedResource('shift-change:' + [shift?.id, shift?.date, shift?.start, shift?.end].join(':'), load, Boolean(shift && !shift.previousTime));
}
