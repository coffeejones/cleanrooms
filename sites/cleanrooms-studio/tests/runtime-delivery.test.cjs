const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm');
test('bundled icons preserve the existing UMD createIcons contract without requiring callers to pass an icon map', () => {
  let requested = false;
  const context = vm.createContext({ document: { querySelectorAll: () => { requested = true; return []; } }, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/vendor-runtime.bundle.js'), 'utf8'), context);
  context.lucide.createIcons({ attrs: { width: 16, height: 16 } });
  assert.equal(requested, true); assert.equal(typeof context.FloatingUIDOM.computePosition, 'function');
});
test('the deployable sandbox uses only bundled executable dependencies and includes their license notices', () => {
  const outer = fs.readFileSync(path.join(__dirname, '../site/index.html'), 'utf8');
  const encoded = outer.match(/data-srcdoc="([^"]*)"/)[1];
  const inner = encoded.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&');
  assert.match(outer, /sandbox="allow-scripts"/); assert.doesNotMatch(outer, /sandbox="[^"]*allow-same-origin/);
  assert.equal((inner.match(/<script id="cleanrooms-vendor-runtime">/g) || []).length, 1);
  assert.doesNotMatch(inner, /<script[^>]+\bsrc\s*=/i);
  assert.match(inner, /Content-Security-Policy/);
  const notices = fs.readFileSync(path.join(__dirname, '../public/THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const name of ['lucide 1.17.0', '@floating-ui/dom 1.7.4', '@tiptap/core']) assert.ok(notices.includes(name), name);
  assert.ok(notices.length > 1000);
});
