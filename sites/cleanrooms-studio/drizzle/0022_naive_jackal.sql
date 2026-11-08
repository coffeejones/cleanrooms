CREATE TABLE `workspace_published_checklist_items` (
	`workspace_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`task_key` text NOT NULL,
	`signature` text NOT NULL,
	`structure` text NOT NULL,
	`published_version` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `shift_id`, `task_key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `workspace_published_shifts` ADD `employee_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_published_shifts` ADD `has_description` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_published_shifts` ADD `checklist_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_published_shifts` ADD `checklist_structure` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_published_shifts` ADD `workflow_fingerprint` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER workspace_published_shifts_employee_dirty_update
AFTER UPDATE OF version ON workspace_published_shifts
WHEN NEW.employee_version<>NEW.version
BEGIN
  UPDATE workspace_published_shifts SET employee_version=0
  WHERE workspace_id=NEW.workspace_id AND id=NEW.id;
END;
