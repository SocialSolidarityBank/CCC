-- ============================================================================
-- Migration 0004 — Phase 1 immutable AI cutover and legacy continuity
--
-- No down migration is provided. Recovery after this cutover is feature-off and
-- forward-fix: manual records and approved briefing projections remain readable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Refuse any pre-existing non-canonical AI lineage. A prior import is reusable
-- only when its deterministic ids, exact summary bytes, counts, actor, and time
-- all prove that it is the historical approved session summary. This deliberately
-- trips ai_work_items.kind's CHECK on bad state without mutating user records.
-- ----------------------------------------------------------------------------
INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
LEFT JOIN sessions AS historical
  ON historical.id = work.session_id
 AND historical.org_id = work.org_id
 AND historical.case_id = work.case_id
WHERE historical.id IS NULL
   OR historical.approved_at IS NULL
   OR historical.ai_summary IS NULL
   OR work.id != 'legacy-import-work:' || historical.id
   OR work.kind != 'text_ai_briefing'
   OR work.created_at IS NOT historical.approved_at
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN sessions AS historical ON historical.id = work.session_id
LEFT JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
WHERE (SELECT COUNT(*) FROM ai_draft_versions WHERE work_item_id = work.id) != 1
   OR draft.id != 'legacy-import-draft:' || historical.id
   OR draft.version != 1
   OR draft.parent_version_id IS NOT NULL
   OR CAST(draft.summary_text AS BLOB) != CAST(historical.ai_summary AS BLOB)
   OR CAST(draft.questions_json AS BLOB) != CAST('[]' AS BLOB)
   OR draft.created_at IS NOT historical.approved_at
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
WHERE draft.source_snapshot_id IS NOT NULL
   OR draft.source_snapshot_hash IS NOT NULL
   OR draft.consent_evidence_id IS NOT NULL
   OR draft.provider_config_id IS NOT NULL
   OR draft.model_id IS NOT NULL
   OR draft.prompt_version IS NOT NULL
   OR draft.schema_version IS NOT NULL
   OR draft.origin != 'legacy_import'
   OR draft.creation_mode != 'legacy_import'
   OR draft.grounding_status != 'legacy_unverified'
   OR draft.created_by IS NOT NULL
   OR CAST(draft.questions_json AS BLOB) != CAST('[]' AS BLOB)
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN sessions AS historical ON historical.id = work.session_id
LEFT JOIN ai_review_events AS review ON review.work_item_id = work.id
WHERE (SELECT COUNT(*) FROM ai_review_events WHERE work_item_id = work.id) != 1
   OR review.id != 'legacy-import-review:' || historical.id
   OR review.draft_version_id != 'legacy-import-draft:' || historical.id
   OR review.decision != 'approved'
   OR review.replacement_draft_id IS NOT NULL
   OR review.actor_id IS NOT historical.approved_by
   OR review.created_at IS NOT historical.approved_at
LIMIT 1;

INSERT INTO ai_work_items (id, org_id, case_id, session_id, kind, created_at)
SELECT
  'phase1-cutover-preflight:' || work.session_id,
  work.org_id,
  work.case_id,
  work.session_id,
  'phase1_cutover_preflight',
  work.created_at
FROM ai_work_items AS work
JOIN ai_draft_versions AS draft ON draft.work_item_id = work.id
WHERE EXISTS (
  SELECT 1
  FROM ai_evidence_links
  WHERE ai_evidence_links.draft_version_id = draft.id
)
LIMIT 1;

-- ----------------------------------------------------------------------------
-- Import every pre-cutover approved summary exactly once. The source text is
-- selected directly from sessions.ai_summary so SQLite preserves its stored
-- bytes; no evidence, model, prompt, or grounding metadata is fabricated.
-- ----------------------------------------------------------------------------
INSERT INTO ai_work_items (
  id,
  org_id,
  case_id,
  session_id,
  kind,
  created_at
)
SELECT
  'legacy-import-work:' || sessions.id,
  sessions.org_id,
  sessions.case_id,
  sessions.id,
  'text_ai_briefing',
  sessions.approved_at
FROM sessions
WHERE sessions.approved_at IS NOT NULL
  AND sessions.ai_summary IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS existing
    WHERE existing.session_id = sessions.id
      AND existing.kind = 'text_ai_briefing'
  );

INSERT INTO ai_draft_versions (
  id,
  work_item_id,
  version,
  parent_version_id,
  summary_text,
  questions_json,
  source_snapshot_id,
  source_snapshot_hash,
  consent_evidence_id,
  provider_config_id,
  model_id,
  prompt_version,
  schema_version,
  origin,
  creation_mode,
  grounding_status,
  created_by,
  created_at
)
SELECT
  'legacy-import-draft:' || sessions.id,
  work.id,
  1,
  NULL,
  sessions.ai_summary,
  '[]',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  'legacy_import',
  'legacy_import',
  'legacy_unverified',
  NULL,
  sessions.approved_at
