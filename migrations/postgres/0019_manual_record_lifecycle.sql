-- W04, paired with SQLite 0063_manual_record_lifecycle.sql.
ALTER TABLE sessions ADD COLUMN manual_schema_version bigint NOT NULL DEFAULT 1 CHECK (manual_schema_version IN (1, 2));
ALTER TABLE sessions ADD COLUMN manual_revision bigint NOT NULL DEFAULT 1 CHECK (manual_revision >= 1);
ALTER TABLE action_items ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE action_items ADD COLUMN stop_reason text CHECK (stop_reason IS NULL OR (length(trim(stop_reason)) > 0 AND resolved_at IS NOT NULL));
ALTER TABLE schedule_custom_questions ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1);
CREATE TABLE manual_record_revisions (
  session_id text NOT NULL REFERENCES sessions(id), org_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1), schema_version bigint NOT NULL CHECK (schema_version IN (1, 2)),
  held_at text NOT NULL, channel text NOT NULL, memo text, details text, recorded_at text NOT NULL, actor_id text,
  PRIMARY KEY (session_id, revision)
);
CREATE TABLE action_item_revisions (
  action_item_id text NOT NULL REFERENCES action_items(id), org_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1), description text NOT NULL, owner text NOT NULL, due_date text,
  resolution_status text, resolution_note text, resolution_session_id text, resolved_at text, stop_reason text,
  PRIMARY KEY (action_item_id, revision)
);
CREATE TABLE schedule_question_revisions (
  question_id text NOT NULL REFERENCES schedule_custom_questions(id), org_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1), body text NOT NULL, schedule_id text NOT NULL, support_case_id text NOT NULL,
  PRIMARY KEY (question_id, revision)
);
CREATE TABLE manual_action_outcomes (
  id text PRIMARY KEY NOT NULL, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id),
  action_item_id text NOT NULL REFERENCES action_items(id), session_id text NOT NULL REFERENCES sessions(id),
  source_revision bigint NOT NULL CHECK (source_revision >= 1),
  outcome text NOT NULL CHECK (outcome IN ('done', 'in_progress', 'not_done', 'unconfirmed')),
  continuation text CHECK (continuation IN ('continue', 'stop')), reason text,
  CHECK ((outcome = 'not_done' AND continuation IS NOT NULL AND
    ((continuation = 'stop' AND reason IS NOT NULL AND length(trim(reason)) > 0) OR (continuation = 'continue' AND reason IS NULL)))
    OR (outcome <> 'not_done' AND continuation IS NULL AND reason IS NULL)),
  FOREIGN KEY (action_item_id, source_revision) REFERENCES action_item_revisions(action_item_id, revision),
  UNIQUE (action_item_id, session_id)
);
CREATE TABLE manual_question_outcomes (
  id text PRIMARY KEY NOT NULL, org_id text NOT NULL, support_case_id text NOT NULL REFERENCES support_cases(id),
  kind text NOT NULL CHECK (kind IN ('schedule', 'record')), question_id text NOT NULL, source_id text NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision >= 1), source_text text NOT NULL,
  session_id text NOT NULL REFERENCES sessions(id), outcome text NOT NULL CHECK (outcome IN ('confirmed', 'unconfirmed')),
  answer text,
  CHECK ((outcome = 'confirmed' AND answer IS NOT NULL AND length(trim(answer)) > 0) OR (outcome = 'unconfirmed' AND answer IS NULL)),
  UNIQUE (kind, question_id, session_id)
);
CREATE UNIQUE INDEX manual_question_confirmed_once ON manual_question_outcomes(org_id, support_case_id, kind, question_id) WHERE outcome = 'confirmed';
INSERT INTO manual_record_revisions SELECT id, org_id, 1, 1, held_at, channel, memo, record_details, updated_at, NULL FROM sessions WHERE kind = 'regular';
INSERT INTO action_item_revisions SELECT id, org_id, 1, description, owner, due_date, resolution_status, resolution_note, resolution_session_id, resolved_at, NULL FROM action_items;
INSERT INTO schedule_question_revisions SELECT id, org_id, 1, body, schedule_id, support_case_id FROM schedule_custom_questions;
CREATE FUNCTION ccc_manual_record_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO manual_record_revisions VALUES (NEW.id, NEW.org_id, NEW.manual_revision, NEW.manual_schema_version, NEW.held_at, NEW.channel, NEW.memo, NEW.record_details, NEW.updated_at, NEW.submitted_by); RETURN NEW; END;
$$;
CREATE TRIGGER manual_record_history_insert AFTER INSERT ON sessions FOR EACH ROW WHEN (NEW.kind = 'regular') EXECUTE FUNCTION ccc_manual_record_history_insert();
CREATE FUNCTION ccc_manual_record_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE sessions SET manual_revision = OLD.manual_revision + 1 WHERE id = NEW.id;
  INSERT INTO manual_record_revisions VALUES (NEW.id, NEW.org_id, OLD.manual_revision + 1, NEW.manual_schema_version, NEW.held_at, NEW.channel, NEW.memo, NEW.record_details, ccc_legacy_now(), NULL);
  RETURN NEW;
