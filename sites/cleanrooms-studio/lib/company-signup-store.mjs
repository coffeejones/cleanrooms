import Departments from '../src/department-model.js';
import { readRawStudio, splitSnapshot, STORAGE_VERSION, StudioError, validateStudio } from './studio-store.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const control = /[\u0000-\u001f\u007f]/;
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const cleanName = value => typeof value === 'string' && !control.test(value) ? value.trim() : '';

function signupInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['name', 'siteName', 'requestId'].includes(key))) {
    throw new StudioError(400, 'company_signup_invalid', 'Oprettelsen indeholder ugyldige oplysninger.');
  }
  const name = cleanName(input.name);
  const siteName = cleanName(input.siteName);
  if (!name || name.length > 120 || !siteName || siteName.length > 120) {
    throw new StudioError(400, 'company_signup_invalid', 'Angiv virksomhedens og arbejdsstedets navn på højst 120 tegn.');
  }
  if (typeof input.requestId !== 'string' || !uuid.test(input.requestId)) {
    throw new StudioError(400, 'company_signup_invalid', 'Åbn oprettelsesformularen igen, og prøv igen.');
  }
  return { name, siteName, requestId: input.requestId.toLowerCase() };
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

export async function createCompany(db, principal, input) {
  const { name, siteName, requestId } = signupInput(input);
  const id = 'ws-' + crypto.randomUUID();
  const memberId = 'company-member-' + crypto.randomUUID();
  const siteId = 'site-' + crypto.randomUUID();
  const departmentId = 'dep-' + crypto.randomUUID();
  const stamp = new Date().toISOString();
  const initial = validateStudio({
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
    workspaceSettings: { companyName: name },
  });
  const { chunks, byteLength } = splitSnapshot(JSON.stringify(initial));
  const created = 'EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND owner_user_id = ?)';

  // Each write after the idempotency check belongs only to this attempted insert.
  const result = await db.batch([
    statement(db, `INSERT INTO workspaces (id, owner_user_id, snapshot_owner_id, created_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM workspace_company_signups WHERE site_user_id = ? AND request_id = ?
      )`, id, memberId, memberId, stamp, principal.userId, requestId),
    statement(db, `INSERT INTO workspace_plans (workspace_id) SELECT ? WHERE ${created}`,
    id, id, memberId),
    statement(db, `INSERT INTO workspace_members
      (user_id, workspace_id, email, name, role, role_id, manage_departments, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'admin', 'admin', 1, ?, ? WHERE ${created}`,
    memberId, id, principal.email, principal.name, stamp, stamp, id, memberId),
    statement(db, `INSERT INTO studio_states
      (owner_id, revision, write_token, chunk_count, byte_length, updated_at, demo_seed, demo_seed_revision)
      SELECT ?, 1, ?, ?, ?, ?, 0, 1 WHERE ${created}`,
    memberId, crypto.randomUUID(), chunks.length, byteLength, stamp, id, memberId),
    ...chunks.map((chunk, index) => statement(db, `INSERT INTO studio_state_chunks
      (owner_id, revision, chunk_index, content) SELECT ?, 1, ?, ? WHERE ${created}`,
    memberId, index, chunk, id, memberId)),
    statement(db, `INSERT INTO workspace_company_signups
      (site_user_id, request_id, workspace_id, member_user_id, company_name, site_name)
      SELECT ?, ?, ?, ?, ?, ? WHERE ${created}`,
    principal.userId, requestId, id, memberId, name, siteName, id, memberId),
    statement(db, `SELECT w.id, p.plan, w.owner_user_id, m.user_id, m.role, m.status,
        signup.company_name, signup.site_name
      FROM workspace_company_signups signup
      JOIN workspaces w ON w.id = signup.workspace_id
      JOIN workspace_plans p ON p.workspace_id = w.id
      JOIN workspace_members m ON m.user_id = signup.member_user_id AND m.workspace_id = w.id
      WHERE signup.site_user_id = ? AND signup.request_id = ?`, principal.userId, requestId),
  ]);
  const row = result.at(-1)?.results?.[0];
  if (!row || row.status !== 'active' || row.user_id !== row.owner_user_id) {
    throw new StudioError(403, 'company_access_denied', 'Du har ikke adgang til denne virksomhed.');
  }
  if (row.company_name !== name || row.site_name !== siteName) {
    throw new StudioError(409, 'company_signup_changed', 'Virksomheden er allerede oprettet. Åbn formularen igen for at oprette en anden.');
  }
  return companySummary(row, row.company_name);
}

async function accessibleCompanies(db, userId, workspaceId = null) {
  const result = await db.batch([statement(db, `WITH member_ids(user_id, workspace_id) AS (
      SELECT ?, NULL WHERE NOT EXISTS (SELECT 1 FROM workspace_company_signups WHERE member_user_id = ?)
      UNION ALL
      SELECT member_user_id, workspace_id FROM workspace_company_signups WHERE site_user_id = ?
    )
    SELECT w.id, COALESCE(p.plan, 'free_beta') AS plan, w.owner_user_id,
        w.snapshot_owner_id, m.user_id, m.role, signup.company_name
    FROM member_ids
    JOIN workspace_members m ON m.user_id = member_ids.user_id
      AND (member_ids.workspace_id IS NULL OR m.workspace_id = member_ids.workspace_id)
    JOIN workspaces w ON w.id = m.workspace_id
    LEFT JOIN workspace_plans p ON p.workspace_id = w.id
    LEFT JOIN workspace_company_signups signup ON signup.workspace_id = w.id
    WHERE m.status = 'active' ${workspaceId === null ? '' : 'AND w.id = ?'}
    ORDER BY w.created_at, w.id`, userId, userId, userId, ...(workspaceId === null ? [] : [workspaceId]))]);
  return result[0]?.results || [];
}

export async function listCompanies(db, principal) {
  const companies = [];
  for (const row of await accessibleCompanies(db, principal.userId)) {
    const { studio } = await readRawStudio(db, row.snapshot_owner_id);
    companies.push(companySummary(row, cleanName(studio?.workspaceSettings?.companyName) || row.company_name || 'CleanRooms'));
  }
  return companies;
}

export async function resolveCompanyPrincipal(db, principal, workspaceId) {
  if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 512 ||
      workspaceId !== workspaceId.trim() || control.test(workspaceId)) {
    throw new StudioError(400, 'company_selection_invalid', 'Vælg en gyldig virksomhed.');
  }
  const [membership] = await accessibleCompanies(db, principal.userId, workspaceId);
  if (!membership) {
    throw new StudioError(403, 'company_access_denied', 'Du har ikke adgang til denne virksomhed.');
  }
  return { ...principal, userId: membership.user_id };
}
