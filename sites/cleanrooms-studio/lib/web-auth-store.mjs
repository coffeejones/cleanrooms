import { createHash, randomBytes } from 'node:crypto';
import { normalizeMobileEmail as normalizeWebEmail, passwordRecord, passwordScheme, validPasswordInput, verifiesPassword } from './mobile-auth-store.mjs';
import { StudioError } from './studio-store.mjs';

export { normalizeWebEmail };

const passwordLimit = 128;
const lifetimeSeconds = 7 * 24 * 60 * 60;
const windowSeconds = 15 * 60;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const requestIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fingerprintPattern = /^[a-f0-9]{64}$/;
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const hashText = value => createHash('sha256').update(value).digest('hex');

function fail(status, code, message) {
  throw new StudioError(status, code, message);
}

function invalidLogin() {
  fail(401, 'web_credentials_invalid', 'E-mail eller adgangskode er forkert.');
}

function invalidSession() {
  fail(401, 'web_session_invalid', 'Din session er udløbet. Log ind igen.');
}

async function first(db, sql, ...values) {
  const [result] = await db.batch([statement(db, sql, ...values)]);
  return result?.results?.[0] ?? null;
}

function requirePassword(password, minimum) {
  if (validPasswordInput(password)) {
    const length = [...password].length;
    if (length >= minimum && length <= passwordLimit) return;
  }
  fail(400, 'web_password_invalid', `Vælg en adgangskode på ${minimum} til ${passwordLimit} tegn.`);
}

export function validateWebPassword(password) {
  requirePassword(password, 12);
}

export async function verifyWebCredential(row, password) {
  return validPasswordInput(password) && await verifiesPassword(password, row);
}

function requireEmail(email) {
  const address = normalizeWebEmail(email);
  if (!address) fail(400, 'web_email_invalid', 'Indtast en gyldig e-mailadresse.');
  return address;
}

export async function prepareWebCredential(db, {
  userId, workspaceId, email, password, signupRequestId = null, signupFingerprint = null, now = Date.now(),
}, condition = { sql: '1', values: [] }) {
  const address = requireEmail(email);
  validateWebPassword(password);
  if ((signupRequestId !== null || signupFingerprint !== null) &&
      (!requestIdPattern.test(signupRequestId) || !fingerprintPattern.test(signupFingerprint))) {
    throw new TypeError('Invalid web signup request metadata.');
  }
  const { salt, hash } = await passwordRecord(password);
  return statement(db, `INSERT INTO workspace_web_credentials
    (user_id, workspace_id, email, password_salt, password_hash, password_scheme, created_at,
      signup_request_id, signup_fingerprint)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${condition.sql}`,
  userId, workspaceId, address, salt, hash, passwordScheme, now, signupRequestId, signupFingerprint, ...condition.values);
}

function sourceKey(ip) {
  return typeof ip === 'string' && ip.length > 0 && ip.length <= 64 ? ip : 'unknown';
}

async function cleanupExpired(db, now) {
  await db.batch([
    statement(db, `DELETE FROM workspace_web_auth_attempts WHERE scope_hash IN
      (SELECT scope_hash FROM workspace_web_auth_attempts WHERE expires_at <= ? ORDER BY expires_at LIMIT 32)`, now),
    statement(db, `DELETE FROM workspace_web_sessions WHERE token_hash IN
      (SELECT token_hash FROM workspace_web_sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 32)`, now),
  ]);
}

async function reserveAttempt(db, scope, limit, now) {
  const scopeHash = hashText(JSON.stringify(scope));
  const [result, selected] = await db.batch([
    statement(db, `INSERT INTO workspace_web_auth_attempts (scope_hash, attempts, expires_at)
      VALUES (?, 1, ?)
      ON CONFLICT(scope_hash) DO UPDATE SET
        attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
        expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
      WHERE expires_at <= ? OR attempts < ?`, scopeHash, now + windowSeconds * 1000, now, now, now, limit),
    statement(db, 'SELECT expires_at FROM workspace_web_auth_attempts WHERE scope_hash = ?', scopeHash),
  ]);
  const expiresAt = selected.results[0].expires_at;
  if (result?.meta?.changes !== 1) {
    const error = new StudioError(429, 'web_auth_rate_limited', 'For mange forsøg. Prøv igen om lidt.');
    error.retryAfterSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));
    throw error;
  }
  return { scopeHash, expiresAt };
}

export async function reserveWebSignup({ db, ip, now = Date.now() }) {
  await cleanupExpired(db, now);
  await reserveAttempt(db, ['signup', sourceKey(ip)], 10, now);
}

const activeMember = `JOIN workspace_members member
  ON member.user_id = credential.user_id AND member.workspace_id = credential.workspace_id AND member.status = 'active'`;
const allowSite = '(credential.site_user_id IS NULL OR credential.site_user_id = ?)';
const identityFields = 'credential.user_id, credential.workspace_id, credential.email, member.name';
const credentialFields = 'credential.password_salt, credential.password_hash, credential.password_scheme';

function principalFromRow(row) {
  return { userId: row.user_id, workspaceId: row.workspace_id, email: row.email, name: row.name };
}

