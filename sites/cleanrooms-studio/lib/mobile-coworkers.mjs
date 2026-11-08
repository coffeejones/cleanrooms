/* A colleague list projects only identities and times from one published worksite/day. */
import { StudioError } from './studio-store.mjs';
import Time from '../src/timekeeping-model.js';

const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = async (db, sql, ...values) => (await db.batch([query(db, sql, ...values)]))[0]?.results ?? [];
const first = async (...args) => (await rows(...args))[0] ?? null;
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const changed = () => fail(409, 'mobile_coworkers_changed', 'Vagten eller kollegaerne er ændret. Åbn vagten igen.');
const encode = value => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))));
function decode(value) {
  try {
    if (typeof value !== 'string' || value.length > 8192) throw Error();
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error();
    return result;
  } catch { fail(400, 'mobile_coworkers_cursor_invalid', 'Sidehenvisningen til kollegaerne er ugyldig.'); }
}

async function ownHeader(db, workspaceId, personId, shiftId) {
  return first(db, `SELECT id,scope_key,person_id,work_date,site,version,write_token
    FROM workspace_published_shifts WHERE workspace_id=? AND id=? AND person_id=? AND deleted=0`, workspaceId, shiftId, personId);
}

export async function readMobileCoworkers(db, employee, { shiftId, cursor = null, limit = 50 }) {
  if (typeof shiftId !== 'string' || !shiftId || shiftId.length > 512 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    fail(400, 'mobile_coworkers_invalid', 'Vælg en gyldig vagt og højst 100 kollegaer ad gangen.');
  }
  const { workspaceId, personId } = employee;
  const own = await ownHeader(db, workspaceId, personId, shiftId);
  if (!own) fail(403, 'mobile_coworkers_forbidden', 'Du kan kun se kollegaerne til en vagt, der er udgivet til dig.');
  if (!Time.validDate(own.work_date) || !Number.isInteger(own.site) || own.site < 0 || own.site >= 2000) changed();
  const headers = await db.batch([
    query(db, 'SELECT version,write_token FROM workspace_publication_scopes WHERE workspace_id=? AND scope_key=? AND deleted=0', workspaceId, own.scope_key),
    query(db, 'SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?', workspaceId),
  ]);
  const scope = headers[0]?.results?.[0], directory = headers[1]?.results?.[0];
  if (!scope || !directory) changed();
  const frame = {
    v: 1, workspaceId, personId, shiftId, site: own.site, day: own.work_date,
    shiftVersion: own.version, shiftToken: own.write_token, scopeKey: own.scope_key,
    scopeVersion: scope.version, scopeToken: scope.write_token,
    directoryVersion: directory.version, directoryToken: directory.write_token,
  };
  let after = null;
  if (cursor !== null) {
    const parsed = decode(cursor);
    if (parsed.workspaceId !== workspaceId || parsed.personId !== personId || parsed.shiftId !== shiftId) {
      fail(400, 'mobile_coworkers_cursor_invalid', 'Sidehenvisningen tilhører en anden konto eller vagt.');
    }
    if (Object.keys(frame).some(key => parsed[key] !== frame[key])) changed();
    if (!Array.isArray(parsed.after) || parsed.after.length !== 2 ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(parsed.after[0]) || typeof parsed.after[1] !== 'string' || !parsed.after[1] || parsed.after[1].length > 512) {
      fail(400, 'mobile_coworkers_cursor_invalid', 'Sidehenvisningen til kollegaerne er ugyldig.');
    }
    after = parsed.after;
  }
  // The published scope index restricts this query to one worksite/week, even in very large tenants.
  const found = await rows(db, `SELECT occurrence.id,occurrence.person_id,occurrence.start_time,occurrence.end_time,
      json_extract(employee.catalog,'$.name') AS name,json_extract(employee.catalog,'$.role') AS role
    FROM workspace_published_shifts occurrence INDEXED BY workspace_published_shifts_scope
    JOIN workspace_directory_records employee ON employee.workspace_id=occurrence.workspace_id
      AND employee.kind='employee' AND employee.id=occurrence.person_id AND employee.deleted=0 AND employee.active=1
    WHERE occurrence.workspace_id=? AND occurrence.scope_key=? AND occurrence.deleted=0
      AND occurrence.site=? AND occurrence.work_date=? AND occurrence.person_id<>? AND occurrence.person_id<>''
      ${after ? 'AND (occurrence.start_time>? OR (occurrence.start_time=? AND occurrence.id>?))' : ''}
    ORDER BY occurrence.start_time,occurrence.id LIMIT ?`, workspaceId, own.scope_key, own.site, own.work_date, personId,
    ...(after ? [after[0], after[0], after[1]] : []), limit + 1);
  const selected = found.slice(0, limit);
  if (selected.some(item => typeof item.name !== 'string' || !item.name || typeof item.start_time !== 'string' || typeof item.end_time !== 'string')) changed();
  const current = await db.batch([
    query(db, 'SELECT person_id,work_date,site,version,write_token FROM workspace_published_shifts WHERE workspace_id=? AND id=? AND deleted=0', workspaceId, shiftId),
    query(db, 'SELECT version,write_token FROM workspace_publication_scopes WHERE workspace_id=? AND scope_key=? AND deleted=0', workspaceId, own.scope_key),
    query(db, 'SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?', workspaceId),
  ]);
  const shiftNow = current[0]?.results?.[0], scopeNow = current[1]?.results?.[0], directoryNow = current[2]?.results?.[0];
  if (!shiftNow || shiftNow.person_id !== personId || shiftNow.version !== own.version || shiftNow.write_token !== own.write_token ||
    shiftNow.site !== own.site || shiftNow.work_date !== own.work_date || scopeNow?.version !== scope.version || scopeNow.write_token !== scope.write_token ||
    directoryNow?.version !== directory.version || directoryNow.write_token !== directory.write_token) changed();
  const last = selected.at(-1);
  return {
    colleagues: selected.map(item => ({ id: item.id, personId: item.person_id, name: item.name, role: typeof item.role === 'string' ? item.role : '', start: item.start_time, end: item.end_time })),
    nextCursor: found.length > limit ? encode({ ...frame, after: [last.start_time, last.id] }) : null,
  };
}
