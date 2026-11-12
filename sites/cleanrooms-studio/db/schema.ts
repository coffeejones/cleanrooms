import { check, integer, primaryKey, real, sqliteTable, text, uniqueIndex, index, foreignKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const workspaceEmployeePreferences = sqliteTable('workspace_employee_preferences', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  personId: text('person_id').notNull(),
  version: integer('version').notNull(),
  config: text('config').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.personId] })]);

export const studioStates = sqliteTable('studio_states', {
  ownerId: text('owner_id').primaryKey().notNull(),
  revision: integer('revision').notNull(),
  writeToken: text('write_token').notNull(),
  chunkCount: integer('chunk_count').notNull(),
  byteLength: integer('byte_length').notNull(),
  updatedAt: text('updated_at').notNull(),
  demoSeed:integer('demo_seed'),
  demoSeedRevision:integer('demo_seed_revision'),
  defaultWeeklyHours:real('default_weekly_hours'),
});

export const studioStateChunks = sqliteTable('studio_state_chunks', {
  ownerId: text('owner_id').notNull().references(() => studioStates.ownerId, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
}, table => [primaryKey({ columns: [table.ownerId, table.revision, table.chunkIndex] })]);

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey().notNull(),
  ownerUserId: text('owner_user_id').notNull().unique(),
  snapshotOwnerId: text('snapshot_owner_id').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const workspacePlans = sqliteTable('workspace_plans', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id),
  plan: text('plan').notNull().default('free_beta'),
});

export const workspaceRoles = sqliteTable('workspace_roles', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  id: text('id').notNull(),
  name: text('name').notNull(),
  permissions: text('permissions').notNull(),
  version: integer('version').notNull().default(1),
  isSystem: integer('is_system').notNull().default(0),
  writeToken: text('write_token').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.id]})]);

export const workspaceDirectoryState = sqliteTable('workspace_directory_state', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(()=>workspaces.id),version:integer('version').notNull(),nextSiteIndex:integer('next_site_index').notNull(),
  rosterPresent:integer('roster_present').notNull(),organizationPresent:integer('organization_present').notNull(),config:text('config').notNull(),byteLength:integer('byte_length').notNull(),chunkCount:integer('chunk_count').notNull(),payloadVersion:integer('payload_version').notNull(),writeToken:text('write_token').notNull(),updatedAt:text('updated_at').notNull(),
});
export const workspaceDirectoryRecords = sqliteTable('workspace_directory_records', {
  workspaceId:text('workspace_id').notNull().references(()=>workspaces.id),kind:text('kind').notNull(),id:text('id').notNull(),version:integer('version').notNull(),deleted:integer('deleted').notNull().default(0),position:integer('position').notNull(),siteIndex:integer('site_index'),active:integer('active'),nameSort:text('name_sort').notNull(),catalog:text('catalog').notNull(),config:text('config').notNull(),byteLength:integer('byte_length').notNull(),chunkCount:integer('chunk_count').notNull(),writeToken:text('write_token').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.kind,table.id]}),uniqueIndex('workspace_directory_site_index').on(table.workspaceId,table.siteIndex).where(sql`${table.kind}='site'`),uniqueIndex('workspace_directory_organization_id').on(table.workspaceId,table.id).where(sql`${table.kind} IN ('site','department')`),index('workspace_directory_order').on(table.workspaceId,table.kind,table.deleted,table.position,table.id),index('workspace_directory_active').on(table.workspaceId,table.kind,table.deleted,table.active,table.nameSort,table.id),index('workspace_directory_site').on(table.workspaceId,table.kind,table.siteIndex,table.deleted,table.id)]);
export const workspaceDirectoryChunks = sqliteTable('workspace_directory_chunks', {
  workspaceId:text('workspace_id').notNull().references(()=>workspaces.id),kind:text('kind').notNull(),id:text('id').notNull(),version:integer('version').notNull(),chunkIndex:integer('chunk_index').notNull(),content:text('content').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.kind,table.id,table.version,table.chunkIndex]})]);

export const workspacePayroll = sqliteTable('workspace_payroll', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  personId: text('person_id').notNull(),
  config: text('config').notNull(),
  version: integer('version').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: text('updated_at').notNull(),
  writeToken: text('write_token').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.personId]})]);

