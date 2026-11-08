CREATE TABLE `workspace_publication_link_imports` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`state_version` integer NOT NULL,
	`state_token` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_publication_links` (
	`workspace_id` text NOT NULL,
	`left_scope` text NOT NULL,
	`right_scope` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `left_scope`, `right_scope`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_publication_links_reverse` ON `workspace_publication_links` (`workspace_id`,`right_scope`,`left_scope`);--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `person_id` text;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `site_index` integer;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `schedule_config` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_plan_records` ADD `schedule_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `workspace_plan_group` ON `workspace_plan_records` (`workspace_id`,`kind`,`group_id`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_parent` ON `workspace_plan_records` (`workspace_id`,`kind`,`parent_id`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_person_period` ON `workspace_plan_records` (`workspace_id`,`kind`,`person_id`,`window_to`,`window_from`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_site_period` ON `workspace_plan_records` (`workspace_id`,`kind`,`site_index`,`window_to`,`window_from`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_plan_schedule_dirty` ON `workspace_plan_records` (`workspace_id`,`schedule_version`,`kind`,`id`);
--> statement-breakpoint
CREATE TRIGGER workspace_plan_schedule_dirty_update AFTER UPDATE OF version ON workspace_plan_records WHEN NEW.schedule_version <> NEW.version BEGIN UPDATE workspace_plan_records SET schedule_version=0,schedule_config='' WHERE workspace_id=NEW.workspace_id AND kind=NEW.kind AND id=NEW.id; END;
