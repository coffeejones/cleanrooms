import { env } from 'cloudflare:workers';
import { chatGPTSignInPath } from '../chatgpt-auth';
import { renderMobileGpsHandoff } from '../../lib/mobile-gps-handoff.mjs';
import { readMobileGpsWorkplaces } from '../../lib/workspace-store.mjs';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return renderMobileGpsHandoff(request, {
    readWorkplaces: (siteId: string | null, workspaceId: string | null) => readMobileGpsWorkplaces(request, () => env.DB, siteId, workspaceId),
    signInPath: chatGPTSignInPath,
  });
}
