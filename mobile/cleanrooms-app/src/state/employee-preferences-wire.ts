import { validDate } from '../domain/model';

export const reminderLeadMinutes = [15, 30, 60] as const;
export type ReminderLeadMinutes = typeof reminderLeadMinutes[number];
export type EmployeePreferenceKey = 'notifications' | 'chatNotifications' | 'shiftReminders' | 'checkoutReminders' | 'reminderLeadMinutes';
export type PushPreferences = {
  notifications: boolean; chatNotifications: boolean;
  shiftReminders: boolean; checkoutReminders: boolean; reminderLeadMinutes: ReminderLeadMinutes;
};
export type EmployeePreferences = PushPreferences & { version: number; unavailableDates: string[] };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const invalid = () => { throw new Error('Indstillingerne kunne ikke bekræftes. Hent dem igen.'); };

/** Older accounts and older API versions have no reminder fields: never opt them in implicitly. */
export function readPushPreferences(value: unknown): PushPreferences {
  if (!record(value) || typeof value.notifications !== 'boolean' || typeof value.chatNotifications !== 'boolean') return invalid();
  const shiftReminders = value.shiftReminders ?? false, checkoutReminders = value.checkoutReminders ?? false;
  const lead = value.reminderLeadMinutes ?? 30;
  if (value.shiftReminders === null || value.checkoutReminders === null || value.reminderLeadMinutes === null
    || typeof shiftReminders !== 'boolean' || typeof checkoutReminders !== 'boolean'
    || !reminderLeadMinutes.some(option => option === lead)) return invalid();
  return { notifications: value.notifications, chatNotifications: value.chatNotifications,
    shiftReminders, checkoutReminders, reminderLeadMinutes: lead as ReminderLeadMinutes };
}

export function parseEmployeePreferences(value: unknown): EmployeePreferences {
  const preferences = readPushPreferences(value);
  if (!record(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 0
    || !Array.isArray(value.unavailableDates) || value.unavailableDates.length > 730 || !value.unavailableDates.every(validDate)) return invalid();
  return { ...preferences, version: Number(value.version), unavailableDates: [...value.unavailableDates] as string[] };
}

export function confirmsEmployeePreference(value: unknown, key: EmployeePreferenceKey, next: boolean | ReminderLeadMinutes, version: number) {
  const preferences = parseEmployeePreferences(value);
  if (preferences.version !== version + 1 || preferences[key] !== next) return invalid();
  return preferences;
}

export function pushPreferencesEnabled(value: unknown) {
  const preferences = readPushPreferences(value);
  return preferences.notifications || preferences.chatNotifications || preferences.shiftReminders || preferences.checkoutReminders;
}
