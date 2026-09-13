-- CCC-299: identity metadata references immutable intake text; existing rows stay unbound.
ALTER TABLE sessions ADD COLUMN intake_question_lifecycle TEXT;
ALTER TABLE intake_record_revisions ADD COLUMN question_lifecycle TEXT;
DROP TRIGGER intake_revision_source_guard;
DROP TRIGGER intake_revision_insert;
DROP TRIGGER intake_revision_update;
DROP TRIGGER intake_revision_guard;
CREATE TRIGGER intake_revision_source_guard BEFORE INSERT ON intake_record_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM sessions AS source WHERE source.id = NEW.session_id AND source.org_id = NEW.org_id
    AND source.kind = 'intake' AND source.intake_revision = NEW.revision AND source.intake_schema_version = NEW.schema_version
    AND source.held_at = NEW.held_at AND source.channel = NEW.channel AND source.intake_details IS NEW.details
    AND source.intake_question_lifecycle IS NEW.question_lifecycle
    AND COALESCE(source.intake_updated_by, source.submitted_by, source.counselor_id) IS NEW.actor_id
    AND source.updated_at = NEW.recorded_at AND source.intake_converted_from_revision IS NEW.converted_from_revision
)
BEGIN SELECT RAISE(ABORT, 'intake_revision_source_mismatch'); END;
CREATE TRIGGER intake_revision_insert AFTER INSERT ON sessions WHEN NEW.kind = 'intake'
BEGIN
  INSERT INTO intake_record_revisions
    (session_id, org_id, revision, schema_version, held_at, channel, details, actor_id, recorded_at, converted_from_revision, question_lifecycle)
  VALUES (NEW.id, NEW.org_id, NEW.intake_revision, NEW.intake_schema_version, NEW.held_at, NEW.channel, NEW.intake_details,
    COALESCE(NEW.intake_updated_by, NEW.submitted_by, NEW.counselor_id), NEW.updated_at, NEW.intake_converted_from_revision, NEW.intake_question_lifecycle);
END;
CREATE TRIGGER intake_revision_update AFTER UPDATE ON sessions
WHEN NEW.kind = 'intake' AND NEW.intake_revision <> OLD.intake_revision
BEGIN
  INSERT INTO intake_record_revisions
    (session_id, org_id, revision, schema_version, held_at, channel, details, actor_id, recorded_at, converted_from_revision, question_lifecycle)
  VALUES (NEW.id, NEW.org_id, NEW.intake_revision, NEW.intake_schema_version, NEW.held_at, NEW.channel, NEW.intake_details,
    COALESCE(NEW.intake_updated_by, NEW.submitted_by, NEW.counselor_id), NEW.updated_at, NEW.intake_converted_from_revision, NEW.intake_question_lifecycle);
END;
CREATE TRIGGER intake_revision_guard BEFORE UPDATE ON sessions
WHEN OLD.kind = 'intake' AND (
  (NEW.intake_details IS NOT OLD.intake_details OR NEW.held_at IS NOT OLD.held_at OR NEW.channel IS NOT OLD.channel
    OR NEW.intake_schema_version <> OLD.intake_schema_version OR NEW.intake_revision <> OLD.intake_revision
    OR NEW.intake_question_lifecycle IS NOT OLD.intake_question_lifecycle)
  AND (NEW.intake_revision <> OLD.intake_revision + 1 OR NEW.intake_schema_version <> 2
    OR NEW.intake_updated_by IS NULL OR NEW.intake_question_lifecycle IS NULL
    OR (OLD.intake_question_lifecycle IS NULL AND NEW.intake_converted_from_revision IS NOT OLD.intake_revision)
    OR (OLD.intake_question_lifecycle IS NOT NULL AND NEW.intake_converted_from_revision IS NOT NULL))
)
BEGIN SELECT RAISE(ABORT, 'intake_revision_conflict'); END;

