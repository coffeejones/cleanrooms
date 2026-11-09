const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { prepareDependencySecurity } = require('./dependency-security.cjs');
prepareDependencySecurity({ check: true });
const directory = path.resolve(process.argv[2] ?? 'dist-dependency-security');
const expected = fs.readFileSync(path.resolve(__dirname, '../node_modules/decode-uri-component/index.cjs'), 'utf8');
for (const platform of ['ios', 'android']) {
  const folder = path.join(directory, '_expo/static/js', platform);
  const names = fs.readdirSync(folder);
  assert.ok(names.some(name => name.endsWith('.hbc')), `${platform} must contain a compiled Hermes bundle`);
  let verified = 0;
  for (const name of names.filter(name => name.endsWith('.map'))) {
    const map = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
    for (let i = 0; i < map.sources.length; i++) {
      const source = map.sources[i];
      if (!source.includes('/decode-uri-component/')) continue;
      assert.ok(source.endsWith('/index.cjs'), `${platform} must resolve the callable CJS entry`);
      assert.equal(map.sourcesContent?.[i], expected, `${platform} must bundle the reviewed official decoder through its exact adapter`);
      verified++;
    }
  }
  assert.equal(verified, 1, `${platform} must include exactly one reviewed decoder`);
  console.log(`${platform}: Hermes bundle includes the exact reviewed CJS decoder.`);
}
