-- Migration 0033 - allow grounded preview fixture AI drafts.
--
-- The draft table is rebuilt because SQLite cannot alter the existing CHECK
-- contract in place. Foreign-key checks remain enabled and are deferred for
-- the create/copy/drop/rename cutover.

PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE ai_draft_versions_new (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items (id),
  version              INTEGER NOT NULL CHECK (version > 0),
  parent_version_id    TEXT REFERENCES ai_draft_versions_new (id),
  summary_text         TEXT NOT NULL,
  questions_json       TEXT NOT NULL
                       CHECK (json_valid(questions_json) AND json_type(questions_json) = 'array'),
  source_snapshot_id   TEXT REFERENCES ai_masked_source_snapshots (id),
  source_snapshot_hash TEXT,
  consent_evidence_id  TEXT REFERENCES pilot_text_ai_consent_evidence (id),
  provider_config_id   TEXT REFERENCES ai_provider_configs (id),
  model_id             TEXT,
  prompt_version       TEXT,
  schema_version       TEXT,
  origin               TEXT NOT NULL
                       CHECK (origin IN ('generated', 'legacy_import', 'fixture_generated')),
  creation_mode        TEXT NOT NULL
                       CHECK (creation_mode IN (
                         'provider_generated', 'human_edited', 'legacy_import',
                         'fixture_generated'
                       )),
  grounding_status     TEXT NOT NULL
                       CHECK (grounding_status IN ('grounded', 'legacy_unverified')),
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  one_liner            TEXT,
  UNIQUE (work_item_id, version),
  CHECK (
    (origin = 'generated'
      AND creation_mode IN ('provider_generated', 'human_edited')
      AND grounding_status = 'grounded'
      AND source_snapshot_id IS NOT NULL
      AND source_snapshot_hash IS NOT NULL
      AND consent_evidence_id IS NOT NULL
      AND provider_config_id IS NOT NULL
      AND model_id IS NOT NULL
      AND prompt_version IS NOT NULL
      AND schema_version IS NOT NULL
      AND created_by IS NOT NULL)
      AND json_array_length(questions_json) BETWEEN 2 AND 3
    OR
    (origin = 'legacy_import'
      AND creation_mode = 'legacy_import'
      AND grounding_status = 'legacy_unverified'
      AND source_snapshot_id IS NULL
      AND source_snapshot_hash IS NULL
      AND consent_evidence_id IS NULL
      AND provider_config_id IS NULL
      AND model_id IS NULL
      AND prompt_version IS NULL
      AND schema_version IS NULL
      AND created_by IS NULL)
      AND json_array_length(questions_json) = 0
    OR
    (origin = 'fixture_generated'
      AND creation_mode = 'fixture_generated'
      AND version = 1
      AND parent_version_id IS NULL
      AND grounding_status = 'grounded'
      AND source_snapshot_id IS NOT NULL
      AND source_snapshot_hash IS NOT NULL
      AND consent_evidence_id IS NOT NULL
      AND provider_config_id IS NULL
      AND model_id IS NULL
      AND prompt_version IS NOT NULL
      AND schema_version IS NOT NULL
      AND created_by IS NOT NULL)
      AND json_array_length(questions_json) BETWEEN 2 AND 3
  )
);

INSERT INTO ai_draft_versions_new (
  id, work_item_id, version, parent_version_id, summary_text, questions_json,
  source_snapshot_id, source_snapshot_hash, consent_evidence_id,
  provider_config_id, model_id, prompt_version, schema_version, origin,
  creation_mode, grounding_status, created_by, created_at, one_liner
)
SELECT
  id, work_item_id, version, parent_version_id, summary_text, questions_json,
  source_snapshot_id, source_snapshot_hash, consent_evidence_id,
  provider_config_id, model_id, prompt_version, schema_version, origin,
  creation_mode, grounding_status, created_by, created_at, one_liner
FROM ai_draft_versions;

