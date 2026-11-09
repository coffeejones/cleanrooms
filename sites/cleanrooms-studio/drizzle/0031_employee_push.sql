CREATE TABLE workspace_push_devices (
 installation_id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 person_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 credential_version INTEGER NOT NULL,
 expo_token TEXT NOT NULL,
 project_id TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('ios','android')),
 site_index INTEGER,
 binding_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 registered_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_push_token ON workspace_push_devices(expo_token) WHERE active=1;
--> statement-breakpoint
CREATE INDEX workspace_push_person ON workspace_push_devices(workspace_id,person_id,active,installation_id);
--> statement-breakpoint
CREATE INDEX workspace_push_fanout ON workspace_push_devices(workspace_id,active,installation_id);
--> statement-breakpoint
CREATE INDEX workspace_push_site ON workspace_push_devices(workspace_id,site_index,active,installation_id);
--> statement-breakpoint
CREATE INDEX workspace_push_session ON workspace_push_devices(session_hash,active);
--> statement-breakpoint
CREATE INDEX workspace_push_member_identity ON workspace_members(workspace_id,person_id,user_id);
--> statement-breakpoint
CREATE TABLE workspace_push_events (
 event_id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('shift','chat','test')),
 source_id TEXT NOT NULL,
 room_id TEXT NOT NULL DEFAULT '',
 person_id TEXT,
 created_at INTEGER NOT NULL,
 expanded INTEGER NOT NULL DEFAULT 0 CHECK(expanded IN (0,1)),
 after_installation TEXT NOT NULL DEFAULT '',
 after_site INTEGER NOT NULL DEFAULT -1
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_push_events_source ON workspace_push_events(workspace_id,source_kind,room_id,source_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_push_test_minute ON workspace_push_events(source_id) WHERE source_kind='test';
--> statement-breakpoint
CREATE INDEX workspace_push_events_pending ON workspace_push_events(expanded,created_at,event_id);
--> statement-breakpoint
CREATE TABLE workspace_push_deliveries (
 event_id TEXT NOT NULL REFERENCES workspace_push_events(event_id) ON DELETE CASCADE,
 installation_id TEXT NOT NULL,
 workspace_id TEXT NOT NULL,
 person_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','sending','receipt','delivered','cancelled','failed','unknown')),
 due_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 receipt_attempts INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 lease_until INTEGER,
 device_version INTEGER,
 binding_id TEXT,
 ticket_id TEXT,
 sent_at INTEGER,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(event_id,installation_id)
);
--> statement-breakpoint
CREATE INDEX workspace_push_delivery_due ON workspace_push_deliveries(status,due_at,event_id,installation_id);
--> statement-breakpoint
CREATE TABLE workspace_push_dispatch_state (
 id TEXT PRIMARY KEY NOT NULL,
 lease_token TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0,
 last_started_at INTEGER,
 last_success_at INTEGER,
 last_error TEXT,
 last_provider_error TEXT
);
--> statement-breakpoint
INSERT INTO workspace_push_dispatch_state(id) VALUES ('expo');
--> statement-breakpoint
CREATE TRIGGER workspace_push_shift_insert AFTER INSERT ON workspace_shift_messages
WHEN NEW.kind IN ('new','changed','moved','cancelled','request')
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
CREATE TRIGGER workspace_push_chat_insert AFTER INSERT ON workspace_chat_messages
WHEN NEW.demo=0 AND julianday(NEW.created_at)>=julianday('now')-1 AND EXISTS(SELECT 1 FROM workspace_chat_rooms room WHERE room.workspace_id=NEW.workspace_id AND room.id=NEW.room_id AND room.demo=0)
 AND EXISTS(SELECT 1 FROM workspace_push_devices device WHERE device.workspace_id=NEW.workspace_id AND device.active=1 AND device.registered_at<=CAST((julianday(NEW.created_at)-2440587.5)*86400000 AS INTEGER)+1)
BEGIN
 INSERT INTO workspace_push_events(workspace_id,source_kind,source_id,room_id,created_at)
 VALUES(NEW.workspace_id,'chat',NEW.id,NEW.room_id,CAST((julianday(NEW.created_at)-2440587.5)*86400000 AS INTEGER))
 ON CONFLICT DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_push_session_delete AFTER DELETE ON workspace_mobile_sessions
BEGIN
 UPDATE workspace_push_devices SET active=0,version=version+1 WHERE session_hash=OLD.token_hash AND active=1;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_push_employee_site AFTER UPDATE OF site_index ON workspace_directory_records
WHEN NEW.kind='employee' AND OLD.site_index IS NOT NEW.site_index
BEGIN
 UPDATE workspace_push_devices SET site_index=NEW.site_index WHERE workspace_id=NEW.workspace_id AND person_id=NEW.id;
END;
