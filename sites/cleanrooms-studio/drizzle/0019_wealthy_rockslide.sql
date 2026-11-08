ALTER TABLE `workspace_published_shifts` ADD `time_config` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace_published_shifts` ADD `time_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `workspace_published_shifts_time_dirty` ON `workspace_published_shifts` (`workspace_id`,`time_version`,`work_date`,`id`);
--> statement-breakpoint
CREATE TRIGGER workspace_published_shifts_time_dirty_update AFTER UPDATE OF version ON workspace_published_shifts WHEN NEW.time_version<>NEW.version BEGIN UPDATE workspace_published_shifts SET time_config='',time_version=0 WHERE workspace_id=NEW.workspace_id AND id=NEW.id; END;
