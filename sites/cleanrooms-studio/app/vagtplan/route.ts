import { env } from 'cloudflare:workers';
import html from '../../site/index.html?raw';
import { createStaticDocument } from '../../lib/static-document.mjs';
import { openWebStudio } from '../../lib/web-entry-flow.mjs';

export const dynamic = 'force-dynamic';
const document = createStaticDocument(html);

export function GET(request: Request) {
  return openWebStudio(request, env.DB, document);
}
