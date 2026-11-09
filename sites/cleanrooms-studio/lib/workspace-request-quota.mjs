/* Private web callers share bounded action budgets, with their live ACL as the commit fence. */
import {StudioError} from './studio-store.mjs';
import {reserveActionQuota} from './mobile-request-quota.mjs';

const policyFor=action=>action==='chatSend'?['chat-send',30,240]
  :['chatList','chatRead','chatSync','chatReadMark','chatMute'].includes(action)?['chat-read',180,1800]
    :action==='timeRead'?['time-read',90,900]
      :action==='plannerDetail'?['planner-detail',180,1800]
        :action==='workflowRead'?['workflow-read',120,1200]
          :['payrollPeriodRead','payrollPeriodClose','payrollPeriodReopen'].includes(action)?['payroll-period',30,120]
            :action==='payrollPeriodExport'?['payroll-export',300,1500]:null;

export async function enforceWorkspaceRequestQuota({db,context,action,helpers:h,now=Date.now()}){
  const policy=policyFor(action);if(!policy)return;
  const [kind,personLimit,workspaceLimit]=policy;
  const required=kind==='payroll-period'||kind==='payroll-export'?['plan','payroll.view',...(['payrollPeriodClose','payrollPeriodReopen'].includes(action)?['payroll.manage']:[])]:[];
  // Forbidden payroll callers must not consume the shared budget of the people
  // who can run payroll; the action handler remains the permission authority.
  if(required.some(key=>!context.role.permissions.includes(key)))return;
  if(await reserveActionQuota(db,{namespace:'web-action',workspaceId:context.workspace.id,identityId:context.member.userId,
    kind,personLimit,workspaceLimit,actorGuard:h.actorGuard(context,required),now}))return;
  await h.assertContext(db,context);
  const error=new StudioError(429,'workspace_action_rate_limited','Der er mange forespørgsler lige nu. Vent et øjeblik, og prøv igen.');
  error.retryAfterSeconds=60;error.requestId=crypto.randomUUID();throw error;
}
