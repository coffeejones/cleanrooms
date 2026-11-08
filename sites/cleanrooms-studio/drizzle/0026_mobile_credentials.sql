CREATE TABLE workspace_mobile_credentials (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  person_id TEXT NOT NULL,
  email TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_scheme TEXT NOT NULL,
  temporary INTEGER NOT NULL,
  version INTEGER NOT NULL,
  write_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (workspace_id, person_id),
  CHECK (temporary IN (0, 1)),
  CHECK (version >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_mobile_active_email ON workspace_mobile_credentials(email) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE TABLE workspace_mobile_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  credential_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id, person_id) REFERENCES workspace_mobile_credentials(workspace_id, person_id)
);
--> statement-breakpoint
CREATE INDEX workspace_mobile_sessions_person ON workspace_mobile_sessions(workspace_id, person_id);
--> statement-breakpoint
CREATE INDEX workspace_mobile_sessions_expiry ON workspace_mobile_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE workspace_mobile_auth_attempts (
  scope_hash TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  write_token TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX workspace_mobile_auth_attempts_expiry ON workspace_mobile_auth_attempts(expires_at);