export const workspacePayrollPolicies = sqliteTable('workspace_payroll_policies', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id),
  config: text('config').notNull(),
  version: integer('version').notNull(),
  history: text('history').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: text('updated_at').notNull(),
  writeToken: text('write_token').notNull(),
});

export const workspaceMembers = sqliteTable('workspace_members', {
  userId: text('user_id').primaryKey().notNull(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role', {enum:['admin','planner','employee']}).notNull(),
  roleId: text('role_id'),
  manageDepartments: integer('manage_departments').notNull().default(0),
  accessScope: text('access_scope').notNull().default('{"mode":"all","departmentIds":[]}'),
  personId: text('person_id'),
  status: text('status', {enum:['active','disabled']}).notNull().default('active'),
  version: integer('version').notNull().default(1),
  preferences: text('preferences').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('workspace_members_active_person_unique').on(table.workspaceId,table.personId)
  .where(sql`${table.status} = 'active' AND ${table.role} = 'employee' AND ${table.personId} IS NOT NULL`),
  index('workspace_push_member_identity').on(table.workspaceId,table.personId,table.userId)]);

export const workspaceCompanySignups = sqliteTable('workspace_company_signups', {
  siteUserId: text('site_user_id').notNull(),
  requestId: text('request_id').notNull(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id).unique(),
  memberUserId: text('member_user_id').notNull().references(() => workspaceMembers.userId).unique(),
  companyName: text('company_name').notNull(),
  siteName: text('site_name').notNull(),
}, table => [primaryKey({ columns: [table.siteUserId, table.requestId] })]);

export const workspaceWebCredentials = sqliteTable('workspace_web_credentials', {
  userId: text('user_id').primaryKey().notNull().references(() => workspaceMembers.userId),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  email: text('email').notNull().unique(),
  passwordSalt: text('password_salt').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordScheme: text('password_scheme').notNull(),
  siteUserId: text('site_user_id'),
  signupRequestId: text('signup_request_id'),
  signupFingerprint: text('signup_fingerprint'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  revokedAt: integer('revoked_at'),
}, table => [
  check('workspace_web_credential_version_valid', sql`${table.version} >= 1`),
  check('workspace_web_credential_site_owner_valid', sql`${table.siteUserId} IS NULL OR ${table.siteUserId} = ${table.userId}`),
  check('workspace_web_credential_signup_metadata_valid', sql`(${table.signupRequestId} IS NULL) = (${table.signupFingerprint} IS NULL)`),
]);

export const workspaceWebSessions = sqliteTable('workspace_web_sessions', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => workspaceWebCredentials.userId),
  credentialVersion: integer('credential_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('workspace_web_sessions_expiry').on(table.expiresAt)]);

export const workspaceWebAuthAttempts = sqliteTable('workspace_web_auth_attempts', {
  scopeHash: text('scope_hash').primaryKey().notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('workspace_web_auth_attempts_expiry').on(table.expiresAt)]);

export const workspaceInvites = sqliteTable('workspace_invites', {
  id: text('id').primaryKey().notNull(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role', {enum:['admin','planner','employee']}).notNull(),
  roleId: text('role_id'),
  manageDepartments: integer('manage_departments').notNull().default(0),
  accessScope: text('access_scope').notNull().default('{"mode":"all","departmentIds":[]}'),
  personId: text('person_id'),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status', {enum:['pending','accepted','revoked']}).notNull().default('pending'),
  version: integer('version').notNull().default(1),
  expiresAt: text('expires_at').notNull(),
  createdBy: text('created_by').notNull(),
  acceptedBy: text('accepted_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceMobileCredentials = sqliteTable('workspace_mobile_credentials', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  personId: text('person_id').notNull(),
  email: text('email').notNull(),
  passwordSalt: text('password_salt').notNull(),
  passwordHash: text('password_hash').notNull(),
  passwordScheme: text('password_scheme').notNull(),
  startCodeCiphertext: text('start_code_ciphertext'),
  temporary: integer('temporary').notNull(),
  version: integer('version').notNull(),
  writeToken: text('write_token').notNull(),
  updatedAt: integer('updated_at').notNull(),
  revokedAt: integer('revoked_at'),
}, table => [primaryKey({ columns: [table.workspaceId, table.personId] }),
  uniqueIndex('workspace_mobile_active_email').on(table.email).where(sql`${table.revokedAt} IS NULL`)]);

export const workspaceMobileSessions = sqliteTable('workspace_mobile_sessions', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  workspaceId: text('workspace_id').notNull(),
  personId: text('person_id').notNull(),
  credentialVersion: integer('credential_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [foreignKey({ columns: [table.workspaceId, table.personId], foreignColumns: [workspaceMobileCredentials.workspaceId, workspaceMobileCredentials.personId] }),
  index('workspace_mobile_sessions_person').on(table.workspaceId, table.personId),
  index('workspace_mobile_sessions_expiry').on(table.expiresAt)]);

export const workspaceMobileAuthAttempts = sqliteTable('workspace_mobile_auth_attempts', {
  scopeHash: text('scope_hash').primaryKey().notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
  writeToken: text('write_token').notNull(),
}, table => [index('workspace_mobile_auth_attempts_expiry').on(table.expiresAt)]);

export const workspaceTimekeeping = sqliteTable('workspace_timekeeping', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id),
  config: text('config').notNull(),
  version: integer('version').notNull(),
  writeToken: text('write_token').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Durable audit is separate from the bounded recovery cache in a plan snapshot.
export const workspaceActivity = sqliteTable('workspace_activity', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  id: text('id').notNull(),
  at: text('at').notNull(),
  actorId: text('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  kind: text('kind').notNull(),
  areas: text('areas').notNull(),
  personIds: text('person_ids').notNull(),
  entry: text('entry').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.id]}),
  index('workspace_activity_order').on(table.workspaceId,table.at,table.id),
  index('workspace_activity_actor').on(table.workspaceId,table.actorId,table.at)]);

export const workspaceActivityImports = sqliteTable('workspace_activity_imports', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id),
  planRevision: integer('plan_revision').notNull().default(-1),
  timeVersion: integer('time_version').notNull().default(-1),
});

