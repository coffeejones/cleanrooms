/* Durable, bounded fanout and provider handoff. A ticket is not a read receipt. */
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { configuredPushProject, pushQuery as query, pushRows as rows, pushFirst as first, readPushDeliveryTargets } from './mobile-push-store.mjs';

const minute = 60_000, day = 24 * 60 * minute;
const BATCH = 50, LEASE = minute, MAX_ATTEMPTS = 5;
const sendUrl = 'https://exp.host/--/api/v2/push/send';
const receiptUrl = 'https://exp.host/--/api/v2/push/getReceipts';
const terminal = "('delivered','cancelled','failed','unknown')";
const safeProviderCode = value => ['DeviceNotRegistered','MessageRateExceeded','MessageTooBig','MismatchSenderId','InvalidCredentials','UNAUTHORIZED'].includes(value) ? value : 'provider_error';
const batchKey = row => [row.event_id, row.installation_id];
const compact = rows => JSON.stringify(rows.map(row => ({ event: row.event_id, installation: row.installation_id })));
const chosen = alias => `EXISTS(SELECT 1 FROM json_each(?) selected WHERE json_extract(selected.value,'$.event')=${alias}.event_id AND json_extract(selected.value,'$.installation')=${alias}.installation_id)`;
const retryAt = (now, attempt) => now + Math.min(60 * minute, 5000 * 2 ** Math.min(attempt, 9));

export function pushServiceAuthorized(request, key) {
  const supplied = request.headers.get('x-cleanrooms-push-key') ?? '';
  return /^[a-f0-9]{64}$/.test(key ?? '') && /^[a-f0-9]{64}$/.test(supplied)
    && timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(supplied, 'hex'));
}


async function expandShiftEvents(db, projectId, now) {
  const events = await rows(db, `SELECT event_id FROM workspace_push_events WHERE expanded=0 AND source_kind IN ('shift','test') ORDER BY created_at,event_id LIMIT 50`);
  if (!events.length) return;
  const document = JSON.stringify(events.map(event => event.event_id));
  // A person has at most eight active addresses. Fifty occurrence events may
  // fan out in one transaction without one query or statement per occurrence.
  await db.batch([
    query(db, `INSERT INTO workspace_push_deliveries(event_id,installation_id,workspace_id,person_id,status,due_at,created_at,updated_at)
      SELECT event.event_id,device.installation_id,event.workspace_id,event.person_id,'pending',?,?,?
      FROM json_each(?) selected CROSS JOIN workspace_push_events event
      JOIN workspace_push_devices device INDEXED BY workspace_push_person
        ON device.workspace_id=event.workspace_id AND device.person_id=event.person_id AND device.active=1 AND device.project_id=? AND device.registered_at<=event.created_at+1
      WHERE event.event_id=selected.value AND event.expanded=0 AND event.source_kind IN ('shift','test')
        AND event.created_at>=? AND event.created_at<=?
        AND (event.source_kind='shift' OR device.installation_id=substr(event.source_id,1,36)) ON CONFLICT DO NOTHING`, now, now, now, document, projectId, now-day, now+minute),
    query(db, `UPDATE workspace_push_events SET expanded=1 WHERE expanded=0 AND source_kind IN ('shift','test') AND event_id IN (SELECT value FROM json_each(?))`, document),
  ]);
}

