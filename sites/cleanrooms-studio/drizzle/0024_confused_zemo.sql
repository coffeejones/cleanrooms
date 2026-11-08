CREATE TABLE `workspace_plan_calendar_chunks` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`, `id`, `version`, `chunk_index`),
	FOREIGN KEY (`workspace_id`,`kind`,`id`) REFERENCES `workspace_plan_records`(`workspace_id`,`kind`,`id`) ON UPDATE no action ON DELETE cascade
);
