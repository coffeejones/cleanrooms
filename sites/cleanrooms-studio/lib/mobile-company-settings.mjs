/* Employee-facing company settings never hydrate the plan or employee directory. */
import { StudioError, readRawStudio } from './studio-store.mjs';
import { readMobileSession } from './mobile-auth-store.mjs';
import PayrollPeriod from '../src/payroll-period-model.js';

const fail=(status,code,message)=>{throw new StudioError(status,code,message);};
const first=async(db,sql,...values)=>(await db.batch([db.prepare(sql).bind(...values)]))[0]?.results?.[0]??null;
function sameSession(expected,current) {
  if(expected.tokenHash!==current.tokenHash||expected.credentialVersion!==current.credentialVersion
    ||expected.employee.workspaceId!==current.employee.workspaceId||expected.employee.personId!==current.employee.personId) {
    fail(401,'mobile_session_invalid','Log ind igen for at fortsætte.');
  }
}
async function head(db,workspaceId) {
  return first(db,`SELECT workspace.snapshot_owner_id,plan.revision,plan.write_token
    FROM workspaces workspace LEFT JOIN studio_states plan ON plan.owner_id=workspace.snapshot_owner_id
    WHERE workspace.id=?`,workspaceId);
}
export async function readMobileCompanySettings(db,token,session) {
  const current=await readMobileSession({db,token});sameSession(session,current);
  const workspaceId=current.employee.workspaceId,before=await head(db,workspaceId);
  if(!before)fail(401,'mobile_session_invalid','Log ind igen for at fortsætte.');
  // readRawStudio reads the compact metadata snapshot; unlike readStudio it does
  // not hydrate any versioned shifts, series, departments or employee records.
  const raw=await readRawStudio(db,before.snapshot_owner_id),after=await head(db,workspaceId);
  sameSession(current,await readMobileSession({db,token}));
  if(!after||JSON.stringify(before)!==JSON.stringify(after)
    ||raw.revision!==(before.revision??0)||raw.source.token!==(before.write_token??'')||raw.source.workspaceId!==workspaceId) {
    fail(409,'employee_company_settings_changed','Virksomhedens indstillinger er ændret. Hent dem igen.');
  }
  return {version:raw.revision,payrollPeriod:PayrollPeriod.normalize(raw.studio?.workspaceSettings?.payrollPeriod)};
}
