CREATE TABLE `workspace_plan_imports` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`source_revision` integer NOT NULL,
	`source_token` text NOT NULL,
	`completed_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_plan_record_chunks` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`, `id`, `version`, `chunk_index`),
	FOREIGN KEY (`workspace_id`,`kind`,`id`) REFERENCES `workspace_plan_records`(`workspace_id`,`kind`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_plan_records` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`config` text NOT NULL,
	`write_token` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_plan_records_kind` ON `workspace_plan_records` (`workspace_id`,`kind`,`deleted`,`sort_order`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_publication_chunks` (
	`workspace_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`version` integer NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `entity_type`, `entity_id`, `version`, `chunk_index`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_publication_records` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`at` text NOT NULL,
	`config` text NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`write_token` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_publication_records_position` ON `workspace_publication_records` (`workspace_id`,`position`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_publication_scopes` (
	`workspace_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`site` integer NOT NULL,
	`version` integer NOT NULL,
	`deleted` integer NOT NULL,
	`config` text NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`payload_version` integer NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `scope_key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_publication_scopes_period` ON `workspace_publication_scopes` (`workspace_id`,`from_date`,`site`);--> statement-breakpoint
CREATE TABLE `workspace_publication_state` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`sequence` integer NOT NULL,
	`config` text NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_published_shifts` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`scope_key` text NOT NULL,
	`person_id` text NOT NULL,
	`work_date` text NOT NULL,
	`site` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`version` integer NOT NULL,
	`deleted` integer NOT NULL,
	`config` text NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`payload_version` integer NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_published_shifts_person` ON `workspace_published_shifts` (`workspace_id`,`person_id`,`work_date`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_published_shifts_scope` ON `workspace_published_shifts` (`workspace_id`,`scope_key`,`deleted`);