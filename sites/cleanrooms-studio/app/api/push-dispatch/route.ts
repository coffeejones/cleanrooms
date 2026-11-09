import { env } from 'cloudflare:workers';
import { handlePushDispatchRequest } from '../../../lib/push-dispatch.mjs';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handlePushDispatchRequest(request, env);
}
