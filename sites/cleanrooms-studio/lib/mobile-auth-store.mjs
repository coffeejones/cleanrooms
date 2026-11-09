import { Buffer } from 'node:buffer';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import Directory from '../src/directory-records.js';
import { employeeReferenceGuard } from './directory-references.mjs';
import { StudioError } from './studio-store.mjs';

const passwordScheme = 'scrypt-n16384-r8-p5-v1';
const scryptOptions = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const attemptWindowMs = 15 * 60_000;
const sessionLifetimeMs = 30 * 24 * 60 * 60_000;
const accountAttemptLimit = 8;
const sourceAttemptLimit = 120;
const distributedAccountLimit = 500;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const startCodeKeyPattern = /^[a-f0-9]{64}$/;
const startCodeContext = Buffer.from('cleanrooms:employee-app-start-code:v1');
const startCodeLength = 10;
const startCodeIvLength = 12;
const startCodeTagLength = 16;

const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const changes = result => result?.meta?.changes ?? 0;
const hashText = value => createHash('sha256').update(value).digest('hex');
const fail = (status, code, message) => { throw new StudioError(status, code, message); };
const invalidLogin = () => fail(401, 'mobile_credentials_invalid', 'E-mail eller adgangskode er forkert.');
const invalidSession = () => fail(401, 'mobile_session_invalid', 'Din session er udløbet. Log ind igen.');
const accountConflict = () => fail(409, 'mobile_account_conflict', 'Adgangen er ændret, eller e-mailen bruges allerede. Genindlæs medarbejderen og prøv igen.');
const rateLimited = () => {
  const error = new StudioError(429, 'mobile_auth_rate_limited', 'For mange forsøg. Prøv igen om lidt.');
  error.retryAfterSeconds = Math.ceil(attemptWindowMs / 1000);
  throw error;
};

const activePersonJoin = `JOIN workspace_directory_records employee
  ON employee.workspace_id = credential.workspace_id AND employee.id = credential.person_id
  AND employee.kind = 'employee' AND employee.deleted = 0 AND employee.active = 1`;
const employeeFields = `credential.workspace_id, credential.person_id, credential.email,
  json_extract(employee.catalog, '$.name') AS name`;
const passwordFields = 'credential.password_salt, credential.password_hash, credential.password_scheme';

async function first(db, sql, ...values) {
  const [result] = await db.batch([statement(db, sql, ...values)]);
  return result?.results?.[0] ?? null;
}

export function normalizeMobileEmail(value) {
  if (typeof value !== 'string' || value.length > 320) return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(email) ? email : null;
}

function validPasswordInput(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && Buffer.byteLength(value, 'utf8') <= 512;
}

function requireNewPassword(password) {
  if (validPasswordInput(password)) {
    const length = [...password].length;
    if (length >= 8 && length <= 128) return;
  }
  fail(400, 'mobile_password_invalid', 'Vælg en adgangskode på 8 til 128 tegn.');
}

function temporaryPassword() {
  return Array.from(randomBytes(startCodeLength), byte => alphabet[byte & 63]).join('');
}

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, scryptOptions, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function passwordRecord(password) {
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt);
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

async function verifiesPassword(password, credential) {
  const known = credential?.password_scheme === passwordScheme
    && /^[a-f0-9]{32}$/.test(credential.password_salt) && /^[a-f0-9]{64}$/.test(credential.password_hash);
  const salt = known ? Buffer.from(credential.password_salt, 'hex') : Buffer.alloc(16);
  const expected = known ? Buffer.from(credential.password_hash, 'hex') : Buffer.alloc(32);
  const candidate = await derivePassword(password, salt);
  return timingSafeEqual(candidate, expected) && known === true;
}

