import { spawn } from 'node:child_process';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = (await readdir(path.join(root, 'tests'))).filter(file => file.endsWith('.test.cjs')).sort();
const concurrency = 4, timeoutMs = 60_000, children = new Set(), results = [];
let next = 0, interrupted = false;
process.on('SIGINT', () => { interrupted = true; for (const child of children) child.kill('SIGTERM'); });
await mkdir(path.join(root, 'outputs/verify'), { recursive: true });
async function worker() {
  while (next < files.length && !interrupted) {
    const file = files[next++], started = performance.now();
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, ['--test', '--test-reporter=tap', '--test-timeout=30000', path.join('tests', file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      children.add(child);
      let output = '', timedOut = false;
      const append = chunk => { output += chunk; };
      child.stdout.on('data', append); child.stderr.on('data', append);
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      child.on('error', error => { output += error.message; });
      child.on('close', code => {
        clearTimeout(timer); children.delete(child);
        const count = key => Number(output.match(new RegExp('^# ' + key + ' (\\d+)$', 'm'))?.[1] ?? 0);
        resolve({ file, code, timedOut, tests: count('tests'), pass: count('pass'), fail: count('fail'), cancelled: count('cancelled'),
          skipped: count('skipped'), durationMs: Math.round(performance.now() - started), output });
      });
    });
    // A process that leaks handles is a failing check, never forcibly marked green.
    result.ok = result.code === 0 && !result.timedOut && result.fail === 0 && result.cancelled === 0 && result.tests > 0;
    await writeFile(path.join(root, 'outputs/verify', file + '.log'), result.output);
    const { output, ...summary } = result; results.push(summary);
    console.log(`${result.ok ? 'PASS' : 'FAIL'} ${file} (${result.pass}/${result.tests}, ${result.durationMs} ms${result.timedOut ? ', process timeout' : ''})`);
    if (!result.ok) console.error(output.slice(-16000));
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
const totals = results.reduce((sum, result) => {
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped']) sum[key] += result[key];
  return sum;
}, { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0 });
await writeFile(path.join(root, 'outputs/verify/results.json'), JSON.stringify({ totals, results }, null, 2) + '\n');
console.log(JSON.stringify({ files: results.length, ...totals, failingFiles: results.filter(result => !result.ok).map(result => result.file) }));
process.exitCode = interrupted || results.length !== files.length || results.some(result => !result.ok) ? 1 : 0;
