/* Personal payroll snapshots are private, append-only, and committed with pay. */
import Payroll from '../src/payroll-model.js';
import {StudioError} from './studio-store.mjs';

export function assertPersonalPayrollHistory(before,after,today){
  // A first setup may import an existing agreement. Once saved, that known
  // history cannot be rewritten, even without a group policy.
  const errors=Payroll.validateHistory(before,after,today);
  if(errors.length)throw new StudioError(400,'historical_payroll_policy',errors[0]);
}

export function payrollRevisionStatements({db,workspaceId,personId,previous,version,writeToken,actor}){
  const committed='EXISTS (SELECT 1 FROM workspace_payroll committed WHERE committed.workspace_id = ? AND committed.person_id = ? AND committed.version = ? AND committed.write_token = ?)';
  const values=[workspaceId,personId,version,writeToken],statements=[];
  if(previous){
    // Recover the last pre-migration snapshot on the first successful save.
    // Never attribute an old snapshot to the person performing the new save.
    statements.push(db.prepare(`INSERT INTO workspace_payroll_revisions
      (workspace_id,person_id,version,config,actor_id,actor_name,recorded_at,source)
      SELECT ?,?,?,?,?,COALESCE((SELECT name FROM workspace_members WHERE workspace_id = ? AND user_id = ?),'Tidligere lønopsætning'),?,'legacy'
      WHERE ${committed} ON CONFLICT(workspace_id,person_id,version) DO NOTHING`).bind(
      workspaceId,personId,previous.version,previous.config,previous.updated_by||'',workspaceId,previous.updated_by||'',previous.updated_at,...values));
  }
  statements.push(db.prepare(`INSERT INTO workspace_payroll_revisions
    (workspace_id,person_id,version,config,actor_id,actor_name,recorded_at,source)
    SELECT workspace_id,person_id,version,config,updated_by,?,updated_at,'save'
    FROM workspace_payroll WHERE workspace_id = ? AND person_id = ? AND version = ? AND write_token = ?
    ON CONFLICT(workspace_id,person_id,version) DO NOTHING`).bind(actor.name,...values));
  return statements;
}
