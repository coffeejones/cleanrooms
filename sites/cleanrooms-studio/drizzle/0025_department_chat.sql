CREATE TABLE workspace_chat_rooms (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 id TEXT NOT NULL,
 department_id TEXT NOT NULL,
 name TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 latest_seq INTEGER NOT NULL DEFAULT 0,
 write_token TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 demo INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (workspace_id,id),
 CHECK(version>=1), CHECK(latest_seq>=0), CHECK(demo IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_chat_rooms_department ON workspace_chat_rooms(workspace_id,department_id);
--> statement-breakpoint
CREATE TABLE workspace_chat_messages (
 workspace_id TEXT NOT NULL,
 room_id TEXT NOT NULL,
 id TEXT NOT NULL,
 seq INTEGER NOT NULL,
 author_id TEXT NOT NULL,
 author_name TEXT NOT NULL,
 client_id TEXT NOT NULL,
 text TEXT NOT NULL,
 created_at TEXT NOT NULL,
 pinned INTEGER NOT NULL DEFAULT 0,
 demo INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (workspace_id,room_id,id),
 FOREIGN KEY (workspace_id,room_id) REFERENCES workspace_chat_rooms(workspace_id,id),
 CHECK(seq>=1), CHECK(pinned IN (0,1)), CHECK(demo IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_chat_messages_sequence ON workspace_chat_messages(workspace_id,room_id,seq);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_chat_messages_client ON workspace_chat_messages(workspace_id,room_id,author_id,client_id);
--> statement-breakpoint
CREATE INDEX workspace_chat_messages_unread ON workspace_chat_messages(workspace_id,room_id,seq,author_id);
--> statement-breakpoint
CREATE INDEX workspace_chat_messages_pinned ON workspace_chat_messages(workspace_id,room_id,pinned,seq);
--> statement-breakpoint
CREATE TABLE workspace_chat_readers (
 workspace_id TEXT NOT NULL,
 room_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 last_read_seq INTEGER NOT NULL DEFAULT 0,
 muted INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (workspace_id,room_id,user_id),
 FOREIGN KEY (workspace_id,room_id) REFERENCES workspace_chat_rooms(workspace_id,id),
 CHECK(last_read_seq>=0), CHECK(muted IN (0,1))
);