export async function loginWeb({ db, email, password, ip, siteUserId = null, now = Date.now() }) {
  const address = normalizeWebEmail(email);
  if (!address || !validPasswordInput(password) || [...password].length > passwordLimit) invalidLogin();
  const source = sourceKey(ip);
  await cleanupExpired(db, now);
  await reserveAttempt(db, ['login-source', source], 60, now);
  const localAttempt = await reserveAttempt(db, ['login-email-source', address, source], 8, now);
  const globalAttempt = await reserveAttempt(db, ['login-email', address], 40, now);
  const row = await first(db, `SELECT ${identityFields}, ${credentialFields}, credential.version
    FROM workspace_web_credentials credential ${activeMember}
    WHERE credential.email = ? AND credential.revoked_at IS NULL AND ${allowSite}`, address, siteUserId);
  if (!await verifyWebCredential(row, password)) invalidLogin();

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashText(token);
  const expiry = now + lifetimeSeconds * 1000;
  const [result] = await db.batch([
    statement(db, `INSERT INTO workspace_web_sessions (token_hash, user_id, credential_version, expires_at)
      SELECT ?, credential.user_id, credential.version, ?
      FROM workspace_web_credentials credential ${activeMember}
      WHERE credential.user_id = ? AND credential.workspace_id = ? AND credential.email = ?
        AND credential.version = ? AND credential.revoked_at IS NULL AND ${allowSite}`,
    tokenHash, expiry, row.user_id, row.workspace_id, address, row.version, siteUserId),
    ...[localAttempt, globalAttempt].map(attempt => statement(db, `UPDATE workspace_web_auth_attempts
      SET attempts = MAX(0, attempts - 1) WHERE scope_hash = ? AND expires_at = ?
      AND EXISTS (SELECT 1 FROM workspace_web_sessions WHERE token_hash = ?)`,
    attempt.scopeHash, attempt.expiresAt, tokenHash)),
  ]);
  if (result?.meta?.changes !== 1) invalidLogin();
  return { token, expiresAt: new Date(expiry).toISOString(), principal: principalFromRow(row) };
}

function cookieName(request) {
  const url = new URL(request.url);
  if (url.protocol === 'https:') return '__Host-cleanrooms-web';
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return 'cleanrooms-web-dev';
  return null;
}

function readSessionToken(request) {
  const name = cookieName(request);
  if (!name) return null;
  const matches = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
    .filter(part => part === name || part.startsWith(name + '='));
  if (!matches.length) return null;
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}

export function hasWebSessionCookie(request) {
  return readSessionToken(request) !== null;
}

function formatCookie(token, request, maxAge) {
  const name = cookieName(request);
  if (!name) fail(400, 'web_https_required', 'Åbn CleanRooms med HTTPS.');
  const secure = name.startsWith('__Host-') ? '; Secure' : '';
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function webSessionCookie(token, request) {
  if (typeof token !== 'string' || !tokenPattern.test(token)) throw new TypeError('Invalid web session token.');
  return formatCookie(token, request, lifetimeSeconds);
}

export function clearWebSessionCookie(request) {
  return formatCookie('', request, 0);
}

export async function readWebPrincipal({ db, request, siteUserId = null, now = Date.now() }) {
  const token = readSessionToken(request);
  if (token === null) return null;
  if (!tokenPattern.test(token)) invalidSession();
  const row = await first(db, `SELECT ${identityFields}
    FROM workspace_web_sessions session
    JOIN workspace_web_credentials credential ON credential.user_id = session.user_id
      AND credential.version = session.credential_version AND credential.revoked_at IS NULL
    ${activeMember} WHERE session.token_hash = ? AND session.expires_at > ? AND ${allowSite}`,
  hashText(token), now, siteUserId);
  if (!row) invalidSession();
  return principalFromRow(row);
}

export async function logoutWeb({ db, request }) {
  const token = readSessionToken(request);
  if (token && tokenPattern.test(token)) {
    await db.batch([statement(db, 'DELETE FROM workspace_web_sessions WHERE token_hash = ?', hashText(token))]);
  }
}

export async function attachDemoWebCredential({ db, principal, email, password, now = Date.now() }) {
  const address = requireEmail(email);
  requirePassword(password, 6);
  if (!principal || typeof principal.userId !== 'string' || !principal.userId) {
    fail(403, 'web_demo_owner_required', 'Kun ejeren kan oprette et testlogin.');
  }
  const ownerId = principal.userId;
  const activeOwner = `FROM workspace_members member JOIN workspaces workspace
    ON workspace.id = member.workspace_id AND workspace.owner_user_id = member.user_id
    WHERE member.user_id = ? AND member.status = 'active' AND member.role = 'admin'`;
  if (!await first(db, 'SELECT member.user_id ' + activeOwner, ownerId)) {
    fail(403, 'web_demo_owner_required', 'Kun ejeren kan oprette et testlogin.');
  }
  await reserveAttempt(db, ['demo-setup', ownerId], 12, now);
  const { salt, hash } = await passwordRecord(password);
  const [result, current] = await db.batch([
    statement(db, `INSERT INTO workspace_web_credentials
      (user_id, workspace_id, email, password_salt, password_hash, password_scheme, site_user_id, created_at)
      SELECT member.user_id, member.workspace_id, ?, ?, ?, ?, member.user_id, ? ${activeOwner}
      ON CONFLICT DO NOTHING`, address, salt, hash, passwordScheme, now, ownerId),
    statement(db, `SELECT ${identityFields}, ${credentialFields}, credential.site_user_id
      FROM workspace_web_credentials credential ${activeMember}
      JOIN workspaces workspace ON workspace.id = member.workspace_id AND workspace.owner_user_id = member.user_id
      WHERE member.user_id = ? AND member.role = 'admin' AND credential.revoked_at IS NULL`, ownerId),
  ]);
  const row = current.results?.[0];
  if (!row || row.site_user_id !== ownerId || row.email !== address ||
      (result?.meta?.changes !== 1 && !await verifyWebCredential(row, password))) {
    fail(409, 'web_demo_credential_conflict', 'Testlogin kunne ikke oprettes. E-mailen eller kontoen er allerede i brug.');
  }
  return principalFromRow(row);
}