async function expandChatEvents(db, projectId, now) {
  const events = await rows(db, "SELECT * FROM workspace_push_events WHERE expanded=0 AND source_kind='chat' ORDER BY created_at,event_id LIMIT 3");
  for (const event of events) {
    if (!Number.isSafeInteger(event.created_at) || event.created_at < now - day || event.created_at > now + minute) {
      await db.batch([query(db, 'UPDATE workspace_push_events SET expanded=1 WHERE event_id=?', event.event_id)]);continue;
    }
    let site = null;
    if (event.source_kind === 'chat') {
      const next = await first(db, `SELECT CAST(site.value AS INTEGER) site FROM workspace_chat_rooms room
        JOIN workspace_directory_records department ON department.workspace_id=room.workspace_id AND department.kind='department' AND department.id=room.department_id AND department.deleted=0
        CROSS JOIN json_each(CASE WHEN json_valid(department.catalog) THEN department.catalog ELSE '{}' END,'$.siteIds') site
        WHERE room.workspace_id=? AND room.id=? AND room.demo=0 AND typeof(site.value)='integer' AND site.value>=? ORDER BY site.value LIMIT 1`, event.workspace_id, event.room_id, event.after_site);
      if (!next) { await db.batch([query(db, 'UPDATE workspace_push_events SET expanded=1 WHERE event_id=?', event.event_id)]);continue; }
      site = next.site;
    }
    const after = site !== null && site !== event.after_site ? '' : event.after_installation;
    // A transactional employee-site trigger keeps this secondary index current.
    // Chat visits only sites in this room, never every device in the company.
    const devices = await rows(db, `SELECT installation_id,person_id FROM workspace_push_devices INDEXED BY ${site === null ? 'workspace_push_person' : 'workspace_push_site'}
      WHERE workspace_id=? AND ${site === null ? 'person_id=?' : 'site_index=?'} AND active=1 AND project_id=? AND installation_id>? AND registered_at<=? ORDER BY installation_id LIMIT 51`,
      event.workspace_id, site === null ? event.person_id : site, projectId, after, event.created_at + 1);
    const selected = devices.slice(0, 50);
    const identity = "COALESCE((SELECT member.user_id FROM workspace_members member WHERE member.workspace_id=address.workspace_id AND member.person_id=address.person_id ORDER BY member.user_id LIMIT 1),'mobile-employee:'||address.person_id)";
    const chatGuard = ` AND EXISTS(SELECT 1 FROM workspace_push_devices address
      JOIN workspace_mobile_sessions session ON session.token_hash=address.session_hash AND session.workspace_id=address.workspace_id AND session.person_id=address.person_id AND session.credential_version=address.credential_version AND session.expires_at>?
      JOIN workspace_mobile_credentials credential ON credential.workspace_id=address.workspace_id AND credential.person_id=address.person_id AND credential.version=address.credential_version AND credential.revoked_at IS NULL
      JOIN workspace_directory_records employee ON employee.workspace_id=address.workspace_id AND employee.kind='employee' AND employee.id=address.person_id AND employee.active=1 AND employee.deleted=0 AND employee.site_index=address.site_index
      JOIN workspace_chat_rooms room ON room.workspace_id=address.workspace_id AND room.id=? AND room.demo=0
      JOIN workspace_directory_records department ON department.workspace_id=room.workspace_id AND department.kind='department' AND department.id=room.department_id AND department.deleted=0
      JOIN workspace_chat_messages message ON message.workspace_id=room.workspace_id AND message.room_id=room.id AND message.id=? AND message.demo=0
      LEFT JOIN workspace_chat_readers reader ON reader.workspace_id=room.workspace_id AND reader.room_id=room.id AND reader.user_id=${identity}
      LEFT JOIN workspace_employee_preferences preferences ON preferences.workspace_id=address.workspace_id AND preferences.person_id=address.person_id
      WHERE address.installation_id=json_extract(device.value,'$.installation_id') AND address.workspace_id=? AND address.person_id=json_extract(device.value,'$.person_id') AND address.active=1
        AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(department.catalog) THEN department.catalog ELSE '{}' END,'$.siteIds') site WHERE site.value=employee.site_index)
        AND NOT EXISTS(SELECT 1 FROM workspace_members member WHERE member.workspace_id=address.workspace_id AND member.person_id=address.person_id ORDER BY member.user_id LIMIT 1 OFFSET 1)
        AND (preferences.person_id IS NULL OR json_type(CASE WHEN json_valid(preferences.config) THEN preferences.config ELSE '{}' END,'$.chatNotifications')='true')
        AND message.author_id<>${identity} AND COALESCE(reader.muted,0)=0 AND COALESCE(reader.last_read_seq,0)<message.seq)`;
    const statements = [query(db, `INSERT INTO workspace_push_deliveries(event_id,installation_id,workspace_id,person_id,status,due_at,created_at,updated_at)
      SELECT ?,json_extract(device.value,'$.installation_id'),?,json_extract(device.value,'$.person_id'),'pending',?,?,?
      FROM json_each(?) device WHERE EXISTS(SELECT 1 FROM workspace_push_events WHERE event_id=? AND expanded=0 AND after_installation=?)${site === null ? '' : chatGuard} ON CONFLICT DO NOTHING`,
      event.event_id, event.workspace_id, now, now, now, JSON.stringify(selected), event.event_id, event.after_installation,
      ...(site === null ? [] : [now, event.room_id, event.source_id, event.workspace_id]))];
    const finishedSite = devices.length <= 50;
    statements.push(query(db, `UPDATE workspace_push_events SET after_installation=?,after_site=?,expanded=? WHERE event_id=? AND expanded=0 AND after_installation=? AND after_site=?`,
      site !== null && finishedSite ? '' : selected.at(-1)?.installation_id ?? event.after_installation,
      site === null ? event.after_site : finishedSite ? site + 1 : site,
      Number(site === null && finishedSite), event.event_id, event.after_installation, event.after_site));
    await db.batch(statements);
  }
}