CREATE TABLE ai_evidence_links_new (
  id                      TEXT PRIMARY KEY,
  draft_version_id        TEXT NOT NULL REFERENCES ai_draft_versions_new (id),
  source_evidence_item_id TEXT NOT NULL REFERENCES ai_masked_source_evidence_items (id),
  claim_key               TEXT NOT NULL CHECK (length(trim(claim_key)) > 0),
  evidence_quote          TEXT NOT NULL,
  source_ref              TEXT NOT NULL CHECK (length(trim(source_ref)) > 0),
  source_start            INTEGER NOT NULL CHECK (source_start >= 0),
  source_end              INTEGER NOT NULL CHECK (source_end > source_start),
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (draft_version_id, claim_key, source_evidence_item_id)
);

INSERT INTO ai_evidence_links_new (
  id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote,
  source_ref, source_start, source_end, created_at
)
SELECT
  id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote,
  source_ref, source_start, source_end, created_at
FROM ai_evidence_links;

CREATE TABLE ai_review_events_new (
  id                   TEXT PRIMARY KEY,
  work_item_id         TEXT NOT NULL REFERENCES ai_work_items (id),
  draft_version_id     TEXT NOT NULL REFERENCES ai_draft_versions_new (id),
  decision             TEXT NOT NULL
                       CHECK (decision IN ('approved', 'rejected', 'superseded')),
  replacement_draft_id TEXT REFERENCES ai_draft_versions_new (id),
  actor_id             TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (decision = 'superseded' AND replacement_draft_id IS NOT NULL)
    OR
    (decision IN ('approved', 'rejected') AND replacement_draft_id IS NULL)
  )
);

INSERT INTO ai_review_events_new (
  id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, created_at
)
SELECT
  id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, created_at
FROM ai_review_events;

DROP TRIGGER sessions_direct_ai_approval_update_guard;
DROP VIEW grounded_ai_quality_v1;
DROP VIEW approved_ai_briefing_v1;

DROP TRIGGER ai_draft_versions_insert_guard;
DROP TRIGGER ai_draft_versions_no_update;
DROP TRIGGER ai_draft_versions_no_delete;
DROP TRIGGER ai_draft_one_liner_format_guard;
DROP TRIGGER ai_evidence_links_insert_guard;
DROP TRIGGER ai_evidence_links_no_update;
DROP TRIGGER ai_evidence_links_no_delete;
DROP TRIGGER ai_review_events_insert_guard;
DROP TRIGGER ai_review_events_no_update;
DROP TRIGGER ai_review_events_no_delete;