FROM sessions
JOIN ai_work_items AS work
  ON work.session_id = sessions.id
 AND work.kind = 'text_ai_briefing'
WHERE sessions.approved_at IS NOT NULL
  AND sessions.ai_summary IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_draft_versions AS existing
    WHERE existing.work_item_id = work.id
  );

INSERT INTO ai_review_events (
  id,
  work_item_id,
  draft_version_id,
  decision,
  replacement_draft_id,
  actor_id,
  created_at
)
SELECT
  'legacy-import-review:' || sessions.id,
  work.id,
  draft.id,
  'approved',
  NULL,
  sessions.approved_by,
  sessions.approved_at
FROM sessions
JOIN ai_work_items AS work
  ON work.session_id = sessions.id
 AND work.kind = 'text_ai_briefing'
JOIN ai_draft_versions AS draft
  ON draft.work_item_id = work.id
 AND draft.version = 1
WHERE sessions.approved_at IS NOT NULL
  AND sessions.ai_summary IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_review_events AS existing
    WHERE existing.work_item_id = work.id
  );

-- These are the exact 0004-owned objects. The migration runner provides the
-- version-level rerun boundary; dropping only these names prevents stale SQL
-- definitions from surviving a cutover replay.
DROP TRIGGER IF EXISTS sessions_approved_ai_compatibility_immutable;
DROP TRIGGER IF EXISTS ai_draft_versions_legacy_import_cutover_guard;
DROP TRIGGER IF EXISTS sessions_direct_ai_approval_update_guard;
DROP TRIGGER IF EXISTS sessions_direct_ai_approval_insert_guard;
DROP VIEW IF EXISTS grounded_ai_quality_v1;
DROP VIEW IF EXISTS approved_ai_briefing_v1;

CREATE TRIGGER ai_draft_versions_legacy_import_cutover_guard
BEFORE INSERT ON ai_draft_versions
WHEN NEW.origin = 'legacy_import'
BEGIN
  SELECT RAISE(ABORT, 'phase1: runtime legacy AI import is prohibited');
END;

-- Every ordinary approval is official continuity, regardless of whether it was
-- generated with grounding or imported from the pre-cutover session columns.
CREATE VIEW approved_ai_briefing_v1 AS
SELECT
  work.id AS work_item_id,
  work.org_id AS org_id,
  work.case_id AS case_id,
  work.session_id AS session_id,
  work.kind AS kind,
  draft.id AS draft_version_id,
  draft.version AS draft_version,
  draft.summary_text AS summary_text,
  draft.questions_json AS questions_json,
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
JOIN ai_work_items AS work
  ON work.id = review.work_item_id
JOIN ai_draft_versions AS draft
  ON draft.id = review.draft_version_id
 AND draft.work_item_id = work.id
WHERE review.decision = 'approved';

-- Quality claims deliberately exclude imported legacy records. This projection
-- is never the official briefing continuity path.
CREATE VIEW grounded_ai_quality_v1 AS
SELECT *
FROM approved_ai_briefing_v1
WHERE origin = 'generated'
  AND grounding_status = 'grounded';

-- Post-cutover, sessions.ai_* remains compatibility-only. A new official value
-- must already have an immutable approved review with matching bytes/actor/time.
CREATE TRIGGER sessions_direct_ai_approval_insert_guard
BEFORE INSERT ON sessions
WHEN NEW.ai_status = 'approved'
  OR NEW.ai_summary IS NOT NULL
  OR NEW.approved_at IS NOT NULL
  OR NEW.approved_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'phase1: direct session AI approval is prohibited');
END;

CREATE TRIGGER sessions_direct_ai_approval_update_guard
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN (
  NEW.ai_status = 'approved'
  OR NEW.ai_summary IS NOT OLD.ai_summary
  OR NEW.approved_at IS NOT OLD.approved_at
  OR NEW.approved_by IS NOT OLD.approved_by
)
AND NOT (
  NEW.ai_status = 'approved'
  AND NEW.approved_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM approved_ai_briefing_v1 AS briefing
    WHERE briefing.session_id = NEW.id
      AND briefing.summary_text IS NEW.ai_summary
      AND briefing.approved_by IS NEW.approved_by
      AND briefing.approved_at IS NEW.approved_at
  )
)
BEGIN
  SELECT RAISE(ABORT, 'phase1: session AI approval requires an immutable approved review');
END;

CREATE TRIGGER sessions_approved_ai_compatibility_immutable
BEFORE UPDATE OF ai_status, ai_summary, approved_at, approved_by ON sessions
WHEN OLD.approved_at IS NOT NULL
  AND (
    NEW.ai_status IS NOT OLD.ai_status
    OR NEW.ai_summary IS NOT OLD.ai_summary
    OR NEW.approved_at IS NOT OLD.approved_at
    OR NEW.approved_by IS NOT OLD.approved_by
  )
BEGIN
  SELECT RAISE(ABORT, 'phase1: approved session AI compatibility fields are immutable');
END;
