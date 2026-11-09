CREATE TABLE workspace_shift_reminders (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 id TEXT NOT NULL,
 shift_id TEXT NOT NULL,
 person_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('reminder','checkout_reminder')),
 work_date TEXT NOT NULL,
 start_time TEXT NOT NULL,
 end_time TEXT NOT NULL,
 site INTEGER NOT NULL,
 lead_minutes INTEGER NOT NULL,
 due_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 next_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','emitted','cancelled')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_shift_reminder_occurrence ON workspace_shift_reminders(workspace_id,shift_id,person_id,work_date,start_time,end_time,site,kind,lead_minutes);
--> statement-breakpoint
CREATE INDEX workspace_shift_reminder_due ON workspace_shift_reminders(status,next_at,workspace_id,id);
--> statement-breakpoint
CREATE INDEX workspace_reminder_published_day ON workspace_published_shifts(work_date,workspace_id,id) WHERE deleted=0;
--> statement-breakpoint
DROP TRIGGER workspace_push_shift_insert;
--> statement-breakpoint
CREATE TRIGGER workspace_push_shift_insert AFTER INSERT ON workspace_shift_messages
WHEN NEW.kind IN ('new','changed','moved','cancelled','request','reminder','checkout_reminder')
 AND NEW.person_id NOT LIKE 'demo-%'
 AND json_valid(NEW.config)
 AND json_extract(NEW.config,'$.readAt') IS NULL AND julianday(NEW.created_at)>=julianday('now')-1
 AND EXISTS(SELECT 1 FROM workspace_push_devices device WHERE device.workspace_id=NEW.workspace_id AND device.person_id=NEW.person_id AND device.active=1 AND device.registered_at<=CAST((julianday(NEW.created_at)-2440587.5)*86400000 AS INTEGER)+1)
BEGIN
 INSERT INTO workspace_push_events(workspace_id,source_kind,source_id,person_id,created_at)
 VALUES(NEW.workspace_id,'shift',NEW.id,NEW.person_id,CAST((julianday(NEW.created_at)-2440587.5)*86400000 AS INTEGER))
 ON CONFLICT DO NOTHING;
END;

--> statement-breakpoint
CREATE INDEX workspace_shift_messages_planner ON workspace_shift_messages(workspace_id,created_at,id) WHERE kind NOT IN ('reminder','checkout_reminder');
