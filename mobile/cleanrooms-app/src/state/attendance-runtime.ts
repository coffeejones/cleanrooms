export type AttendanceReceipt = {
  version: number; status: string; clockIn: string | null; clockOut: string | null; pauseAt: string | null;
  workedSeconds?: number; measuredAt?: number; receivedAtMonotonic?: number;
  comment?: string;
};
export function monotonicNow() { return globalThis.performance?.now?.() ?? Date.now(); }
/** Server duration is anchored on arrival, never compared with the device's wall clock. */
export function elapsedSeconds(entry: AttendanceReceipt, now: number): number | null {
  if (!Number.isFinite(entry.workedSeconds) || !Number.isFinite(entry.receivedAtMonotonic)) return null;
  return Math.max(0, entry.workedSeconds! + (entry.status === 'running'
    ? Math.max(0, now - entry.receivedAtMonotonic!) / 1000 : 0));
}
export function confirmsTimeCommand(operation: string, previousVersion: number, entry: AttendanceReceipt | null | undefined, comment?: string | null, previousComment?: string) {
  if (!entry || entry.version <= previousVersion) return false;
  const expectedComment = operation === 'submit' && comment != null
    ? previousComment === undefined ? null : [previousComment.trim(), comment.trim()].filter(Boolean).join('\n\n')
    : (comment ?? '').trim();
  const sameComment = expectedComment !== null && (entry.comment ?? '').trim() === expectedComment;
  if (operation === 'start') return Boolean(entry.clockIn) && ['running', 'paused', 'submitted', 'approved'].includes(entry.status);
  if (operation === 'finish') return Boolean(entry.clockOut) && ['submitted', 'approved', 'rejected'].includes(entry.status) && sameComment;
  if (operation === 'pause') return entry.status === 'paused' && Boolean(entry.pauseAt);
  if (operation === 'resume') return entry.status === 'running' && entry.pauseAt === null;
  if (operation === 'submit') return Boolean(entry.clockOut) && ['submitted', 'approved'].includes(entry.status) && sameComment
    || entry.status === 'rejected' && !entry.clockOut && Boolean(comment?.trim()) && sameComment;
  return false;
}
