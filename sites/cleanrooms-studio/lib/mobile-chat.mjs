/* Native sessions reuse the department-chat store and its transactional membership checks. */
import { handleChatAction } from './chat-store.mjs';
import { readMobileSession } from './mobile-auth-store.mjs';
import { StudioError } from './studio-store.mjs';

const fields = {
  chatList: ['cursor', 'limit'],
  chatRead: ['roomId', 'before', 'limit'],
  chatSync: ['roomId', 'afterSeq', 'version', 'limit'],
  chatSend: ['roomId', 'clientId', 'text'],
  chatReadMark: ['roomId', 'throughSeq'],
  chatMute: ['roomId', 'muted'],
};
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = async (db, sql, ...values) => (await db.batch([statement(db, sql, ...values)]))[0]?.results ?? [];
const first = async (...args) => (await rows(...args))[0] ?? null;

export async function mobileEmployeeChatContext(db, token, session) {
  const current = await readMobileSession({ db, token });
  if (session.tokenHash !== current.tokenHash || session.credentialVersion !== current.credentialVersion ||
    session.employee.workspaceId !== current.employee.workspaceId || session.employee.personId !== current.employee.personId) {
    fail(401, 'mobile_session_invalid', 'Log ind igen for at fortsætte.');
  }
  const { employee: { workspaceId, personId, name }, tokenHash, credentialVersion } = current;
  const members = await rows(db, `SELECT member.user_id, member.name, member.status, member.version, member.role_id,
    role.version AS role_version FROM workspace_members member LEFT JOIN workspace_roles role
      ON role.workspace_id = member.workspace_id AND role.id = member.role_id
    WHERE member.workspace_id = ? AND member.person_id = ? ORDER BY member.user_id LIMIT 2`, workspaceId, personId);
  if (members.length > 1) fail(409, 'mobile_membership_ambiguous', 'Medarbejderens konto kunne ikke bekræftes. Kontakt administratoren.');
  const linked = members[0];
  const userId = linked?.user_id ?? 'mobile-employee:' + personId;
  const context = {
    mobileEmployee: true,
    workspace: { id: workspaceId },
    member: { userId, personId, name, version: credentialVersion },
    // Native employee sessions never inherit planner or chat-management rights.
    role: { id: 'mobile-employee', version: credentialVersion, permissions: [] },
  };
  const actorGuard = () => ({
    sql: `EXISTS (SELECT 1 FROM workspace_mobile_sessions mobile
      JOIN workspace_mobile_credentials credential ON credential.workspace_id = mobile.workspace_id
        AND credential.person_id = mobile.person_id AND credential.version = mobile.credential_version
        AND credential.revoked_at IS NULL
      JOIN workspace_directory_records employee ON employee.workspace_id = mobile.workspace_id
        AND employee.kind = 'employee' AND employee.id = mobile.person_id AND employee.deleted = 0 AND employee.active = 1
      WHERE mobile.token_hash = ? AND mobile.workspace_id = ? AND mobile.person_id = ?
        AND mobile.credential_version = ? AND mobile.expires_at > (julianday('now') - 2440587.5) * 86400000)
      AND ${linked ? `EXISTS (SELECT 1 FROM workspace_members member
        WHERE member.workspace_id = ? AND member.person_id = ? AND member.user_id = ?)`
        : `NOT EXISTS (SELECT 1 FROM workspace_members member WHERE member.workspace_id = ? AND member.person_id = ?)`}`,
    values: [tokenHash, workspaceId, personId, credentialVersion, workspaceId, personId,
      ...(linked ? [userId] : [])],
  });
  const assertContext = async () => {
    await readMobileSession({ db, token });
    const guard = actorGuard();
    if (!await first(db, 'SELECT 1 AS valid WHERE ' + guard.sql, ...guard.values)) {
      fail(409, 'mobile_membership_changed', 'Din kontoadgang er ændret. Åbn siden igen.');
    }
  };
  await assertContext();
  return { context, helpers: { actorGuard, assertContext, fail, statement, rows, first } };
}

const safeMessage = ({ id, seq, text, authorId, authorName, createdAt, pinned }) =>
  ({ id, seq, text, authorId, authorName, createdAt, pinned });
const safeRoom = room => {
  const { id, departmentId, departmentName, name, version, latestSeq, unread, muted, memberCount, lastMessage } = room;
  return { id, departmentId, departmentName, name, version, latestSeq, unread, muted, memberCount, lastMessage };
};

export async function handleMobileChat(db, token, session, payload) {
  const allowed = fields[payload?.action];
  if (!allowed || Object.keys(payload).some(key => key !== 'action' && !allowed.includes(key))) {
    fail(400, 'mobile_chat_action_invalid', 'Vælg en gyldig samtalehandling.');
  }
  const normalized = Object.fromEntries(Object.entries(payload)
    .filter(([key, value]) => !(['cursor', 'before'].includes(key) && value === null)));
  const { context, helpers } = await mobileEmployeeChatContext(db, token, session);
  const result = await handleChatAction({ db, context, payload: normalized, helpers });
  await helpers.assertContext();
  const output = { viewer: result.viewer };
  for (const key of ['unreadCount', 'nextCursor', 'hasMore', 'unchanged', 'latestSeq', 'version', 'throughSeq', 'hasMoreNew']) {
    if (Object.hasOwn(result, key)) output[key] = result[key];
  }
  if (result.rooms) output.rooms = result.rooms.map(safeRoom);
  if (result.room) output.room = safeRoom(result.room);
  if (result.messages) output.messages = result.messages.map(safeMessage);
  if (result.pins) output.pins = result.pins.map(safeMessage);
  if (result.message) output.message = safeMessage(result.message);
  return output;
}