DROP TABLE ai_review_events;
DROP TABLE ai_evidence_links;
DROP TABLE ai_draft_versions;
ALTER TABLE ai_draft_versions_new RENAME TO ai_draft_versions;
ALTER TABLE ai_evidence_links_new RENAME TO ai_evidence_links;
ALTER TABLE ai_review_events_new RENAME TO ai_review_events;

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_work
  ON ai_draft_versions (work_item_id, version DESC);

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_source_snapshot
  ON ai_draft_versions (source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_draft_versions_provider_config
  ON ai_draft_versions (provider_config_id)
  WHERE provider_config_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_evidence_links_draft
  ON ai_evidence_links (draft_version_id, claim_key);

CREATE INDEX IF NOT EXISTS idx_ai_review_events_work
  ON ai_review_events (work_item_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_review_events_terminal_draft
  ON ai_review_events (draft_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_review_events_approved_work
  ON ai_review_events (work_item_id)
  WHERE decision = 'approved';

CREATE TRIGGER ai_draft_versions_insert_guard
BEFORE INSERT ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.version != COALESCE((SELECT MAX(version) + 1 FROM ai_draft_versions
                                 WHERE work_item_id = NEW.work_item_id), 1);
  SELECT RAISE(ABORT, 'phase1: AI draft parent must be the prior version in the same work item')
  WHERE (NEW.version = 1 AND NEW.parent_version_id IS NOT NULL)
     OR (NEW.version > 1 AND NOT EXISTS (
       SELECT 1 FROM ai_draft_versions AS parent
       WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
         AND parent.version = NEW.version - 1
     ));
  SELECT RAISE(ABORT, 'phase1: AI draft questions are invalid')
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.questions_json) AS question
    WHERE CASE question.type
      WHEN 'text' THEN length(trim(question.value)) = 0
      WHEN 'object' THEN NOT (
        json_type(question.value, '$.title') = 'text'
        AND length(trim(json_extract(question.value, '$.title'))) > 0
        AND json_type(question.value, '$.reason') = 'text'
        AND length(trim(json_extract(question.value, '$.reason'))) > 0
        AND (SELECT COUNT(*) FROM json_each(question.value)) = 2
      )
      ELSE 1
    END
  )
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.questions_json) AS question
    GROUP BY CASE question.type
      WHEN 'object' THEN json_extract(question.value, '$.title')
      ELSE question.value
    END
    HAVING COUNT(*) > 1
  )
  OR (
    NEW.origin = 'fixture_generated'
    AND EXISTS (
      SELECT 1 FROM json_each(NEW.questions_json) AS question
      WHERE question.type <> 'object'
    )
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.parent_version_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM ai_review_events
                WHERE draft_version_id = NEW.parent_version_id);
  SELECT RAISE(ABORT, 'phase1: generated draft source snapshot scope or hash mismatch')
  WHERE NEW.origin IN ('generated', 'fixture_generated') AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = NEW.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = NEW.source_snapshot_hash
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: generated draft consent evidence scope mismatch')
  WHERE NEW.origin IN ('generated', 'fixture_generated') AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.id = NEW.consent_evidence_id AND evidence.org_id = work.org_id
     AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.origin IN ('generated', 'fixture_generated') AND NEW.consent_evidence_id IS NOT (
    SELECT evidence.id
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.org_id = work.org_id AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
      AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC LIMIT 1
  );
  SELECT RAISE(ABORT, 'phase1: generated draft provider configuration scope mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: human-edited draft must retain parent provenance')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'human_edited' AND NOT EXISTS (
    SELECT 1 FROM ai_draft_versions AS parent
    WHERE parent.id = NEW.parent_version_id AND parent.work_item_id = NEW.work_item_id
      AND parent.origin = 'generated' AND parent.provider_config_id IS NEW.provider_config_id
      AND parent.source_snapshot_id IS NEW.source_snapshot_id
      AND parent.source_snapshot_hash IS NEW.source_snapshot_hash
      AND parent.questions_json IS NEW.questions_json AND parent.model_id IS NEW.model_id
      AND parent.prompt_version IS NEW.prompt_version AND parent.schema_version IS NEW.schema_version
  );
  SELECT RAISE(ABORT, 'phase1: provider-generated draft requires the active provider configuration')
  WHERE NEW.origin = 'generated' AND NEW.creation_mode = 'provider_generated' AND NOT EXISTS (
    SELECT 1 FROM ai_work_items AS work
    JOIN ai_provider_configs AS config ON config.id = NEW.provider_config_id
                                       AND config.org_id = work.org_id
    JOIN ai_provider_activations AS activation ON activation.config_id = config.id
                                                AND activation.org_id = work.org_id
    WHERE work.id = NEW.work_item_id AND activation.deactivated_at IS NULL
  );
END;

CREATE TRIGGER ai_draft_versions_no_update
BEFORE UPDATE ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only');
END;

CREATE TRIGGER ai_draft_versions_no_delete
BEFORE DELETE ON ai_draft_versions
BEGIN
  SELECT RAISE(ABORT, 'phase1: AI draft versions are append-only');
END;

CREATE TRIGGER ai_draft_one_liner_format_guard
BEFORE INSERT ON ai_draft_versions
WHEN NEW.one_liner IS NOT NULL
  AND (length(trim(NEW.one_liner)) = 0 OR instr(NEW.one_liner, char(10)) > 0)