function deliveryOutcome(row, status, now, { due = now, ticket = null, error = null, receiptAttempt = false } = {}) {
  return { event: row.event_id, installation: row.installation_id, lease: row.lease_token,
    status, due, ticket, error, at: now, receiptAttempt: Number(receiptAttempt) };
}

async function applyDeliveryOutcomes(db, outcomes) {
  if (!outcomes.length) return;
  // One JSON-bound UPDATE, not a batch of N statements: each row still has its
  // own event/installation/attempt CAS, including mixed receipts and failures.
  await db.batch([query(db, `UPDATE workspace_push_deliveries AS delivery
    SET status=json_extract(outcome.value,'$.status'),due_at=json_extract(outcome.value,'$.due'),
      ticket_id=COALESCE(json_extract(outcome.value,'$.ticket'),delivery.ticket_id),last_error=json_extract(outcome.value,'$.error'),
      updated_at=json_extract(outcome.value,'$.at'),lease_token=NULL,lease_until=NULL,
      receipt_attempts=delivery.receipt_attempts+json_extract(outcome.value,'$.receiptAttempt')
    FROM json_each(?) outcome WHERE delivery.event_id=json_extract(outcome.value,'$.event')
      AND delivery.installation_id=json_extract(outcome.value,'$.installation') AND delivery.lease_token=json_extract(outcome.value,'$.lease')`, JSON.stringify(outcomes))]);
}

async function disableExactDevices(db, devices, now) {
  if (!devices.length) return;
  await db.batch([query(db, `UPDATE workspace_push_devices SET active=0,version=version+1,updated_at=? WHERE active=1 AND EXISTS(
    SELECT 1 FROM json_each(?) selected WHERE workspace_push_devices.installation_id=json_extract(selected.value,'$.installation')
      AND workspace_push_devices.workspace_id=json_extract(selected.value,'$.workspace') AND workspace_push_devices.person_id=json_extract(selected.value,'$.person')
      AND workspace_push_devices.version=json_extract(selected.value,'$.version') AND workspace_push_devices.binding_id=json_extract(selected.value,'$.binding'))`, now,
    JSON.stringify(devices.map(row => ({ installation: row.installation_id, workspace: row.workspace_id, person: row.person_id, version: row.device_version, binding: row.binding_id }))))]);
}

async function providerJson(requestProvider, url, body, accessToken) {
  const response = await requestProvider(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', Accept: 'application/json',
    ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
  }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (response.status === 429 || response.status >= 500) return { retry: true };
  if (!response.ok) return { error: 'provider_http_' + response.status };
  // The provider is external too. Bound both JSON and response shape before
  // mapping positional tickets to people, and never copy provider text to logs.
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) return { unknown: true };
  const reader = response.body?.getReader();if (!reader) return { unknown: true };
  const chunks = [];let length = 0;
  try { for (;;) { const { value, done } = await reader.read();if (done) break;length += value.length;
    if (length > 256 * 1024) { await reader.cancel();return { unknown: true }; }chunks.push(value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);let offset = 0;for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.length; }
  try { return { body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }; } catch { return { unknown: true }; }
}

