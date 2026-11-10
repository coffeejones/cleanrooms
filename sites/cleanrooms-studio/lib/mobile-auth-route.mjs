import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { StudioError } from './studio-store.mjs';
import { changeMobilePassword, loginMobile, logoutMobile, readMobileSession } from './mobile-auth-store.mjs';
import { readPublishedEmployeePage, readEmployeePublishedShift } from './publication-store.mjs';
import Checklist from '../src/checklist-progress.js';
import Description from '../src/description-model.js';
import Time from '../src/timekeeping-model.js';
import {mayReadWorksiteInfo} from './worksite-information.mjs';
import { readDirectorySite } from './directory-store.mjs';
import { readMobileTimeEntry, readMobileTimeEntries, writeMobileTimeEntry, readMobileActiveTime, readMobileRecoveryShift } from './mobile-timekeeping.mjs';
import { readMobileHours } from './mobile-employee-data.mjs';
import { handleMobileChat } from './mobile-chat.mjs';
import { handleMobileEmployeeWorkflow } from './mobile-employee-workflow.mjs';
import { handleMobileEmployeeState, mobileChecklistSnapshot } from './mobile-employee-state.mjs';
import { readMobileCoworkers } from './mobile-coworkers.mjs';
import { readMobileCompanySettings } from './mobile-company-settings.mjs';
import { handleMobileInbox } from './mobile-inbox.mjs';
import { enforceMobileRequestQuota } from './mobile-request-quota.mjs';
import { handleMobilePush } from './mobile-push-store.mjs';

const maxBodyBytes = 64 * 1024;
const secretPattern = /^[a-f0-9]{64}$/;
const sessionPattern = /^Bearer ([A-Za-z0-9_-]{32,128})$/;
const fields = new Map([
  ['login', ['email', 'password']],
  ['session', []],
  ['changePassword', ['currentPassword', 'newPassword']],
  ['logout', []],
  ['employeePushRegister', ['installationId', 'expoPushToken', 'platform', 'projectId']],
  ['employeePushUnregister', ['installationId']],
  ['employeePushOpen', ['installationId', 'eventId']],
  ['employeePushTest', ['installationId']],
  ['publishedSchedule', ['from', 'to', 'cursor']],
  ['publishedShift', ['shiftId']],
  ['shiftTime', ['shiftId', 'operation', 'version', 'comment', 'location']],
  ['employeeHours', ['from', 'to']],
  ['employeeCompanySettings', []],
  ['employeeInbox', ['cursor', 'limit']],
  ['employeeInboxRead', ['messageId']],
  ['employeeActiveTime', []],
  ['employeePreferences', []],
  ['employeePreference', ['version', 'key', 'value']],
  ['employeeAvailability', ['version', 'date', 'unavailable']],
  ['employeeChecklist', ['shiftId', 'taskId', 'checked', 'checklistToken']],
  ['employeeColleagues', ['shiftId', 'cursor', 'limit']],
  ['chatList', ['cursor', 'limit']],
  ['chatRead', ['roomId', 'before', 'limit']],
  ['chatSync', ['roomId', 'afterSeq', 'version', 'limit']],
  ['chatSend', ['roomId', 'clientId', 'text']],
  ['chatReadMark', ['roomId', 'throughSeq']],
  ['chatMute', ['roomId', 'muted']],
  ['workflowRead', ['from', 'to', 'limit', 'messageCursor', 'requestCursor', 'ownCursor', 'openCursor', 'colleagueCursor', 'colleagueQuery']],
  ['workflowReadMessage', ['messageId', 'from', 'to']],
  ['workflowRequest', ['kind', 'shiftId', 'fingerprint', 'toPersonId', 'comment', 'from', 'to']],
  ['workflowRespond', ['requestId', 'version', 'decision', 'from', 'to']],
  ['shiftLeave', ['shiftId', 'comment']],
  ['leaveRead', ['from', 'to', 'cursor', 'limit']],
  ['leaveCreate', ['from', 'to', 'type', 'comment']],
]);

