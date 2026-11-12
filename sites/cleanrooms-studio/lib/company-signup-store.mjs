import Departments from '../src/department-model.js';
import { splitSnapshot, STORAGE_VERSION, StudioError, validateStudio } from './studio-store.mjs';
import { normalizeWebEmail, prepareWebCredential, reserveWebSignup, validateWebPassword, verifyWebCredential } from './web-auth-store.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const control = /[\u0000-\u001f\u007f]/;
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const cleanName = value => typeof value === 'string' && !control.test(value) ? value.trim() : '';

function signupInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['name', 'email', 'password', 'companyName', 'siteName', 'requestId'].includes(key))) {
    throw new StudioError(400, 'company_signup_invalid', 'Oprettelsen indeholder ugyldige oplysninger.');
  }
  const name = cleanName(input.name);
  const companyName = cleanName(input.companyName);
  const siteName = cleanName(input.siteName);
  if (!name || name.length > 120 || !companyName || companyName.length > 120 || !siteName || siteName.length > 120) {
    throw new StudioError(400, 'company_signup_invalid', 'Angiv dit navn, virksomhedens navn og arbejdsstedet. Hvert navn må højst være 120 tegn.');
  }
  const email = normalizeWebEmail(input.email);
  if (!email) throw new StudioError(400, 'web_email_invalid', 'Angiv en gyldig e-mailadresse.');
  validateWebPassword(input.password);
  if (typeof input.requestId !== 'string' || !uuid.test(input.requestId)) {
    throw new StudioError(400, 'company_signup_invalid', 'Åbn oprettelsesformularen igen, og prøv igen.');
  }
  return { name, email, password: input.password, companyName, siteName, requestId: input.requestId.toLowerCase() };
}

function companySummary(row, name) {
  return {
    id: row.id,
    name,
    plan: row.plan,
    role: row.role,
    isOwner: row.owner_user_id === row.user_id,
  };
}

function initialCompanyStudio(companyName, siteName) {
  const siteId = 'site-' + crypto.randomUUID();
  const departmentId = 'dep-' + crypto.randomUUID();
  return validateStudio({
    storageVersion: STORAGE_VERSION,
    demoSeed: false,
    series: [],
    edits: {},
    deleted: [],
    weekPlans: {},
    requests: {},
    absences: [],
    coverageRules: [],
    checklistProgress: {},
    roster: [],
    organization: {
      version: 1,
      sites: [{ id: siteId, name: siteName, address: '', color: Departments.COLORS[0] }],
      departments: [{ id: departmentId, name: siteName, kind: 'branch', siteIds: [0] }],
    },
    workspaceSettings: { companyName },
  });
}

