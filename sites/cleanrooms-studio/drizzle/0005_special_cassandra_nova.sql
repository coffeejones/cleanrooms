CREATE TABLE `workspace_payroll` (
	`workspace_id` text NOT NULL,
	`person_id` text NOT NULL,
	`config` text NOT NULL,
	`version` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`write_token` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `person_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
