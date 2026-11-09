import { mobileEmployeeChatContext } from './mobile-chat.mjs';
import { StudioError, readRawStudio } from './studio-store.mjs';
import { readEmployeePublishedShift } from './publication-store.mjs';
import { handleChecklistAction, readChecklistProgress } from './engagement-store.mjs';
import Checklist from '../src/checklist-progress.js';
import Time from '../src/timekeeping-model.js';
import { createHash } from 'node:crypto';
import { reminderPreferences } from './shift-reminders.mjs';

const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const first = async (db, sql, ...values) => (await db.batch([query(db, sql, ...values)]))[0]?.results?.[0] ?? null;
const defaults = () => ({ version: 0, notifications: true, chatNotifications: true, shiftReminders: false, checkoutReminders: false, reminderLeadMinutes: 30, unavailableDates: [] });
const checklistToken = view => createHash('sha256').update(view.signature).digest('hex');

async function preferences(db, { workspaceId, personId }) {
  const row = await first(db, 'SELECT version,config FROM workspace_employee_preferences WHERE workspace_id=? AND person_id=?', workspaceId, personId);
  if (!row) return defaults();
  let config;
  try { config = JSON.parse(row.config); } catch { fail(503, 'employee_preferences_invalid', 'Indstillingerne kunne ikke læses. Prøv igen.'); }
  if (typeof config?.notifications !== 'boolean' || typeof config?.chatNotifications !== 'boolean' || !Array.isArray(config.unavailableDates)
    || config.unavailableDates.some(date => !Time.validDate(date))) fail(503, 'employee_preferences_invalid', 'Indstillingerne kunne ikke læses. Prøv igen.');
  const reminders = reminderPreferences(config);
  if (!reminders) fail(503, 'employee_preferences_invalid', 'Indstillingerne kunne ikke læses. Prøv igen.');
  return { ...config, ...reminders, version: row.version };
}

