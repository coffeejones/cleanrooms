CREATE TRIGGER workspace_mobile_sessions_archive_employee
AFTER UPDATE OF active, deleted ON workspace_directory_records
WHEN OLD.kind = 'employee' AND OLD.active = 1 AND OLD.deleted = 0
  AND (NEW.active IS NOT 1 OR NEW.deleted <> 0)
BEGIN
  DELETE FROM workspace_mobile_sessions WHERE workspace_id = OLD.workspace_id AND person_id = OLD.id;
END;
