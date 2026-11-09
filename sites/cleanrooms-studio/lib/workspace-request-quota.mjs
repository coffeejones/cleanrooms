/* Private web callers share bounded action budgets, with their live ACL as the commit fence. */
import {StudioError} from './studio-store.mjs';
import {reserveActionQuota} from './mobile-request-quota.mjs';

const policyFor=action=>action==='chatSend'?['chat-send',30,240]
  :['chatList','chatRead','chatSync','chatReadMark','chatMute'].includes(action)?['chat-read',180,1800]
    :action==='timeRead'?['time-read',90,900]
      :action==='plannerDetail'?['planner-detail',180,1800]
        :action==='workflowRead'?['workflow-read',120,1200]:null;

export async function enforceWorkspaceRequestQuota({db,context,action,helpers:h,now=Date.now()}){
  const policy=policyFor(action);if(!policy)return;
  const [kind,personLimit,workspaceLimit]=policy;
  if(await reserveActionQuota(db,{namespace:'web-action',workspaceId:context.workspace.id,identityId:context.member.userId,
    kind,personLimit,workspaceLimit,actorGuard:h.actorGuard(context),now}))return;
  await h.assertContext(db,context);
  const error=new StudioError(429,'workspace_action_rate_limited','Der er mange forespørgsler lige nu. Vent et øjeblik, og prøv igen.');
  error.retryAfterSeconds=60;error.requestId=crypto.randomUUID();throw error;
}