-- Rebuild only the kind constraint, copying every original outcome byte before replacement.
CREATE TABLE manual_question_outcomes_next (
  id TEXT PRIMARY KEY NOT NULL, org_id TEXT NOT NULL, support_case_id TEXT NOT NULL REFERENCES support_cases(id),
  kind TEXT NOT NULL CHECK (kind IN ('schedule', 'record', 'intake')), question_id TEXT NOT NULL, source_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL CHECK (source_revision >= 1), source_text TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id), outcome TEXT NOT NULL CHECK (outcome IN ('confirmed', 'unconfirmed')),
  answer TEXT,
  CHECK ((outcome = 'confirmed' AND answer IS NOT NULL AND length(trim(answer)) > 0) OR (outcome = 'unconfirmed' AND answer IS NULL)),
  UNIQUE (kind, question_id, session_id)
);
INSERT INTO manual_question_outcomes_next
  (id, org_id, support_case_id, kind, question_id, source_id, source_revision, source_text, session_id, outcome, answer)
SELECT id, org_id, support_case_id, kind, question_id, source_id, source_revision, source_text, session_id, outcome, answer
FROM manual_question_outcomes;
DROP TABLE manual_question_outcomes;
ALTER TABLE manual_question_outcomes_next RENAME TO manual_question_outcomes;
CREATE UNIQUE INDEX manual_question_confirmed_once ON manual_question_outcomes(org_id, support_case_id, kind, question_id) WHERE outcome = 'confirmed';
CREATE TRIGGER manual_question_outcomes_no_update BEFORE UPDATE ON manual_question_outcomes
BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_question_outcomes_no_delete BEFORE DELETE ON manual_question_outcomes
BEGIN SELECT RAISE(ABORT, 'manual_history_immutable'); END;
CREATE TRIGGER manual_question_outcomes_source_guard BEFORE INSERT ON manual_question_outcomes
WHEN NOT EXISTS (
  SELECT 1 FROM sessions target WHERE target.id = NEW.session_id AND target.org_id = NEW.org_id
    AND target.support_case_id = NEW.support_case_id AND target.kind = 'regular' AND target.manual_schema_version = 2
    AND (NEW.kind <> 'intake' OR EXISTS (
      SELECT 1 FROM sessions source WHERE source.id = NEW.source_id AND source.org_id = NEW.org_id
        AND source.support_case_id = NEW.support_case_id AND source.kind = 'intake' AND source.held_at <= target.held_at
    ))
)
BEGIN SELECT RAISE(ABORT, 'manual_source_mismatch'); END;
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
  )) OR (NEW.kind = 'intake' AND EXISTS (
    SELECT 1 FROM sessions source, json_each(source.intake_question_lifecycle, '$.items') q
    JOIN intake_record_revisions h ON h.session_id = source.id AND h.org_id = source.org_id
      AND h.revision = json_extract(q.value, '$.sourceRevision') AND h.revision <= source.intake_revision
    WHERE source.id = NEW.source_id AND source.org_id = NEW.org_id AND source.support_case_id = NEW.support_case_id AND source.kind = 'intake'
      AND json_extract(source.intake_question_lifecycle, '$.version') = 1
      AND json_extract(q.value, '$.id') = NEW.question_id AND json_extract(q.value, '$.revision') = NEW.source_revision
      AND json_type(q.value, '$.withdrawn') = 'null'
      AND CASE h.schema_version
        WHEN 1 THEN json_extract(h.details, '$.additionalItems[' || json_extract(q.value, '$.sourceRowIndex') || '].item')
        WHEN 2 THEN CASE WHEN json_extract(h.details, '$.additionalItems.response') = 'answered'
          THEN json_extract(h.details, '$.additionalItems.rows[' || json_extract(q.value, '$.sourceRowIndex') || '].item') END
      END = NEW.source_text
  ))
)
BEGIN SELECT RAISE(ABORT, 'manual_question_source_mismatch'); END;
