/* Opt-in, server-timed reminders. Jobs contain only indexed shift summaries. */
import { createHash } from 'node:crypto';
import Time from '../src/timekeeping-model.js';

const minute = 60_000, day = 24 * 60 * minute;
const LIMIT = 100;
const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = async (db, sql, ...values) => (await db.batch([query(db, sql, ...values)]))[0]?.results ?? [];
export const reminderKinds = Object.freeze(['reminder', 'checkout_reminder']);
export function reminderPreferences(config) {
  const shiftReminders = Object.hasOwn(config, 'shiftReminders') ? config.shiftReminders : false, checkoutReminders = Object.hasOwn(config, 'checkoutReminders') ? config.checkoutReminders : false, reminderLeadMinutes = Object.hasOwn(config, 'reminderLeadMinutes') ? config.reminderLeadMinutes : 30;
  if (typeof shiftReminders !== 'boolean' || typeof checkoutReminders !== 'boolean' || ![15, 30, 60].includes(reminderLeadMinutes)) return null;
  return { shiftReminders, checkoutReminders, reminderLeadMinutes };
}
const preferenceJson = "CASE WHEN json_valid(preferences.config) THEN preferences.config ELSE '{}' END";
const enabled = kind => `json_type(${preferenceJson},'$.${kind === 'reminder' ? 'shiftReminders' : 'checkoutReminders'}')='true'`;
const validPreferences = `json_type(${preferenceJson},'$.notifications') IN ('true','false') AND json_type(${preferenceJson},'$.chatNotifications') IN ('true','false')
  AND (json_type(${preferenceJson},'$.shiftReminders') IS NULL OR json_type(${preferenceJson},'$.shiftReminders') IN ('true','false'))
  AND (json_type(${preferenceJson},'$.checkoutReminders') IS NULL OR json_type(${preferenceJson},'$.checkoutReminders') IN ('true','false'))
  AND (json_type(${preferenceJson},'$.reminderLeadMinutes') IS NULL OR (json_type(${preferenceJson},'$.reminderLeadMinutes') IN ('integer','real') AND json_extract(${preferenceJson},'$.reminderLeadMinutes') IN (15,30,60)))`;
const liveDevice = alias => `EXISTS(SELECT 1 FROM workspace_push_devices device
  JOIN workspace_mobile_sessions session ON session.token_hash=device.session_hash AND session.workspace_id=device.workspace_id AND session.person_id=device.person_id AND session.credential_version=device.credential_version AND session.expires_at>?
  JOIN workspace_mobile_credentials credential ON credential.workspace_id=device.workspace_id AND credential.person_id=device.person_id AND credential.version=device.credential_version AND credential.revoked_at IS NULL
  WHERE device.workspace_id=${alias}.workspace_id AND device.person_id=${alias}.person_id AND device.active=1 AND device.project_id=?)`;
const samePublished = `published.workspace_id=job.workspace_id AND published.id=job.shift_id AND published.person_id=job.person_id AND published.deleted=0
  AND published.work_date=job.work_date AND published.start_time=job.start_time AND published.end_time=job.end_time AND published.site=job.site`;
const noAbsence = `NOT EXISTS(SELECT 1 FROM workspace_absences absence WHERE absence.workspace_id=job.workspace_id AND absence.person_id=job.person_id
  AND absence.status='approved' AND absence.from_date<=job.work_date AND absence.to_date>=job.work_date
  AND (NOT json_valid(absence.config) OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(absence.config) THEN absence.config ELSE '{}' END,'$.days') day WHERE day.value=job.work_date)))`;
const timeState = `((job.kind='reminder' AND NOT EXISTS(SELECT 1 FROM workspace_time_entries entry WHERE entry.workspace_id=job.workspace_id AND entry.shift_id=job.shift_id AND entry.person_id=job.person_id AND entry.demo=0))
  OR (job.kind='checkout_reminder' AND EXISTS(SELECT 1 FROM workspace_time_entries entry WHERE entry.workspace_id=job.workspace_id AND entry.shift_id=job.shift_id AND entry.person_id=job.person_id AND entry.demo=0 AND entry.status IN ('running','paused'))))`;
