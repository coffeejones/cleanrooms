import html from '../site/index.html?raw';
import { createStaticDocument } from '../lib/static-document.mjs';

const document = createStaticDocument(html);

export function GET(request: Request) {
  return document(request);
}
