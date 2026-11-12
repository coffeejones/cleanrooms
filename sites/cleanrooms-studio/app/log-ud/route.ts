import { env } from 'cloudflare:workers';
import { webLogout } from '../../lib/web-entry-flow.mjs';

export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return webLogout(request, env.DB);
}