// Message reads must not invalidate a planner's unsaved calendar revision.
export const workspaceMessageReceipts = sqliteTable('workspace_message_receipts', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  messageId: text('message_id').notNull(),
  personId: text('person_id').notNull(),
  readAt: text('read_at').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.messageId]}),
  index('workspace_message_receipts_person').on(table.workspaceId,table.personId)]);

// Workflow examples have their own revision and never share the live plan or receipts.
export const workspaceWorkflowDemo = sqliteTable('workspace_workflow_demo', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id),
  config: text('config').notNull(),
  version: integer('version').notNull(),
  writeToken: text('write_token').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Operational records have independent versions; attendance never rewrites a company ledger.
export const workspaceTimeEntries = sqliteTable('workspace_time_entries', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  id: text('id').notNull(), shiftId: text('shift_id').notNull(), personId: text('person_id').notNull(),
  workDate: text('work_date').notNull(), endDate: text('end_date').notNull(), status: text('status').notNull(),
  demo: integer('demo').notNull().default(0), version: integer('version').notNull(), config: text('config').notNull(),
  writeToken: text('write_token').notNull(), updatedAt: text('updated_at').notNull(),
  intervalStart: integer('interval_start'), intervalEnd: integer('interval_end'),
}, table => [primaryKey({columns:[table.workspaceId,table.id]}),
  uniqueIndex('workspace_time_entries_shift').on(table.workspaceId,table.shiftId,table.demo),
  uniqueIndex('workspace_time_entries_running').on(table.workspaceId,table.personId,table.demo).where(sql`${table.status} IN ('running','paused')`),
  index('workspace_time_entries_period').on(table.workspaceId,table.workDate,table.id),
  index('workspace_time_entries_person_period').on(table.workspaceId,table.personId,table.workDate,table.id)]);

export const workspacePayrollRevisions = sqliteTable('workspace_payroll_revisions', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), personId: text('person_id').notNull(),
  version: integer('version').notNull(), config: text('config').notNull(), actorId: text('actor_id').notNull(),
  actorName: text('actor_name').notNull(), recordedAt: text('recorded_at').notNull(), source: text('source').notNull().default('save'),
}, table => [primaryKey({columns:[table.workspaceId,table.personId,table.version]})]);