BEGIN SELECT RAISE(ABORT, 'ccc38: AI one-liner must be a non-empty single line'); END;

CREATE TRIGGER ai_evidence_links_insert_guard
BEFORE INSERT ON ai_evidence_links
BEGIN
  SELECT RAISE(ABORT, 'phase1: evidence links require a generated grounded draft')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id
      AND draft.origin IN ('generated', 'fixture_generated')
      AND draft.grounding_status = 'grounded'
  );
  SELECT RAISE(ABORT, 'phase1: evidence link must match its attested source item')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_work_items AS work ON work.id = draft.work_item_id
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = draft.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = draft.source_snapshot_hash
    JOIN ai_masked_source_evidence_items AS item
      ON item.id = NEW.source_evidence_item_id AND item.snapshot_id = snapshot.id
     AND item.source_sha256 = snapshot.sha256 AND item.org_id = work.org_id
     AND item.support_case_id = work.support_case_id AND item.session_id = work.session_id
     AND item.source_ref = NEW.source_ref AND item.evidence_quote = NEW.evidence_quote
     AND item.source_start = NEW.source_start AND item.source_end = NEW.source_end
    WHERE draft.id = NEW.draft_version_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE EXISTS (SELECT 1 FROM ai_review_events WHERE draft_version_id = NEW.draft_version_id)
     OR EXISTS (
       SELECT 1
       FROM ai_draft_versions AS newer
       JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
       WHERE newer.work_item_id = draft.work_item_id AND newer.version > draft.version
     );
END;

CREATE TRIGGER ai_evidence_links_no_update
BEFORE UPDATE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;

CREATE TRIGGER ai_evidence_links_no_delete
BEFORE DELETE ON ai_evidence_links
BEGIN SELECT RAISE(ABORT, 'phase1: AI evidence links are append-only'); END;

CREATE TRIGGER ai_review_events_insert_guard
BEFORE INSERT ON ai_review_events
BEGIN
  SELECT RAISE(ABORT, 'phase1: review event draft and work item mismatch')
  WHERE NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id AND draft.work_item_id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision IN ('approved', 'rejected') AND EXISTS (
    SELECT 1
    FROM ai_draft_versions AS newer
    JOIN ai_draft_versions AS draft ON draft.id = NEW.draft_version_id
    WHERE newer.work_item_id = NEW.work_item_id AND newer.version > draft.version
  );
  SELECT RAISE(ABORT, 'phase1: supersession must name the next draft version in the same work item')
  WHERE NEW.decision = 'superseded' AND NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE draft.id = NEW.draft_version_id AND replacement.work_item_id = draft.work_item_id
      AND replacement.version = draft.version + 1
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions AS later
    JOIN ai_draft_versions AS replacement ON replacement.id = NEW.replacement_draft_id
    WHERE later.work_item_id = NEW.work_item_id AND later.version > replacement.version
  );
  SELECT RAISE(ABORT, 'phase1: replacement draft is already terminal')
  WHERE NEW.decision = 'superseded' AND EXISTS (
    SELECT 1
    FROM ai_review_events
    WHERE draft_version_id = NEW.replacement_draft_id
  );
  SELECT RAISE(ABORT, 'phase1: fixture draft approval is prohibited')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'fixture_generated'
  );
  SELECT RAISE(ABORT, 'phase1: generated approval requires a human actor')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND (NEW.actor_id IS NULL OR length(trim(NEW.actor_id)) = 0);
  SELECT RAISE(ABORT, 'phase1: generated approval requires immutable evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (
    SELECT 1
    FROM ai_evidence_links
    WHERE draft_version_id = NEW.draft_version_id
  );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded summary evidence')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions
    WHERE id = NEW.draft_version_id AND origin = 'generated'
  ) AND NOT EXISTS (
    SELECT 1
    FROM ai_evidence_links
    WHERE draft_version_id = NEW.draft_version_id
      AND claim_key NOT GLOB 'question_[0-9]*'
  );
  SELECT RAISE(ABORT, 'phase1: generated approval requires grounded briefing questions')
  WHERE NEW.decision = 'approved' AND EXISTS (
    SELECT 1
    FROM ai_draft_versions AS draft
    WHERE draft.id = NEW.draft_version_id AND draft.origin = 'generated'
      AND EXISTS (
        SELECT 1
        FROM json_each(draft.questions_json) AS question
        WHERE NOT EXISTS (
          SELECT 1
          FROM ai_evidence_links AS evidence
          WHERE evidence.draft_version_id = draft.id
            AND evidence.claim_key = 'question_' || (CAST(question.key AS INTEGER) + 1)
        )
      )
  );