async function sendPending(db, projectId, accessToken, requestProvider, now, dispatchLease, timeLeft, health) {
  if (timeLeft() < 1500) return 0;
  const due = await rows(db, `SELECT event_id,installation_id FROM workspace_push_deliveries WHERE status='pending' AND due_at<=? ORDER BY due_at,event_id,installation_id LIMIT ?`, now, BATCH);
  const eligible = await readPushDeliveryTargets(db, due, projectId, now);
  const keys = new Set(eligible.map(row => JSON.stringify(batchKey(row))));
  const cancelled = due.filter(row => !keys.has(JSON.stringify(batchKey(row))));
  if (cancelled.length) await db.batch([query(db, `UPDATE workspace_push_deliveries SET status='cancelled',updated_at=? WHERE status='pending' AND ${chosen('workspace_push_deliveries')}`, now, compact(cancelled))]);
  if (!eligible.length || timeLeft() < 1500) return 0;
  const attempt = crypto.randomUUID(), document = JSON.stringify(eligible.map(row => ({ event: row.event_id, installation: row.installation_id, version: row.device_version, binding: row.binding_id })));
  await db.batch([query(db, `UPDATE workspace_push_deliveries SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,
    binding_id=(SELECT json_extract(selected.value,'$.binding') FROM json_each(?) selected WHERE json_extract(selected.value,'$.event')=workspace_push_deliveries.event_id AND json_extract(selected.value,'$.installation')=workspace_push_deliveries.installation_id),device_version=(SELECT json_extract(selected.value,'$.version') FROM json_each(?) selected WHERE json_extract(selected.value,'$.event')=workspace_push_deliveries.event_id AND json_extract(selected.value,'$.installation')=workspace_push_deliveries.installation_id),sent_at=?,updated_at=?
    WHERE status='pending' AND due_at<=? AND ${chosen('workspace_push_deliveries')}
      AND EXISTS(SELECT 1 FROM workspace_push_dispatch_state dispatch WHERE dispatch.id='expo' AND dispatch.lease_token=? AND dispatch.lease_until>=?)`,
    attempt, now + LEASE, document, document, now, now, now, compact(eligible), dispatchLease, now + 10_000)]);
  for (const row of eligible) row.lease_token = attempt;
  const ready = await readPushDeliveryTargets(db, eligible, projectId, Date.now(), { leaseToken: dispatchLease });
  const readyKeys = new Set(ready.map(row => JSON.stringify(batchKey(row))));
  await applyDeliveryOutcomes(db, eligible.filter(row => !readyKeys.has(JSON.stringify(batchKey(row)))).map(row => deliveryOutcome(row, 'cancelled', now)));
  if (!ready.length) return 0;
  if (timeLeft() < 1500) {
    await applyDeliveryOutcomes(db, ready.map(row => deliveryOutcome(row, 'pending', now, { due: now + 5000, error: 'dispatch_budget' })));return 0;
  }
  const messages = ready.map(row => ({ to: row.expo_token, title: row.source_kind === 'test' ? 'CleanRooms' : row.source_kind === 'chat' ? 'Ny besked' : 'Vagtplanen er opdateret',
    body: row.source_kind === 'test' ? 'Beskeder virker på denne telefon.' : row.source_kind === 'chat' ? 'Der er nyt i en af dine samtaler.' : 'Åbn CleanRooms for at se ændringen.',
    sound: 'default', ttl: 24 * 60 * 60, channelId: 'cleanrooms', collapseId: row.event_id, tag: row.event_id,
    data: { v: 1, eventId: row.event_id, installationId: row.installation_id } }));
  let result;
  try { result = await providerJson(requestProvider, sendUrl, messages, accessToken); }
  catch { result = { unknown: true }; }
  if (result.retry || result.error || result.unknown) {
    if (result.error) health.providerError = result.error;
    await applyDeliveryOutcomes(db, ready.map(row => deliveryOutcome(row, result.retry && row.attempts < MAX_ATTEMPTS ? 'pending' : result.unknown ? 'unknown' : 'failed', now,
      { due: retryAt(now, row.attempts), error: result.retry ? 'provider_temporary' : result.error ?? 'send_unconfirmed' })));
    return ready.length;
  }
  const tickets = result.body?.data;
  if (!Array.isArray(tickets) || tickets.length !== ready.length || tickets.some(ticket => !ticket || !['ok','error'].includes(ticket.status)
    || ticket.status === 'ok' && (typeof ticket.id !== 'string' || ticket.id.length < 1 || ticket.id.length > 200))) {
    await applyDeliveryOutcomes(db, ready.map(row => deliveryOutcome(row, 'unknown', now, { error: 'ticket_unconfirmed' })));return ready.length;
  }
  health.checked = true;
  const invalidDevices = [], outcomes = [];
  for (let index = 0; index < ready.length; index++) {
    const row = ready[index], ticket = tickets[index];
    if (ticket.status === 'ok') outcomes.push(deliveryOutcome(row, 'receipt', now, { ticket: ticket.id, due: now + 15 * minute }));
    else {
      const code = safeProviderCode(ticket.details?.error);
      if (['InvalidCredentials','MismatchSenderId','UNAUTHORIZED'].includes(code)) health.providerError = code;
      if (code === 'DeviceNotRegistered') invalidDevices.push(row);
      outcomes.push(deliveryOutcome(row, code === 'MessageRateExceeded' && row.attempts < MAX_ATTEMPTS ? 'pending' : 'failed', now, { due: retryAt(now, row.attempts), error: code }));
    }
  }
  await applyDeliveryOutcomes(db, outcomes);
  await disableExactDevices(db, invalidDevices, now);
  return ready.length;
}

