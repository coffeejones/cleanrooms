import { env } from 'cloudflare:workers';
import { handleAccountsRequest } from '../../../lib/workspace-store.mjs';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleAccountsRequest(request, () => env.DB, env.MOBILE_GATEWAY_KEY ?? null, env.ADDRESS_LOOKUP_TOKEN);
}
