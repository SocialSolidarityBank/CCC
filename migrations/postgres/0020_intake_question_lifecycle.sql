-- CCC-299, paired with SQLite 0064. Historical text and lifecycle snapshots are not backfilled.
ALTER TABLE sessions ADD COLUMN intake_question_lifecycle text;
ALTER TABLE intake_record_revisions ADD COLUMN question_lifecycle text;
CREATE OR REPLACE FUNCTION ccc_validate_intake_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sessions AS source WHERE source.id = NEW.session_id AND source.org_id = NEW.org_id
      AND source.kind = 'intake' AND source.intake_revision = NEW.revision AND source.intake_schema_version = NEW.schema_version
      AND source.held_at = NEW.held_at AND source.channel = NEW.channel AND source.intake_details IS NOT DISTINCT FROM NEW.details
      AND source.intake_question_lifecycle IS NOT DISTINCT FROM NEW.question_lifecycle
      AND COALESCE(source.intake_updated_by, source.submitted_by, source.counselor_id) IS NOT DISTINCT FROM NEW.actor_id
      AND source.updated_at = NEW.recorded_at AND source.intake_converted_from_revision IS NOT DISTINCT FROM NEW.converted_from_revision
  ) THEN RAISE EXCEPTION 'intake_revision_source_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION ccc_capture_intake_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO intake_record_revisions
    (session_id, org_id, revision, schema_version, held_at, channel, details, actor_id, recorded_at, converted_from_revision, question_lifecycle)
  VALUES (NEW.id, NEW.org_id, NEW.intake_revision, NEW.intake_schema_version, NEW.held_at, NEW.channel, NEW.intake_details,
    COALESCE(NEW.intake_updated_by, NEW.submitted_by, NEW.counselor_id), NEW.updated_at, NEW.intake_converted_from_revision, NEW.intake_question_lifecycle);
  RETURN NEW;
END;
$$;
DROP TRIGGER intake_revision_guard ON sessions;
CREATE TRIGGER intake_revision_guard BEFORE UPDATE ON sessions FOR EACH ROW
WHEN (OLD.kind = 'intake' AND (
  (NEW.intake_details IS DISTINCT FROM OLD.intake_details OR NEW.held_at IS DISTINCT FROM OLD.held_at OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.intake_schema_version <> OLD.intake_schema_version OR NEW.intake_revision <> OLD.intake_revision
    OR NEW.intake_question_lifecycle IS DISTINCT FROM OLD.intake_question_lifecycle)
  AND (NEW.intake_revision <> OLD.intake_revision + 1 OR NEW.intake_schema_version <> 2
    OR NEW.intake_updated_by IS NULL OR NEW.intake_question_lifecycle IS NULL
    OR (OLD.intake_question_lifecycle IS NULL AND NEW.intake_converted_from_revision IS DISTINCT FROM OLD.intake_revision)
    OR (OLD.intake_question_lifecycle IS NOT NULL AND NEW.intake_converted_from_revision IS NOT NULL))
)) EXECUTE FUNCTION ccc_reject_write('intake_revision_conflict');
ALTER FUNCTION ccc_validate_intake_revision() OWNER TO ccc_schema_owner;
ALTER FUNCTION ccc_capture_intake_revision() OWNER TO ccc_schema_owner;

ALTER TABLE manual_question_outcomes DROP CONSTRAINT manual_question_outcomes_kind_check;
ALTER TABLE manual_question_outcomes ADD CONSTRAINT manual_question_outcomes_kind_check CHECK (kind IN ('schedule', 'record', 'intake'));
CREATE OR REPLACE FUNCTION ccc_manual_question_outcomes_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sessions target WHERE target.id = NEW.session_id AND target.org_id = NEW.org_id
      AND target.support_case_id = NEW.support_case_id AND target.kind = 'regular' AND target.manual_schema_version = 2
      AND (NEW.kind <> 'intake' OR EXISTS (
        SELECT 1 FROM sessions source WHERE source.id = NEW.source_id AND source.org_id = NEW.org_id
          AND source.support_case_id = NEW.support_case_id AND source.kind = 'intake' AND source.held_at <= target.held_at
      ))
  ) THEN RAISE EXCEPTION 'manual_source_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION ccc_manual_question_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (
    (NEW.kind = 'schedule' AND EXISTS (
      SELECT 1 FROM schedule_question_revisions h WHERE h.question_id = NEW.question_id AND h.org_id = NEW.org_id
        AND h.revision = NEW.source_revision AND h.schedule_id = NEW.source_id AND h.support_case_id = NEW.support_case_id AND h.body = NEW.source_text
    )) OR (NEW.kind = 'record' AND EXISTS (
      SELECT 1 FROM manual_record_revisions h JOIN sessions s ON s.id = h.session_id AND s.org_id = h.org_id,
        jsonb_array_elements(h.details::jsonb -> 'nextQuestions') q
      WHERE h.session_id = NEW.source_id AND h.org_id = NEW.org_id AND h.revision = NEW.source_revision
        AND s.support_case_id = NEW.support_case_id AND h.schema_version = 2
        AND q.value ->> 'id' = NEW.question_id AND q.value ->> 'body' = NEW.source_text
    )) OR (NEW.kind = 'intake' AND EXISTS (
      SELECT 1 FROM sessions source
      CROSS JOIN LATERAL jsonb_array_elements(source.intake_question_lifecycle::jsonb -> 'items') q
      JOIN intake_record_revisions h ON h.session_id = source.id AND h.org_id = source.org_id
        AND h.revision = (q.value ->> 'sourceRevision')::bigint AND h.revision <= source.intake_revision
      WHERE source.id = NEW.source_id AND source.org_id = NEW.org_id AND source.support_case_id = NEW.support_case_id AND source.kind = 'intake'
        AND source.intake_question_lifecycle::jsonb ->> 'version' = '1'
        AND q.value ->> 'id' = NEW.question_id AND (q.value ->> 'revision')::bigint = NEW.source_revision
        AND q.value -> 'withdrawn' = 'null'::jsonb
        AND CASE h.schema_version
          WHEN 1 THEN h.details::jsonb -> 'additionalItems' -> (q.value ->> 'sourceRowIndex')::integer ->> 'item'
          WHEN 2 THEN CASE WHEN h.details::jsonb -> 'additionalItems' ->> 'response' = 'answered'
            THEN h.details::jsonb -> 'additionalItems' -> 'rows' -> (q.value ->> 'sourceRowIndex')::integer ->> 'item' END
        END = NEW.source_text
    ))
  ) THEN RAISE EXCEPTION 'manual_question_source_mismatch'; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION ccc_manual_question_outcomes_source_guard() OWNER TO ccc_schema_owner;
ALTER FUNCTION ccc_manual_question_history_guard() OWNER TO ccc_schema_owner;
-- Existing FORCE RLS, tenant policies, PUBLIC revokes, ccc_api SELECT/INSERT grants,
-- ccc_schema_owner table ownership, append-only triggers and confirmed-once index remain attached.
