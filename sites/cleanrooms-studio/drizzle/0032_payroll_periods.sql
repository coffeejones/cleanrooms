CREATE TABLE workspace_payroll_periods (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 period_from TEXT NOT NULL,
 period_to TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','closed')),
 version INTEGER NOT NULL CHECK(version>=1),
 revision INTEGER NOT NULL DEFAULT 0,
 write_token TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,period_from,period_to)
);
--> statement-breakpoint
CREATE INDEX workspace_payroll_period_locks ON workspace_payroll_periods(workspace_id,status,period_from,period_to);
--> statement-breakpoint
CREATE TABLE workspace_payroll_closures (
 workspace_id TEXT NOT NULL,
 period_from TEXT NOT NULL,
 period_to TEXT NOT NULL,
 revision INTEGER NOT NULL,
 config TEXT NOT NULL,
 write_token TEXT NOT NULL,
 closed_at TEXT NOT NULL,
 PRIMARY KEY(workspace_id,period_from,period_to,revision),
 FOREIGN KEY(workspace_id,period_from,period_to) REFERENCES workspace_payroll_periods(workspace_id,period_from,period_to)
);
--> statement-breakpoint
CREATE TABLE workspace_payroll_export_rows (
 workspace_id TEXT NOT NULL,
 period_from TEXT NOT NULL,
 period_to TEXT NOT NULL,
 revision INTEGER NOT NULL,
 row_id TEXT NOT NULL,
 config TEXT NOT NULL,
 PRIMARY KEY(workspace_id,period_from,period_to,revision,row_id),
 FOREIGN KEY(workspace_id,period_from,period_to,revision) REFERENCES workspace_payroll_closures(workspace_id,period_from,period_to,revision)
);
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_closed_time_insert BEFORE INSERT ON workspace_time_entries
WHEN (NEW.demo=0 AND EXISTS(SELECT 1 FROM workspace_payroll_periods locked WHERE locked.workspace_id=NEW.workspace_id AND locked.status='closed' AND NEW.work_date BETWEEN locked.period_from AND locked.period_to))
 OR EXISTS(SELECT 1 FROM workspace_time_entries existing JOIN workspace_payroll_periods locked ON locked.workspace_id=existing.workspace_id AND locked.status='closed' AND existing.work_date BETWEEN locked.period_from AND locked.period_to
   WHERE existing.workspace_id=NEW.workspace_id AND existing.demo=0 AND(existing.id=NEW.id OR(existing.shift_id=NEW.shift_id AND existing.demo=NEW.demo)))
BEGIN SELECT RAISE(ABORT,'payroll_period_closed'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_closed_time_update BEFORE UPDATE ON workspace_time_entries
WHEN (OLD.demo=0 OR NEW.demo=0) AND EXISTS(SELECT 1 FROM workspace_payroll_periods locked WHERE locked.workspace_id=NEW.workspace_id AND locked.status='closed' AND ((OLD.work_date BETWEEN locked.period_from AND locked.period_to) OR (NEW.work_date BETWEEN locked.period_from AND locked.period_to)))
BEGIN SELECT RAISE(ABORT,'payroll_period_closed'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_closed_time_delete BEFORE DELETE ON workspace_time_entries
WHEN OLD.demo=0 AND EXISTS(SELECT 1 FROM workspace_payroll_periods locked WHERE locked.workspace_id=OLD.workspace_id AND locked.status='closed' AND OLD.work_date BETWEEN locked.period_from AND locked.period_to)
BEGIN SELECT RAISE(ABORT,'payroll_period_closed'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_closure_immutable_update BEFORE UPDATE ON workspace_payroll_closures
BEGIN SELECT RAISE(ABORT,'payroll_closure_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_closure_immutable_delete BEFORE DELETE ON workspace_payroll_closures
BEGIN SELECT RAISE(ABORT,'payroll_closure_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_export_immutable_update BEFORE UPDATE ON workspace_payroll_export_rows
BEGIN SELECT RAISE(ABORT,'payroll_closure_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_export_immutable_delete BEFORE DELETE ON workspace_payroll_export_rows
BEGIN SELECT RAISE(ABORT,'payroll_closure_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_closure_insert_guard BEFORE INSERT ON workspace_payroll_closures
WHEN EXISTS(SELECT 1 FROM workspace_payroll_closures existing WHERE existing.workspace_id=NEW.workspace_id AND existing.period_from=NEW.period_from AND existing.period_to=NEW.period_to AND existing.revision=NEW.revision)
 OR NOT EXISTS(SELECT 1 FROM workspace_payroll_periods period WHERE period.workspace_id=NEW.workspace_id AND period.period_from=NEW.period_from AND period.period_to=NEW.period_to AND period.status='closed' AND period.revision=NEW.revision AND period.write_token=NEW.write_token)
BEGIN SELECT RAISE(ABORT,'payroll_closure_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_payroll_export_insert_guard BEFORE INSERT ON workspace_payroll_export_rows
WHEN length(NEW.row_id)<>10 OR NEW.row_id GLOB '*[^0-9]*'
 OR EXISTS(SELECT 1 FROM workspace_payroll_export_rows existing WHERE existing.workspace_id=NEW.workspace_id AND existing.period_from=NEW.period_from AND existing.period_to=NEW.period_to AND existing.revision=NEW.revision AND existing.row_id=NEW.row_id)
 OR NOT EXISTS(SELECT 1 FROM workspace_payroll_closures closure JOIN workspace_payroll_periods period ON period.workspace_id=closure.workspace_id AND period.period_from=closure.period_from AND period.period_to=closure.period_to
   WHERE closure.workspace_id=NEW.workspace_id AND closure.period_from=NEW.period_from AND closure.period_to=NEW.period_to AND closure.revision=NEW.revision
    AND period.status='closed' AND period.revision=closure.revision AND period.write_token=closure.write_token
    AND json_type(closure.config,'$.rowCount')='integer' AND CAST(NEW.row_id AS INTEGER)<json_extract(closure.config,'$.rowCount'))
BEGIN SELECT RAISE(ABORT,'payroll_closure_immutable'); END;
