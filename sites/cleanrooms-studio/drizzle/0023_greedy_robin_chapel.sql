ALTER TABLE `workspace_published_shifts` ADD `instruction_token` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_published_shifts` ADD `instruction_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TRIGGER workspace_published_shifts_instruction_dirty_update
AFTER UPDATE OF version ON workspace_published_shifts
WHEN NEW.instruction_version<>NEW.version
BEGIN
  UPDATE workspace_published_shifts SET instruction_version=0
  WHERE workspace_id=NEW.workspace_id AND id=NEW.id;
END;
