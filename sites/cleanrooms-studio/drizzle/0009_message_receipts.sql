CREATE TABLE `workspace_message_receipts` (
  `workspace_id` text NOT NULL,
  `message_id` text NOT NULL,
  `person_id` text NOT NULL,
  `read_at` text NOT NULL,
  PRIMARY KEY (`workspace_id`,`message_id`),
  FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_message_receipts_person` ON `workspace_message_receipts` (`workspace_id`,`person_id`);