async function checkReceipts(db, accessToken, requestProvider, now, health) {
  const due = await rows(db, `SELECT * FROM workspace_push_deliveries WHERE status='receipt' AND due_at<=? ORDER BY due_at,event_id,installation_id LIMIT ?`, now, BATCH);
  if (!due.length) return 0;
  const lease = crypto.randomUUID();
  await db.batch([query(db, `UPDATE workspace_push_deliveries SET lease_token=?,lease_until=? WHERE status='receipt' AND (lease_until IS NULL OR lease_until<=?) AND ${chosen('workspace_push_deliveries')}`, lease, now + LEASE, now, compact(due))]);
  const claimed = await rows(db, 'SELECT * FROM workspace_push_deliveries WHERE lease_token=? ORDER BY event_id,installation_id LIMIT ?', lease, BATCH);
  if (!claimed.length) return 0;
  let result;try { result = await providerJson(requestProvider, receiptUrl, { ids: claimed.map(row => row.ticket_id) }, accessToken); } catch { result = { retry: true }; }
  if (result.error) health.providerError = result.error;
  const receipts = result.body?.data, invalidDevices = [], outcomes = [];
  if (receipts && typeof receipts === 'object' && !Array.isArray(receipts)) health.checked = true;
  for (const row of claimed) {
    const receipt = receipts && typeof receipts === 'object' && !Array.isArray(receipts) ? receipts[row.ticket_id] : null;
    if (!receipt || !['ok','error'].includes(receipt.status)) {
      const expired = now - row.sent_at >= 23 * 60 * minute || row.receipt_attempts >= 12;
      outcomes.push(deliveryOutcome(row, expired ? 'unknown' : 'receipt', now, { due: now + 15 * minute, error: expired ? 'receipt_unconfirmed' : 'receipt_pending', receiptAttempt: true }));continue;
    }
    if (receipt.status === 'ok') outcomes.push(deliveryOutcome(row, 'delivered', now));
    else {
      const code = safeProviderCode(receipt.details?.error);
      if (['InvalidCredentials','MismatchSenderId','UNAUTHORIZED'].includes(code)) health.providerError = code;
      if (code === 'DeviceNotRegistered') invalidDevices.push(row);
      outcomes.push(deliveryOutcome(row, code === 'MessageRateExceeded' && row.attempts < MAX_ATTEMPTS ? 'pending' : 'failed', now, { due: retryAt(now, row.attempts), error: code, receiptAttempt: true }));
    }
  }
  await applyDeliveryOutcomes(db, outcomes);
  await disableExactDevices(db, invalidDevices, now);
  return claimed.length;
}

export async function drainPushOutbox({ db, projectId, accessToken, requestProvider = fetch, now = Date.now() }) {
  const project = configuredPushProject(projectId);
  if (!db || !project) return { configured: false };
  const started = performance.now(), timeLeft = () => 25_000 - (performance.now() - started);
  const provider = (url, options) => timeLeft() < 1000 ? Promise.resolve(new Response('', { status: 503 }))
    : requestProvider(url, { ...options, signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(8000, timeLeft())))) });
  const lease = crypto.randomUUID();
  const lock = await db.batch([query(db, `UPDATE workspace_push_dispatch_state SET lease_token=?,lease_until=?,next_at=?,last_started_at=? WHERE id='expo' AND lease_until<=? AND next_at<=?`, lease, now + LEASE, now + 1000, now, now, now)]);
  if (lock[0]?.meta?.changes !== 1) return { configured: true, busy: true };
  let failure = null;const health = { checked: false, providerError: null };
  try {
    // A dead worker may have transmitted before it vanished. Unknown is visible
    // to operations and the durable inbox remains authoritative; do not duplicate.
    await db.batch([query(db, `UPDATE workspace_push_deliveries SET status='unknown',last_error='send_unconfirmed',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE status='sending' AND lease_until<=?`, now, now)]);
    await expandShiftEvents(db, project, now);
    await expandChatEvents(db, project, now);
    const receipts = await checkReceipts(db, accessToken, provider, now, health);
    const sent = await sendPending(db, project, accessToken, provider, now, lease, timeLeft, health);
    await db.batch([
      query(db, `DELETE FROM workspace_push_deliveries WHERE (event_id,installation_id) IN (SELECT event_id,installation_id FROM workspace_push_deliveries WHERE status IN ${terminal} AND updated_at<? ORDER BY updated_at LIMIT 100)`, now - 30 * day),
      query(db, `DELETE FROM workspace_push_events WHERE event_id IN (SELECT event_id FROM workspace_push_events event WHERE expanded=1 AND created_at<? AND NOT EXISTS(SELECT 1 FROM workspace_push_deliveries delivery WHERE delivery.event_id=event.event_id) ORDER BY created_at LIMIT 100)`, now - 30 * day),
    ]);
    return { configured: true, sent, receipts };
  } catch (error) {
    failure = 'dispatch_failed';throw error;
  } finally {
    await db.batch([query(db, `UPDATE workspace_push_dispatch_state SET lease_token=NULL,lease_until=0,last_error=?,last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,last_provider_error=CASE WHEN ? IS NOT NULL THEN ? WHEN ?=1 THEN NULL ELSE last_provider_error END WHERE id='expo' AND lease_token=?`, failure, failure, now, health.providerError, health.providerError, Number(health.checked), lease)]);
  }
}