const kindPreferences = `((job.kind='reminder' AND ${enabled('reminder')} AND COALESCE(json_extract(${preferenceJson},'$.reminderLeadMinutes'),30)=job.lead_minutes)
  OR (job.kind='checkout_reminder' AND ${enabled('checkout_reminder')}))`;
const noEarlierReminder = `NOT EXISTS(SELECT 1 FROM workspace_shift_reminders earlier WHERE earlier.workspace_id=job.workspace_id AND earlier.shift_id=job.shift_id AND earlier.person_id=job.person_id
  AND earlier.work_date=job.work_date AND earlier.start_time=job.start_time AND earlier.end_time=job.end_time AND earlier.site=job.site AND earlier.kind=job.kind AND earlier.status='emitted' AND earlier.id<>job.id)`;
const actorValid = `employee.active=1 AND employee.deleted=0
  AND NOT EXISTS(SELECT 1 FROM workspace_members member WHERE member.workspace_id=job.workspace_id AND member.person_id=job.person_id ORDER BY member.user_id LIMIT 1 OFFSET 1)`;
function identity(row) { return createHash('sha256').update(JSON.stringify([row.workspace_id, row.id, row.person_id, row.work_date, row.start_time, row.end_time, row.site, row.kind, row.lead])).digest('hex'); }

/** Point-key eligibility is reused at the final provider handoff and banner tap. */
export async function readReminderStates(db, references, now, { forDelivery = true } = {}) {
  if (!references.length) return new Map();
  const document = JSON.stringify(references.slice(0, LIMIT).map(row => ({ workspace: row.workspace, id: row.id, person: row.person })));
  const found = await rows(db, `SELECT job.workspace_id,job.id,job.shift_id,job.person_id,job.expires_at FROM json_each(?) chosen
    CROSS JOIN workspace_shift_reminders job
    JOIN workspace_published_shifts published ON ${samePublished}
    JOIN workspace_directory_records employee ON employee.workspace_id=job.workspace_id AND employee.kind='employee' AND employee.id=job.person_id
    LEFT JOIN workspace_employee_preferences preferences ON preferences.workspace_id=job.workspace_id AND preferences.person_id=job.person_id
    WHERE job.workspace_id=json_extract(chosen.value,'$.workspace') AND job.id=json_extract(chosen.value,'$.id') AND job.person_id=json_extract(chosen.value,'$.person')
      AND ${actorValid}${forDelivery ? ` AND ${validPreferences} AND ${kindPreferences} AND ${noAbsence} AND ${timeState} AND ${noEarlierReminder} AND job.due_at<=? AND job.expires_at>?` : ''}
    LIMIT ${LIMIT}`, document, ...(forDelivery ? [now, now] : []));
  return new Map(found.map(row => [row.workspace_id + ':' + row.id + ':' + row.person_id, { shiftId: row.shift_id, expiresAt: row.expires_at }]));
}