function mobileShift(shift) {
  const { id, person, date, start, end, plannedBreakMinutes, location } = shift;
  return {
    id, personId: person, date, start, end, breakMinutes: plannedBreakMinutes ?? 0,
    site: { id: location.id, name: location.name, address: location.address },
  };
}

async function readSchedule(db, employee, { from, to, cursor }) {
  if (!Time.validDate(from) || !Time.validDate(to) || from > to || Date.parse(to) - Date.parse(from) >= 56 * 86400000
    || (cursor !== null && (typeof cursor !== 'string' || cursor.length > 1024))) {
    throw new StudioError(400, 'employee_period_invalid', 'Vælg højst 56 gyldige kalenderdage.');
  }
  const result = await readPublishedEmployeePage({
    db, workspaceId: employee.workspaceId, personId: employee.personId, from, to, cursor, limit: 200, overlap: true,
  });
  const entries = await readMobileTimeEntries(db, employee, result.shifts.map(shift => shift.id));
  return { shifts: result.shifts.map(shift => ({ ...mobileShift(shift), entry: entries[shift.id] ?? null })), nextCursor: result.nextCursor };
}

async function readShift(db, employee, shiftId) {
  const { workspaceId, personId } = employee;
  const detail = await readEmployeePublishedShift({ db, workspaceId, personId, shiftId });
  if (!detail) return { shift: await readMobileRecoveryShift(db, employee, shiftId,{includeWorksiteInfo:true}) };
  const { shift } = detail;
  const entry = await readMobileTimeEntry(db, employee, shiftId);
  const workplace = await readDirectorySite({ db, workspaceId, siteIndex: shift.site, includeWorksiteInfo:mayReadWorksiteInfo(shift,{entry}) });
  return { shift: {
    ...mobileShift(shift),
    site:{...mobileShift(shift).site,...(workplace?.worksiteInfo?{worksiteInfo:workplace.worksiteInfo}:{})},
    description: shift.noteRich ? Description.text(shift.noteRich) : shift.note ?? '',
    checklist: Checklist.tasks(shift.noteRich).map(({ key, text }) => ({ id: key, text })),
    clockInRadius: workplace?.gps?.enabled ? workplace.gps.radiusMeters : null,
    entry,
    ...await mobileChecklistSnapshot(db, employee, shift),
  } };
}

function reply(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store, private',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  } });
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '') || !request.body) {
    throw new StudioError(415, 'mobile_json_required', 'Send oplysningerne som JSON.');
  }
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maxBodyBytes);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maxBodyBytes) {
        await reader.cancel();
        throw new StudioError(413, 'mobile_body_too_large', 'Forespørgslen er for stor.');
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } catch {
    throw new StudioError(400, 'mobile_request_invalid', 'Forespørgslen er ugyldig.');
  }
  const allowed = fields.get(payload?.action);
  const optional = /^(?:workflow|leave)/.test(payload?.action ?? '');
  if (!allowed || Object.keys(payload).some(key => key !== 'action' && !allowed.includes(key)) || !optional && !allowed.every(key => Object.hasOwn(payload, key))) {
    throw new StudioError(400, 'mobile_request_invalid', 'Forespørgslen er ugyldig.');
  }
  return payload;
}

function fromGateway(request, key) {
  const supplied = request.headers.get('x-cleanrooms-gateway-key') ?? '';
  return typeof key === 'string' && secretPattern.test(key) && secretPattern.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(key, 'hex'));
}

