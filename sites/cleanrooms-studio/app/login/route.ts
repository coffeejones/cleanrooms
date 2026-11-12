import { env } from 'cloudflare:workers';
import { webLogin } from '../../lib/web-entry-flow.mjs';

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, { status:303, headers:{ Location:'/' } });
}

export function POST(request: Request) {
  return webLogin(request, env.DB, env.CLEANROOMS_TEST_LOGIN);
}
