export type EmployeeCompanySettings = { version: number; payrollPeriod: { startDay: number } };

export function parseEmployeeCompanySettings(value: unknown): EmployeeCompanySettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Virksomhedens lønperiode kunne ikke læses.');
  const record = value as Record<string, unknown>;
  const policy = record.payrollPeriod;
  if (!Number.isSafeInteger(record.version) || (record.version as number) < 0 || !policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('Virksomhedens lønperiode kunne ikke læses.');
  const startDay = (policy as Record<string, unknown>).startDay;
  if (!Number.isInteger(startDay) || (startDay as number) < 1 || (startDay as number) > 31) throw new Error('Virksomhedens lønperiode kunne ikke læses.');
  return { version: record.version as number, payrollPeriod: { startDay: startDay as number } };
}
