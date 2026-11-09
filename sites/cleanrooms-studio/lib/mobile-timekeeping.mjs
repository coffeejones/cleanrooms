import { timeActivityStatements } from './activity-store.mjs';
import { readMobileSession } from './mobile-auth-store.mjs';
import { readPublishedTimeShifts } from './publication-time-store.mjs';
import { StudioError, readRawStudio } from './studio-store.mjs';
import { findTimeEntry, ensureTimeEntries } from './time-entry-store.mjs';
import { handleTimekeepingAction } from './timekeeping-store.mjs';
import { readDirectorySite } from './directory-store.mjs';
import { mobileEmployeeChatContext } from './mobile-chat.mjs';
import Time from '../src/timekeeping-model.js';

const operations = new Set(['start', 'pause', 'resume', 'finish', 'submit']);
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const first = async (db, sql, ...values) => (await db.batch([statement(db, sql, ...values)]))[0]?.results?.[0] ?? null;

function receipt(entry) {
  const measuredAt = Date.now();
  const end = entry.status === 'paused' ? Date.parse(entry.pauseAt) : entry.clockEndAt ? Date.parse(entry.clockEndAt) : measuredAt;
  const workedSeconds = entry.clockStartAt && Number.isFinite(end) ? Math.max(0, Math.floor((end - Date.parse(entry.clockStartAt)) / 1000) - entry.breakMinutes * 60) : 0;
  return {
    version: entry.version, status: entry.status, clockIn: entry.clockStartAt ?? null,
    clockOut: entry.clockEndAt ?? null, pauseAt: entry.pauseAt ?? null,
    workedSeconds, measuredAt,
    comment: entry.comment ?? '',
    rejectionReason: entry.status === 'rejected' ? [...(entry.audit ?? [])].reverse().find(event => event.operation === 'reject')?.reason ?? '' : '',
  };
}

export async function readMobileTimeEntries(db, { workspaceId, personId }, ids) {
  if (!ids.length) return {};
  const result = await db.batch([statement(db, `SELECT shift_id,version,status,
    json_extract(config,'$.personId') AS stored_person,json_extract(config,'$.shiftId') AS stored_shift,
    json_extract(config,'$.clockStartAt') AS clock_start,json_extract(config,'$.clockEndAt') AS clock_end,
    json_extract(config,'$.pauseAt') AS pause_at,json_extract(config,'$.breakMinutes') AS break_minutes
    FROM workspace_time_entries
    WHERE workspace_id=? AND person_id=? AND demo=0 AND shift_id IN (SELECT value FROM json_each(?))`, workspaceId, personId, JSON.stringify(ids))]);
  const entries = {};
  for (const row of result[0]?.results ?? []) {
    if (row.stored_person !== personId || row.stored_shift !== row.shift_id || !Number.isSafeInteger(row.break_minutes)) fail(503, 'mobile_time_invalid', 'Registreringen kunne ikke læses.');
    const entry = { version: row.version, status: row.status, clockStartAt: row.clock_start, clockEndAt: row.clock_end, pauseAt: row.pause_at, breakMinutes: row.break_minutes };
    entries[row.shift_id] = receipt(entry);
  }
  return entries;
}

export async function readMobileTimeEntry(db, { workspaceId, personId }, shiftId) {
  const entry = await findTimeEntry({ db, workspaceId, shiftId });
  return entry && !entry.demo && entry.personId === personId ? receipt(entry) : null;
}

/** Original attendance owns its frozen assignment after cancellation or reassignment. */
export async function readMobileRecoveryShift(db, employee, shiftId) {
  const entry = await findTimeEntry({ db, workspaceId: employee.workspaceId, shiftId });
  if (!entry || entry.demo || entry.personId !== employee.personId) return null;
  const frozen = entry.frozenShift ?? { id: entry.shiftId, person: entry.personId, date: entry.date, site: entry.site,
    start: entry.plannedStart, end: entry.plannedEnd, plannedBreakMinutes: entry.plannedBreakMinutes ?? 0 };
  if (frozen.id !== shiftId || frozen.person !== employee.personId || !Time.validDate(frozen.date)
    || Time.minute(frozen.start) === null || Time.minute(frozen.end) === null || frozen.end === frozen.start || !Number.isInteger(frozen.site)) {
    fail(503, 'mobile_time_invalid', 'Registreringens oprindelige vagt kunne ikke læses sikkert.');
  }
  const place = await readDirectorySite({ db, workspaceId: employee.workspaceId, siteIndex: frozen.site });
  return { id: frozen.id, personId: employee.personId, date: frozen.date, start: frozen.start, end: frozen.end,
    breakMinutes: frozen.plannedBreakMinutes ?? 0,
    site: { id: place?.id ?? 'site-' + frozen.site, name: place?.name ?? 'Arbejdssted', address: place?.address ?? '' },
    description: '', checklist: [], completedTaskIds: [], clockInRadius: null, entry: receipt(entry) };
}

