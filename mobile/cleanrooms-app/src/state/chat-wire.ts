/** Strict, platform-independent chat DTOs and stable message merging. */
export type LiveChatMessage = {
  id: string; seq: number; text: string; authorId: string; authorName: string;
  createdAt: string; pinned: boolean;
};
export type LiveChatRoom = {
  id: string; departmentId: string; departmentName: string; name: string; version: number;
  latestSeq: number; unread: number; muted: boolean; memberCount: number;
  lastMessage: null | Pick<LiveChatMessage, 'id' | 'seq' | 'text' | 'authorName' | 'createdAt'>;
};
export type Viewer = { userId: string; name: string };
export type RoomPage = { viewer: Viewer; rooms: LiveChatRoom[]; unreadCount: number; nextCursor: string | null };
export type Conversation = {
  viewer: Viewer; room: LiveChatRoom; messages: LiveChatMessage[]; pins: LiveChatMessage[];
  nextCursor: string | null;
};
export type SyncPage = {
  viewer: Viewer; unchanged: boolean; latestSeq: number; version: number; throughSeq: number;
  hasMoreNew: boolean; room?: LiveChatRoom; messages: LiveChatMessage[]; pins?: LiveChatMessage[];
};
export const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const id = (value: unknown): value is string => text(value, 512) && value.length > 0;
export const integer = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
export function invalid(): never { throw new Error('Samtalen kunne ikke læses. Prøv igen.'); }
function cursor(value: unknown): string | null {
  return value === null || text(value, 8192) && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid();
}
export function readViewer(value: unknown, expectedUserId?: string): Viewer {
  if (!record(value) || !id(value.userId) || !text(value.name, 512) || expectedUserId !== undefined && value.userId !== expectedUserId) return invalid();
  return { userId: value.userId, name: value.name };
}
function readLast(value: unknown): NonNullable<LiveChatRoom['lastMessage']> {
  if (!record(value) || !id(value.id) || !integer(value.seq, 1) || !text(value.text, 10_000)
    || !text(value.authorName, 512) || !text(value.createdAt, 40) || !Number.isFinite(Date.parse(value.createdAt))) return invalid();
  return { id: value.id, seq: value.seq, text: value.text, authorName: value.authorName, createdAt: value.createdAt };
}
export function readMessage(value: unknown): LiveChatMessage {
  const last = readLast(value);
  if (!record(value) || !id(value.authorId) || typeof value.pinned !== 'boolean') return invalid();
  return { ...last, authorId: value.authorId, pinned: value.pinned };
}
export function readRoom(value: unknown): LiveChatRoom {
  if (!record(value) || !id(value.id) || !id(value.departmentId) || !text(value.departmentName, 512)
    || !text(value.name, 120) || !integer(value.version, 1) || !integer(value.latestSeq)
    || !integer(value.unread) || !integer(value.memberCount) || typeof value.muted !== 'boolean') return invalid();
  return {
    id: value.id, departmentId: value.departmentId, departmentName: value.departmentName, name: value.name,
    version: value.version, latestSeq: value.latestSeq, unread: value.unread, muted: value.muted,
    memberCount: value.memberCount, lastMessage: value.lastMessage === null ? null : readLast(value.lastMessage),
  };
}
function messages(value: unknown, limit: number): LiveChatMessage[] {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  const result = value.map(readMessage);
  if (new Set(result.map(item => item.id)).size !== result.length || result.some((item, index) => index > 0 && item.seq <= result[index - 1].seq)) return invalid();
  return result;
}
export function readLiveChatRooms(value: unknown): RoomPage {
  if (!record(value) || !Array.isArray(value.rooms) || value.rooms.length > 100 || !integer(value.unreadCount)) return invalid();
  const rooms = value.rooms.map(readRoom);
  if (new Set(rooms.map(room => room.id)).size !== rooms.length) return invalid();
  return { viewer: readViewer(value.viewer), rooms, unreadCount: value.unreadCount, nextCursor: cursor(value.nextCursor) };
}
export function readLiveConversation(value: unknown, roomId: string, expectedUserId?: string): Conversation {
  if (!record(value)) return invalid();
  const room = readRoom(value.room);
  if (room.id !== roomId) return invalid();
  const body = messages(value.messages, 50), pins = messages(value.pins, 3);
  if (body.some(message => message.seq > room.latestSeq) || pins.some(pin => !pin.pinned || pin.seq > room.latestSeq)) return invalid();
  return { viewer: readViewer(value.viewer, expectedUserId), room, messages: body, pins, nextCursor: cursor(value.nextCursor) };
}
export function readSync(value: unknown, roomId: string, expected?: { afterSeq: number; viewerId: string }): SyncPage {
  if (!record(value) || typeof value.unchanged !== 'boolean' || !integer(value.latestSeq)
    || !integer(value.version, 1) || !integer(value.throughSeq) || typeof value.hasMoreNew !== 'boolean') return invalid();
  const common = { viewer: readViewer(value.viewer, expected?.viewerId), unchanged: value.unchanged, latestSeq: value.latestSeq, version: value.version, throughSeq: value.throughSeq, hasMoreNew: value.hasMoreNew };
  if (common.throughSeq > common.latestSeq) return invalid();
  if (value.unchanged) {
    if (common.hasMoreNew || common.throughSeq !== common.latestSeq || expected && expected.afterSeq !== common.throughSeq) return invalid();
    return { ...common, messages: [] };
  }
  const room = readRoom(value.room);
  if (room.id !== roomId) return invalid();
  const body = messages(value.messages, 50), pins = value.pins === undefined ? undefined : messages(value.pins, 3);
  if (body.at(-1) && body.at(-1)!.seq !== common.throughSeq || pins?.some(pin => !pin.pinned || pin.seq > common.latestSeq)) return invalid();
  if (expected && (common.throughSeq < expected.afterSeq || common.hasMoreNew && common.throughSeq === expected.afterSeq
    || body.some((message, index) => message.seq !== expected.afterSeq + index + 1)
    || common.throughSeq !== (body.at(-1)?.seq ?? expected.afterSeq))) return invalid();
  return { ...common, room, messages: body, ...(pins ? { pins } : {}) };
}
export function mergeLiveMessages(previous: LiveChatMessage[], incoming: LiveChatMessage[]) {
  const found = new Map<string, LiveChatMessage>(), sequences = new Map<number, string>();
  for (const item of [...previous, ...incoming]) {
    if (found.has(item.id) && found.get(item.id)?.seq !== item.seq || sequences.has(item.seq) && sequences.get(item.seq) !== item.id) return invalid();
    found.set(item.id, item); sequences.set(item.seq, item.id);
  }
  return [...found.values()].sort((a, b) => a.seq - b.seq);
}
