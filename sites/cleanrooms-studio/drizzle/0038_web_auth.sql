CREATE TABLE workspace_web_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES workspace_members(user_id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_scheme TEXT NOT NULL,
  site_user_id TEXT,
  signup_request_id TEXT,
  signup_fingerprint TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (site_user_id IS NULL OR site_user_id = user_id),
  CHECK ((signup_request_id IS NULL) = (signup_fingerprint IS NULL))
);
--> statement-breakpoint
CREATE TABLE workspace_web_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES workspace_web_credentials(user_id),
  credential_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX workspace_web_sessions_expiry ON workspace_web_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE workspace_web_auth_attempts (
  scope_hash TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX workspace_web_auth_attempts_expiry ON workspace_web_auth_attempts(expires_at);