async function routeMobileAuthRequest(request, db, gatewayKey, pushOptions) {
  if (!fromGateway(request, gatewayKey)) return reply({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
  if (!db) return reply({ error: 'mobile_unavailable', message: 'Login er midlertidigt utilgængeligt. Prøv igen.' }, 503);
  try {
    const payload = await readBody(request);
    const address = request.headers.get('x-cleanrooms-client-ip') ?? '';
    const ip = /^[0-9a-f:.]{3,45}$/i.test(address) ? address : 'unknown';
    if (payload.action === 'login') {
      return reply(await loginMobile({ db, email: payload.email, password: payload.password, ip }));
    }
    const token = sessionPattern.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!token) return reply({ error: 'mobile_session_invalid', message: 'Log ind igen for at fortsætte.' }, 401);
    if (payload.action === 'logout') {
      await logoutMobile({ db, token });
      return reply({ ok: true });
    }
    if (payload.action === 'changePassword') {
      return reply(await changeMobilePassword({ db, token, currentPassword: payload.currentPassword, newPassword: payload.newPassword, ip }));
    }
    const session = await readMobileSession({ db, token });
    await enforceMobileRequestQuota(db, token, session, payload.action);
    const { expiresAt, employee, temporaryPassword } = session;
    if (payload.action.startsWith('employeePush')) return reply(await handleMobilePush(db, token, session, payload, pushOptions));
    if (payload.action === 'employeeInbox' || payload.action === 'employeeInboxRead') return reply(await handleMobileInbox(db, token, session, payload));
    if (payload.action === 'employeeActiveTime') return reply(await readMobileActiveTime(db, token, session));
    if (payload.action === 'employeeCompanySettings') return reply(await readMobileCompanySettings(db, token, session));
    if (payload.action === 'employeeHours') {
      const result = await readMobileHours(db, employee, payload);
      await readMobileSession({ db, token });
      return reply(result);
    }
    if (payload.action === 'employeeColleagues') {
      const result = await readMobileCoworkers(db, employee, payload);
      await readMobileSession({ db, token });
      return reply(result);
    }
    if (payload.action.startsWith('chat')) return reply(await handleMobileChat(db, token, session, payload));
    if (payload.action.startsWith('workflow') || payload.action.startsWith('leave') || payload.action === 'shiftLeave') return reply(await handleMobileEmployeeWorkflow(db, token, session, payload));
    if (payload.action.startsWith('employee')) return reply(await handleMobileEmployeeState(db, token, session, payload));
    if (payload.action === 'shiftTime') return reply(await writeMobileTimeEntry(db, token, session, payload));
    if (payload.action === 'publishedSchedule' || payload.action === 'publishedShift') {
      const result = payload.action === 'publishedSchedule'
        ? await readSchedule(db, employee, payload)
        : await readShift(db, employee, payload.shiftId);
      await readMobileSession({ db, token });
      return reply(result);
    }
    return reply({ expiresAt, employee, temporaryPassword });
  } catch (error) {
    if (error instanceof StudioError) return reply({ error: error.code, message: error.message }, error.status,
      error.status === 429 && Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds > 0
        ? { 'Retry-After': String(Math.min(error.retryAfterSeconds, 3600)) } : {});
    if (error?.status === 400 && /^employee_/.test(error.code)) return reply({ error: error.code, message: error.message }, 400);
    if (error?.code === 'publication_read_conflict') return reply({ error: error.code, message: error.message }, 409);
    return reply({ error: 'mobile_unavailable', message: 'Login er midlertidigt utilgængeligt. Prøv igen.' }, 503);
  }
}

export async function handleMobileAuthRequest(request, db, gatewayKey, pushOptions = {}) {
  const candidate = request.headers.get('x-request-id') ?? '';
  const requestId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(candidate) ? candidate : crypto.randomUUID();
  const started = performance.now(), result = await routeMobileAuthRequest(request, db, gatewayKey, pushOptions);
  result.headers.set('X-Request-Id', requestId);
  if (result.status >= 500) console.error(JSON.stringify({ event: 'mobile_request_failed', requestId,
    status: result.status, durationMs: Math.round(performance.now() - started) }));
  return result;
}
