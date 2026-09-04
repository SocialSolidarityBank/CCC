-- Migration 0038 - persist D70 v4 claim sections with each immutable draft.
--
-- v3 and earlier rows keep an empty list. New provider and fixture drafts write
-- the three-section claim list explicitly. The approved view exposes the same
-- immutable JSON so review and record pages never reconstruct sections from prose.

ALTER TABLE ai_draft_versions
  ADD COLUMN claims_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(claims_json) AND json_type(claims_json) = 'array');

DROP VIEW grounded_ai_quality_v1;
DROP VIEW approved_ai_briefing_v1;

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
  draft.claims_json AS claims_json,
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