async function signupFingerprint({ name, companyName, siteName }) {
  const fields = new TextEncoder().encode(JSON.stringify([name, companyName, siteName]));
  const digest = await crypto.subtle.digest('SHA-256', fields);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function registrationForEmail(db, email) {
  const [result] = await db.batch([statement(db, `SELECT credential.*, workspace.id, workspace.owner_user_id,
      member.role, member.status, plan.plan
    FROM workspace_web_credentials credential
    JOIN workspace_members member ON member.user_id = credential.user_id AND member.workspace_id = credential.workspace_id
    JOIN workspaces workspace ON workspace.id = credential.workspace_id
    LEFT JOIN workspace_plans plan ON plan.workspace_id = workspace.id
    WHERE credential.email = ?`, email)]);
  return result?.results?.[0];
}

async function recoverSignup(row, input, fingerprint) {
  if (row && row.revoked_at === null && row.status === 'active' && row.owner_user_id === row.user_id &&
      row.signup_request_id === input.requestId && row.signup_fingerprint === fingerprint &&
      await verifyWebCredential(row, input.password)) {
    return companySummary(row, input.companyName);
  }
  throw new StudioError(409, 'company_signup_exists', 'Der kunne ikke oprettes en ny konto med den e-mail. Prøv at logge ind.');
}

export async function registerCompany(db, values, { ip } = {}) {
  const input = signupInput(values);
  await reserveWebSignup({ db, ip });
  const fingerprint = await signupFingerprint(input);
  const existing = await registrationForEmail(db, input.email);
  if (existing) return recoverSignup(existing, input, fingerprint);

  const id = 'ws-' + crypto.randomUUID();
  const memberId = 'web-member-' + crypto.randomUUID();
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const initial = initialCompanyStudio(input.companyName, input.siteName);
  const { chunks, byteLength } = splitSnapshot(JSON.stringify(initial));
  const created = {
    sql: 'EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND owner_user_id = ?)',
    values: [id, memberId],
  };
  const credential = await prepareWebCredential(db, {
    userId: memberId, workspaceId: id, email: input.email, password: input.password, now,
    signupRequestId: input.requestId, signupFingerprint: fingerprint,
  }, created);

  // Reserve the normalized address and provision all company records in one batch.
  // A competing signup that already owns the address skips every write in this batch.
  const result = await db.batch([
    statement(db, `INSERT INTO workspaces (id, owner_user_id, snapshot_owner_id, created_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM workspace_web_credentials WHERE email = ?
      ) AND NOT EXISTS (
        SELECT 1 FROM workspace_members WHERE email = ? COLLATE NOCASE
      )`, id, memberId, memberId, stamp, input.email, input.email),
    statement(db, `INSERT INTO workspace_plans (workspace_id) SELECT ? WHERE ${created.sql}`,
    id, ...created.values),
    statement(db, `INSERT INTO workspace_members
      (user_id, workspace_id, email, name, role, role_id, manage_departments, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'admin', 'admin', 1, ?, ? WHERE ${created.sql}`,
    memberId, id, input.email, input.name, stamp, stamp, ...created.values),
    credential,
    statement(db, `INSERT INTO studio_states
      (owner_id, revision, write_token, chunk_count, byte_length, updated_at, demo_seed, demo_seed_revision)
      SELECT ?, 1, ?, ?, ?, ?, 0, 1 WHERE ${created.sql}`,
    memberId, crypto.randomUUID(), chunks.length, byteLength, stamp, ...created.values),
    ...chunks.map((chunk, index) => statement(db, `INSERT INTO studio_state_chunks
      (owner_id, revision, chunk_index, content) SELECT ?, 1, ?, ? WHERE ${created.sql}`,
    memberId, index, chunk, ...created.values)),
  ]);
  if (result[0]?.meta?.changes !== 1) {
    return recoverSignup(await registrationForEmail(db, input.email), input, fingerprint);
  }
  return { id, name: input.companyName, plan: 'free_beta', role: 'admin', isOwner: true };
}

async function legacyCompanyMembership(db, userId, workspaceId = null) {
  const result = await db.batch([statement(db, `WITH member_ids(user_id, workspace_id) AS (
      SELECT ?, NULL WHERE NOT EXISTS (SELECT 1 FROM workspace_company_signups WHERE member_user_id = ?)
      UNION ALL
      SELECT member_user_id, workspace_id FROM workspace_company_signups WHERE site_user_id = ?
    )
    SELECT w.id, m.user_id
    FROM member_ids
    JOIN workspace_members m ON m.user_id = member_ids.user_id
      AND (member_ids.workspace_id IS NULL OR m.workspace_id = member_ids.workspace_id)
    JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.status = 'active' ${workspaceId === null ? '' : 'AND w.id = ?'}
    ORDER BY w.created_at, w.id LIMIT 1`, userId, userId, userId, ...(workspaceId === null ? [] : [workspaceId]))]);
  return result[0]?.results?.[0] ?? null;
}

export async function firstLegacyCompanyId(db, principal) {
  return (await legacyCompanyMembership(db, principal.userId))?.id ?? null;
}

export async function resolveCompanyPrincipal(db, principal, workspaceId) {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 512 ||
      workspaceId !== workspaceId.trim() || control.test(workspaceId)) {
    throw new StudioError(400, 'company_selection_invalid', 'Vælg en gyldig virksomhed.');
  }
  const membership = await legacyCompanyMembership(db, principal.userId, workspaceId);
  if (!membership) {
    throw new StudioError(403, 'company_access_denied', 'Du har ikke adgang til denne virksomhed.');
  }
  return { ...principal, userId: membership.user_id };
}
