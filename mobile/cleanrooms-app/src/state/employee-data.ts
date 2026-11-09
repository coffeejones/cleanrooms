import { useCallback } from 'react';
import { useMobileAuth } from '@/auth/mobile-auth';
import type { PublishedShift, ShiftTimeEntry } from '@/auth/mobile-auth-api';
import { validDate, type PeriodSummary } from '@/domain/model';
import { usePublishedResource } from './published-schedule';
import { parseEmployeeCompanySettings } from './company-settings-wire';

export type EmployeeHoursRow = PublishedShift & {
  entry: ShiftTimeEntry | null;
  pay: { kind: 'registered' | 'planned'; minutes: number; baseCents: number; allowanceCents: number; totalCents: number; unavailableReason?: string };
  sourceLabel?: string;
};
export type EmployeeHours = {
  from: string; to: string; currency: 'DKK';
  summary: PeriodSummary & { missingPayCount: number; missingEarnedPayCount: number; missingEstimatedPayCount: number; monthlyCents: number };
  rows: EmployeeHoursRow[]; warnings: string[];
  monthlyLines: { label: string; amountCents: number }[];
};
export type EmployeePreferences = {
  version: number; notifications: boolean; chatNotifications: boolean; unavailableDates: string[];
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
  const load = useCallback(() => employeeRequest<EmployeePreferences>({ action: 'employeePreferences' }), [employeeRequest]);
  return usePublishedResource('preferences', load);
}

export function useEmployeeCompanySettings() {
  const { employeeRequest } = useMobileAuth();
  const load = useCallback(async () => parseEmployeeCompanySettings(await employeeRequest({ action: 'employeeCompanySettings' })), [employeeRequest]);
  return usePublishedResource('company-settings', load);
}
