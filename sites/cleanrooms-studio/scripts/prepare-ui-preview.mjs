/* Opt-in sample data for this checkout's local UI preview. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { prepareLocalSchema } from './prepare-local-schema.mjs';
import { readExecutionProfile } from './execution-profile.mjs';
import { readRawStudio, writeStudio } from '../lib/studio-store.mjs';
import Data from '../src/studio-data.js';
import Departments from '../src/department-model.js';

if (readExecutionProfile() !== 'portable') {
  throw new Error('UI preview is only available with the portable local profile.');
}

await prepareLocalSchema();
const root = process.cwd();
const proxy = await getPlatformProxy({
  configPath: resolve(root, '.sites-runtime/local-schema.wrangler.json'),
  persist: { path: resolve(root, '.wrangler/state/v3') },
  remoteBindings: false,
  envFiles: [],
});

try {
  // Matches the existing loopback-only Sites sign-in. Never replace a saved plan.
  const owner = 'local_seedy';
  const saved = await readRawStudio(proxy.env.DB, owner);
  if (saved.revision === 0 && saved.studio === null) {
    const result = await writeStudio(proxy.env.DB, owner, 0, {
      storageVersion: 1,
      demoSeed: true,
      calendarAnchor: Data.anchor,
      roster: Data.staff.map(person => ({ ...person })),
      organization: Departments.defaultOrganization(),
      series: [],
      deleted: [],
      coverageRules: [],
      edits: {},
      weekPlans: {},
      requests: {},
      checklistProgress: {},
      employeeExamplesVersion: 1,
    });
    if (!result.ok) throw new Error('The local preview plan could not be created.');
    console.log('Created a local sample plan for seedy@sites.test.');
  } else {
    console.log('Keeping the existing local preview plan and its changes.');
  }
} finally {
  await proxy.dispose();
}

// The server serves this generated document, rather than src/ directly.
for (const [command, args] of [
  [process.execPath, ['scripts/build-editor.mjs']],
  ['python3', ['scripts/build.py']],
]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Local UI preview is ready. Open /signin-with-chatgpt?return_to=/ to sign in.');
