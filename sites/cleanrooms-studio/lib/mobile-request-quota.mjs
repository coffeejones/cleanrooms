/* Bound authenticated expensive work without rate-limiting clock-out recovery. */
import { createHash } from 'node:crypto';
import { StudioError } from './studio-store.mjs';
import { readMobileSession } from './mobile-auth-store.mjs';

const windowMs = 60_000;
const groupFor = action => action === 'chatSend' ? ['chat-send', 30, 240]
  : ['chatList', 'chatRead', 'chatSync', 'chatReadMark', 'chatMute'].includes(action) ? ['chat-read', 180, 1800]
    : action === 'employeeHours' ? ['hours-read', 30, 180]
      : ['workflowRead', 'employeeInbox'].includes(action) ? ['workflow-read', 120, 1200]
        : ['employeePushRegister', 'employeePushUnregister', 'employeePushOpen', 'employeePushTest'].includes(action) ? ['push', 30, 600] : null;
const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
const hash = value => createHash('sha256').update(value).digest('hex');

export async function reserveActionQuota(db,{namespace,workspaceId,identityId,kind,personLimit,workspaceLimit,actorGuard,now=Date.now()}) {
  const personScope=hash(`${namespace}:v1:${workspaceId}:${identityId}:${kind}`),workspaceScope=hash(`${namespace}:v1:${workspaceId}:${kind}`),requestToken=crypto.randomUUID();
  const capacity=`NOT EXISTS (SELECT 1 FROM workspace_mobile_auth_attempts quota WHERE quota.scope_hash=? AND quota.expires_at>? AND quota.attempts>=?)`;
  const reserve=(scope,limit,condition,values)=>query(db,`INSERT INTO workspace_mobile_auth_attempts(scope_hash,attempts,expires_at,write_token)
    SELECT ?,1,?,? WHERE ${condition} ON CONFLICT(scope_hash) DO UPDATE SET
      attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END,write_token=excluded.write_token
    WHERE expires_at<=? OR attempts<?`,scope,now+windowMs,requestToken,...values,now,now,now,limit);
  const result=await db.batch([
    query(db,`DELETE FROM workspace_mobile_auth_attempts WHERE scope_hash IN (SELECT scope_hash FROM workspace_mobile_auth_attempts WHERE expires_at<=? ORDER BY expires_at LIMIT 32)`,now),
    reserve(personScope,personLimit,`(${actorGuard.sql}) AND (${capacity})`,[...actorGuard.values,workspaceScope,now,workspaceLimit]),
    reserve(workspaceScope,workspaceLimit,`EXISTS (SELECT 1 FROM workspace_mobile_auth_attempts personal WHERE personal.scope_hash=? AND personal.write_token=?)`,[personScope,requestToken]),
  ]);
  return result.slice(1).every(row=>row.meta?.changes===1);
}

export async function enforceMobileRequestQuota(db, token, session, action, now = Date.now()) {
  const policy = groupFor(action);
  if (!policy) return;
  const [kind, personLimit, workspaceLimit] = policy, { workspaceId, personId } = session.employee;
  const guard = `EXISTS (SELECT 1 FROM workspace_mobile_sessions session
    JOIN workspace_mobile_credentials credential ON credential.workspace_id=session.workspace_id AND credential.person_id=session.person_id
      AND credential.version=session.credential_version AND credential.revoked_at IS NULL
    JOIN workspace_directory_records employee ON employee.workspace_id=session.workspace_id AND employee.kind='employee'
      AND employee.id=session.person_id AND employee.active=1 AND employee.deleted=0
    WHERE session.token_hash=? AND session.workspace_id=? AND session.person_id=? AND session.credential_version=? AND session.expires_at>?)`;
  const values = [session.tokenHash, workspaceId, personId, session.credentialVersion, now];
  if(await reserveActionQuota(db,{namespace:'mobile-action',workspaceId,identityId:personId,kind,personLimit,workspaceLimit,actorGuard:{sql:guard,values},now}))return;
  await readMobileSession({ db, token, now });
  const error = new StudioError(429, 'mobile_action_rate_limited', 'Der er mange forespørgsler lige nu. Vent et øjeblik, og prøv igen.');
  error.retryAfterSeconds = Math.ceil(windowMs / 1000);
  throw error;
}
