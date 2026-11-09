/* Reviewed CJS interop only. The official patched decoder algorithm stays unchanged. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'vendor/decode-uri-component/UPSTREAM.json'), 'utf8'));
const upstream = JSON.parse(fs.readFileSync(path.join(root, 'vendor/decode-uri-component/upstream-package.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = message => { throw new Error('Dependency security check: ' + message); };
const version = value => value.split('.').slice(0, 3).map(Number);
const atLeast = (actual, minimum) => {
  const a = version(actual), b = version(minimum);
  for (let i = 0; i < 3; i++) { if (!Number.isInteger(a[i])) return false; if (a[i] !== b[i]) return a[i] > b[i]; }
  return true;
};

function prepareDependencySecurity({ check = false } = {}) {
  const lock = json(path.join(root, 'package-lock.json'));
  let decoders = 0;
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative.startsWith('node_modules/') || relative.split('/').includes('..')) continue;
    const name = relative.slice(relative.lastIndexOf('node_modules/') + 13);
    const minimum = { glob: '14.0.2', zod: '4.6.6', 'decode-uri-component': '0.5.1', deepmerge: '4.3.2' }[name];
    if (minimum && !atLeast(entry.version, minimum)) fail(`${name} must be at least ${minimum}`);
    if (name === 'minimatch' && Number(entry.version.split('.')[0]) >= 7 && !atLeast(entry.version, '11.0.1')) fail('minimatch 7–10 must be replaced with the nonrecursive matcher');
    if (name !== 'decode-uri-component') continue;
    decoders++;
    if (entry.version !== provenance.version || entry.integrity !== provenance.registryIntegrity) fail('decoder lockfile provenance changed; review the upstream release before updating');
    const directory = path.join(root, relative), source = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
    const license = fs.readFileSync(path.join(directory, 'license'), 'utf8');
    if (digest(source) !== provenance.indexSha256 || digest(license) !== provenance.licenseSha256) fail('decoder source/license does not match the reviewed official package');
    if (digest(fs.readFileSync(path.join(root, 'vendor/decode-uri-component/LICENSE'))) !== provenance.licenseSha256) fail('checked-in license changed');
    const marker = 'export default function decodeUriComponent(encodedURI)';
    if (source.split(marker).length !== 2) fail('decoder CJS conversion marker changed');
    const cjs = '/*! decode-uri-component 0.5.1 — MIT; see ./license. CJS syntax adapter only. */\n\'use strict\';\n'
      + source.replace(marker, 'module.exports = function decodeUriComponent(encodedURI)');
    const adapted = { ...upstream, exports: { types: './index.d.ts', import: './index.js', require: './index.cjs', default: './index.js' } };
    const installed = json(path.join(directory, 'package.json'));
    if (![upstream, adapted].some(expected => JSON.stringify(expected) === JSON.stringify(installed))) fail('decoder package metadata changed unexpectedly');
    if (check) {
      if (!fs.existsSync(path.join(directory, 'index.cjs')) || fs.readFileSync(path.join(directory, 'index.cjs'), 'utf8') !== cjs
        || JSON.stringify(installed) !== JSON.stringify(adapted)) fail('CJS adapter is missing or changed; run npm run postinstall');
    } else {
      fs.writeFileSync(path.join(directory, 'index.cjs'), cjs);
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(adapted, null, 2) + '\n');
    }
  }
  if (!decoders) fail('expected the reviewed decoder dependency');
  // Check real consumer resolution too: an untracked stale nested dependency
  // must not shadow the secure version recorded in package-lock.json.
  for (const [consumer, request, name, minimum] of [
    ['query-string', 'decode-uri-component', 'decode-uri-component', '0.5.1'],
    ['@expo/fingerprint', 'glob', 'glob', '14.0.2'],
    ['@expo/fingerprint', 'minimatch', 'minimatch', '11.0.1'],
    ['@typescript-eslint/typescript-estree', 'minimatch', 'minimatch', '11.0.1'],
    ['eslint-plugin-react-hooks', 'zod/v4', 'zod', '4.6.6'],
  ]) {
    let consumerPath;
    try { consumerPath = require.resolve(consumer); }
    catch (error) {
      if (['@typescript-eslint/typescript-estree', 'eslint-plugin-react-hooks'].includes(consumer)
        && !fs.existsSync(path.join(root, 'node_modules', consumer))) continue; // npm ci --omit=dev
      throw error;
    }
    const consumerRequire = createRequire(consumerPath);
    let directory = path.dirname(consumerRequire.resolve(request)), found = false;
    for (;;) {
      const meta = path.join(directory, 'package.json');
      if (fs.existsSync(meta)) {
        const installed = json(meta);
        if (installed.name === name) { if (!atLeast(installed.version, minimum)) fail(`${consumer} resolves an unsafe ${name}`); found = true; break; }
      }
      const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
    }
    if (!found) fail(`cannot verify ${consumer}'s ${name} resolution`);
  }
  return { decoders };
}
module.exports = { prepareDependencySecurity };
if (require.main === module) {
  const result = prepareDependencySecurity({ check: process.argv.includes('--check') });
  console.log(`Verified patched dependency contracts (${result.decoders} decoder entry).`);
}
