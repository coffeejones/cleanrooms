/* The employee inbox is ordered by event time, independently of calendar windows. */
import { StudioError, readRawStudio } from './studio-store.mjs';
import { mobileEmployeeChatContext } from './mobile-chat.mjs';
import { ensureEngagement } from './engagement-store.mjs';
import { Buffer } from 'node:buffer';

const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = async (db, sql, ...values) => (await db.batch([query(db, sql, ...values)]))[0]?.results ?? [];
const first = async (...args) => (await rows(...args))[0] ?? null;
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const readable = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const safeShift=value=>value?Object.fromEntries(['id','person','site','date','start','end','plannedBreakMinutes','siteName','fingerprint'].filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]])):null;
const ownUnread = `SELECT COUNT(*) AS n FROM workspace_shift_messages message
  LEFT JOIN workspace_message_receipts receipt ON receipt.workspace_id=message.workspace_id
    AND receipt.message_id=message.id AND receipt.person_id=message.person_id
  WHERE message.workspace_id=? AND message.person_id=? AND receipt.read_at IS NULL
    AND json_extract(message.config,'$.readAt') IS NULL`;

async function inboxContext(db, token, session) {
  const { context, helpers } = await mobileEmployeeChatContext(db, token, session);
  const head = await first(db, `SELECT workspace.snapshot_owner_id,plan.revision FROM workspaces workspace
    JOIN studio_states plan ON plan.owner_id=workspace.snapshot_owner_id WHERE workspace.id=?`, context.workspace.id);
  if (!head) fail(409, 'employee_context_changed', 'Beskederne kunne ikke indlæses. Prøv igen.');
  context.workspace.snapshotOwnerId = head.snapshot_owner_id;
  context.saved = { revision: head.revision, studio: {} };
  await ensureEngagement(db, context, { ...helpers, ensureOperationalSource: async current => {
    const raw = await readRawStudio(db, current.workspace.snapshotOwnerId);
    if (raw.revision !== current.saved.revision) fail(409, 'employee_context_changed', 'Beskederne er ændret. Prøv igen.');
    current.saved = raw; return raw;
  } });
  return { context, helpers };
}

