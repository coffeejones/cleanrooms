/* Device addresses are capabilities: keep them server-side, bound to the native session. */
import { StudioError } from './studio-store.mjs';
import { readMobileSession } from './mobile-auth-store.mjs';

export const pushUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const pushEventId = /^[a-f0-9]{32}$/;
const expoToken = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{20,200}\]$/;
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
export const pushQuery = (db, sql, ...values) => db.prepare(sql).bind(...values);
export const pushRows = async (db, sql, ...values) => (await db.batch([pushQuery(db, sql, ...values)]))[0]?.results ?? [];
export const pushFirst = async (...args) => (await pushRows(...args))[0] ?? null;
export const configuredPushProject = value => typeof value === 'string' && pushUuid.test(value) ? value.toLowerCase() : null;

export function pushSessionGuard(session, now = Date.now()) {
  const { workspaceId, personId } = session.employee;
  return { sql: `EXISTS (SELECT 1 FROM workspace_mobile_sessions mobile
    JOIN workspace_mobile_credentials credential ON credential.workspace_id=mobile.workspace_id AND credential.person_id=mobile.person_id
      AND credential.version=mobile.credential_version AND credential.revoked_at IS NULL
    JOIN workspace_directory_records employee ON employee.workspace_id=mobile.workspace_id AND employee.kind='employee'
      AND employee.id=mobile.person_id AND employee.active=1 AND employee.deleted=0
    WHERE mobile.token_hash=? AND mobile.workspace_id=? AND mobile.person_id=? AND mobile.credential_version=? AND mobile.expires_at>?)`,
  values: [session.tokenHash, workspaceId, personId, session.credentialVersion, now] };
}

/** Every call rechecks the original source and the current employee, never notification data. */
export async function pushTarget(db, event, personId, { forDelivery = false } = {}) {
  const people = await pushRows(db, `SELECT employee.site_index,
    (SELECT member.user_id FROM workspace_members member WHERE member.workspace_id=employee.workspace_id AND member.person_id=employee.id ORDER BY member.user_id LIMIT 1) user_id,
    EXISTS(SELECT 1 FROM workspace_members member WHERE member.workspace_id=employee.workspace_id AND member.person_id=employee.id ORDER BY member.user_id LIMIT 1 OFFSET 1) ambiguous,
    preferences.config preferences
    FROM workspace_directory_records employee LEFT JOIN workspace_employee_preferences preferences
      ON preferences.workspace_id=employee.workspace_id AND preferences.person_id=employee.id
    WHERE employee.workspace_id=? AND employee.kind='employee' AND employee.id=? AND employee.active=1 AND employee.deleted=0 LIMIT 1`, event.workspace_id, personId);
  const employee = people[0];
  if (!employee || employee.ambiguous) return null;
  let preferences = { notifications: true, chatNotifications: true };
  if (employee.preferences !== null) {
    try { preferences = JSON.parse(employee.preferences); } catch { return null; }
    if (typeof preferences?.notifications !== 'boolean' || typeof preferences?.chatNotifications !== 'boolean') return null;
  }
  const userId = employee.user_id ?? 'mobile-employee:' + personId;
  if (event.source_kind === 'test') return event.person_id === personId && (!forDelivery || preferences.notifications || preferences.chatNotifications) ? { kind: 'inbox' } : null;
  if (event.source_kind === 'chat') {
    if (forDelivery && !preferences.chatNotifications) return null;
    const source = await pushFirst(db, `SELECT message.seq,message.author_id,COALESCE(reader.muted,0) muted,COALESCE(reader.last_read_seq,0) read_seq
      FROM workspace_chat_messages message JOIN workspace_chat_rooms room
        ON room.workspace_id=message.workspace_id AND room.id=message.room_id AND room.demo=0
      JOIN workspace_directory_records department ON department.workspace_id=room.workspace_id AND department.kind='department'
        AND department.id=room.department_id AND department.deleted=0
      LEFT JOIN workspace_chat_readers reader ON reader.workspace_id=room.workspace_id AND reader.room_id=room.id AND reader.user_id=?
      WHERE message.workspace_id=? AND message.room_id=? AND message.id=? AND message.demo=0
        AND EXISTS(SELECT 1 FROM json_each(department.catalog,'$.siteIds') site WHERE site.value=?)`, userId, event.workspace_id, event.room_id, event.source_id, employee.site_index);
    if (!source || forDelivery && (source.author_id === userId || source.muted || source.read_seq >= source.seq)) return null;
    return { kind: 'chat', roomId: event.room_id };
  }
  if (event.source_kind !== 'shift' || event.person_id !== personId || forDelivery && !preferences.notifications) return null;
  const source = await pushFirst(db, `SELECT message.kind,message.config,receipt.read_at FROM workspace_shift_messages message
    LEFT JOIN workspace_message_receipts receipt ON receipt.workspace_id=message.workspace_id AND receipt.message_id=message.id AND receipt.person_id=message.person_id
    WHERE message.workspace_id=? AND message.id=? AND message.person_id=?`, event.workspace_id, event.source_id, personId);
  if (!source) return null;
  let message;
  try { message = JSON.parse(source.config); } catch { return null; }
  if (message?.personId !== personId || forDelivery && (source.read_at || message.readAt)) return null;
  if (source.kind === 'cancelled') return { kind: 'inbox' };
  if (!['new', 'changed', 'moved', 'request'].includes(source.kind)) return null;
  const shiftId = message.after?.id;
  if (source.kind === 'request') {
    if (!safeId(message.requestId)) return null;
    const request = await pushFirst(db, `SELECT id FROM workspace_shift_requests WHERE workspace_id=? AND id=? AND (from_person_id=? OR to_person_id=?)`, event.workspace_id, message.requestId, personId, personId);
    if (!request) return null;
  }
  const current = safeId(shiftId) ? await pushFirst(db, `SELECT id,workflow_fingerprint FROM workspace_published_shifts WHERE workspace_id=? AND id=? AND person_id=? AND deleted=0`, event.workspace_id, shiftId, personId) : null;
  if (!current) return forDelivery && source.kind !== 'request' ? null : { kind: 'inbox' };
  if (forDelivery && source.kind !== 'request' && message.after?.fingerprint && current.workflow_fingerprint !== message.after.fingerprint) return null;
  return { kind: 'shift', shiftId: current.id };
}

