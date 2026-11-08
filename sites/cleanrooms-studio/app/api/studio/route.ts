import { env } from 'cloudflare:workers';
import { handleWorkspaceStudioRequest } from '../../../lib/workspace-store.mjs';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return handleWorkspaceStudioRequest(request, () => env.DB);
}

export function PUT(request: Request) {
  return handleWorkspaceStudioRequest(request, () => env.DB);
}