function requireAdminGuard(workspaceId, personId, version, actorGuard) {
  if (!actorGuard || typeof actorGuard.sql !== 'string' || !Array.isArray(actorGuard.values)) {
    throw new TypeError('Mobile credential mutations require a server-derived administrator guard.');
  }
  if (!Directory.validId('employee', personId) || typeof workspaceId !== 'string' || !workspaceId
    || !Number.isSafeInteger(version) || version < 0 || version >= Number.MAX_SAFE_INTEGER) {
    fail(400, 'mobile_account_invalid', 'Vælg en medarbejder, og prøv igen.');
  }
}

async function startCodeKey(secret) {
  if (typeof secret !== 'string' || !startCodeKeyPattern.test(secret)) {
    fail(503, 'mobile_start_code_unavailable', 'Startkoder er midlertidigt utilgængelige. Prøv igen.');
  }
  const material = await crypto.subtle.importKey('raw', Buffer.from(secret, 'hex'), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: startCodeContext },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function startCodeIdentity(workspaceId, personId, version) {
  return Buffer.from(JSON.stringify([workspaceId, personId, version]), 'utf8');
}

async function sealStartCode(code, secret, workspaceId, personId, version) {
  const iv = randomBytes(startCodeIvLength);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: startCodeIdentity(workspaceId, personId, version) },
    await startCodeKey(secret), Buffer.from(code, 'utf8'));
  return Buffer.concat([iv, Buffer.from(cipher)]).toString('base64url');
}

async function openStartCode(ciphertext, secret, workspaceId, personId, version) {
  const key = await startCodeKey(secret);
  try {
    const bytes = Buffer.from(ciphertext, 'base64url');
    if (bytes.length !== startCodeIvLength + startCodeLength + startCodeTagLength) throw new Error('Invalid encrypted start code size.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, startCodeIvLength),
      additionalData: startCodeIdentity(workspaceId, personId, version) }, key, bytes.subarray(startCodeIvLength));
    const code = Buffer.from(plain).toString('utf8');
    if (code.length !== startCodeLength || !/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('Invalid start code.');
    return code;
  } catch {
    fail(409, 'mobile_start_code_unreadable', 'Startkoden kan ikke vises. Generér en ny startkode fra profilen.');
  }
}

async function prepareTemporaryCredential(secret, workspaceId, personId, version) {
  const code = temporaryPassword();
  const { salt, hash } = await passwordRecord(code);
  const ciphertext = secret === undefined ? null : await sealStartCode(code, secret, workspaceId, personId, version);
  return { code, salt, hash, ciphertext, writeToken: crypto.randomUUID() };
}

function mobileAccount(row) {
  return {
    personId: row.person_id,
    email: row.email,
    temporary: row.temporary === 1,
    version: row.version,
    status: row.revoked_at === null ? 'active' : 'revoked',
  };
}

export async function listMobileCredentials({ db, workspaceId }) {
  const [result] = await db.batch([statement(db, `SELECT person_id, email, temporary, version, revoked_at
    FROM workspace_mobile_credentials WHERE workspace_id = ? ORDER BY person_id`, workspaceId)]);
  return (result?.results ?? []).map(mobileAccount);
}

export async function readMobileCredential({ db, workspaceId, personId, actorGuard, secret }) {
  requireAdminGuard(workspaceId, personId, 0, actorGuard);
  const row = await first(db, `SELECT credential.person_id, credential.email, credential.temporary, credential.version, credential.revoked_at,
    CASE WHEN credential.start_code_ciphertext IS NOT NULL AND credential.temporary = 1 AND credential.revoked_at IS NULL
      AND employee.active = 1 THEN 1 ELSE 0 END AS has_start_code
    FROM workspace_mobile_credentials credential
    JOIN workspace_directory_records employee ON employee.workspace_id = credential.workspace_id AND employee.kind = 'employee'
      AND employee.id = credential.person_id AND employee.deleted = 0
    WHERE credential.workspace_id = ? AND credential.person_id = ? AND (${actorGuard.sql})`, workspaceId, personId, ...actorGuard.values);
  return row ? { ...mobileAccount(row), canRevealStartCode: row.has_start_code === 1 && typeof secret === 'string' && startCodeKeyPattern.test(secret) } : null;
}

