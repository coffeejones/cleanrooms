type Job = { origin: string; token: string; expiresAt: number };
type Storage = { read: () => Promise<string | null>; write: (value: string) => Promise<void>; clear: () => Promise<void> };
function validOrigin(value: string) {
  try {
    const url = new URL(value);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && (url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname) && Boolean(url.port));
  } catch { return false; }
}
/** Durable revocation jobs never serve as credentials for restoring the UI session. */
export class PendingLogouts {
  private serial: Promise<unknown> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  constructor(private readonly storage: Storage, private readonly now = Date.now) {}
  private async jobs(includeExpired = false): Promise<Job[]> {
    const raw = await this.storage.read();
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 16 || value.some(item => !item || typeof item !== 'object'
      || typeof item.origin !== 'string' || !validOrigin(item.origin)
      || typeof item.token !== 'string' || !/^[A-Za-z0-9._~-]{22,512}$/.test(item.token)
      || typeof item.expiresAt !== 'number' || !Number.isFinite(item.expiresAt))) throw new Error('Invalid pending logout queue');
    if (includeExpired) return value as Job[];
    const current = (value as Job[]).filter(job => job.expiresAt > this.now());
    if (current.length !== value.length) {
      if (current.length) await this.storage.write(JSON.stringify(current)); else await this.storage.clear();
    }
    return current;
  }
  private transaction<T>(change: (jobs: Job[]) => Promise<T>, includeExpired = false) {
    const result = this.serial.then(async () => change(await this.jobs(includeExpired)));
    this.serial = result.catch(() => undefined);
    return result;
  }
  enqueue(origin: string, token: string, expiresAt = this.now() + 30 * 86400_000) {
    return this.transaction(async jobs => {
      if (!validOrigin(origin) || !/^[A-Za-z0-9._~-]{22,512}$/.test(token) || !Number.isFinite(expiresAt)) throw new Error('Invalid pending logout');
      if (jobs.some(job => job.origin === origin && job.token === token)) return;
      if (jobs.length >= 16) throw new Error('Pending logout queue is full');
      await this.storage.write(JSON.stringify([...jobs, { origin, token, expiresAt }]));
    });
  }
  hasPending(origin: string) { return this.transaction(async jobs => jobs.some(job => job.origin === origin)); }
  contains(origin: string, token: string) { return this.transaction(async jobs => jobs.some(job => job.origin === origin && job.token === token), true); }
  flush(origin: string, logout: (token: string) => Promise<void>) {
    if (this.flushing) return this.flushing;
    const run = async () => {
      for (let count = 0; count < 16; count++) {
        const job = await this.transaction(async value => value.find(job => job.origin === origin));
        if (!job) return;
        await logout(job.token); // Remove only after the server has acknowledged revocation.
        await this.transaction(async latest => {
          const remaining = latest.filter(item => item.origin !== job.origin || item.token !== job.token);
          if (remaining.length) await this.storage.write(JSON.stringify(remaining));
          else await this.storage.clear();
        });
      }
    };
    this.flushing = run().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