END;
$$;
CREATE TRIGGER manual_record_history_update AFTER UPDATE ON sessions FOR EACH ROW WHEN (NEW.kind = 'regular' AND (NEW.held_at IS DISTINCT FROM OLD.held_at OR NEW.channel IS DISTINCT FROM OLD.channel OR NEW.memo IS DISTINCT FROM OLD.memo OR NEW.record_details IS DISTINCT FROM OLD.record_details)) EXECUTE FUNCTION ccc_manual_record_history_update();
ALTER FUNCTION ccc_manual_record_history_insert() OWNER TO ccc_schema_owner;
ALTER FUNCTION ccc_manual_record_history_update() OWNER TO ccc_schema_owner;
CREATE FUNCTION ccc_action_item_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO action_item_revisions VALUES (NEW.id, NEW.org_id, NEW.revision, NEW.description, NEW.owner, NEW.due_date, NEW.resolution_status, NEW.resolution_note, NEW.resolution_session_id, NEW.resolved_at, NEW.stop_reason); RETURN NEW; END;
$$;
CREATE TRIGGER action_item_history_insert AFTER INSERT ON action_items FOR EACH ROW WHEN (1 = 1) EXECUTE FUNCTION ccc_action_item_history_insert();
CREATE FUNCTION ccc_action_item_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE action_items SET revision = OLD.revision + 1 WHERE id = NEW.id;
  INSERT INTO action_item_revisions VALUES (NEW.id, NEW.org_id, OLD.revision + 1, NEW.description, NEW.owner, NEW.due_date, NEW.resolution_status, NEW.resolution_note, NEW.resolution_session_id, NEW.resolved_at, NEW.stop_reason);
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_item_history_update AFTER UPDATE ON action_items FOR EACH ROW WHEN (1 = 1 AND (NEW.description IS DISTINCT FROM OLD.description OR NEW.owner IS DISTINCT FROM OLD.owner OR NEW.due_date IS DISTINCT FROM OLD.due_date OR NEW.resolution_status IS DISTINCT FROM OLD.resolution_status OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note OR NEW.resolution_session_id IS DISTINCT FROM OLD.resolution_session_id OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason)) EXECUTE FUNCTION ccc_action_item_history_update();
ALTER FUNCTION ccc_action_item_history_insert() OWNER TO ccc_schema_owner;
ALTER FUNCTION ccc_action_item_history_update() OWNER TO ccc_schema_owner;
CREATE FUNCTION ccc_schedule_question_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO schedule_question_revisions VALUES (NEW.id, NEW.org_id, NEW.revision, NEW.body, NEW.schedule_id, NEW.support_case_id); RETURN NEW; END;
$$;
CREATE TRIGGER schedule_question_history_insert AFTER INSERT ON schedule_custom_questions FOR EACH ROW WHEN (1 = 1) EXECUTE FUNCTION ccc_schedule_question_history_insert();
CREATE FUNCTION ccc_schedule_question_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE schedule_custom_questions SET revision = OLD.revision + 1 WHERE id = NEW.id;
  INSERT INTO schedule_question_revisions VALUES (NEW.id, NEW.org_id, OLD.revision + 1, NEW.body, NEW.schedule_id, NEW.support_case_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER schedule_question_history_update AFTER UPDATE ON schedule_custom_questions FOR EACH ROW WHEN (1 = 1 AND (NEW.body IS DISTINCT FROM OLD.body OR NEW.schedule_id IS DISTINCT FROM OLD.schedule_id OR NEW.support_case_id IS DISTINCT FROM OLD.support_case_id)) EXECUTE FUNCTION ccc_schedule_question_history_update();
ALTER FUNCTION ccc_schedule_question_history_insert() OWNER TO ccc_schema_owner;
ALTER FUNCTION ccc_schedule_question_history_update() OWNER TO ccc_schema_owner;
CREATE TRIGGER manual_record_revisions_no_update BEFORE UPDATE ON manual_record_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
CREATE TRIGGER manual_record_revisions_no_delete BEFORE DELETE ON manual_record_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
ALTER TABLE manual_record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_record_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_manual_record_revisions ON manual_record_revisions FOR ALL TO ccc_api USING (org_id = NULLIF(current_setting('app.org_id', true), '')) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
REVOKE ALL ON TABLE manual_record_revisions FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE manual_record_revisions TO ccc_api;
ALTER TABLE manual_record_revisions OWNER TO ccc_schema_owner;
CREATE TRIGGER action_item_revisions_no_update BEFORE UPDATE ON action_item_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
CREATE TRIGGER action_item_revisions_no_delete BEFORE DELETE ON action_item_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
ALTER TABLE action_item_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_item_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_action_item_revisions ON action_item_revisions FOR ALL TO ccc_api USING (org_id = NULLIF(current_setting('app.org_id', true), '')) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
REVOKE ALL ON TABLE action_item_revisions FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE action_item_revisions TO ccc_api;
ALTER TABLE action_item_revisions OWNER TO ccc_schema_owner;
CREATE TRIGGER schedule_question_revisions_no_update BEFORE UPDATE ON schedule_question_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
CREATE TRIGGER schedule_question_revisions_no_delete BEFORE DELETE ON schedule_question_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
ALTER TABLE schedule_question_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_question_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_schedule_question_revisions ON schedule_question_revisions FOR ALL TO ccc_api USING (org_id = NULLIF(current_setting('app.org_id', true), '')) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
REVOKE ALL ON TABLE schedule_question_revisions FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE schedule_question_revisions TO ccc_api;
ALTER TABLE schedule_question_revisions OWNER TO ccc_schema_owner;
CREATE TRIGGER manual_action_outcomes_no_update BEFORE UPDATE ON manual_action_outcomes FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
CREATE TRIGGER manual_action_outcomes_no_delete BEFORE DELETE ON manual_action_outcomes FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
ALTER TABLE manual_action_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_action_outcomes FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_manual_action_outcomes ON manual_action_outcomes FOR ALL TO ccc_api USING (org_id = NULLIF(current_setting('app.org_id', true), '')) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
REVOKE ALL ON TABLE manual_action_outcomes FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE manual_action_outcomes TO ccc_api;
ALTER TABLE manual_action_outcomes OWNER TO ccc_schema_owner;
CREATE TRIGGER manual_question_outcomes_no_update BEFORE UPDATE ON manual_question_outcomes FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
CREATE TRIGGER manual_question_outcomes_no_delete BEFORE DELETE ON manual_question_outcomes FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('manual_history_immutable');
ALTER TABLE manual_question_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_question_outcomes FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_manual_question_outcomes ON manual_question_outcomes FOR ALL TO ccc_api USING (org_id = NULLIF(current_setting('app.org_id', true), '')) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
REVOKE ALL ON TABLE manual_question_outcomes FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE manual_question_outcomes TO ccc_api;
ALTER TABLE manual_question_outcomes OWNER TO ccc_schema_owner;
CREATE FUNCTION ccc_manual_action_outcomes_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT (EXISTS (SELECT 1 FROM sessions s JOIN action_items a ON a.id = NEW.action_item_id AND a.org_id = s.org_id AND a.support_case_id = s.support_case_id WHERE s.id = NEW.session_id AND s.org_id = NEW.org_id AND s.support_case_id = NEW.support_case_id AND s.kind = 'regular' AND s.manual_schema_version = 2)) THEN RAISE EXCEPTION 'manual_source_mismatch'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER manual_action_outcomes_source_guard BEFORE INSERT ON manual_action_outcomes FOR EACH ROW EXECUTE FUNCTION ccc_manual_action_outcomes_source_guard();
ALTER FUNCTION ccc_manual_action_outcomes_source_guard() OWNER TO ccc_schema_owner;
CREATE FUNCTION ccc_manual_question_outcomes_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT (EXISTS (SELECT 1 FROM sessions s WHERE s.id = NEW.session_id AND s.org_id = NEW.org_id AND s.support_case_id = NEW.support_case_id AND s.kind = 'regular' AND s.manual_schema_version = 2)) THEN RAISE EXCEPTION 'manual_source_mismatch'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER manual_question_outcomes_source_guard BEFORE INSERT ON manual_question_outcomes FOR EACH ROW EXECUTE FUNCTION ccc_manual_question_outcomes_source_guard();
ALTER FUNCTION ccc_manual_question_outcomes_source_guard() OWNER TO ccc_schema_owner;
CREATE TRIGGER manual_question_identity_guard BEFORE UPDATE ON sessions FOR EACH ROW
WHEN (OLD.manual_schema_version = 2 AND (NEW.record_details::jsonb -> 'nextQuestions') IS DISTINCT FROM (OLD.record_details::jsonb -> 'nextQuestions'))
EXECUTE FUNCTION ccc_reject_write('manual_question_identity_immutable');
CREATE FUNCTION ccc_manual_question_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    ))
  ) THEN RAISE EXCEPTION 'manual_question_source_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER manual_question_history_guard BEFORE INSERT ON manual_question_outcomes FOR EACH ROW EXECUTE FUNCTION ccc_manual_question_history_guard();
ALTER FUNCTION ccc_manual_question_history_guard() OWNER TO ccc_schema_owner;