END;

CREATE TRIGGER ai_review_events_no_update
BEFORE UPDATE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;

CREATE TRIGGER ai_review_events_no_delete
BEFORE DELETE ON ai_review_events
BEGIN SELECT RAISE(ABORT, 'phase1: AI review events are append-only'); END;

CREATE TRIGGER ai_draft_versions_legacy_import_cutover_guard
BEFORE INSERT ON ai_draft_versions
WHEN NEW.origin = 'legacy_import'
BEGIN SELECT RAISE(ABORT, 'phase1: runtime legacy AI import is prohibited'); END;

CREATE VIEW approved_ai_briefing_v1 AS
SELECT
  work.id AS work_item_id,
  work.org_id AS org_id,
  work.support_case_id AS support_case_id,
  COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
  support_case.beneficiary_id AS beneficiary_id,
  support_case.program_type AS support_case_program_type,
  support_case.status AS support_case_status,
  work.session_id AS session_id,
  work.kind AS kind,
  draft.id AS draft_version_id,
  draft.version AS draft_version,
  draft.summary_text AS summary_text,
  draft.questions_json AS questions_json,
  draft.one_liner AS one_liner,
  draft.summary_text AS ai_summary,
  draft.source_snapshot_id AS source_snapshot_id,
  draft.source_snapshot_hash AS source_snapshot_hash,
  draft.consent_evidence_id AS consent_evidence_id,
  draft.provider_config_id AS provider_config_id,
  draft.model_id AS model_id,
  draft.prompt_version AS prompt_version,
  draft.schema_version AS schema_version,
  draft.origin AS origin,
  draft.creation_mode AS creation_mode,
  draft.grounding_status AS grounding_status,
  draft.created_by AS draft_created_by,
  draft.created_at AS draft_created_at,
  review.id AS review_event_id,
  review.actor_id AS approved_by,
  review.created_at AS approved_at
FROM ai_review_events AS review
JOIN ai_work_items AS work ON work.id = review.work_item_id
JOIN support_cases AS support_case ON support_case.id = work.support_case_id
JOIN ai_draft_versions AS draft ON draft.id = review.draft_version_id
                             AND draft.work_item_id = work.id
WHERE review.decision = 'approved'
  AND draft.origin <> 'fixture_generated';

CREATE VIEW grounded_ai_quality_v1 AS
SELECT * FROM approved_ai_briefing_v1
WHERE origin = 'generated' AND grounding_status = 'grounded';

CREATE TRIGGER sessions_direct_ai_approval_update_guard
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN (NEW.ai_status = 'approved' OR NEW.ai_summary IS NOT OLD.ai_summary
      OR NEW.approved_at IS NOT OLD.approved_at OR NEW.approved_by IS NOT OLD.approved_by)
 AND NOT (
   NEW.ai_status = 'approved' AND NEW.approved_at IS NOT NULL AND EXISTS (
     SELECT 1 FROM approved_ai_briefing_v1 AS briefing
     WHERE briefing.session_id = NEW.id AND briefing.summary_text IS NEW.ai_summary
       AND briefing.approved_by IS NEW.approved_by AND briefing.approved_at IS NEW.approved_at
   )
 )
BEGIN SELECT RAISE(ABORT, 'phase1: session AI approval requires an immutable approved review'); END;