export async function handleMobileInbox(db, token, session, payload) {
  const { context, helpers } = await inboxContext(db, token, session);
  const workspaceId = context.workspace.id, personId = context.member.personId;
  if (payload.action === 'employeeInboxRead') {
    if (!readable(payload.messageId, 512)) fail(400, 'employee_message_invalid', 'Vælg en gyldig besked.');
    const message = await first(db, `SELECT message.id,json_extract(message.config,'$.readAt') AS legacy_read,
      CASE WHEN message.kind IN ('new','changed','moved','reminder','checkout_reminder') THEN (
        SELECT published.id FROM workspace_published_shifts published
        WHERE published.workspace_id=message.workspace_id AND published.person_id=message.person_id
          AND published.id=json_extract(message.config,'$.after.id') AND published.deleted=0
      ) END AS target_shift_id FROM workspace_shift_messages message
      WHERE message.workspace_id=? AND message.id=? AND message.person_id=?`, workspaceId, payload.messageId, personId);
    if (!message) fail(404, 'workflow_message_missing', 'Beskeden findes ikke på din konto.');
    const guard = helpers.actorGuard(), stamp = new Date().toISOString();
    await db.batch([query(db, `INSERT INTO workspace_message_receipts(workspace_id,message_id,person_id,read_at)
      SELECT ?,?,?,? WHERE ${guard.sql} AND EXISTS (SELECT 1 FROM workspace_shift_messages message
        WHERE message.workspace_id=? AND message.id=? AND message.person_id=?)
      ON CONFLICT(workspace_id,message_id) DO NOTHING`, workspaceId, message.id, personId, message.legacy_read ?? stamp,
      ...guard.values, workspaceId, message.id, personId)]);
    const receipt = await first(db, 'SELECT read_at FROM workspace_message_receipts WHERE workspace_id=? AND message_id=? AND person_id=?', workspaceId, message.id, personId);
    const count = await first(db, ownUnread, workspaceId, personId);
    await helpers.assertContext();
    if (!receipt) fail(409, 'employee_message_changed', 'Beskeden er ændret. Hent den igen.');
    // A notification is history, not authority to open its former assignment.
    // Return a fresh point-key destination alongside the idempotent receipt so
    // even an already-read event cannot send the app to a removed/handed-off shift.
    return { messageId: message.id, readAt: receipt.read_at, unreadCount: Number(count?.n ?? 0),
      target: message.target_shift_id ? { kind: 'shift', shiftId: message.target_shift_id } : { kind: 'inbox' } };
  }
  if (payload.action !== 'employeeInbox') fail(400, 'employee_inbox_action_invalid', 'Vælg en gyldig beskedhandling.');
  if (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 100) fail(400, 'employee_inbox_limit_invalid', 'Vælg højst 100 beskeder ad gangen.');
  let after = null;
  if (payload.cursor !== null) {
    try {
      if (typeof payload.cursor !== 'string' || payload.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(payload.cursor)) throw Error();
      const value = JSON.parse(Buffer.from(payload.cursor, 'base64url').toString());
      if (value.v !== 1 || value.workspace !== workspaceId || value.person !== personId || !readable(value.id, 512)
        || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) throw Error();
      after = value;
    } catch { fail(400, 'employee_inbox_cursor_invalid', 'Beskedlisten er ændret. Hent den igen.'); }
  }
  const result = await db.batch([
    query(db, `SELECT message.id,message.created_at,length(CAST(message.config AS BLOB)) AS bytes,
      COALESCE(receipt.read_at,json_extract(message.config,'$.readAt')) AS read_at
      FROM workspace_shift_messages message LEFT JOIN workspace_message_receipts receipt
        ON receipt.workspace_id=message.workspace_id AND receipt.message_id=message.id AND receipt.person_id=message.person_id
      WHERE message.workspace_id=? AND message.person_id=?
        ${after ? 'AND (message.created_at<? OR (message.created_at=? AND message.id<?))' : ''}
      ORDER BY message.created_at DESC,message.id DESC LIMIT ?`, workspaceId, personId,
    ...(after ? [after.at, after.at, after.id] : []), payload.limit + 1),
    query(db, ownUnread, workspaceId, personId),
  ]);
  const found = result[0]?.results ?? [], selected = []; let bytes = 0;
  for (const item of found) {
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 512 * 1024) fail(503, 'employee_inbox_invalid', 'Beskeden kunne ikke læses sikkert.');
    if (selected.length >= payload.limit || selected.length && bytes + item.bytes > 1536 * 1024) break;
    selected.push(item); bytes += item.bytes;
  }
  const loaded = selected.length ? await rows(db, `SELECT message.id,message.config FROM json_each(?) chosen
    CROSS JOIN workspace_shift_messages message WHERE message.workspace_id=? AND message.person_id=?
      AND message.id=json_extract(chosen.value,'$.id') AND length(CAST(message.config AS BLOB))<=json_extract(chosen.value,'$.bytes')`,
  JSON.stringify(selected), workspaceId, personId) : [];
  if (loaded.length !== selected.length) fail(409, 'employee_inbox_changed', 'Beskedlisten er ændret. Hent den igen.');
  const messages = new Map(loaded.map(row => [row.id, row.config]));
  const notifications = selected.map(header => {
    let message; try { message = JSON.parse(messages.get(header.id)); } catch { fail(503, 'employee_inbox_invalid', 'Beskeden kunne ikke læses sikkert.'); }
    if (message.id !== header.id || message.personId !== personId || message.createdAt !== header.created_at
      || typeof message.summary!=='string'||!['new','changed','moved','cancelled','request','reminder','checkout_reminder'].includes(message.kind)) fail(503, 'employee_inbox_invalid', 'Beskeden kunne ikke læses sikkert.');
    return { id: message.id, kind: message.kind, before: safeShift(message.before), after: safeShift(message.after),
      summary: message.summary, createdAt: message.createdAt, readAt: header.read_at ?? null,
      ...(message.requestId ? { requestId: message.requestId } : {}) };
  });
  await helpers.assertContext();
  const last = selected.at(-1);
  return { notifications, unreadCount: Number(result[1]?.results?.[0]?.n ?? 0), serverNow: new Date().toISOString(),
    nextCursor: found.length > selected.length ? encode({ v: 1, workspace: workspaceId, person: personId, at: last.created_at, id: last.id }) : null };
}