export async function revealMobileStartCode({ db, workspaceId, personId, actorGuard, expectedVersion, secret, audit }) {
  requireAdminGuard(workspaceId, personId, expectedVersion, actorGuard);
  const from = `FROM workspace_mobile_credentials credential ${activePersonJoin}
    WHERE credential.workspace_id = ? AND credential.person_id = ? AND credential.version = ? AND credential.revoked_at IS NULL
      AND credential.temporary = 1 AND credential.start_code_ciphertext IS NOT NULL AND (${actorGuard.sql})`;
  const values = [workspaceId, personId, expectedVersion, ...actorGuard.values];
  const row = await first(db, 'SELECT credential.start_code_ciphertext ' + from, ...values);
  if (!row) accountConflict();
  const code = await openStartCode(row.start_code_ciphertext, secret, workspaceId, personId, expectedVersion);
  const condition = { sql: 'EXISTS (SELECT 1 ' + from + ')', values };
  const identity = { personId, version: expectedVersion, status: 'active' };
  // The authorization/version check and access event share one transaction.
  // Never release decrypted material if recording the access fails.
  const [checked] = await db.batch([
    statement(db, 'SELECT 1 AS allowed WHERE ' + condition.sql, ...condition.values),
    ...(audit?.({ condition, before: identity, after: identity }) ?? []),
  ]);
  if (!checked?.results?.length) accountConflict();
  return code;
}

export async function prepareMobileCredentialCreate({ db, workspaceId, personId, email, actorGuard, secret, atomic = false, now = Date.now() }) {
  requireAdminGuard(workspaceId, personId, 0, actorGuard);
  const address = normalizeMobileEmail(email);
  if (!address) fail(400, 'mobile_email_invalid', 'Skriv en gyldig e-mailadresse.');
  if (atomic && (typeof secret !== 'string' || !startCodeKeyPattern.test(secret))) {
    fail(503, 'mobile_start_code_unavailable', 'Startkoder er midlertidigt utilgængelige. Prøv igen.');
  }
  const employee = employeeReferenceGuard({ workspaceId, personIds: [personId], active: true });
  const { code, salt, hash, ciphertext, writeToken } = await prepareTemporaryCredential(secret, workspaceId, personId, 1);
  const insert = statement(db, `INSERT INTO workspace_mobile_credentials
    (workspace_id, person_id, email, password_salt, password_hash, password_scheme, start_code_ciphertext, temporary, version, write_token, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ? WHERE (${actorGuard.sql}) AND (${employee.sql}) ${atomic ? '' : 'ON CONFLICT DO NOTHING'}`,
  workspaceId, personId, address, salt, hash, passwordScheme, ciphertext, writeToken, now, ...actorGuard.values, ...employee.values);
  return { statement: insert, commit: { sql: 'EXISTS (SELECT 1 FROM workspace_mobile_credentials WHERE workspace_id = ? AND person_id = ? AND write_token = ?)',
    values: [workspaceId, personId, writeToken] }, email: address, temporaryPassword: code, version: 1 };
}

