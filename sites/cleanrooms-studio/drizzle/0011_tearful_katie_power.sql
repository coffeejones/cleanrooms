CREATE TABLE `workspace_absences` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`person_id` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`config` text NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_absences_person_period` ON `workspace_absences` (`workspace_id`,`person_id`,`from_date`,`to_date`);--> statement-breakpoint
CREATE INDEX `workspace_absences_status` ON `workspace_absences` (`workspace_id`,`status`,`from_date`);--> statement-breakpoint
CREATE TABLE `workspace_checklist_tasks` (
	`workspace_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`person_id` text NOT NULL,
	`task_key` text NOT NULL,
	`signature` text NOT NULL,
	`structure` text NOT NULL,
	`checked` integer NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `shift_id`, `person_id`, `task_key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_engagement_imports` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`plan_revision` integer NOT NULL,
	`token` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_payroll_revisions` (
	`workspace_id` text NOT NULL,
	`person_id` text NOT NULL,
	`version` integer NOT NULL,
	`config` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`recorded_at` text NOT NULL,
	`source` text DEFAULT 'save' NOT NULL,
	PRIMARY KEY(`workspace_id`, `person_id`, `version`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_shift_messages` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`config` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_shift_messages_person` ON `workspace_shift_messages` (`workspace_id`,`person_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `workspace_shift_requests` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`shift_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_person_id` text NOT NULL,
	`to_person_id` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`config` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_shift_requests_active` ON `workspace_shift_requests` (`workspace_id`,`shift_id`,`kind`,`from_person_id`) WHERE "workspace_shift_requests"."status" IN ('awaiting_colleague','pending');--> statement-breakpoint
CREATE INDEX `workspace_shift_requests_status` ON `workspace_shift_requests` (`workspace_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workspace_shift_requests_sender` ON `workspace_shift_requests` (`workspace_id`,`from_person_id`);--> statement-breakpoint
CREATE INDEX `workspace_shift_requests_recipient` ON `workspace_shift_requests` (`workspace_id`,`to_person_id`);--> statement-breakpoint
CREATE TABLE `workspace_time_entries` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`shift_id` text NOT NULL,
	`person_id` text NOT NULL,
	`work_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text NOT NULL,
	`demo` integer DEFAULT 0 NOT NULL,
	`version` integer NOT NULL,
	`config` text NOT NULL,
	`write_token` text NOT NULL,
	`updated_at` text NOT NULL,
	`interval_start` integer,
	`interval_end` integer,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_time_entries_shift` ON `workspace_time_entries` (`workspace_id`,`shift_id`,`demo`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_time_entries_running` ON `workspace_time_entries` (`workspace_id`,`person_id`,`demo`) WHERE "workspace_time_entries"."status" IN ('running','paused');--> statement-breakpoint
CREATE INDEX `workspace_time_entries_period` ON `workspace_time_entries` (`workspace_id`,`work_date`,`id`);--> statement-breakpoint
CREATE INDEX `workspace_time_entries_person_period` ON `workspace_time_entries` (`workspace_id`,`person_id`,`work_date`,`id`);