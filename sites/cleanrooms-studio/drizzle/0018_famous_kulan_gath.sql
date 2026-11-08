CREATE TABLE `workspace_directory_chunks` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`, `id`, `version`, `chunk_index`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_directory_records` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`site_index` integer,
	`active` integer,
	`name_sort` text NOT NULL,
	`catalog` text NOT NULL,
	`config` text NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_directory_site_index` ON `workspace_directory_records` (`workspace_id`,`site_index`) WHERE "workspace_directory_records"."kind"='site';--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_directory_organization_id` ON `workspace_directory_records` (`workspace_id`,`id`) WHERE "workspace_directory_records"."kind" IN ('site','department');--> statement-breakpoint
CREATE INDEX `workspace_directory_order` ON `workspace_directory_records` (`workspace_id`,`kind`,`deleted`,`position`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_directory_active` ON `workspace_directory_records` (`workspace_id`,`kind`,`deleted`,`active`,`name_sort`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_directory_site` ON `workspace_directory_records` (`workspace_id`,`kind`,`site_index`,`deleted`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_directory_state` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`next_site_index` integer NOT NULL,
	`roster_present` integer NOT NULL,
	`organization_present` integer NOT NULL,
	`config` text NOT NULL,
	`byte_length` integer NOT NULL,
	`chunk_count` integer NOT NULL,
	`payload_version` integer NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