export async function issueMobileCredential({ db, workspaceId, personId, email, actorGuard, expectedVersion, secret, audit, now = Date.now() }) {
  requireAdminGuard(workspaceId, personId, expectedVersion, actorGuard);
  if (expectedVersion === 0) {
    const { statement: insert, commit, email: address, temporaryPassword: code, version } = await prepareMobileCredentialCreate(
      { db, workspaceId, personId, email, actorGuard, secret, now });
    const [result] = await db.batch([insert, ...(audit?.({ condition: commit, before: null,
      after: { personId, email: address, version, status: 'active' } }) ?? [])]);
    if (changes(result) !== 1) accountConflict();
    return { email: address, temporaryPassword: code, version };
  }

  const current = await first(db, `SELECT person_id, email, temporary, version, revoked_at FROM workspace_mobile_credentials
    WHERE workspace_id = ? AND person_id = ? AND version = ?`, workspaceId, personId, expectedVersion);
  if (!current) accountConflict();
  if (email !== undefined && normalizeMobileEmail(email) !== current.email) {
    fail(400, 'mobile_email_unchangeable', 'E-mailadressen kan ikke ændres ved nulstilling af adgangskoden.');
  }
  const address = current.email;
  const employee = employeeReferenceGuard({ workspaceId, personIds: [personId], active: true });
  const { code, salt, hash, ciphertext, writeToken } = await prepareTemporaryCredential(secret, workspaceId, personId, expectedVersion + 1);
  const writeGuard = `(${actorGuard.sql}) AND (${employee.sql})`;
  const guardValues = [...actorGuard.values, ...employee.values];
  const write = statement(db, `UPDATE workspace_mobile_credentials
    SET password_salt = ?, password_hash = ?, password_scheme = ?, start_code_ciphertext = ?, temporary = 1,
        version = version + 1, write_token = ?, updated_at = ?, revoked_at = NULL
    WHERE workspace_id = ? AND person_id = ? AND version = ? AND ${writeGuard}
      AND NOT EXISTS (SELECT 1 FROM workspace_mobile_credentials other WHERE other.email = ? AND other.revoked_at IS NULL
        AND (other.workspace_id <> ? OR other.person_id <> ?))`,
  salt, hash, passwordScheme, ciphertext, writeToken, now, workspaceId, personId, expectedVersion, ...guardValues,
  address, workspaceId, personId);
  const condition = { sql: 'EXISTS (SELECT 1 FROM workspace_mobile_credentials WHERE workspace_id = ? AND person_id = ? AND write_token = ?)',
    values: [workspaceId, personId, writeToken] };
  const [result] = await db.batch([write, deleteSessionsAfterWrite(db, workspaceId, personId, writeToken),
    ...(audit?.({ condition, before: mobileAccount(current),
      after: { personId, email: address, version: expectedVersion + 1, status: 'active' } }) ?? [])]);
  if (changes(result) !== 1) accountConflict();
  return { email: address, temporaryPassword: code, version: expectedVersion + 1 };
}

function deleteSessionsAfterWrite(db, workspaceId, personId, writeToken) {
  return statement(db, `DELETE FROM workspace_mobile_sessions WHERE workspace_id = ? AND person_id = ?
    AND EXISTS (SELECT 1 FROM workspace_mobile_credentials WHERE workspace_id = ? AND person_id = ? AND write_token = ?)`,
  workspaceId, personId, workspaceId, personId, writeToken);
}

export async function revokeMobileCredential({ db, workspaceId, personId, expectedVersion, actorGuard, audit, now = Date.now() }) {
  requireAdminGuard(workspaceId, personId, expectedVersion, actorGuard);
  const writeToken = crypto.randomUUID();
  const condition = { sql: 'EXISTS (SELECT 1 FROM workspace_mobile_credentials WHERE workspace_id = ? AND person_id = ? AND write_token = ?)',
    values: [workspaceId, personId, writeToken] };
  const [result] = await db.batch([
    statement(db, `UPDATE workspace_mobile_credentials SET revoked_at = ?, updated_at = ?, version = version + 1,
      password_salt = '', password_hash = '', start_code_ciphertext = NULL, temporary = 0, write_token = ?
      WHERE workspace_id = ? AND person_id = ? AND version = ? AND revoked_at IS NULL AND (${actorGuard.sql})`,
    now, now, writeToken, workspaceId, personId, expectedVersion, ...actorGuard.values),
    deleteSessionsAfterWrite(db, workspaceId, personId, writeToken),
    ...(audit?.({ condition, before: { personId, version: expectedVersion, status: 'active' },
      after: { personId, version: expectedVersion + 1, status: 'revoked' } }) ?? []),
  ]);
  if (changes(result) !== 1) accountConflict();
  return { version: expectedVersion + 1 };
}