async function seedJobs(db, projectId, now) {
  const local = Time.localNow(new Date(now)), from = Time.addDays(local.date, -1), to = Time.addDays(local.date, 1);
  // Global day index bounds the discovery window; the occurrence index advances
  // each bounded batch instead of repeatedly returning the same first shifts.
  const candidates = await rows(db, `SELECT published.workspace_id,published.id,published.person_id,published.work_date,published.start_time,published.end_time,published.site,
    kinds.kind,CASE WHEN kinds.kind='reminder' THEN COALESCE(json_extract(${preferenceJson},'$.reminderLeadMinutes'),30) ELSE 0 END lead
    FROM workspace_published_shifts published INDEXED BY workspace_reminder_published_day
    JOIN workspace_employee_preferences preferences ON preferences.workspace_id=published.workspace_id AND preferences.person_id=published.person_id
    JOIN workspace_directory_records employee ON employee.workspace_id=published.workspace_id AND employee.kind='employee' AND employee.id=published.person_id AND employee.active=1 AND employee.deleted=0
    CROSS JOIN (SELECT 'reminder' kind UNION ALL SELECT 'checkout_reminder') kinds
    WHERE published.deleted=0 AND published.workflow_fingerprint<>'' AND published.work_date BETWEEN ? AND ? AND ${validPreferences}
      AND ((kinds.kind='reminder' AND ${enabled('reminder')}) OR (kinds.kind='checkout_reminder' AND ${enabled('checkout_reminder')}))
      AND ${liveDevice('published')}
      AND NOT EXISTS(SELECT 1 FROM workspace_shift_reminders job WHERE job.workspace_id=published.workspace_id AND job.shift_id=published.id AND job.person_id=published.person_id
        AND job.work_date=published.work_date AND job.start_time=published.start_time AND job.end_time=published.end_time AND job.site=published.site AND job.kind=kinds.kind
        AND (job.lead_minutes=CASE WHEN kinds.kind='reminder' THEN COALESCE(json_extract(${preferenceJson},'$.reminderLeadMinutes'),30) ELSE 0 END OR job.status='emitted') AND (job.status<>'cancelled' OR job.expires_at<=?))
    ORDER BY published.work_date,published.workspace_id,published.id,kinds.kind LIMIT ${LIMIT}`, from, to, now, projectId, now);
  const jobs = candidates.map(row => {
    const start = Time.instantForLocal(row.work_date, row.start_time), end = Time.instantForLocal(row.work_date, row.end_time);
    const valid = start !== null && end !== null && end > start && (row.kind !== 'reminder' || [15, 30, 60].includes(row.lead));
    const due = valid ? row.kind === 'reminder' ? start - row.lead * minute : end + 15 * minute : now;
    const expiry = valid ? row.kind === 'reminder' ? start : end + 2 * 60 * minute : now;
    return { ...row, reminderId: identity(row), due, expiry, status: valid && expiry > now ? 'pending' : 'cancelled' };
  });
  if (jobs.length) await db.batch([query(db, `INSERT INTO workspace_shift_reminders(workspace_id,id,shift_id,person_id,kind,work_date,start_time,end_time,site,lead_minutes,due_at,expires_at,next_at,status,created_at)
    SELECT json_extract(value,'$.workspace_id'),json_extract(value,'$.reminderId'),json_extract(value,'$.id'),json_extract(value,'$.person_id'),json_extract(value,'$.kind'),json_extract(value,'$.work_date'),json_extract(value,'$.start_time'),json_extract(value,'$.end_time'),json_extract(value,'$.site'),json_extract(value,'$.lead'),json_extract(value,'$.due'),json_extract(value,'$.expiry'),json_extract(value,'$.due'),json_extract(value,'$.status'),?
    FROM json_each(?) WHERE 1 ON CONFLICT(workspace_id,id) DO UPDATE SET status='pending',next_at=excluded.next_at,due_at=excluded.due_at,expires_at=excluded.expires_at
      WHERE workspace_shift_reminders.status='cancelled' AND workspace_shift_reminders.expires_at>? AND excluded.status='pending'`, now, JSON.stringify(jobs), now)]);
}

