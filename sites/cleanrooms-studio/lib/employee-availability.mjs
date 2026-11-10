/* Account-owned all-day marks are warnings in planning and constraints on new transfers. */
import {isScoped,personPredicate} from './department-access.mjs';
import Time from '../src/timekeeping-model.js';
import Directory from '../src/directory-records.js';
import Data from '../src/studio-data.js';
import { StudioError } from './studio-store.mjs';

const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = async (db, sql, ...values) => (await db.batch([query(db, sql, ...values)]))[0]?.results ?? [];
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const changed = () => fail(409, 'employee_availability_changed', 'Tilgængeligheden er ændret. Hent oplysningerne igen.');

/** Project only availability dates, never notification choices or another preference field. */
export async function readEmployeeAvailability({ db, workspaceId, personIds, from = null, to = null }) {
  const ids = [...new Set(personIds)];
  if (ids.length > 500 || ids.some(id => !Directory.validId('employee', id))) fail(400, 'employee_availability_people_invalid', 'Vælg højst 500 medarbejdere.');
  if (!ids.length) return [];
  let found;
  try {
    found = await rows(db, `SELECT chosen.value AS person_id, preference.version,
      json_type(preference.config,'$.unavailableDates') AS dates_type,
      json_array_length(preference.config,'$.unavailableDates') AS date_count,
      (SELECT json_group_array(mark.value) FROM json_each(preference.config,'$.unavailableDates') mark
        WHERE (? IS NULL OR mark.value>=?) AND (? IS NULL OR mark.value<=?)) AS dates
      FROM json_each(?) chosen LEFT JOIN workspace_employee_preferences preference
        ON preference.workspace_id=? AND preference.person_id=chosen.value`, from, from, to, to, JSON.stringify(ids), workspaceId);
  } catch { fail(503, 'employee_availability_invalid', 'Tilgængeligheden kunne ikke læses sikkert. Prøv igen.'); }
  return found.map(row => {
    let dates;
    try { dates = JSON.parse(row.dates); } catch { fail(503, 'employee_availability_invalid', 'Tilgængeligheden kunne ikke læses sikkert. Prøv igen.'); }
    if (row.version !== null && (!Number.isSafeInteger(row.version) || row.version < 1 || row.dates_type !== 'array'
      || !Number.isSafeInteger(row.date_count) || row.date_count > 730)
      || !Array.isArray(dates) || dates.some(date => !Time.validDate(date))) fail(503, 'employee_availability_invalid', 'Tilgængeligheden kunne ikke læses sikkert. Prøv igen.');
    return { personId: row.person_id, version: row.version ?? 0, unavailableDates: [...new Set(dates)].sort() };
  });
}

/** Missing preferences are a versioned fact: a concurrent first insert also invalidates a write. */
export function employeeAvailabilityGuard(workspaceId, snapshots) {
  const expected = snapshots.map(({ personId, version }) => ({ personId, version }));
  return { sql: `NOT EXISTS (SELECT 1 FROM json_each(?) expected
      LEFT JOIN workspace_employee_preferences preference ON preference.workspace_id=?
        AND preference.person_id=json_extract(expected.value,'$.personId')
      WHERE (json_extract(expected.value,'$.version')=0 AND preference.person_id IS NOT NULL)
        OR (json_extract(expected.value,'$.version')>0 AND
          (preference.version IS NULL OR preference.version<>json_extract(expected.value,'$.version'))))`,
    values: [JSON.stringify(expected), workspaceId] };
}

/** Calendar dates with actual work, in the schedule's Copenhagen wall-clock calendar. */
export function shiftAvailabilityDates(shift) {
  if (!Time.validDate(shift?.date) || Time.minute(shift.start) === null || Time.minute(shift.end) === null) return [];
  const endDate = shift.endDate ?? (shift.end < shift.start ? Time.addDays(shift.date, 1) : shift.date);
  const span = Time.span({ ...shift, endDate });
  if (!span) return [shift.date];
  return Array.from({ length: Math.floor((span.end - 1) / 1440) + 1 }, (_, index) => Time.addDays(shift.date, index));
}

export function unavailableShiftDate(snapshot, shift) {
  const dates = new Set(snapshot?.unavailableDates ?? []);
  return shiftAvailabilityDates(shift).find(date => dates.has(date)) ?? null;
}

export function availabilityMessage(date) {
  return 'Medarbejderen er utilgængelig den ' + date.slice(8) + '.' + date.slice(5, 7) + '.' + date.slice(0, 4) + '.';
}

/** Explicit current employees and a short visible period; no company-wide preferences scan. */
export async function readPlanningAvailability({ db, context, payload, helpers: h }) {
  if (!h.capabilities(context).plan) fail(403, 'planning_availability_forbidden', 'Kun en planlægger kan se medarbejdernes tilgængelighed.');
  const { from, to, personIds } = payload;
  if (!Time.validDate(from) || !Time.validDate(to) || from < Data.minDate || to > Data.maxDate || from > to
    || Date.parse(to) - Date.parse(from) >= 56 * 86400000) fail(400, 'planning_availability_period_invalid', 'Vælg højst 56 gyldige kalenderdage.');
  if (!Array.isArray(personIds) || personIds.length > 500 || personIds.some(id => !Directory.validId('employee', id))) fail(400, 'planning_availability_people_invalid', 'Vælg højst 500 medarbejdere.');
  const workspaceId = context.workspace.id;
  const directory = async () => (await rows(db, 'SELECT version,write_token FROM workspace_directory_state WHERE workspace_id=?', workspaceId))[0] ?? null;
  const before = await directory();
  const access=personPredicate(context,'employee.id');
  const selected = await rows(db, `SELECT employee.id FROM json_each(?) chosen CROSS JOIN workspace_directory_records employee
    WHERE employee.workspace_id=? AND employee.kind='employee' AND employee.id=chosen.value AND employee.deleted=0 AND (${access.sql})`, JSON.stringify([...new Set(personIds)]), workspaceId,...access.values);
  if(isScoped(context)&&selected.length!==new Set(personIds).size)fail(403,'department_person_forbidden','En medarbejder ligger uden for dine afdelinger.');
  const people = await readEmployeeAvailability({ db, workspaceId, personIds: selected.map(employee => employee.id), from, to });
  const guard = employeeAvailabilityGuard(workspaceId, people);
  if (!(await rows(db, `SELECT 1 AS valid WHERE ${guard.sql}`, ...guard.values))[0]) changed();
  if (JSON.stringify(before) !== JSON.stringify(await directory())) changed();
  await h.assertContext(db, context);
  return { from, to, directoryRevision: before?.version ?? 0, people };
}
