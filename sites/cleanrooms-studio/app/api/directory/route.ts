import { env } from 'cloudflare:workers';
import { handleDirectoryRequest } from '../../../lib/workspace-store.mjs';

export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleDirectoryRequest(request, () => env.DB); }
