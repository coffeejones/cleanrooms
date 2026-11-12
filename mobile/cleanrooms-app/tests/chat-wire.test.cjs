const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const build = process.env.CLEANROOMS_TEST_BUILD;
if (!build) throw new Error('Run npm test to compile the actual chat wire helpers.');
const chat = require(path.join(build, 'state/chat-wire.js'));
const { firstUnreadLiveMessageId } = require(path.join(build, 'state/chat-unread.js'));
const viewer = { userId: 'employee-web-account', name: 'Jonas Hansen' };
const message = (seq, extra = {}) => ({
  id: `message-${seq}`, seq, text: `Besked ${seq}`, authorId: 'colleague', authorName: 'Sara',
  createdAt: '2026-11-08T11:00:00.000Z', pinned: false, ...extra,
});
const room = (extra = {}) => ({
  id: 'chat-ringsted', departmentId: 'department-ringsted', departmentName: 'Ringsted', name: 'Team Ringsted',
  version: 2, latestSeq: 4, unread: 2, muted: false, memberCount: 6,
  lastMessage: message(4), ...extra,
});
const rooms = (extra = {}) => ({ viewer, rooms: [room()], unreadCount: 2, nextCursor: null, ...extra });
const conversation = (extra = {}) => ({ viewer, room: room(), messages: [message(3), message(4)], pins: [message(1, { pinned: true })], hasMore: false, nextCursor: null, ...extra });
const sync = (extra = {}) => ({ viewer, unchanged: false, room: room(), messages: [message(3), message(4)],
  latestSeq: 4, throughSeq: 4, version: 2, hasMoreNew: false, ...extra });

test('chat DTOs keep server identity and visible data without carrying authority or employee records into UI', () => {
  const result = chat.readLiveChatRooms(rooms({ canManage: true, employee: { salary: 900000 }, viewer: { ...viewer, token: 'not-ui-data' }, rooms: [room({ payroll: 'not-ui-data' })] }));
  assert.deepEqual(result.viewer, viewer);
  assert.equal(result.rooms[0].id, 'chat-ringsted');
  assert.equal(result.rooms[0].lastMessage.seq, 4);
  assert.equal(Object.hasOwn(result, 'canManage'), false);
  assert.equal(Object.hasOwn(result, 'employee'), false);
  assert.equal(Object.hasOwn(result.viewer, 'token'), false);
  assert.equal(Object.hasOwn(result.rooms[0], 'payroll'), false);
  const detail = chat.readLiveConversation(conversation(), 'chat-ringsted', viewer.userId);
  assert.equal(detail.viewer.userId, viewer.userId);
  assert.equal(detail.pins[0].pinned, true);
  assert.deepEqual(detail.messages.map(item => item.seq), [3, 4]);
});

test('malformed messages and impossible room metadata fail closed', () => {
  for (const invalid of [
    { ...message(3), authorId: undefined }, { ...message(3), createdAt: 'not-a-date' },
    { ...message(3), seq: 0 }, { ...message(3), seq: Number.NaN },
    { ...message(3), text: 'x'.repeat(10001) }, { ...message(3), pinned: 1 },
  ]) assert.throws(() => chat.readLiveConversation(conversation({ messages: [invalid] }), 'chat-ringsted'));
  assert.throws(() => chat.readLiveConversation(conversation({ messages: [message(4), message(3)] }), 'chat-ringsted'));
  assert.throws(() => chat.readLiveConversation(conversation({ messages: [message(3), message(4, { id: 'message-3' })] }), 'chat-ringsted'));
  assert.throws(() => chat.readLiveConversation(conversation({ messages: [message(5)] }), 'chat-ringsted'));
  assert.throws(() => chat.readLiveConversation(conversation({ pins: [message(1)] }), 'chat-ringsted'));
  for (const invalid of [{ unread: -1 }, { memberCount: 1.5 }, { latestSeq: '4' }, { version: 0 }, { muted: 1 }]) {
    assert.throws(() => chat.readLiveChatRooms(rooms({ rooms: [room(invalid)] })));
  }
  assert.throws(() => chat.readLiveChatRooms(rooms({ rooms: [room(), room()] })));
});

test('a room or viewer mismatch cannot replace an existing conversation', () => {
  assert.throws(() => chat.readLiveConversation(conversation({ room: room({ id: 'other-room' }) }), 'chat-ringsted'));
  assert.throws(() => chat.readLiveConversation(conversation({ viewer: { userId: 'other-account', name: 'Other' } }), 'chat-ringsted', viewer.userId));
  assert.throws(() => chat.readSync(sync({ room: room({ id: 'other-room' }) }), 'chat-ringsted', { afterSeq: 2, viewerId: viewer.userId }));
  assert.throws(() => chat.readSync(sync({ viewer: { userId: 'other-account', name: 'Other' } }), 'chat-ringsted', { afterSeq: 2, viewerId: viewer.userId }));
  assert.throws(() => chat.readViewer({ userId: 'stale-session-viewer', name: 'Stale' }, viewer.userId));
});