export const workspaceChecklistTasks = sqliteTable('workspace_checklist_tasks', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), shiftId: text('shift_id').notNull(),
  personId: text('person_id').notNull(), taskKey: text('task_key').notNull(), signature: text('signature').notNull(),
  structure: text('structure').notNull(), checked: integer('checked').notNull(), version: integer('version').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.shiftId,table.personId,table.taskKey]})]);

export const workspaceShiftRequests = sqliteTable('workspace_shift_requests', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), id: text('id').notNull(), shiftId: text('shift_id').notNull(),
  kind: text('kind').notNull(), fromPersonId: text('from_person_id').notNull(), toPersonId: text('to_person_id').notNull(),
  status: text('status').notNull(), version: integer('version').notNull(), config: text('config').notNull(), updatedAt: text('updated_at').notNull(), writeToken: text('write_token').notNull().default(''),
}, table => [primaryKey({columns:[table.workspaceId,table.id]}),
  uniqueIndex('workspace_shift_requests_active').on(table.workspaceId,table.shiftId,table.kind,table.fromPersonId).where(sql`${table.status} IN ('awaiting_colleague','pending')`),
  index('workspace_shift_requests_status').on(table.workspaceId,table.status,table.updatedAt),
  index('workspace_shift_requests_sender').on(table.workspaceId,table.fromPersonId),
  index('workspace_shift_requests_recipient').on(table.workspaceId,table.toPersonId)]);

export const workspaceShiftMessages = sqliteTable('workspace_shift_messages', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), id: text('id').notNull(),
  personId: text('person_id').notNull(), kind: text('kind').notNull(), createdAt: text('created_at').notNull(), config: text('config').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.id]}),index('workspace_shift_messages_person').on(table.workspaceId,table.personId,table.createdAt,table.id),index('workspace_shift_messages_planner').on(table.workspaceId,table.createdAt,table.id).where(sql`${table.kind} NOT IN ('reminder','checkout_reminder')`)]);

export const workspaceEngagementImports = sqliteTable('workspace_engagement_imports', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id), planRevision: integer('plan_revision').notNull(), token: text('token').notNull(),
});

export const workspaceAbsences = sqliteTable('workspace_absences', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), id: text('id').notNull(), personId: text('person_id').notNull(),
  fromDate: text('from_date').notNull(), toDate: text('to_date').notNull(), type: text('type').notNull(), status: text('status').notNull(),
  version: integer('version').notNull(), config: text('config').notNull(), writeToken: text('write_token').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.id]}),index('workspace_absences_person_period').on(table.workspaceId,table.personId,table.fromDate,table.toDate),index('workspace_absences_status').on(table.workspaceId,table.status,table.fromDate)]);

export const workspaceAbsenceImports = sqliteTable('workspace_absence_imports', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id),
  version: integer('version').notNull().default(0), importedAt: text('imported_at').notNull(),
});

export const workspacePlanRecords = sqliteTable('workspace_plan_records', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), kind: text('kind').notNull(), id: text('id').notNull(),
  version: integer('version').notNull(), deleted: integer('deleted').notNull().default(0), config: text('config').notNull(),
  writeToken: text('write_token').notNull(), sortOrder: integer('sort_order').notNull().default(0), updatedAt: text('updated_at').notNull(),
  windowFrom: text('window_from'), windowTo: text('window_to'), originDate: text('origin_date'), parentId: text('parent_id'), groupId: text('group_id'), weekIndex: integer('week_index'),
  windowSchema: integer('window_schema').notNull().default(0), windowVersion: integer('window_version').notNull().default(0),
  personId: text('person_id'), siteIndex: integer('site_index'), scheduleConfig: text('schedule_config').notNull().default(''), scheduleVersion: integer('schedule_version').notNull().default(0),
}, table => [primaryKey({columns:[table.workspaceId,table.kind,table.id]}),index('workspace_plan_records_kind').on(table.workspaceId,table.kind,table.deleted,table.sortOrder,table.id),
  index('workspace_plan_window_from').on(table.workspaceId,table.kind,table.windowFrom,table.id),index('workspace_plan_window_to').on(table.workspaceId,table.kind,table.windowTo,table.id),
  index('workspace_plan_window_origin').on(table.workspaceId,table.kind,table.originDate,table.id),index('workspace_plan_window_week').on(table.workspaceId,table.kind,table.weekIndex,table.id),
  index('workspace_plan_window_dirty').on(table.workspaceId,table.windowSchema,table.kind,table.id),
  index('workspace_plan_group').on(table.workspaceId,table.kind,table.groupId,table.id),index('workspace_plan_parent').on(table.workspaceId,table.kind,table.parentId,table.id),
  index('workspace_plan_person_period').on(table.workspaceId,table.kind,table.personId,table.windowTo,table.windowFrom,table.id),index('workspace_plan_site_period').on(table.workspaceId,table.kind,table.siteIndex,table.windowTo,table.windowFrom,table.id),
  index('workspace_plan_schedule_dirty').on(table.workspaceId,table.scheduleVersion,table.kind,table.id)]);

