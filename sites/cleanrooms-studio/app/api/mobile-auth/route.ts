import { env } from 'cloudflare:workers';
import { handleMobileAuthRequest } from '../../../lib/mobile-auth-route.mjs';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleMobileAuthRequest(request, env.DB, env.MOBILE_GATEWAY_KEY);
}