export async function readMobileActiveTime(db, token, session) {
  const { context, helpers } = await mobileEmployeeChatContext(db, token, session);
  const head = await first(db, `SELECT workspace.snapshot_owner_id,plan.revision FROM workspaces workspace
    JOIN studio_states plan ON plan.owner_id=workspace.snapshot_owner_id WHERE workspace.id=?`, context.workspace.id);
  if (!head) fail(409, 'time_context_changed', 'Registreringen kunne ikke indlæses. Prøv igen.');
  context.workspace.snapshotOwnerId = head.snapshot_owner_id;
  context.saved = { revision: head.revision, studio: {} };
  await ensureTimeEntries({ db, workspaceId: context.workspace.id, context, helpers: { ...helpers, ensureOperationalSource: async current => {
    const raw = await readRawStudio(db, current.workspace.snapshotOwnerId);
    if (raw.revision !== current.saved.revision) fail(409, 'time_context_changed', 'Registreringerne er ændret. Prøv igen.');
    current.saved = raw; return raw;
  } } });
  const found = await db.batch([statement(db, `SELECT id,shift_id,version,write_token FROM workspace_time_entries
    WHERE workspace_id=? AND person_id=? AND demo=0 AND status IN ('running','paused') LIMIT 2`, session.employee.workspaceId, session.employee.personId)]);
  const entries = found[0]?.results ?? [];
  if (entries.length > 1) fail(409, 'time_active_conflict', 'Der er flere igangværende registreringer. Kontakt planlæggeren.');
  const current = entries[0], shift = current ? await readMobileRecoveryShift(db, session.employee, current.shift_id) : null;
  if (current && (!shift || shift.entry.version !== current.version || !['running','paused'].includes(shift.entry.status)
    || !await first(db, `SELECT id FROM workspace_time_entries WHERE workspace_id=? AND person_id=? AND id=? AND version=? AND write_token=?
      AND demo=0 AND status IN ('running','paused')`, session.employee.workspaceId, session.employee.personId, current.id, current.version, current.write_token))) {
    fail(409, 'time_conflict', 'Registreringen er ændret. Hent den igen.');
  }
  await helpers.assertContext();
  return { shift };
}

export async function writeMobileTimeEntry(db, token, session, payload) {
  const { employee: { workspaceId, personId, name }, tokenHash, credentialVersion } = session;
  const { operation, shiftId, version, comment, location } = payload;
  if (!operations.has(operation) || typeof shiftId !== 'string' || !shiftId.trim() || shiftId.length > 512
    || !Number.isSafeInteger(version) || version < 0 || (comment !== null && (!['finish','submit'].includes(operation) || typeof comment !== 'string'))
    || (location !== null && (operation !== 'start' || typeof location !== 'object' || Array.isArray(location)))) {
    fail(400, 'mobile_time_invalid', 'Vælg en gyldig vagt og handling.');
  }
  if (location?.mocked === true) fail(400, 'time_location_invalid', 'Simuleret GPS kan ikke bruges til indstempling.');
  const ownEntry = operation === 'start' ? null : await readMobileTimeEntry(db, session.employee, shiftId);
  if (operation === 'submit' && (!ownEntry || ownEntry.status !== 'rejected' || typeof comment !== 'string' || !comment.trim())) fail(409, 'time_state_invalid', 'Skriv en forklaring til den returnerede registrering.');
  if (!ownEntry && !(await readPublishedTimeShifts({ db, workspaceId, personId, ids: [shiftId] })).length) {
    fail(403, 'time_shift_forbidden', 'Vagten er ikke tildelt din konto.');
  }
  const row = await first(db, `SELECT workspace.snapshot_owner_id, plan.revision
    FROM workspaces workspace JOIN studio_states plan ON plan.owner_id = workspace.snapshot_owner_id
    WHERE workspace.id = ?`, workspaceId);
  if (!row) fail(409, 'time_context_changed', 'Vagtplanen kunne ikke indlæses. Prøv igen.');
  const context = {
    workspace: { id: workspaceId, snapshotOwnerId: row.snapshot_owner_id },
    member: { personId },
    saved: { revision: row.revision },
  };
  // Check the same live credential, employee and expiry inside the attendance transaction.
  const actorGuard = () => ({
    sql: `EXISTS (SELECT 1 FROM workspace_mobile_sessions mobile
      JOIN workspace_mobile_credentials credential ON credential.workspace_id = mobile.workspace_id
        AND credential.person_id = mobile.person_id AND credential.version = mobile.credential_version
        AND credential.revoked_at IS NULL
      JOIN workspace_directory_records employee ON employee.workspace_id = mobile.workspace_id
        AND employee.kind = 'employee' AND employee.id = mobile.person_id AND employee.deleted = 0 AND employee.active = 1
      WHERE mobile.token_hash = ? AND mobile.workspace_id = ? AND mobile.person_id = ?
        AND mobile.credential_version = ? AND mobile.expires_at > (julianday('now') - 2440587.5) * 86400000)`,
    values: [tokenHash, workspaceId, personId, credentialVersion],
  });
  const ensureOperationalSource = async current => {
    const saved = await readRawStudio(db, current.workspace.snapshotOwnerId);
    if (saved.revision !== current.saved.revision) fail(409, 'time_context_changed', 'Vagtplanen er ændret. Prøv igen.');
    current.saved = saved;
    return saved;
  };
  const result = await handleTimekeepingAction({
    db, context,
    payload: {
      action: 'timeWrite', operation: operation === 'submit' ? 'comment' : operation, shiftId, version,
      ...(comment !== null ? { comment } : {}),
      ...(location !== null ? { location } : {}),
    },
    principal: { userId: 'mobile-employee:' + personId, name },
    helpers: {
      capabilities: () => ({ plan: false, viewPayroll: false }),
      actorGuard, assertContext: () => readMobileSession({ db, token }),
      fail, statement, first, ensureOperationalSource, timeActivityStatements,
    },
  });
  return { entry: receipt(result.entry) };
}
