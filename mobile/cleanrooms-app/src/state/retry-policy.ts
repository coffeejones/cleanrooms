export function retryAfterMilliseconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : undefined;
  const delay = seconds === undefined ? Date.parse(value) - now : seconds * 1000;
  return Number.isFinite(delay) && delay >= 0 ? Math.min(300_000, Math.ceil(delay)) : undefined;
}
/** Read, sync and send share one gate per conversation/list. */
export class RetryGate {
  failures = 0;
  until = 0;
  version = 0;
  constructor(readonly base = 3000, readonly cap = 60_000) {}
  ready(now: number) { return now >= this.until; }
  success(version = this.version) { if (version === this.version) { this.failures = 0; this.until = 0; } }
  fail(now: number, retryAfterMs?: number, random = Math.random) {
    this.failures = Math.min(8, this.failures + 1);
    this.version++;
    const jittered = Math.round(Math.min(this.cap, this.base * 2 ** (this.failures - 1) * (0.8 + random() * 0.4)));
    this.until = now + Math.max(jittered, retryAfterMs ?? 0);
    return this.until - now;
  }
}
