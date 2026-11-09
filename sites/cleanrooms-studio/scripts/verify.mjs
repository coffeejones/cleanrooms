import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const steps = [
  ['node_modules/eslint/bin/eslint.js', '.'],
  ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'],
  ['scripts/test-all.mjs'],
];
for (const args of steps) {
  console.log(`Checking ${args[0]}`);
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
    child.on('error', error => { console.error(error.message); resolve(1); });
    child.on('exit', code => resolve(code ?? 1));
  });
  if (code !== 0) { process.exitCode = code; break; }
}
