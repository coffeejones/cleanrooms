CREATE TABLE `studio_state_chunks` (
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `revision`, `chunk_index`),
	FOREIGN KEY (`owner_id`) REFERENCES `studio_states`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `studio_states` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`write_token` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`byte_length` integer NOT NULL,
	`updated_at` text NOT NULL
);
