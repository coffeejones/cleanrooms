import { env } from 'cloudflare:workers';
import { webSignup } from '../../lib/web-entry-flow.mjs';

export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, { status:303, headers:{ Location:'/?vis=opret' } });
}

export function POST(request: Request) {
  return webSignup(request, env.DB, env.CLEANROOMS_TEST_LOGIN);
}