export const workspacePlanRecordChunks = sqliteTable('workspace_plan_record_chunks', {
  workspaceId: text('workspace_id').notNull(), kind: text('kind').notNull(), id: text('id').notNull(),
  version: integer('version').notNull(), chunkIndex: integer('chunk_index').notNull(), content: text('content').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.kind,table.id,table.version,table.chunkIndex]}),
  foreignKey({columns:[table.workspaceId,table.kind,table.id],foreignColumns:[workspacePlanRecords.workspaceId,workspacePlanRecords.kind,workspacePlanRecords.id]}).onDelete('cascade')]);

export const workspacePlanCalendarChunks = sqliteTable('workspace_plan_calendar_chunks', {
  workspaceId:text('workspace_id').notNull(),kind:text('kind').notNull(),id:text('id').notNull(),version:integer('version').notNull(),chunkIndex:integer('chunk_index').notNull(),content:text('content').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.kind,table.id,table.version,table.chunkIndex]}),foreignKey({columns:[table.workspaceId,table.kind,table.id],foreignColumns:[workspacePlanRecords.workspaceId,workspacePlanRecords.kind,workspacePlanRecords.id]}).onDelete('cascade')]);

export const workspacePlanImports = sqliteTable('workspace_plan_imports', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id), sourceRevision: integer('source_revision').notNull(),
  sourceToken: text('source_token').notNull(), completedAt: text('completed_at').notNull(),
});

export const workspacePlanWindowImports = sqliteTable('workspace_plan_window_imports', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id), schema: integer('schema').notNull(),
  sourceRevision: integer('source_revision').notNull(),sourceToken: text('source_token').notNull(),completedAt: text('completed_at').notNull(),
});

export const workspacePublicationState = sqliteTable('workspace_publication_state', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id), version: integer('version').notNull(), sequence: integer('sequence').notNull(),
  config: text('config').notNull(), byteLength: integer('byte_length').notNull(), chunkCount: integer('chunk_count').notNull(), writeToken: text('write_token').notNull(), updatedAt: text('updated_at').notNull(),
  windowConfig: text('window_config').notNull().default(''),windowVersion: integer('window_version').notNull().default(0),
});

export const workspacePublicationLinks = sqliteTable('workspace_publication_links', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),leftScope: text('left_scope').notNull(),rightScope: text('right_scope').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.leftScope,table.rightScope]}),index('workspace_publication_links_reverse').on(table.workspaceId,table.rightScope,table.leftScope)]);

export const workspacePublicationLinkImports = sqliteTable('workspace_publication_link_imports', {
  workspaceId: text('workspace_id').primaryKey().notNull().references(() => workspaces.id),stateVersion: integer('state_version').notNull(),stateToken: text('state_token').notNull(),
});

export const workspacePublicationScopes = sqliteTable('workspace_publication_scopes', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), scopeKey: text('scope_key').notNull(), fromDate: text('from_date').notNull(), toDate: text('to_date').notNull(), site: integer('site').notNull(),
  version: integer('version').notNull(), deleted: integer('deleted').notNull(), config: text('config').notNull(), byteLength: integer('byte_length').notNull(), chunkCount: integer('chunk_count').notNull(),
  payloadVersion: integer('payload_version').notNull(), writeToken: text('write_token').notNull(), updatedAt: text('updated_at').notNull(),
  windowConfig: text('window_config').notNull().default(''),windowVersion: integer('window_version').notNull().default(0),
}, table => [primaryKey({columns:[table.workspaceId,table.scopeKey]}),index('workspace_publication_scopes_period').on(table.workspaceId,table.fromDate,table.site)]);