export async function handleMobilePush(db, token, session, payload, { projectId } = {}) {
  if (typeof payload.installationId !== 'string' || !pushUuid.test(payload.installationId)) fail(400, 'mobile_push_invalid', 'Enhedens identitet er ugyldig.');
  const installationId = payload.installationId.toLowerCase(), { workspaceId, personId } = session.employee;
  const guard = pushSessionGuard(session), now = Date.now();
  if (payload.action === 'employeePushRegister') {
    const configured = configuredPushProject(projectId);
    if (!configured) fail(503, 'mobile_push_unavailable', 'Pushnotifikationer er ikke klar endnu.');
    if (typeof payload.projectId !== 'string' || payload.projectId.toLowerCase() !== configured
      || typeof payload.expoPushToken !== 'string' || !expoToken.test(payload.expoPushToken) || !['ios', 'android'].includes(payload.platform)) fail(400, 'mobile_push_invalid', 'Pushoplysningerne er ugyldige.');
    const current = await pushFirst(db, 'SELECT workspace_id,person_id,active FROM workspace_push_devices WHERE installation_id=?', installationId);
    if (current?.active && (current.workspace_id !== workspaceId || current.person_id !== personId)) fail(409, 'mobile_push_binding_changed', 'Log ud af den tidligere konto på enheden først.');
    const permitted = `(${guard.sql}) AND NOT EXISTS(SELECT 1 FROM workspace_push_devices other WHERE other.expo_token=? AND other.active=1 AND (other.workspace_id<>? OR other.person_id<>?))
      AND (EXISTS(SELECT 1 FROM workspace_push_devices same WHERE same.installation_id=? AND same.workspace_id=? AND same.person_id=?)
        OR (SELECT COUNT(*) FROM workspace_push_devices own WHERE own.workspace_id=? AND own.person_id=?)<32)
      AND (EXISTS(SELECT 1 FROM workspace_push_devices same WHERE same.installation_id=? AND same.workspace_id=? AND same.person_id=? AND same.active=1)
        OR (SELECT COUNT(*) FROM workspace_push_devices own WHERE own.workspace_id=? AND own.person_id=? AND own.active=1)<8)`;
    const values = [...guard.values, payload.expoPushToken, workspaceId, personId, installationId, workspaceId, personId, workspaceId, personId, installationId, workspaceId, personId, workspaceId, personId];
    // Reinstallation may reuse an Expo token. Only the same authenticated owner
    // may retire its previous installation address, within this transaction.
    await db.batch([
      pushQuery(db, `DELETE FROM workspace_push_devices WHERE installation_id IN (SELECT installation_id FROM workspace_push_devices WHERE workspace_id=? AND person_id=? AND active=0 AND installation_id<>? ORDER BY updated_at LIMIT 4) AND ${guard.sql}`, workspaceId, personId, installationId, ...guard.values),
      pushQuery(db, `UPDATE workspace_push_devices SET active=0,version=version+1,updated_at=? WHERE expo_token=? AND installation_id<>? AND workspace_id=? AND person_id=? AND active=1 AND ${permitted}`, now, payload.expoPushToken, installationId, workspaceId, personId, ...values),
      pushQuery(db, `INSERT INTO workspace_push_devices(installation_id,workspace_id,person_id,session_hash,credential_version,expo_token,project_id,platform,site_index,binding_id,version,active,registered_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,(SELECT site_index FROM workspace_directory_records WHERE workspace_id=? AND kind='employee' AND id=?),?,1,1,?,? WHERE ${permitted}
        ON CONFLICT(installation_id) DO UPDATE SET workspace_id=excluded.workspace_id,person_id=excluded.person_id,session_hash=excluded.session_hash,
          credential_version=excluded.credential_version,expo_token=excluded.expo_token,project_id=excluded.project_id,platform=excluded.platform,site_index=excluded.site_index,binding_id=excluded.binding_id,active=1,
          registered_at=CASE WHEN workspace_push_devices.workspace_id=excluded.workspace_id AND workspace_push_devices.person_id=excluded.person_id THEN workspace_push_devices.registered_at ELSE excluded.registered_at END,
          version=workspace_push_devices.version+1,updated_at=excluded.updated_at
        WHERE (workspace_push_devices.active=0 OR (workspace_push_devices.workspace_id=excluded.workspace_id AND workspace_push_devices.person_id=excluded.person_id))
          AND (workspace_push_devices.active<>1 OR workspace_push_devices.session_hash<>excluded.session_hash OR workspace_push_devices.credential_version<>excluded.credential_version
            OR workspace_push_devices.expo_token<>excluded.expo_token OR workspace_push_devices.project_id<>excluded.project_id OR workspace_push_devices.platform<>excluded.platform)`,
        installationId, workspaceId, personId, session.tokenHash, session.credentialVersion, payload.expoPushToken, configured, payload.platform, workspaceId, personId, crypto.randomUUID(), now, now, ...values),
    ]);
    await readMobileSession({ db, token });
    const saved = await pushFirst(db, `SELECT 1 registered FROM workspace_push_devices WHERE installation_id=? AND workspace_id=? AND person_id=? AND session_hash=? AND expo_token=? AND active=1`, installationId, workspaceId, personId, session.tokenHash, payload.expoPushToken);
    if (!saved) fail(409, 'mobile_push_binding_changed', 'Pushadgangen er ændret. Prøv igen.');
    return { registered: true };
  }
  if (payload.action === 'employeePushUnregister') {
    await db.batch([pushQuery(db, `UPDATE workspace_push_devices SET active=0,version=version+1,updated_at=? WHERE installation_id=? AND workspace_id=? AND person_id=? AND session_hash=? AND active=1 AND ${guard.sql}`, now, installationId, workspaceId, personId, session.tokenHash, ...guard.values)]);
    await readMobileSession({ db, token });
    return { registered: false };
  }
  if (payload.action === 'employeePushTest') {
    const configured = configuredPushProject(projectId);
    if (!configured) fail(503, 'mobile_push_unavailable', 'Pushnotifikationer er ikke klar endnu.');
    const deviceGuard = `EXISTS(SELECT 1 FROM workspace_push_devices WHERE installation_id=? AND workspace_id=? AND person_id=? AND session_hash=? AND project_id=? AND active=1) AND ${guard.sql}`;
    const deviceValues = [installationId, workspaceId, personId, session.tokenHash, configured, ...guard.values];
    if (!await pushFirst(db, 'SELECT 1 valid WHERE ' + deviceGuard, ...deviceValues)) fail(404, 'mobile_push_missing', 'Push er ikke aktiveret på denne telefon.');
    const sourceId = installationId + ':' + Math.floor(now / 60_000);
    await db.batch([
      pushQuery(db, `INSERT INTO workspace_push_events(workspace_id,source_kind,source_id,person_id,created_at,expanded)
        SELECT ?,'test',?,?,?,1 WHERE ${deviceGuard} ON CONFLICT DO NOTHING`, workspaceId, sourceId, personId, now, ...deviceValues),
      pushQuery(db, `INSERT INTO workspace_push_deliveries(event_id,installation_id,workspace_id,person_id,status,due_at,created_at,updated_at)
        SELECT event.event_id,?,event.workspace_id,event.person_id,'pending',?,?,? FROM workspace_push_events event
        WHERE event.workspace_id=? AND event.source_kind='test' AND event.source_id=? AND event.person_id=? AND ${deviceGuard} ON CONFLICT DO NOTHING`,
        installationId, now, now, now, workspaceId, sourceId, personId, ...deviceValues),
    ]);
    await readMobileSession({ db, token });
    if (!await pushFirst(db, "SELECT event_id FROM workspace_push_events WHERE workspace_id=? AND source_kind='test' AND source_id=? AND person_id=?", workspaceId, sourceId, personId)) {
      const error = new StudioError(429, 'mobile_push_test_rate_limited', 'Vent et øjeblik, før du sender en ny testbesked.');error.retryAfterSeconds = 60;throw error;
    }
    return { queued: true };
  }
  if (payload.action !== 'employeePushOpen' || typeof payload.eventId !== 'string' || !pushEventId.test(payload.eventId)) fail(400, 'mobile_push_invalid', 'Notifikationen er ugyldig.');
  const event = await pushFirst(db, `SELECT event.* FROM workspace_push_deliveries delivery JOIN workspace_push_events event ON event.event_id=delivery.event_id
    JOIN workspace_push_devices device ON device.installation_id=delivery.installation_id AND device.workspace_id=delivery.workspace_id AND device.person_id=delivery.person_id AND device.active=1 AND device.binding_id=delivery.binding_id
    WHERE delivery.event_id=? AND delivery.installation_id=? AND delivery.workspace_id=? AND delivery.person_id=? AND device.session_hash=? AND ${guard.sql}`,
    payload.eventId, installationId, workspaceId, personId, session.tokenHash, ...guard.values);
  const target = event ? await pushTarget(db, event, personId) : null;
  await readMobileSession({ db, token });
  if (!target || !await pushFirst(db, `SELECT 1 valid FROM workspace_push_devices WHERE installation_id=? AND workspace_id=? AND person_id=? AND session_hash=? AND active=1`, installationId, workspaceId, personId, session.tokenHash)) fail(404, 'mobile_push_missing', 'Notifikationen er ikke tilgængelig for denne konto.');
  return { target };
}

