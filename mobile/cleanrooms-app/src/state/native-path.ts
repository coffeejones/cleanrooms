/** Reject malformed/unbounded external links before handing them to Router. */
export function sanitizeNativePath(path: unknown): string | null {
  if (typeof path !== 'string' || path.length > 8192 || /[\u0000-\u001f\u007f]/.test(path)) return null;
  const retired = 'cleanrooms://gps-return';
  if (path === retired || path.startsWith(retired + '?')) return null;
  try { decodeURIComponent(path); } catch { return null; }
  return path;
}