export const workspacePublishedShifts = sqliteTable('workspace_published_shifts', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), id: text('id').notNull(), scopeKey: text('scope_key').notNull(), personId: text('person_id').notNull(),
  workDate: text('work_date').notNull(), site: integer('site').notNull(), startTime: text('start_time').notNull(), endTime: text('end_time').notNull(),
  version: integer('version').notNull(), deleted: integer('deleted').notNull(), config: text('config').notNull(), byteLength: integer('byte_length').notNull(), chunkCount: integer('chunk_count').notNull(),
  payloadVersion: integer('payload_version').notNull(), writeToken: text('write_token').notNull(), updatedAt: text('updated_at').notNull(),
  timeConfig:text('time_config').notNull().default(''),timeVersion:integer('time_version').notNull().default(0),
  employeeVersion:integer('employee_version').notNull().default(0),hasDescription:integer('has_description').notNull().default(0),
  checklistTotal:integer('checklist_total').notNull().default(0),checklistStructure:text('checklist_structure').notNull().default(''),workflowFingerprint:text('workflow_fingerprint').notNull().default(''),
  instructionToken:text('instruction_token').notNull().default(''),instructionVersion:integer('instruction_version').notNull().default(0),
}, table => [primaryKey({columns:[table.workspaceId,table.id]}),index('workspace_published_shifts_person').on(table.workspaceId,table.personId,table.workDate,table.id),index('workspace_published_shifts_scope').on(table.workspaceId,table.scopeKey,table.deleted),index('workspace_published_shifts_window').on(table.workspaceId,table.workDate,table.id),index('workspace_published_shifts_time_dirty').on(table.workspaceId,table.timeVersion,table.workDate,table.id),index('workspace_reminder_published_day').on(table.workDate,table.workspaceId,table.id).where(sql`${table.deleted}=0`)]);

export const workspacePublishedChecklistItems=sqliteTable('workspace_published_checklist_items',{
  workspaceId:text('workspace_id').notNull().references(()=>workspaces.id),shiftId:text('shift_id').notNull(),taskKey:text('task_key').notNull(),signature:text('signature').notNull(),structure:text('structure').notNull(),publishedVersion:integer('published_version').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.shiftId,table.taskKey]})]);

export const workspacePublicationRecords = sqliteTable('workspace_publication_records', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), id: text('id').notNull(), position: integer('position').notNull(), at: text('at').notNull(),
  config: text('config').notNull(), byteLength: integer('byte_length').notNull(), chunkCount: integer('chunk_count').notNull(), writeToken: text('write_token').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.id]}),index('workspace_publication_records_position').on(table.workspaceId,table.position,table.id)]);

export const workspacePublicationChunks = sqliteTable('workspace_publication_chunks', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
  version: integer('version').notNull(), chunkIndex: integer('chunk_index').notNull(), content: text('content').notNull(),
}, table => [primaryKey({columns:[table.workspaceId,table.entityType,table.entityId,table.version,table.chunkIndex]})]);


export const workspaceChatRooms=sqliteTable('workspace_chat_rooms',{
 workspaceId:text('workspace_id').notNull().references(()=>workspaces.id),id:text('id').notNull(),departmentId:text('department_id').notNull(),name:text('name').notNull(),version:integer('version').notNull().default(1),latestSeq:integer('latest_seq').notNull().default(0),writeToken:text('write_token').notNull(),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),demo:integer('demo').notNull().default(0),
},table=>[primaryKey({columns:[table.workspaceId,table.id]}),uniqueIndex('workspace_chat_rooms_department').on(table.workspaceId,table.departmentId)]);
export const workspaceChatMessages=sqliteTable('workspace_chat_messages',{
 workspaceId:text('workspace_id').notNull(),roomId:text('room_id').notNull(),id:text('id').notNull(),seq:integer('seq').notNull(),authorId:text('author_id').notNull(),authorName:text('author_name').notNull(),clientId:text('client_id').notNull(),text:text('text').notNull(),createdAt:text('created_at').notNull(),pinned:integer('pinned').notNull().default(0),demo:integer('demo').notNull().default(0),
},table=>[primaryKey({columns:[table.workspaceId,table.roomId,table.id]}),uniqueIndex('workspace_chat_messages_sequence').on(table.workspaceId,table.roomId,table.seq),uniqueIndex('workspace_chat_messages_client').on(table.workspaceId,table.roomId,table.authorId,table.clientId),index('workspace_chat_messages_unread').on(table.workspaceId,table.roomId,table.seq,table.authorId),index('workspace_chat_messages_pinned').on(table.workspaceId,table.roomId,table.pinned,table.seq),foreignKey({columns:[table.workspaceId,table.roomId],foreignColumns:[workspaceChatRooms.workspaceId,workspaceChatRooms.id]})]);
export const workspaceChatReaders=sqliteTable('workspace_chat_readers',{
 workspaceId:text('workspace_id').notNull(),roomId:text('room_id').notNull(),userId:text('user_id').notNull(),lastReadSeq:integer('last_read_seq').notNull().default(0),muted:integer('muted').notNull().default(0),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.workspaceId,table.roomId,table.userId]}),foreignKey({columns:[table.workspaceId,table.roomId],foreignColumns:[workspaceChatRooms.workspaceId,workspaceChatRooms.id]})]);

