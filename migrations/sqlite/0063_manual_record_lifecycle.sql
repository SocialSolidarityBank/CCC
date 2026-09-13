-- W04: retain legacy values; record observations separately from open work.
ALTER TABLE sessions ADD COLUMN manual_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (manual_schema_version IN (1, 2));
ALTER TABLE sessions ADD COLUMN manual_revision INTEGER NOT NULL DEFAULT 1 CHECK (manual_revision >= 1);
ALTER TABLE action_items ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE action_items ADD COLUMN stop_reason TEXT CHECK (stop_reason IS NULL OR (length(trim(stop_reason)) > 0 AND resolved_at IS NOT NULL));
ALTER TABLE schedule_custom_questions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
CREATE TABLE manual_record_revisions (
  session_id TEXT NOT NULL REFERENCES sessions(id), org_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1), schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
  held_at TEXT NOT NULL, channel TEXT NOT NULL, memo TEXT, details TEXT, recorded_at TEXT NOT NULL, actor_id TEXT,
  PRIMARY KEY (session_id, revision)
);
CREATE TABLE action_item_revisions (
  action_item_id TEXT NOT NULL REFERENCES action_items(id), org_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1), description TEXT NOT NULL, owner TEXT NOT NULL, due_date TEXT,
  resolution_status TEXT, resolution_note TEXT, resolution_session_id TEXT, resolved_at TEXT, stop_reason TEXT,
  PRIMARY KEY (action_item_id, revision)
);
CREATE TABLE schedule_question_revisions (
  question_id TEXT NOT NULL REFERENCES schedule_custom_questions(id), org_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1), body TEXT NOT NULL, schedule_id TEXT NOT NULL, support_case_id TEXT NOT NULL,
  PRIMARY KEY (question_id, revision)
);
CREATE TABLE manual_action_outcomes (
  id TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL, support_case_id TEXT NOT NULL REFERENCES support_cases(id),
  action_item_id TEXT NOT NULL REFERENCES action_items(id), session_id TEXT NOT NULL REFERENCES sessions(id),
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1),
  outcome TEXT NOT NULL CHECK (outcome IN ('done', 'in_progress', 'not_done', 'unconfirmed')),
  continuation TEXT CHECK (continuation IN ('continue', 'stop')), reason TEXT,
  CHECK ((outcome = 'not_done' AND continuation IS NOT NULL AND
    ((continuation = 'stop' AND reason IS NOT NULL AND length(trim(reason)) > 0) OR (continuation = 'continue' AND reason IS NULL)))
    OR (outcome <> 'not_done' AND continuation IS NULL AND reason IS NULL)),
  FOREIGN KEY (action_item_id, source_revision) REFERENCES action_item_revisions(action_item_id, revision),
  UNIQUE (action_item_id, session_id)
);
CREATE TABLE manual_question_outcomes (
  id TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL, support_case_id TEXT NOT NULL REFERENCES support_cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('schedule', 'record')), question_id TEXT NOT NULL, source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1), source_text TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id), outcome TEXT NOT NULL CHECK (outcome IN ('confirmed', 'unconfirmed')),
  answer TEXT,
  CHECK ((outcome = 'confirmed' AND answer IS NOT NULL AND length(trim(answer)) > 0) OR (outcome = 'unconfirmed' AND answer IS NULL)),
  UNIQUE (kind, question_id, session_id)
);
CREATE UNIQUE INDEX manual_question_confirmed_once ON manual_question_outcomes(org_id, support_case_id, kind, question_id) WHERE outcome = 'confirmed';
INSERT INTO manual_record_revisions SELECT id, org_id, 1, 1, held_at, channel, memo, record_details, updated_at, NULL FROM sessions WHERE kind = 'regular';
INSERT INTO action_item_revisions SELECT id, org_id, 1, description, owner, due_date, resolution_status, resolution_note, resolution_session_id, resolved_at, NULL FROM action_items;
INSERT INTO schedule_question_revisions SELECT id, org_id, 1, body, schedule_id, support_case_id FROM schedule_custom_questions;
CREATE TRIGGER manual_record_history_insert AFTER INSERT ON sessions WHEN NEW.kind = 'regular'
BEGIN INSERT INTO manual_record_revisions VALUES (NEW.id, NEW.org_id, NEW.manual_revision, NEW.manual_schema_version, NEW.held_at, NEW.channel, NEW.memo, NEW.record_details, NEW.updated_at, NEW.submitted_by); END;
CREATE TRIGGER manual_record_history_update AFTER UPDATE ON sessions WHEN NEW.kind = 'regular' AND (NEW.held_at IS NOT OLD.held_at OR NEW.channel IS NOT OLD.channel OR NEW.memo IS NOT OLD.memo OR NEW.record_details IS NOT OLD.record_details)
BEGIN
  UPDATE sessions SET manual_revision = OLD.manual_revision + 1 WHERE id = NEW.id;
  INSERT INTO manual_record_revisions VALUES (NEW.id, NEW.org_id, OLD.manual_revision + 1, NEW.manual_schema_version, NEW.held_at, NEW.channel, NEW.memo, NEW.record_details, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL);
