CREATE TABLE `workspace_roles` (
	`workspace_id` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`permissions` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`is_system` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `workspace_invites` ADD `role_id` text;--> statement-breakpoint
ALTER TABLE `workspace_members` ADD `role_id` text;