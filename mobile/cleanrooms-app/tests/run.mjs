import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = mkdtempSync(path.join(tmpdir(), 'cleanrooms-mobile-tests-'));
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'commonjs', '--moduleResolution', 'node', '--ignoreDeprecations', '6.0', '--skipLibCheck', '--strict', '--outDir', output,
    'src/domain/model.ts', 'src/domain/worksite-information.ts', 'src/domain/demo.ts', 'src/state/transitions.ts', 'src/state/snapshot.ts', 'src/state/chat-wire.ts', 'src/state/chat-unread.ts', 'src/state/private-draft-store.ts', 'src/state/company-settings-wire.ts', 'src/state/employee-preferences-wire.ts', 'src/state/attendance-runtime.ts', 'src/state/retry-policy.ts', 'src/state/native-path.ts', 'src/auth/pending-logouts.ts', 'src/state/employee-offline-cache.ts'], { cwd: root, stdio: 'inherit' });
  execFileSync(process.execPath, ['--test', 'tests/model.test.cjs', 'tests/employee-offline.test.cjs', 'tests/mobile-auth-api.test.cjs', 'tests/chat-wire.test.cjs', 'tests/private-drafts-runtime.test.cjs', 'tests/company-settings.test.cjs', 'tests/employee-preferences.test.cjs', 'tests/employee-runtime.test.cjs', 'tests/notifications-runtime.test.cjs', 'tests/dependency-security.test.cjs', 'tests/push-runtime.test.cjs', 'tests/native-build-config.test.cjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, CLEANROOMS_TEST_BUILD: output } });
} finally { rmSync(output, { recursive: true, force: true }); }
