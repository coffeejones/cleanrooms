/** Push content is only a hint. The authenticated server chooses the destination. */
export type PushHint = { v: 1; eventId: string; installationId: string };
export type PushTarget = { kind: 'shift'; shiftId: string } | { kind: 'chat'; roomId: string } | { kind: 'inbox' };
export type PushRoute = '/notifications' | { pathname: '/shift/[id]' | '/chat/[id]'; params: { id: string } };
export const validInstallationId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const validProjectId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512
  && !/[\u0000-\u001f\u007f]/.test(value) && value.trim() === value;
const targetId = (value: unknown): value is string => id(value) && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function parsePushHint(value: unknown): PushHint | null {
  if (!record(value) || !exact(value, ['v', 'eventId', 'installationId']) || value.v !== 1 || typeof value.eventId !== 'string' || !/^[a-f0-9]{32}$/.test(value.eventId)
    || !validInstallationId(value.installationId)) return null;
  return { v: 1, eventId: value.eventId, installationId: value.installationId };
}
export function parsePushTarget(value: unknown): PushTarget {
  if (!record(value) || !exact(value, ['target']) || !record(value.target)) throw new Error('Beskeden kunne ikke åbnes. Prøv igen.');
  const target = value.target;
  if (target.kind === 'inbox' && exact(target, ['kind'])) return { kind: 'inbox' };
  if (target.kind === 'shift' && exact(target, ['kind', 'shiftId']) && targetId(target.shiftId)) return { kind: 'shift', shiftId: target.shiftId };
  if (target.kind === 'chat' && exact(target, ['kind', 'roomId']) && targetId(target.roomId)) return { kind: 'chat', roomId: target.roomId };
  throw new Error('Beskeden kunne ikke åbnes. Prøv igen.');
}
export function pushRoute(target: PushTarget): PushRoute {
  if (target.kind === 'shift') return { pathname: '/shift/[id]', params: { id: target.shiftId } };
  if (target.kind === 'chat') return { pathname: '/chat/[id]', params: { id: target.roomId } };
  return '/notifications';
}

/** Bounded account-scoped deduplication; a stale read cannot navigate a new account. */
export class PushOpenGuard {
  private scope: string | null = null;
  private epoch = 0;
  private handled = new Set<string>();
  private pending = new Set<string>();
  setScope(scope: string | null) {
    if (this.scope === scope) return;
    this.scope = scope;this.epoch++;this.handled.clear();this.pending.clear();
  }
  async open(hint: PushHint, installationId: string, load: () => Promise<unknown>, navigate: (target: PushTarget) => void | boolean) {
    if (!this.scope || hint.installationId !== installationId || this.handled.has(hint.eventId) || this.pending.has(hint.eventId)) return false;
    const epoch = this.epoch;
    this.pending.add(hint.eventId);
    try {
      const target = parsePushTarget(await load());
      if (epoch !== this.epoch || !this.scope) return false;
      if (navigate(target) === false) return false;
      this.handled.add(hint.eventId);
      if (this.handled.size > 100) this.handled.delete(this.handled.values().next().value!);
      return true;
    } finally { if (epoch === this.epoch) this.pending.delete(hint.eventId); }
  }
}