export const workspacePushDevices = sqliteTable('workspace_push_devices', {
  installationId: text('installation_id').primaryKey().notNull(), workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  personId: text('person_id').notNull(), sessionHash: text('session_hash').notNull(), credentialVersion: integer('credential_version').notNull(),
  expoToken: text('expo_token').notNull(), projectId: text('project_id').notNull(), platform: text('platform').notNull(), siteIndex: integer('site_index'), bindingId: text('binding_id').notNull(), version: integer('version').notNull(),
  active: integer('active').notNull(), registeredAt: integer('registered_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, table => [uniqueIndex('workspace_push_token').on(table.expoToken).where(sql`${table.active}=1`),
  index('workspace_push_person').on(table.workspaceId, table.personId, table.active, table.installationId),
  index('workspace_push_fanout').on(table.workspaceId, table.active, table.installationId), index('workspace_push_session').on(table.sessionHash, table.active), index('workspace_push_site').on(table.workspaceId,table.siteIndex,table.active,table.installationId)]);
export const workspacePushEvents = sqliteTable('workspace_push_events', {
  eventId: text('event_id').primaryKey().notNull().default(sql`(lower(hex(randomblob(16))))`), workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  sourceKind: text('source_kind').notNull(), sourceId: text('source_id').notNull(), roomId: text('room_id').notNull().default(''), personId: text('person_id'),
  createdAt: integer('created_at').notNull(), expanded: integer('expanded').notNull().default(0), afterInstallation: text('after_installation').notNull().default(''), afterSite: integer('after_site').notNull().default(-1),
}, table => [uniqueIndex('workspace_push_events_source').on(table.workspaceId, table.sourceKind, table.roomId, table.sourceId), uniqueIndex('workspace_push_test_minute').on(table.sourceId).where(sql`${table.sourceKind}='test'`), index('workspace_push_events_pending').on(table.expanded, table.createdAt, table.eventId)]);
export const workspacePushDeliveries = sqliteTable('workspace_push_deliveries', {
  eventId: text('event_id').notNull().references(() => workspacePushEvents.eventId, { onDelete: 'cascade' }), installationId: text('installation_id').notNull(),
  workspaceId: text('workspace_id').notNull(), personId: text('person_id').notNull(), status: text('status').notNull(), dueAt: integer('due_at').notNull(),
  attempts: integer('attempts').notNull().default(0), receiptAttempts: integer('receipt_attempts').notNull().default(0), leaseToken: text('lease_token'), leaseUntil: integer('lease_until'),
  deviceVersion: integer('device_version'), bindingId: text('binding_id'), ticketId: text('ticket_id'), sentAt: integer('sent_at'), lastError: text('last_error'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.eventId, table.installationId] }), index('workspace_push_delivery_due').on(table.status, table.dueAt, table.eventId, table.installationId)]);
export const workspacePushDispatchState = sqliteTable('workspace_push_dispatch_state', {
  id: text('id').primaryKey().notNull(), leaseToken: text('lease_token'), leaseUntil: integer('lease_until').notNull().default(0), nextAt: integer('next_at').notNull().default(0), lastStartedAt: integer('last_started_at'), lastSuccessAt: integer('last_success_at'), lastError: text('last_error'), lastProviderError: text('last_provider_error'),
});

