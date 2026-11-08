/* Native employee requests use the same rows and approval rules as the private web app. */
import { mobileEmployeeChatContext } from './mobile-chat.mjs';
import { readRawStudio, StudioError } from './studio-store.mjs';
import { handleShiftWorkflowAction } from './shift-workflow-store.mjs';
import { ensureEngagement } from './engagement-store.mjs';
import { ensureAbsences, handleAbsenceAction } from './absence-store.mjs';
import Time from '../src/timekeeping-model.js';
import Workflow from '../src/shift-workflow-model.js';
import { readEmployeePublishedShift } from './publication-store.mjs';

const periodFields = ['from', 'to'];
const fields = {
  workflowRead: [...periodFields, 'limit', 'messageCursor', 'requestCursor', 'ownCursor', 'openCursor', 'colleagueCursor', 'colleagueQuery'],
  workflowReadMessage: [...periodFields, 'messageId'],
  workflowRequest: [...periodFields, 'kind', 'shiftId', 'fingerprint', 'toPersonId', 'comment'],
  workflowRespond: [...periodFields, 'requestId', 'version', 'decision'],
  leaveRead: [...periodFields, 'cursor', 'limit'],
  leaveCreate: [...periodFields, 'type', 'comment'],
  shiftLeave: ['shiftId', 'comment'],
};

export async function handleMobileEmployeeWorkflow(db, token, session, payload) {
  const allowed = fields[payload?.action];
  if (!allowed || Object.keys(payload).some(key => key !== 'action' && !allowed.includes(key))) {
    throw new StudioError(400, 'mobile_workflow_action_invalid', 'Vælg en gyldig medarbejderhandling.');
  }
  const { context, helpers: base } = await mobileEmployeeChatContext(db, token, session);
  const head = await base.first(db, `SELECT workspace.snapshot_owner_id, plan.revision FROM workspaces workspace
    JOIN studio_states plan ON plan.owner_id=workspace.snapshot_owner_id WHERE workspace.id=?`, context.workspace.id);
  if (!head) base.fail(409, 'employee_context_changed', 'Vagtplanen kunne ikke indlæses. Prøv igen.');
  context.workspace.snapshotOwnerId = head.snapshot_owner_id;
  context.saved = { revision: head.revision, studio: {} };
  const helpers = {
    ...base,
    capabilities: () => ({ plan: false, viewPayroll: false }),
    ensureOperationalSource: async current => {
      const raw = await readRawStudio(db, current.workspace.snapshotOwnerId);
      if (raw.revision !== current.saved.revision) base.fail(409, 'employee_context_changed', 'Vagtplanen er ændret. Prøv igen.');
      current.saved = raw;
      return raw;
    },
  };
  helpers.ensureOperationalPlanningSource = async current => {
    const raw = await helpers.ensureOperationalSource(current);
    await ensureEngagement(db, current, helpers);
    await ensureAbsences(db, current, helpers);
    return raw;
  };
  const normalized = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== null));
  const principal = { userId: context.member.userId, name: context.member.name };
  let result;
  if (payload.action === 'leaveRead' || payload.action === 'leaveCreate' || payload.action === 'shiftLeave') {
    await ensureAbsences(db, context, helpers);
    if (payload.action === 'shiftLeave') {
      const detail = await readEmployeePublishedShift({ db, workspaceId: context.workspace.id, personId: context.member.personId, shiftId: payload.shiftId });
      if (!detail || !Workflow.future(detail.shift, Time.localNow())) base.fail(409, 'employee_shift_changed', 'Du kan kun ønske fri på en kommende vagt, der er udgivet til dig.');
      Object.assign(normalized, { action: 'leaveCreate', from: detail.shift.date, to: detail.shift.date, type: 'Friønske' });
      delete normalized.shiftId;
    }
    result = await handleAbsenceAction({ db, context, payload: normalized, principal, helpers });
  } else {
    if (normalized.from === undefined && normalized.to === undefined) {
      normalized.from = Time.localNow().date;
      normalized.to = Time.addDays(normalized.from, 55);
    }
    result = await handleShiftWorkflowAction({ db, context, payload: normalized, principal, helpers });
  }
  await helpers.assertContext();
  const output = {};
  for (const key of ['notifications', 'unreadCount', 'requests', 'openShifts', 'ownShifts', 'colleagues', 'pagination', 'serverNow', 'request', 'planChanged', 'hasMore', 'nextCursor', 'counts']) {
    if (Object.hasOwn(result, key)) output[key] = result[key];
  }
  return output;
}