test('pagination accepts opaque nonempty cursors and rejects malformed references', () => {
  assert.equal(chat.readLiveChatRooms(rooms({ nextCursor: 'opaque-page-reference=' })).nextCursor, 'opaque-page-reference=');
  assert.equal(chat.readLiveConversation(conversation({ nextCursor: 'older-messages=' }), 'chat-ringsted').nextCursor, 'older-messages=');
  for (const nextCursor of [undefined, '', 5, false, {}, ['page'], 'x'.repeat(8193), 'page\nnext']) {
    assert.throws(() => chat.readLiveChatRooms(rooms({ nextCursor })));
    assert.throws(() => chat.readLiveConversation(conversation({ nextCursor }), 'chat-ringsted'));
  }
  assert.equal(chat.readLiveChatRooms(rooms()).nextCursor, null);
});

test('incremental pages must advance continuously without silently skipping messages', () => {
  const expected = { afterSeq: 2, viewerId: viewer.userId };
  const page = chat.readSync(sync(), 'chat-ringsted', expected);
  assert.deepEqual(page.messages.map(item => item.seq), [3, 4]);
  assert.equal(page.throughSeq, 4);
  for (const invalid of [
    { messages: [message(4)] }, { messages: [message(3)], throughSeq: 4 },
    { throughSeq: 5 }, { messages: [], throughSeq: 2, hasMoreNew: true },
    { messages: [message(3)], throughSeq: 3, latestSeq: 2 },
  ]) assert.throws(() => chat.readSync(sync(invalid), 'chat-ringsted', expected));
  const unchanged = { viewer, unchanged: true, latestSeq: 2, throughSeq: 2, version: 2, hasMoreNew: false };
  assert.deepEqual(chat.readSync(unchanged, 'chat-ringsted', expected).messages, []);
  assert.throws(() => chat.readSync({ ...unchanged, hasMoreNew: true }, 'chat-ringsted', expected));
  assert.throws(() => chat.readSync({ ...unchanged, throughSeq: 1 }, 'chat-ringsted', expected));
});

test('overlapping history, send receipts and retries merge once in server sequence order', () => {
  const previous = Object.freeze([Object.freeze(message(3)), Object.freeze(message(4))]);
  const older = chat.mergeLiveMessages(previous, [message(1), message(2), message(3)]);
  assert.deepEqual(older.map(item => item.seq), [1, 2, 3, 4]);
  const receipt = message(5, { authorId: viewer.userId, authorName: viewer.name });
  const sent = chat.mergeLiveMessages(older, [receipt]);
  const retried = chat.mergeLiveMessages(sent, [message(4), receipt]);
  assert.equal(retried.length, 5);
  assert.equal(retried.filter(item => item.id === receipt.id).length, 1);
  const pinned = chat.mergeLiveMessages(retried, [message(3, { pinned: true })]);
  assert.equal(pinned.find(item => item.id === 'message-3').pinned, true);
  assert.deepEqual(previous.map(item => item.seq), [3, 4]);
  assert.equal(previous[0].pinned, false);
});

test('conflicting message identity or sequence is rejected instead of duplicating or moving a row', () => {
  assert.throws(() => chat.mergeLiveMessages([message(3)], [message(4, { id: 'message-3' })]));
  assert.throws(() => chat.mergeLiveMessages([message(3)], [message(3, { id: 'different-message' })]));
  assert.equal(chat.mergeLiveMessages([message(3)], [message(3)])[0].id, 'message-3');
});

test('the unread divider uses the opening snapshot and skips the viewer’s own messages', () => {
  const snapshot = { viewerId: viewer.userId, unread: 2, latestSeq: 4 };
  const messages = [message(1), message(2), message(3, { authorId: viewer.userId }), message(4)];
  assert.equal(firstUnreadLiveMessageId(messages, snapshot), 'message-2');
  assert.equal(firstUnreadLiveMessageId([...messages, message(5)], snapshot), 'message-2');
  assert.equal(firstUnreadLiveMessageId(messages, { ...snapshot, unread: 0 }), undefined);
});

test('the unread divider waits for older history if the boundary is outside the current page', () => {
  const snapshot = { viewerId: viewer.userId, unread: 3, latestSeq: 4 };
  const newest = [message(3), message(4)];
  assert.equal(firstUnreadLiveMessageId(newest, snapshot), undefined);
  assert.equal(firstUnreadLiveMessageId([message(1), message(2), ...newest], snapshot), 'message-2');
});

test('the unread divider waits for missing messages covered by the opening summary', () => {
  const snapshot = { viewerId: viewer.userId, unread: 2, latestSeq: 4 };
  assert.equal(firstUnreadLiveMessageId([message(1), message(2), message(3)], snapshot), undefined);
  assert.equal(firstUnreadLiveMessageId([message(2), message(4)], snapshot), undefined);
  assert.equal(firstUnreadLiveMessageId([message(2), message(3), message(4)], snapshot), 'message-3');
});
