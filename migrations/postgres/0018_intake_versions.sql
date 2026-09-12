-- W03, paired with SQLite 0062_intake_versions.sql. No historical JSON is reclassified.
ALTER TABLE programs ADD COLUMN financial_support_enabled integer NOT NULL DEFAULT 0 CHECK (financial_support_enabled IN (0, 1));
ALTER TABLE sessions ADD COLUMN intake_schema_version integer NOT NULL DEFAULT 1 CHECK (intake_schema_version IN (1, 2));
ALTER TABLE sessions ADD COLUMN intake_revision integer NOT NULL DEFAULT 1 CHECK (intake_revision >= 1);
ALTER TABLE sessions ADD COLUMN intake_updated_by text;
ALTER TABLE sessions ADD COLUMN intake_converted_from_revision integer;
CREATE TABLE intake_record_revisions (
  session_id text NOT NULL REFERENCES sessions(id), org_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1), schema_version integer NOT NULL CHECK (schema_version IN (1, 2)),
  held_at text NOT NULL, channel text NOT NULL, details text, actor_id text,
  recorded_at text NOT NULL, converted_from_revision integer,
  PRIMARY KEY (session_id, revision)
);
INSERT INTO intake_record_revisions
SELECT id, org_id, 1, 1, held_at, channel, intake_details, NULL, updated_at, NULL
FROM sessions WHERE kind = 'intake';
CREATE FUNCTION ccc_validate_intake_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sessions AS source WHERE source.id = NEW.session_id AND source.org_id = NEW.org_id
      AND source.kind = 'intake' AND source.intake_revision = NEW.revision AND source.intake_schema_version = NEW.schema_version
      AND source.held_at = NEW.held_at AND source.channel = NEW.channel AND source.intake_details IS NOT DISTINCT FROM NEW.details
      AND COALESCE(source.intake_updated_by, source.submitted_by, source.counselor_id) IS NOT DISTINCT FROM NEW.actor_id
      AND source.updated_at = NEW.recorded_at AND source.intake_converted_from_revision IS NOT DISTINCT FROM NEW.converted_from_revision
  ) THEN RAISE EXCEPTION 'intake_revision_source_mismatch'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER intake_revision_source_guard BEFORE INSERT ON intake_record_revisions FOR EACH ROW EXECUTE FUNCTION ccc_validate_intake_revision();
CREATE FUNCTION ccc_capture_intake_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO intake_record_revisions VALUES (NEW.id, NEW.org_id, NEW.intake_revision, NEW.intake_schema_version,
    NEW.held_at, NEW.channel, NEW.intake_details, COALESCE(NEW.intake_updated_by, NEW.submitted_by, NEW.counselor_id), NEW.updated_at, NEW.intake_converted_from_revision);
  RETURN NEW;
END;
$$;
CREATE TRIGGER intake_revision_insert AFTER INSERT ON sessions FOR EACH ROW WHEN (NEW.kind = 'intake')
EXECUTE FUNCTION ccc_capture_intake_revision();
CREATE TRIGGER intake_revision_update AFTER UPDATE ON sessions FOR EACH ROW
WHEN (NEW.kind = 'intake' AND NEW.intake_revision <> OLD.intake_revision) EXECUTE FUNCTION ccc_capture_intake_revision();
CREATE TRIGGER intake_revision_guard BEFORE UPDATE ON sessions FOR EACH ROW
WHEN (OLD.kind = 'intake' AND (
  (NEW.intake_details IS DISTINCT FROM OLD.intake_details OR NEW.held_at IS DISTINCT FROM OLD.held_at OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.intake_schema_version <> OLD.intake_schema_version OR NEW.intake_revision <> OLD.intake_revision)
  AND (NEW.intake_revision <> OLD.intake_revision + 1 OR NEW.intake_schema_version <> 2
    OR NEW.intake_updated_by IS NULL
    OR (OLD.intake_schema_version = 1 AND NEW.intake_converted_from_revision IS DISTINCT FROM OLD.intake_revision)
    OR (OLD.intake_schema_version = 2 AND NEW.intake_converted_from_revision IS NOT NULL))
)) EXECUTE FUNCTION ccc_reject_write('intake_revision_conflict');
CREATE TRIGGER intake_revisions_no_update BEFORE UPDATE ON intake_record_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('intake_revision_immutable');
CREATE TRIGGER intake_revisions_no_delete BEFORE DELETE ON intake_record_revisions FOR EACH ROW EXECUTE FUNCTION ccc_reject_write('intake_revision_immutable');
ALTER TABLE intake_record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_record_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_intake_record_revisions ON intake_record_revisions FOR ALL TO ccc_api
USING (org_id = NULLIF(current_setting('app.org_id', true), ''))
WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''));
REVOKE ALL ON TABLE intake_record_revisions FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE intake_record_revisions TO ccc_api;
ALTER TABLE intake_record_revisions OWNER TO ccc_schema_owner;
ALTER FUNCTION ccc_capture_intake_revision() OWNER TO ccc_schema_owner;
ALTER FUNCTION ccc_validate_intake_revision() OWNER TO ccc_schema_owner;