export const workspacePayrollPeriods = sqliteTable('workspace_payroll_periods', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), periodFrom: text('period_from').notNull(), periodTo: text('period_to').notNull(),
  status: text('status').notNull(), version: integer('version').notNull(), revision: integer('revision').notNull().default(0), writeToken: text('write_token').notNull(), updatedAt: text('updated_at').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.periodFrom, table.periodTo] }), index('workspace_payroll_period_locks').on(table.workspaceId, table.status, table.periodFrom, table.periodTo)]);
export const workspacePayrollClosures = sqliteTable('workspace_payroll_closures', {
  workspaceId: text('workspace_id').notNull(), periodFrom: text('period_from').notNull(), periodTo: text('period_to').notNull(), revision: integer('revision').notNull(), config: text('config').notNull(), writeToken: text('write_token').notNull(), closedAt: text('closed_at').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.periodFrom, table.periodTo, table.revision] }), foreignKey({ columns: [table.workspaceId, table.periodFrom, table.periodTo], foreignColumns: [workspacePayrollPeriods.workspaceId, workspacePayrollPeriods.periodFrom, workspacePayrollPeriods.periodTo] })]);
export const workspacePayrollExportRows = sqliteTable('workspace_payroll_export_rows', {
  workspaceId: text('workspace_id').notNull(), periodFrom: text('period_from').notNull(), periodTo: text('period_to').notNull(), revision: integer('revision').notNull(), rowId: text('row_id').notNull(), config: text('config').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.periodFrom, table.periodTo, table.revision, table.rowId] }), foreignKey({ columns: [table.workspaceId, table.periodFrom, table.periodTo, table.revision], foreignColumns: [workspacePayrollClosures.workspaceId, workspacePayrollClosures.periodFrom, workspacePayrollClosures.periodTo, workspacePayrollClosures.revision] }), index('workspace_payroll_export_person').on(table.workspaceId, table.periodFrom, table.periodTo, table.revision, sql`json_extract(${table.config}, '$.employeeId')`, sql`json_extract(${table.config}, '$.lineKind')`, table.rowId)]);

export const workspaceShiftReminders = sqliteTable('workspace_shift_reminders', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), id: text('id').notNull(), shiftId: text('shift_id').notNull(), personId: text('person_id').notNull(), kind: text('kind').notNull(), workDate: text('work_date').notNull(), startTime: text('start_time').notNull(), endTime: text('end_time').notNull(), site: integer('site').notNull(), leadMinutes: integer('lead_minutes').notNull(), dueAt: integer('due_at').notNull(), expiresAt: integer('expires_at').notNull(), nextAt: integer('next_at').notNull(), status: text('status').notNull(), createdAt: integer('created_at').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.id] }), uniqueIndex('workspace_shift_reminder_occurrence').on(table.workspaceId, table.shiftId, table.personId, table.workDate, table.startTime, table.endTime, table.site, table.kind, table.leadMinutes), index('workspace_shift_reminder_due').on(table.status, table.nextAt, table.workspaceId, table.id)]);

export const workspacePayrollExportProfiles = sqliteTable('workspace_payroll_export_profiles', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id), id: text('id').notNull(), name: text('name').notNull(), version: integer('version').notNull(), config: text('config').notNull(), writeToken: text('write_token').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(), archivedAt: text('archived_at'),
}, table => [primaryKey({ columns: [table.workspaceId, table.id] }), index('workspace_payroll_export_profile_list').on(table.workspaceId, table.archivedAt, table.name, table.id)]);
export const workspacePayrollExportProfileRevisions = sqliteTable('workspace_payroll_export_profile_revisions', {
  workspaceId: text('workspace_id').notNull(), profileId: text('profile_id').notNull(), version: integer('version').notNull(), config: text('config').notNull(), createdAt: text('created_at').notNull(), createdBy: text('created_by').notNull(),
}, table => [primaryKey({ columns: [table.workspaceId, table.profileId, table.version] }), foreignKey({ columns: [table.workspaceId, table.profileId], foreignColumns: [workspacePayrollExportProfiles.workspaceId, workspacePayrollExportProfiles.id] })]);
