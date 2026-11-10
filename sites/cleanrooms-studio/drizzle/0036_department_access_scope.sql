-- Existing memberships retain company-wide access until an administrator narrows it.
ALTER TABLE workspace_members ADD COLUMN access_scope TEXT NOT NULL DEFAULT '{"mode":"all","departmentIds":[]}' CHECK(json_valid(access_scope));
ALTER TABLE workspace_invites ADD COLUMN access_scope TEXT NOT NULL DEFAULT '{"mode":"all","departmentIds":[]}' CHECK(json_valid(access_scope));
CREATE TRIGGER workspace_member_scope_version BEFORE UPDATE OF access_scope ON workspace_members
WHEN NEW.access_scope<>OLD.access_scope AND NEW.version<=OLD.version
BEGIN SELECT RAISE(ABORT,'department_scope_version_required'); END;
CREATE TRIGGER workspace_invite_scope_version BEFORE UPDATE OF access_scope ON workspace_invites
WHEN NEW.access_scope<>OLD.access_scope AND NEW.version<=OLD.version
BEGIN SELECT RAISE(ABORT,'department_scope_version_required'); END;