export function wakePushOutbox(env, ctx) {
  if (!env.DB || !configuredPushProject(env.EXPO_PROJECT_ID)) return;
  ctx.waitUntil(drainPushOutbox({ db: env.DB, projectId: env.EXPO_PROJECT_ID, accessToken: env.EXPO_PUSH_ACCESS_TOKEN })
    .then(async result => { if (result.configured && (await readPushDispatchHealth(env.DB)).needsAttention) console.warn(JSON.stringify({ event: 'push_dispatch_backlog' })); })
    .catch(() => console.error(JSON.stringify({ event: 'push_dispatch_failed' }))));
}

export async function handlePushDispatchRequest(request, env, requestProvider = fetch) {
  const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
  if (!pushServiceAuthorized(request, env.PUSH_DISPATCH_KEY)) return Response.json({ error: 'not_found' }, { status: 404, headers });
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) return Response.json({ error: 'push_request_invalid' }, { status: 400, headers });
  const reader = request.body.getReader(), bytes = new Uint8Array(2048);let length = 0;
  try { for (;;) { const { done, value } = await reader.read();if (done) break;
    if (length + value.length > bytes.length) { await reader.cancel();return Response.json({ error: 'push_request_invalid' }, { status: 413, headers }); }
    bytes.set(value, length);length += value.length;
  } } finally { reader.releaseLock(); }
  if (new TextDecoder().decode(bytes.subarray(0, length)) !== '{}') return Response.json({ error: 'push_request_invalid' }, { status: 400, headers });
  try {
    const result = await drainPushOutbox({ db: env.DB, projectId: env.EXPO_PROJECT_ID, accessToken: env.EXPO_PUSH_ACCESS_TOKEN, requestProvider });
    return Response.json(result.configured ? { ok: true } : { error: 'push_unavailable' }, { status: result.configured ? 200 : 503, headers });
  } catch {
    console.error(JSON.stringify({ event: 'push_dispatch_failed' }));
    return Response.json({ error: 'push_unavailable' }, { status: 503, headers });
  }
}

export async function readPushDispatchHealth(db, now = Date.now()) {
  const state = await first(db, `SELECT last_started_at,last_success_at,last_error,last_provider_error,
    (SELECT due_at FROM workspace_push_deliveries WHERE status='pending' ORDER BY due_at LIMIT 1) pending_due,
    (SELECT due_at FROM workspace_push_deliveries WHERE status='receipt' ORDER BY due_at LIMIT 1) receipt_due,
    (SELECT created_at FROM workspace_push_events WHERE expanded=0 ORDER BY created_at LIMIT 1) event_due
    FROM workspace_push_dispatch_state WHERE id='expo'`);
  const due = [state?.pending_due, state?.receipt_due, state?.event_due].filter(value => Number.isSafeInteger(value));
  const oldestDueAt = due.length ? Math.min(...due) : null;
  return { lastWakeAt: state?.last_started_at ?? null, lastSuccessAt: state?.last_success_at ?? null,
    lastError: state?.last_error ?? null, lastProviderError: state?.last_provider_error ?? null, oldestDueAt,
    needsAttention: Boolean(state?.last_error || state?.last_provider_error || oldestDueAt !== null && oldestDueAt < now - 15 * minute) };
}
