-- W03: existing records remain version 1; only new explicitly versioned writes use 2.
ALTER TABLE programs ADD COLUMN financial_support_enabled INTEGER NOT NULL DEFAULT 0 CHECK (financial_support_enabled IN (0, 1));
ALTER TABLE sessions ADD COLUMN intake_schema_version INTEGER NOT NULL DEFAULT 1 CHECK (intake_schema_version IN (1, 2));
ALTER TABLE sessions ADD COLUMN intake_revision INTEGER NOT NULL DEFAULT 1 CHECK (intake_revision >= 1);
ALTER TABLE sessions ADD COLUMN intake_updated_by TEXT;
ALTER TABLE sessions ADD COLUMN intake_converted_from_revision INTEGER;
CREATE TABLE intake_record_revisions (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  org_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
  held_at TEXT NOT NULL,
  channel TEXT NOT NULL,
  details TEXT,
  actor_id TEXT,
  recorded_at TEXT NOT NULL,
  converted_from_revision INTEGER,
  PRIMARY KEY (session_id, revision)
);
INSERT INTO intake_record_revisions
SELECT id, org_id, 1, 1, held_at, channel, intake_details, NULL, updated_at, NULL
FROM sessions WHERE kind = 'intake';
CREATE TRIGGER intake_revision_source_guard BEFORE INSERT ON intake_record_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM sessions AS source WHERE source.id = NEW.session_id AND source.org_id = NEW.org_id
    AND source.kind = 'intake' AND source.intake_revision = NEW.revision AND source.intake_schema_version = NEW.schema_version
    AND source.held_at = NEW.held_at AND source.channel = NEW.channel AND source.intake_details IS NEW.details
    AND COALESCE(source.intake_updated_by, source.submitted_by, source.counselor_id) IS NEW.actor_id
    AND source.updated_at = NEW.recorded_at AND source.intake_converted_from_revision IS NEW.converted_from_revision
)
BEGIN SELECT RAISE(ABORT, 'intake_revision_source_mismatch'); END;
CREATE TRIGGER intake_revision_insert AFTER INSERT ON sessions WHEN NEW.kind = 'intake'
BEGIN
  INSERT INTO intake_record_revisions VALUES (NEW.id, NEW.org_id, NEW.intake_revision, NEW.intake_schema_version,
    NEW.held_at, NEW.channel, NEW.intake_details, COALESCE(NEW.intake_updated_by, NEW.submitted_by, NEW.counselor_id), NEW.updated_at, NEW.intake_converted_from_revision);
END;
CREATE TRIGGER intake_revision_update AFTER UPDATE ON sessions
WHEN NEW.kind = 'intake' AND NEW.intake_revision <> OLD.intake_revision
BEGIN
  INSERT INTO intake_record_revisions VALUES (NEW.id, NEW.org_id, NEW.intake_revision, NEW.intake_schema_version,
    NEW.held_at, NEW.channel, NEW.intake_details, COALESCE(NEW.intake_updated_by, NEW.submitted_by, NEW.counselor_id), NEW.updated_at, NEW.intake_converted_from_revision);
END;
CREATE TRIGGER intake_revision_guard BEFORE UPDATE ON sessions
WHEN OLD.kind = 'intake' AND (
  (NEW.intake_details IS NOT OLD.intake_details OR NEW.held_at IS NOT OLD.held_at OR NEW.channel IS NOT OLD.channel
    OR NEW.intake_schema_version <> OLD.intake_schema_version OR NEW.intake_revision <> OLD.intake_revision)
  AND (NEW.intake_revision <> OLD.intake_revision + 1 OR NEW.intake_schema_version <> 2
    OR NEW.intake_updated_by IS NULL
    OR (OLD.intake_schema_version = 1 AND NEW.intake_converted_from_revision IS NOT OLD.intake_revision)
    OR (OLD.intake_schema_version = 2 AND NEW.intake_converted_from_revision IS NOT NULL))
)
BEGIN SELECT RAISE(ABORT, 'intake_revision_conflict'); END;
CREATE TRIGGER intake_revisions_no_update BEFORE UPDATE ON intake_record_revisions
BEGIN SELECT RAISE(ABORT, 'intake_revision_immutable'); END;
CREATE TRIGGER intake_revisions_no_delete BEFORE DELETE ON intake_record_revisions
BEGIN SELECT RAISE(ABORT, 'intake_revision_immutable'); END;