async function reserveAttempt(db, scope, limit, now) {
  const scopeHash = hashText(scope);
  const writeToken = crypto.randomUUID();
  const [result, selected] = await db.batch([statement(db, `INSERT INTO workspace_mobile_auth_attempts
    (scope_hash, attempts, expires_at, write_token) VALUES (?, 1, ?, ?)
    ON CONFLICT(scope_hash) DO UPDATE SET
      attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
      expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END,
      write_token = excluded.write_token
    WHERE expires_at <= ? OR attempts < ?`, scopeHash, now + attemptWindowMs, writeToken, now, now, now, limit),
    statement(db, 'SELECT expires_at FROM workspace_mobile_auth_attempts WHERE scope_hash = ?', scopeHash)]);
  if (changes(result) !== 1) rateLimited();
  return { scopeHash, writeToken, expiresAt: selected.results[0].expires_at };
}

function releaseAttemptAfterSession(db, attempt, session) {
  return statement(db, `UPDATE workspace_mobile_auth_attempts SET attempts = MAX(0, attempts - 1) WHERE scope_hash = ? AND expires_at = ?
    AND EXISTS (SELECT 1 FROM workspace_mobile_sessions WHERE token_hash = ?)`,
    attempt.scopeHash, attempt.expiresAt, session.hash);
}

async function reserveLogin(db, email, ip, now) {
  await db.batch([
    statement(db, `DELETE FROM workspace_mobile_auth_attempts WHERE scope_hash IN
      (SELECT scope_hash FROM workspace_mobile_auth_attempts WHERE expires_at <= ? ORDER BY expires_at LIMIT 32)`, now),
    statement(db, `DELETE FROM workspace_mobile_sessions WHERE token_hash IN
      (SELECT token_hash FROM workspace_mobile_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 32)`, now),
  ]);
  const source = typeof ip === 'string' && ip.length > 0 && ip.length <= 128 ? ip : 'unknown';
  // A known address cannot lock a legitimate login out from a different source
  // after only eight guesses. Bound both source guessing and distributed attacks.
  return [
    await reserveAttempt(db, `login-source:${source}`, sourceAttemptLimit, now),
    await reserveAttempt(db, `login-account-source:${email}:${source}`, accountAttemptLimit, now),
    await reserveAttempt(db, `login-account:${email}`, distributedAccountLimit, now),
  ];
}

function sessionToken(now) {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashText(token), expiry: now + sessionLifetimeMs };
}

function sessionEmployee(row) {
  return { workspaceId: row.workspace_id, personId: row.person_id, email: row.email, name: row.name };
}

function sessionResult(session, row, temporary = row.temporary === 1) {
  return { token: session.token, expiresAt: new Date(session.expiry).toISOString(), employee: sessionEmployee(row),
    temporaryPassword: temporary };
}

export async function loginMobile({ db, email, password, ip, now = Date.now() }) {
  const address = normalizeMobileEmail(email);
  if (!address || !validPasswordInput(password)) invalidLogin();
  const attempts = await reserveLogin(db, address, ip, now);
  const row = await first(db, `SELECT ${employeeFields}, ${passwordFields}, credential.version, credential.temporary
    FROM workspace_mobile_credentials credential ${activePersonJoin}
    WHERE credential.email = ? AND credential.revoked_at IS NULL`, address);
  if (!await verifiesPassword(password, row)) invalidLogin();
  const session = sessionToken(now);
  const [result] = await db.batch([
    statement(db, `INSERT INTO workspace_mobile_sessions (token_hash, workspace_id, person_id, credential_version, expires_at)
      SELECT ?, credential.workspace_id, credential.person_id, credential.version, ?
      FROM workspace_mobile_credentials credential ${activePersonJoin}
      WHERE credential.workspace_id = ? AND credential.person_id = ? AND credential.version = ? AND credential.revoked_at IS NULL`,
    session.hash, session.expiry, row.workspace_id, row.person_id, row.version),
    ...attempts.map(attempt => releaseAttemptAfterSession(db, attempt, session)),
  ]);
  if (changes(result) !== 1) invalidLogin();
  return sessionResult(session, row);
}

