CREATE TABLE `workspace_payroll_policies` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`config` text NOT NULL,
	`version` integer NOT NULL,
	`history` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`write_token` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
