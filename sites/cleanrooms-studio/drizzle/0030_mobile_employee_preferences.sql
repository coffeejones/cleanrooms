CREATE TABLE `workspace_employee_preferences` (
	`workspace_id` text NOT NULL,
	`person_id` text NOT NULL,
	`version` integer NOT NULL,
	`config` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `person_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
