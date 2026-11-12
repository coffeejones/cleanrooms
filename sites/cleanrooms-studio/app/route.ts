import { env } from 'cloudflare:workers';
import { webHome } from '../lib/web-entry-flow.mjs';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return webHome(request, env.DB);
}
