import type { LiveChatMessage } from './chat-wire';

export type LiveUnreadSnapshot = { viewerId: string; unread: number; latestSeq: number };

export function firstUnreadLiveMessageId(
  messages: readonly Pick<LiveChatMessage, 'id' | 'seq' | 'authorId'>[],
  snapshot: LiveUnreadSnapshot,
) {
  let { unread: remaining, latestSeq: expectedSeq } = snapshot;
  if (remaining === 0) return;

  // The server counts unread messages from other authors. A complete suffix
  // through the room's opening sequence is needed to locate the first one.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.seq > snapshot.latestSeq) continue;
    if (message.seq !== expectedSeq) return;
    expectedSeq--;
    if (message.authorId !== snapshot.viewerId) {
      remaining--;
      if (remaining === 0) return message.id;
    }
  }
}
