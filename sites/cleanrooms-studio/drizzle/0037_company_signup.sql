CREATE TABLE workspace_plans (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id),
  plan TEXT NOT NULL DEFAULT 'free_beta'
);
--> statement-breakpoint
CREATE TABLE workspace_company_signups (
  site_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  member_user_id TEXT NOT NULL REFERENCES workspace_members(user_id),
  company_name TEXT NOT NULL,
  site_name TEXT NOT NULL,
  PRIMARY KEY (site_user_id, request_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_company_signups_workspace_id_unique ON workspace_company_signups(workspace_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_company_signups_member_user_id_unique ON workspace_company_signups(member_user_id);
