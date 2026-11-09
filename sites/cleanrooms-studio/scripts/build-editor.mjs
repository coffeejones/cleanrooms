import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const result = await build({
  entryPoints: ['src/rich-description-entry.mjs'],
  outfile: 'src/rich-description.bundle.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  supported: {'template-literal': false},
  minify: true,
  legalComments: 'none',
  metafile: true,
});

const notices = new Map();
const runtime = await build({
  entryPoints: ['src/vendor-runtime-entry.mjs'], outfile: 'src/vendor-runtime.bundle.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2020',
  supported: {'template-literal': false}, minify: true, legalComments: 'none', metafile: true,
});
for (const input of [...Object.keys(result.metafile.inputs), ...Object.keys(runtime.metafile.inputs)].filter(path => path.startsWith('node_modules/'))) {
  let directory = dirname(resolve(input));
  while (!existsSync(join(directory, 'package.json'))) directory = dirname(directory);
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md'].find(name => existsSync(join(directory, name)));
  if (!licenseFile) throw new Error(`Bundled package ${pkg.name} has no license notice.`);
  notices.set(`${pkg.name} ${pkg.version}`, readFileSync(join(directory, licenseFile), 'utf8').trim());
}
mkdirSync('public', {recursive:true});
if (!notices.size) throw new Error('Refusing to publish an empty third-party notice file.');
writeFileSync('public/THIRD_PARTY_NOTICES.txt', [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([name, license]) => `${name}\n${license}`).join('\n\n-----\n\n') + '\n');
