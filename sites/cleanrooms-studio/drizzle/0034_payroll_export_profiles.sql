CREATE TABLE workspace_payroll_export_profiles (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 config TEXT NOT NULL,
 write_token TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 archived_at TEXT,
 PRIMARY KEY(workspace_id,id)
);
--> statement-breakpoint
CREATE INDEX workspace_payroll_export_profile_list ON workspace_payroll_export_profiles(workspace_id,archived_at,name,id);
--> statement-breakpoint
CREATE TABLE workspace_payroll_export_profile_revisions (
 workspace_id TEXT NOT NULL,
 profile_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 config TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 PRIMARY KEY(workspace_id,profile_id,version),
 FOREIGN KEY(workspace_id,profile_id) REFERENCES workspace_payroll_export_profiles(workspace_id,id)
);
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_export_profile_immutable_update BEFORE UPDATE ON workspace_payroll_export_profile_revisions
BEGIN SELECT RAISE(ABORT,'payroll_profile_revision_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_export_profile_immutable_delete BEFORE DELETE ON workspace_payroll_export_profile_revisions
BEGIN SELECT RAISE(ABORT,'payroll_profile_revision_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_export_profile_immutable_replace BEFORE INSERT ON workspace_payroll_export_profile_revisions
WHEN EXISTS(SELECT 1 FROM workspace_payroll_export_profile_revisions saved WHERE saved.workspace_id=NEW.workspace_id AND saved.profile_id=NEW.profile_id AND saved.version=NEW.version)
BEGIN SELECT RAISE(ABORT,'payroll_profile_revision_immutable'); END;
