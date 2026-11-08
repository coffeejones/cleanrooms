CREATE TABLE `workspace_plan_window_imports` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`schema` integer NOT NULL,
	`source_revision` integer NOT NULL,
	`source_token` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `window_from` text;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `window_to` text;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `origin_date` text;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `group_id` text;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `week_index` integer;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `window_schema` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `window_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `workspace_plan_window_from` ON `workspace_plan_records` (`workspace_id`,`kind`,`window_from`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_window_to` ON `workspace_plan_records` (`workspace_id`,`kind`,`window_to`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_window_origin` ON `workspace_plan_records` (`workspace_id`,`kind`,`origin_date`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_window_week` ON `workspace_plan_records` (`workspace_id`,`kind`,`week_index`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_window_dirty` ON `workspace_plan_records` (`workspace_id`,`window_schema`,`kind`,`id`);--> statement-breakpoint
ALTER TABLE `workspace_publication_scopes` ADD `window_config` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_publication_scopes` ADD `window_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_publication_state` ADD `window_config` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_publication_state` ADD `window_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TRIGGER workspace_plan_window_dirty_update AFTER UPDATE OF version ON workspace_plan_records
WHEN NEW.window_version <> NEW.version
BEGIN
  UPDATE workspace_plan_records SET window_schema = 0 WHERE workspace_id = NEW.workspace_id AND kind = NEW.kind AND id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_publication_state_window_dirty AFTER UPDATE OF version ON workspace_publication_state
WHEN NEW.window_version <> NEW.version
BEGIN
  UPDATE workspace_publication_state SET window_config = '',window_version = 0 WHERE workspace_id = NEW.workspace_id;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_publication_scope_window_dirty AFTER UPDATE OF version ON workspace_publication_scopes
WHEN NEW.window_version <> NEW.version
BEGIN
  UPDATE workspace_publication_scopes SET window_config = '',window_version = 0 WHERE workspace_id = NEW.workspace_id AND scope_key = NEW.scope_key;
END;