export async function generateShiftReminders(db, projectId, now = Date.now()) {
  await seedJobs(db, projectId, now);
  const due = await rows(db, `SELECT job.*,published.workflow_fingerprint,json_extract(CASE WHEN json_valid(published.time_config) THEN published.time_config ELSE '{}' END,'$.value.plannedBreakMinutes') planned_break,site.catalog site_catalog
    FROM workspace_shift_reminders job LEFT JOIN workspace_published_shifts published ON ${samePublished}
    LEFT JOIN workspace_directory_records site ON site.workspace_id=job.workspace_id AND site.kind='site' AND site.site_index=job.site AND site.deleted=0
    WHERE job.status='pending' AND job.next_at<=? ORDER BY job.next_at,job.workspace_id,job.id LIMIT ${LIMIT}`, now);
  if (!due.length) return { checked: 0, emitted: 0 };
  const eligible = await readReminderStates(db, due.map(job => ({ workspace: job.workspace_id, id: job.id, person: job.person_id })), now);
  const messages = [], stamp = new Date(now).toISOString();
  for (const job of due) {
    const key = job.workspace_id + ':' + job.id + ':' + job.person_id;
    if (job.expires_at <= now || !job.workflow_fingerprint || !eligible.has(key)) continue;
    let siteName = 'Arbejdssted';try { const site = JSON.parse(job.site_catalog);if (typeof site?.name === 'string') siteName = site.name.slice(0, 500); } catch { /* Safe label if archived site has no summary. */ }
    const messageId = 'reminder-' + job.id;
    const message = { id: messageId, personId: job.person_id, kind: job.kind, createdAt: stamp, readAt: null, before: null,
      after: { id: job.shift_id, person: job.person_id, date: job.work_date, start: job.start_time, end: job.end_time, site: job.site, siteName, plannedBreakMinutes: Number.isSafeInteger(job.planned_break) && job.planned_break >= 0 ? job.planned_break : 0, fingerprint: job.workflow_fingerprint },
      summary: job.kind === 'reminder' ? 'Din vagt starter snart.' : 'Husk at stemple ud, når du er færdig.', reminderId: job.id };
    messages.push({ workspace: job.workspace_id, job: job.id, id: messageId, person: job.person_id, kind: job.kind, config: JSON.stringify(message) });
  }
  const selected = JSON.stringify(due.map(job => ({ workspace: job.workspace_id, id: job.id })));
  const chosen = `EXISTS(SELECT 1 FROM json_each(?) chosen WHERE workspace_shift_reminders.workspace_id=json_extract(chosen.value,'$.workspace') AND workspace_shift_reminders.id=json_extract(chosen.value,'$.id'))`;
  // Four set-based statements regardless of batch size. Mutable authority is
  // checked inside the insert transaction, not trusted from the discovery read.
  const statements = [query(db, `UPDATE workspace_shift_reminders SET status='cancelled' WHERE status='pending' AND ${chosen}
    AND (expires_at<=? OR NOT EXISTS(SELECT 1 FROM workspace_published_shifts published
      WHERE published.workspace_id=workspace_shift_reminders.workspace_id AND published.id=workspace_shift_reminders.shift_id AND published.person_id=workspace_shift_reminders.person_id AND published.deleted=0
        AND published.work_date=workspace_shift_reminders.work_date AND published.start_time=workspace_shift_reminders.start_time AND published.end_time=workspace_shift_reminders.end_time AND published.site=workspace_shift_reminders.site AND published.workflow_fingerprint<>''))`, selected, now)];
  statements.push(query(db, `INSERT INTO workspace_shift_messages(workspace_id,id,person_id,kind,created_at,config)
    SELECT job.workspace_id,json_extract(chosen.value,'$.id'),job.person_id,job.kind,?,json_extract(chosen.value,'$.config')
    FROM json_each(?) chosen CROSS JOIN workspace_shift_reminders job
    JOIN workspace_published_shifts published ON ${samePublished}
    JOIN workspace_directory_records employee ON employee.workspace_id=job.workspace_id AND employee.kind='employee' AND employee.id=job.person_id
    LEFT JOIN workspace_employee_preferences preferences ON preferences.workspace_id=job.workspace_id AND preferences.person_id=job.person_id
    WHERE job.workspace_id=json_extract(chosen.value,'$.workspace') AND job.id=json_extract(chosen.value,'$.job') AND job.person_id=json_extract(chosen.value,'$.person')
      AND job.status='pending' AND job.due_at<=? AND job.expires_at>? AND ${actorValid} AND ${validPreferences} AND ${kindPreferences} AND ${noAbsence} AND ${timeState} AND ${noEarlierReminder} AND ${liveDevice('job')}
    ON CONFLICT DO NOTHING`, stamp, JSON.stringify(messages), now, now, now, projectId));
  statements.push(query(db, `UPDATE workspace_shift_reminders SET status='emitted' WHERE status='pending' AND ${chosen}
    AND EXISTS(SELECT 1 FROM workspace_shift_messages message WHERE message.workspace_id=workspace_shift_reminders.workspace_id AND message.id='reminder-'||workspace_shift_reminders.id)`, selected));
  statements.push(query(db, `UPDATE workspace_shift_reminders SET next_at=? WHERE status='pending' AND ${chosen}`, now + 5 * minute, selected));
  const committed = await db.batch(statements);
  return { checked: due.length, emitted: committed[1]?.meta?.changes ?? 0 };
}
