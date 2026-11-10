import type { WorksiteInfo } from './model';

const limits: Record<keyof WorksiteInfo, number> = {
  contactName: 120, contactPhone: 80, parking: 200_000, accessInstructions: 200_000,
};

/** Only the opened assignment receives current worksite information. */
export function readWorksiteInfo(value: unknown): WorksiteInfo | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid worksite information.');
  const result: WorksiteInfo = {};
  for (const field of Object.keys(limits) as (keyof WorksiteInfo)[]) {
    const text = (value as Record<string, unknown>)[field];
    if (text === undefined) continue;
    if (typeof text !== 'string' || text.length > limits[field] || text.includes('\0')) throw new TypeError('Invalid worksite information.');
    if (text.trim()) result[field] = text.trim();
  }
  return Object.keys(result).length ? result : undefined;
}