async function sessionRow({ db, token, now, includePassword = false }) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) invalidSession();
  const tokenHash = hashText(token);
  const row = await first(db, `SELECT ${employeeFields}, credential.temporary,
    session.credential_version, session.expires_at${includePassword ? ', ' + passwordFields : ''}
    FROM workspace_mobile_sessions session JOIN workspace_mobile_credentials credential
      ON credential.workspace_id = session.workspace_id AND credential.person_id = session.person_id
      AND credential.version = session.credential_version AND credential.revoked_at IS NULL
    ${activePersonJoin} WHERE session.token_hash = ? AND session.expires_at > ?`, tokenHash, now);
  if (!row) invalidSession();
  return { row, tokenHash };
}

export async function readMobileSession({ db, token, now = Date.now() }) {
  const { row, tokenHash } = await sessionRow({ db, token, now });
  return { tokenHash, credentialVersion: row.credential_version, expiresAt: new Date(row.expires_at).toISOString(),
    employee: sessionEmployee(row), temporaryPassword: row.temporary === 1 };
}

export async function changeMobilePassword({ db, token, currentPassword, newPassword, now = Date.now() }) {
  const { row, tokenHash } = await sessionRow({ db, token, now, includePassword: true });
  requireNewPassword(newPassword);
  const attempt = await reserveAttempt(db, `password-change:${row.workspace_id}:${row.person_id}`, accountAttemptLimit, now);
  if (!validPasswordInput(currentPassword) || !await verifiesPassword(currentPassword, row)) {
    fail(400, 'mobile_current_password_invalid', 'Den nuværende adgangskode er forkert.');
  }
  if (currentPassword === newPassword) fail(400, 'mobile_password_invalid', 'Vælg en ny adgangskode, der er forskellig fra den nuværende.');

  const { salt, hash } = await passwordRecord(newPassword);
  const session = sessionToken(now);
  const writeToken = crypto.randomUUID();
  const { workspace_id: workspaceId, person_id: personId, credential_version: version } = row;
  const employee = employeeReferenceGuard({ workspaceId, personIds: [personId], active: true });
  const [updated, , inserted] = await db.batch([
    statement(db, `UPDATE workspace_mobile_credentials
      SET password_salt = ?, password_hash = ?, password_scheme = ?, start_code_ciphertext = NULL, temporary = 0, version = version + 1, write_token = ?, updated_at = ?
      WHERE workspace_id = ? AND person_id = ? AND version = ? AND revoked_at IS NULL AND (${employee.sql})
        AND EXISTS (SELECT 1 FROM workspace_mobile_sessions WHERE token_hash = ? AND expires_at > ?)`,
    salt, hash, passwordScheme, writeToken, now, workspaceId, personId, version, ...employee.values, tokenHash, now),
    deleteSessionsAfterWrite(db, workspaceId, personId, writeToken),
    statement(db, `INSERT INTO workspace_mobile_sessions (token_hash, workspace_id, person_id, credential_version, expires_at)
      SELECT ?, workspace_id, person_id, version, ? FROM workspace_mobile_credentials
      WHERE workspace_id = ? AND person_id = ? AND write_token = ?`, session.hash, session.expiry, workspaceId, personId, writeToken),
    releaseAttemptAfterSession(db, attempt, session),
  ]);
  if (changes(updated) !== 1 || changes(inserted) !== 1) invalidSession();
  return sessionResult(session, row, false);
}

export async function logoutMobile({ db, token }) {
  if (typeof token === 'string' && tokenPattern.test(token)) {
    await db.batch([statement(db, 'DELETE FROM workspace_mobile_sessions WHERE token_hash = ?', hashText(token))]);
  }
}