export async function handleMobileEmployeeState(db, token, session, payload) {
  const { context, helpers } = await mobileEmployeeChatContext(db, token, session);
  const { workspaceId, personId } = session.employee;
  if (payload.action === 'employeePreferences') {
    const result = await preferences(db, session.employee);
    await helpers.assertContext();
    return result;
  }
  if (payload.action === 'employeePreference' || payload.action === 'employeeAvailability') {
    const current = await preferences(db, session.employee);
    if (!Number.isSafeInteger(payload.version) || payload.version !== current.version) fail(409, 'employee_preferences_changed', 'Indstillingerne er ændret. Hent dem igen.');
    const { version, ...next } = current;
    if (payload.action === 'employeePreference') {
      if (payload.key === 'reminderLeadMinutes' ? ![15, 30, 60].includes(payload.value) : !['notifications', 'chatNotifications', 'shiftReminders', 'checkoutReminders'].includes(payload.key) || typeof payload.value !== 'boolean') fail(400, 'employee_preference_invalid', 'Vælg en gyldig indstilling.');
      next[payload.key] = payload.value;
    } else {
      if (!Time.validDate(payload.date) || typeof payload.unavailable !== 'boolean' || payload.unavailable && payload.date < Time.localNow().date) fail(400, 'employee_availability_invalid', 'Vælg i dag eller en kommende dato.');
      const dates = new Set(next.unavailableDates);
      if (payload.unavailable) dates.add(payload.date); else dates.delete(payload.date);
      if (dates.size > 730) fail(400, 'employee_availability_limit', 'Vælg højst 730 utilgængelige dage.');
      next.unavailableDates = [...dates].sort();
    }
    const guard = helpers.actorGuard();
    const result = await db.batch([query(db, `INSERT INTO workspace_employee_preferences(workspace_id,person_id,version,config,updated_at)
      SELECT ?,?,1,?,? WHERE ?=0 AND ${guard.sql}
      ON CONFLICT(workspace_id,person_id) DO NOTHING`, workspaceId, personId, JSON.stringify(next), new Date().toISOString(), version, ...guard.values),
      query(db, `UPDATE workspace_employee_preferences SET version=version+1,config=?,updated_at=?
        WHERE workspace_id=? AND person_id=? AND version=? AND ?>0 AND ${guard.sql}`,
      JSON.stringify(next), new Date().toISOString(), workspaceId, personId, version, version, ...guard.values)]);
    await helpers.assertContext();
    if (result.reduce((count, row) => count + (row.meta?.changes ?? 0), 0) !== 1) fail(409, 'employee_preferences_changed', 'Indstillingerne er ændret. Hent dem igen.');
    return { ...next, version: version + 1 };
  }
  if (payload.action === 'employeeChecklist') {
    if (typeof payload.shiftId !== 'string' || typeof payload.taskId !== 'string' || typeof payload.checked !== 'boolean') fail(400, 'employee_task_invalid', 'Vælg en gyldig opgave.');
    const head = await first(db, 'SELECT workspace.snapshot_owner_id,plan.revision FROM workspaces workspace JOIN studio_states plan ON plan.owner_id=workspace.snapshot_owner_id WHERE workspace.id=?', workspaceId);
    if (!head) fail(409, 'employee_context_changed', 'Vagtplanen kunne ikke indlæses. Prøv igen.');
    const publication = await first(db, 'SELECT version,write_token FROM workspace_published_shifts WHERE workspace_id=? AND id=? AND person_id=? AND deleted=0', workspaceId, payload.shiftId, personId);
    const detail = await readEmployeePublishedShift({ db, workspaceId, personId, shiftId: payload.shiftId });
    if (!detail || !publication) fail(403, 'employee_shift_forbidden', 'Vagten er ikke udgivet til dig.');
    if (detail.publicationVersion !== publication.version) fail(409, 'checklist_changed', 'Vagten er ændret. Åbn den igen.');
    context.workspace.snapshotOwnerId = head.snapshot_owner_id;
    context.saved = { revision: head.revision, studio: {} };
    context.staff = [{ id: personId, name: session.employee.name }];
    const taskView = Checklist.read({}, detail.shift);
    if (payload.checklistToken !== checklistToken(taskView)) fail(409, 'checklist_changed', 'Beskrivelsen er ændret. Åbn vagten igen.');
    const task = taskView.tasks.find(task => task.key === payload.taskId);
    if (!task) fail(409, 'checklist_changed', 'Opgaverne er ændret. Åbn vagten igen.');
    await handleChecklistAction({ db, context, payload: { action: 'checklist', shiftId: payload.shiftId, key: task.key, signature: taskView.signature, checked: payload.checked }, helpers: {
      ...helpers, capabilities: () => ({ plan: false }), resolveAssignedShift: () => detail,
      actorGuard: () => {
        const actor = helpers.actorGuard();
        return { sql: `(${actor.sql}) AND EXISTS (SELECT 1 FROM workspace_published_shifts current WHERE current.workspace_id=? AND current.id=? AND current.person_id=? AND current.version=? AND current.write_token=? AND current.deleted=0)`,
          values: [...actor.values, workspaceId, payload.shiftId, personId, publication.version, publication.write_token] };
      },
      ensureOperationalSource: async sourceContext => {
        const raw = await readRawStudio(db, head.snapshot_owner_id);
        if (raw.revision !== sourceContext.saved.revision) fail(409, 'employee_context_changed', 'Vagtplanen er ændret. Åbn vagten igen.');
        sourceContext.saved = raw;
        return raw;
      },
    } });
    const progress = await readChecklistProgress(db, context, { personId, shifts: [detail.shift] });
    await helpers.assertContext();
    const view = Checklist.read(progress, detail.shift);
    return { shiftId: payload.shiftId, completedTaskIds: view.tasks.filter(task => task.checked).map(task => task.key) };
  }
  fail(400, 'employee_action_invalid', 'Handlingen findes ikke.');
}

export async function mobileChecklistSnapshot(db, employee, shift) {
  const progress = await readChecklistProgress(db, { workspace: { id: employee.workspaceId }, saved: { studio: {} } }, { personId: employee.personId, shifts: [shift] });
  const view = Checklist.read(progress, shift);
  return { completedTaskIds: view.tasks.filter(task => task.checked).map(task => task.key), checklistToken: checklistToken(view) };
}
