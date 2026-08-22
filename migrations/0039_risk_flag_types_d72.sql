-- Migration 0039 - finalize the D72 risk flag taxonomy.
--
-- Keep the existing housing_livelihood_shock identifier while widening its
-- product label to include health shocks. Add violence_exploitation as the
-- sixth allowed value. SQLite requires a table rebuild to replace the CHECK.

PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE flags_next (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases (id),
  session_id      TEXT REFERENCES sessions (id),
  flag_type       TEXT NOT NULL CHECK (flag_type IN (
                    'crisis_utterance', 'contact_loss_risk',
                    'housing_livelihood_shock', 'debt_deterioration',
                    'repeated_noncompliance', 'violence_exploitation')),
  quote           TEXT,
  source          TEXT NOT NULL CHECK (source IN ('ai', 'counselor')),
  review_status   TEXT NOT NULL CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
  reviewed_by     TEXT,
  reviewed_at     TEXT,
  created_at      TEXT NOT NULL,
  CHECK (source = 'counselor' OR quote IS NOT NULL)
);

INSERT INTO flags_next (
  id, org_id, support_case_id, session_id, flag_type, quote, source,
  review_status, reviewed_by, reviewed_at, created_at
)
SELECT
  id, org_id, support_case_id, session_id, flag_type, quote, source,
  review_status, reviewed_by, reviewed_at, created_at
FROM flags;

DROP TABLE flags;
ALTER TABLE flags_next RENAME TO flags;

CREATE INDEX idx_flags_support_case ON flags (support_case_id, review_status);

-- Table rebuilds drop table-owned triggers. Restore the canonical session scope
-- guard from migration 0006 so a flag cannot point at another support case's
-- session after the D72 taxonomy change.
CREATE TRIGGER flags_session_scope_guard
BEFORE INSERT ON flags
WHEN NEW.session_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM sessions
    WHERE id = NEW.session_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );
END;
