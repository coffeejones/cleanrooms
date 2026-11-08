ALTER TABLE workspace_mobile_credentials ADD COLUMN start_code_ciphertext TEXT;
--> statement-breakpoint
CREATE TRIGGER workspace_mobile_start_code_archive_employee
AFTER UPDATE OF active, deleted ON workspace_directory_records
WHEN OLD.kind = 'employee' AND OLD.active = 1 AND OLD.deleted = 0
  AND (NEW.active IS NOT 1 OR NEW.deleted <> 0)
BEGIN
  UPDATE workspace_mobile_credentials SET start_code_ciphertext = NULL
  WHERE workspace_id = OLD.workspace_id AND person_id = OLD.id;
END;
