CREATE TABLE `workspace_activity` (
  `workspace_id` text NOT NULL,
  `id` text NOT NULL,
  `at` text NOT NULL,
  `actor_id` text NOT NULL,
  `actor_name` text NOT NULL,
  `kind` text NOT NULL,
  `areas` text NOT NULL,
  `person_ids` text NOT NULL,
  `entry` text NOT NULL,
  PRIMARY KEY (`workspace_id`,`id`),
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_activity_order` ON `workspace_activity` (`workspace_id`,`at`,`id`);
--> statement-breakpoint
CREATE INDEX `workspace_activity_actor` ON `workspace_activity` (`workspace_id`,`actor_id`,`at`);
--> statement-breakpoint
CREATE TABLE `workspace_activity_imports` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `plan_revision` integer NOT NULL DEFAULT -1,
  `time_version` integer NOT NULL DEFAULT -1,
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