END;
CREATE TRIGGER action_item_history_insert AFTER INSERT ON action_items WHEN 1 = 1
BEGIN INSERT INTO action_item_revisions VALUES (NEW.id, NEW.org_id, NEW.revision, NEW.description, NEW.owner, NEW.due_date, NEW.resolution_status, NEW.resolution_note, NEW.resolution_session_id, NEW.resolved_at, NEW.stop_reason); END;
CREATE TRIGGER action_item_history_update AFTER UPDATE ON action_items WHEN 1 = 1 AND (NEW.description IS NOT OLD.description OR NEW.owner IS NOT OLD.owner OR NEW.due_date IS NOT OLD.due_date OR NEW.resolution_status IS NOT OLD.resolution_status OR NEW.resolution_note IS NOT OLD.resolution_note OR NEW.resolution_session_id IS NOT OLD.resolution_session_id OR NEW.resolved_at IS NOT OLD.resolved_at OR NEW.stop_reason IS NOT OLD.stop_reason)
BEGIN
  UPDATE action_items SET revision = OLD.revision + 1 WHERE id = NEW.id;
  INSERT INTO action_item_revisions VALUES (NEW.id, NEW.org_id, OLD.revision + 1, NEW.description, NEW.owner, NEW.due_date, NEW.resolution_status, NEW.resolution_note, NEW.resolution_session_id, NEW.resolved_at, NEW.stop_reason);
END;
CREATE TRIGGER schedule_question_history_insert AFTER INSERT ON schedule_custom_questions WHEN 1 = 1
BEGIN INSERT INTO schedule_question_revisions VALUES (NEW.id, NEW.org_id, NEW.revision, NEW.body, NEW.schedule_id, NEW.support_case_id); END;
CREATE TRIGGER schedule_question_history_update AFTER UPDATE ON schedule_custom_questions WHEN 1 = 1 AND (NEW.body IS NOT OLD.body OR NEW.schedule_id IS NOT OLD.schedule_id OR NEW.support_case_id IS NOT OLD.support_case_id)
BEGIN
  UPDATE schedule_custom_questions SET revision = OLD.revision + 1 WHERE id = NEW.id;
  INSERT INTO schedule_question_revisions VALUES (NEW.id, NEW.org_id, OLD.revision + 1, NEW.body, NEW.schedule_id, NEW.support_case_id);
END;
CREATE TRIGGER manual_record_revisions_no_update BEFORE UPDATE ON manual_record_revisions BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_record_revisions_no_delete BEFORE DELETE ON manual_record_revisions BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER action_item_revisions_no_update BEFORE UPDATE ON action_item_revisions BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER action_item_revisions_no_delete BEFORE DELETE ON action_item_revisions BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER schedule_question_revisions_no_update BEFORE UPDATE ON schedule_question_revisions BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER schedule_question_revisions_no_delete BEFORE DELETE ON schedule_question_revisions BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_action_outcomes_no_update BEFORE UPDATE ON manual_action_outcomes BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_action_outcomes_no_delete BEFORE DELETE ON manual_action_outcomes BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_question_outcomes_no_update BEFORE UPDATE ON manual_question_outcomes BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_question_outcomes_no_delete BEFORE DELETE ON manual_question_outcomes BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_action_outcomes_source_guard BEFORE INSERT ON manual_action_outcomes WHEN NOT (EXISTS (SELECT 1 FROM sessions s JOIN action_items a ON a.id = NEW.action_item_id AND a.org_id = s.org_id AND a.support_case_id = s.support_case_id WHERE s.id = NEW.session_id AND s.org_id = NEW.org_id AND s.support_case_id = NEW.support_case_id AND s.kind = 'regular' AND s.manual_schema_version = 2)) BEGIN SELECT RAISE(ABORT, 'manual_source_mismatch'); END;
CREATE TRIGGER manual_question_outcomes_source_guard BEFORE INSERT ON manual_question_outcomes WHEN NOT (EXISTS (SELECT 1 FROM sessions s WHERE s.id = NEW.session_id AND s.org_id = NEW.org_id AND s.support_case_id = NEW.support_case_id AND s.kind = 'regular' AND s.manual_schema_version = 2)) BEGIN SELECT RAISE(ABORT, 'manual_source_mismatch'); END;
CREATE TRIGGER manual_question_identity_guard BEFORE UPDATE ON sessions
WHEN OLD.manual_schema_version = 2 AND json_extract(NEW.record_details, '$.nextQuestions') IS NOT json_extract(OLD.record_details, '$.nextQuestions')
BEGIN SELECT RAISE(ABORT, 'manual_question_identity_immutable'); END;
CREATE TRIGGER manual_question_history_guard BEFORE INSERT ON manual_question_outcomes
WHEN NOT (
  (NEW.kind = 'schedule' AND EXISTS (
    SELECT 1 FROM schedule_question_revisions h WHERE h.question_id = NEW.question_id AND h.org_id = NEW.org_id
      AND h.revision = NEW.source_revision AND h.schedule_id = NEW.source_id AND h.support_case_id = NEW.support_case_id AND h.body = NEW.source_text
  )) OR (NEW.kind = 'record' AND EXISTS (
    SELECT 1 FROM manual_record_revisions h JOIN sessions s ON s.id = h.session_id AND s.org_id = h.org_id,
      json_each(h.details, '$.nextQuestions') q
    WHERE h.session_id = NEW.source_id AND h.org_id = NEW.org_id AND h.revision = NEW.source_revision
      AND s.support_case_id = NEW.support_case_id AND h.schema_version = 2
      AND json_extract(q.value, '$.id') = NEW.question_id AND json_extract(q.value, '$.body') = NEW.source_text
  ))
)
BEGIN SELECT RAISE(ABORT, 'manual_question_source_mismatch'); END;