/** One bounded, point-key-driven read for dispatch; no roster or plan hydration. */
export async function readPushDeliveryTargets(db, deliveries, projectId, now, { leaseToken = null } = {}) {
  if (!deliveries.length) return [];
  const document = JSON.stringify(deliveries.map(row => ({ event: row.event_id, installation: row.installation_id, lease: row.lease_token ?? null })));
  const messageJson = "CASE WHEN json_valid(message.config) THEN message.config ELSE '{}' END";
  const preferencesJson = "CASE WHEN json_valid(preferences.config) THEN preferences.config ELSE '{}' END";
  const departmentJson = "CASE WHEN json_valid(department.catalog) THEN department.catalog ELSE '{}' END";
  const identity = "COALESCE((SELECT member.user_id FROM workspace_members member WHERE member.workspace_id=device.workspace_id AND member.person_id=device.person_id ORDER BY member.user_id LIMIT 1),'mobile-employee:'||device.person_id)";
  const loaded = await pushRows(db, `SELECT delivery.event_id,delivery.installation_id,delivery.workspace_id,delivery.person_id,delivery.lease_token,delivery.attempts,
    event.source_kind,event.created_at event_created_at,event.person_id event_person,event.room_id,
    device.version device_version,device.binding_id,device.expo_token,
    CASE WHEN preferences.person_id IS NULL THEN 1 ELSE json_type(${preferencesJson},'$.notifications')='true' END notifications,
    CASE WHEN preferences.person_id IS NULL THEN 1 ELSE json_type(${preferencesJson},'$.chatNotifications')='true' END chat_notifications,
    CASE WHEN preferences.person_id IS NULL THEN 1 ELSE json_type(${preferencesJson},'$.notifications') IN ('true','false') AND json_type(${preferencesJson},'$.chatNotifications') IN ('true','false') END valid_preferences,
    EXISTS(SELECT 1 FROM workspace_members member WHERE member.workspace_id=device.workspace_id AND member.person_id=device.person_id ORDER BY member.user_id LIMIT 1 OFFSET 1) ambiguous,
    message.kind message_kind,json_extract(${messageJson},'$.personId') message_person,
    COALESCE(receipt.read_at,json_extract(${messageJson},'$.readAt')) read_at,
    json_extract(${messageJson},'$.after.fingerprint') after_fingerprint,published.workflow_fingerprint current_fingerprint,published.id published_id,
    request.id request_id,chat.id chat_id,chat.seq chat_seq,chat.author_id chat_author,${identity} user_id,
    COALESCE(reader.muted,0) muted,COALESCE(reader.last_read_seq,0) read_seq,
    EXISTS(SELECT 1 FROM json_each(${departmentJson},'$.siteIds') site WHERE site.value=employee.site_index) in_department
    FROM json_each(?) selected CROSS JOIN workspace_push_deliveries delivery
    JOIN workspace_push_events event ON event.event_id=delivery.event_id
    JOIN workspace_push_devices device ON device.installation_id=delivery.installation_id AND device.workspace_id=delivery.workspace_id AND device.person_id=delivery.person_id AND device.active=1 AND device.project_id=?
    JOIN workspace_mobile_sessions session ON session.token_hash=device.session_hash AND session.workspace_id=device.workspace_id AND session.person_id=device.person_id AND session.credential_version=device.credential_version AND session.expires_at>?
    JOIN workspace_mobile_credentials credential ON credential.workspace_id=device.workspace_id AND credential.person_id=device.person_id AND credential.version=device.credential_version AND credential.revoked_at IS NULL
    JOIN workspace_directory_records employee ON employee.workspace_id=device.workspace_id AND employee.kind='employee' AND employee.id=device.person_id AND employee.active=1 AND employee.deleted=0
    LEFT JOIN workspace_employee_preferences preferences ON preferences.workspace_id=device.workspace_id AND preferences.person_id=device.person_id
    LEFT JOIN workspace_shift_messages message ON event.source_kind='shift' AND message.workspace_id=event.workspace_id AND message.id=event.source_id AND message.person_id=delivery.person_id
    LEFT JOIN workspace_message_receipts receipt ON receipt.workspace_id=message.workspace_id AND receipt.message_id=message.id AND receipt.person_id=delivery.person_id
    LEFT JOIN workspace_shift_requests request ON message.kind='request' AND request.workspace_id=event.workspace_id AND request.id=json_extract(${messageJson},'$.requestId') AND (request.from_person_id=delivery.person_id OR request.to_person_id=delivery.person_id)
    LEFT JOIN workspace_published_shifts published ON published.workspace_id=event.workspace_id AND published.id=json_extract(${messageJson},'$.after.id') AND published.person_id=delivery.person_id AND published.deleted=0
    LEFT JOIN workspace_chat_messages chat ON event.source_kind='chat' AND chat.workspace_id=event.workspace_id AND chat.room_id=event.room_id AND chat.id=event.source_id AND chat.demo=0
    LEFT JOIN workspace_chat_rooms room ON room.workspace_id=chat.workspace_id AND room.id=chat.room_id AND room.demo=0
    LEFT JOIN workspace_directory_records department ON department.workspace_id=room.workspace_id AND department.kind='department' AND department.id=room.department_id AND department.deleted=0
    LEFT JOIN workspace_chat_readers reader ON reader.workspace_id=room.workspace_id AND reader.room_id=room.id AND reader.user_id=${identity}
    WHERE delivery.event_id=json_extract(selected.value,'$.event') AND delivery.installation_id=json_extract(selected.value,'$.installation')
      ${leaseToken ? "AND device.version=delivery.device_version AND device.binding_id=delivery.binding_id AND delivery.status='sending' AND delivery.lease_token=json_extract(selected.value,'$.lease') AND delivery.lease_until>=? AND EXISTS(SELECT 1 FROM workspace_push_dispatch_state dispatch WHERE dispatch.id='expo' AND dispatch.lease_token=? AND dispatch.lease_until>=?)" : "AND delivery.status='pending'"}
    LIMIT 50`, document, projectId, now, ...(leaseToken ? [now + 10_000, leaseToken, now + 10_000] : []));
  return loaded.filter(row => {
    if (row.ambiguous || row.event_created_at < now - 24 * 60 * 60_000 || row.event_created_at > now + 60_000) return false;
    if (row.source_kind === 'test') return row.valid_preferences === 1 && (row.notifications === 1 || row.chat_notifications === 1) && row.event_person === row.person_id;
    if (row.source_kind === 'chat') return row.chat_notifications === 1 && row.chat_id && row.in_department === 1 && row.chat_author !== row.user_id && !row.muted && row.read_seq < row.chat_seq;
    if (row.notifications !== 1 || row.event_person !== row.person_id || row.message_person !== row.person_id || row.read_at) return false;
    if (row.message_kind === 'cancelled') return true;
    if (row.message_kind === 'request') return Boolean(row.request_id);
    return ['new','changed','moved'].includes(row.message_kind) && Boolean(row.published_id) && (!row.after_fingerprint || row.current_fingerprint === row.after_fingerprint);
  });
}
