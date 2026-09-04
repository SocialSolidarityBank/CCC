-- ============================================================================
-- 마이그레이션 0025 — 회차별 핵심 한 줄 (D45 영역 ② · CCC-38 · 2026-07-29)
--
-- 번호가 0025인 이유: 0021·0022는 PR #5, 0023은 CCC-32, 0024는 CCC-41이 선점했고
-- 0026(CCC-39)·0027(CCC-43)은 병렬 티켓 예약분이다.
--
-- D45 영역 ②: 브리핑 회차 줄마다 **상담일 · 유형 · 핵심 한 줄**. 핵심 한 줄은 AI가
-- 만들고 기존 산출물(요약·질문)과 **같은 승인 흐름에서 함께 승인**된다(R2). 그래서
-- 별도 테이블이 아니라 승인 단위인 ai_draft_versions 의 컬럼이다 — 요약과 같은 초안
-- 버전에 실려 approveGeneratedAiDraft 한 번으로 함께 공식화된다.
--
-- NULL = 이 초안에 핵심 한 줄이 없음(스키마 v1 레거시 초안). 백필 없음 — 지난 회차는
-- 승인된 한 줄이 없으므로 브리핑이 수기 메모 발췌 + '수기' 배지로 폴백한다(D5).
--
-- 뷰 재생성: 승인 전 초안은 브리핑·통계 어디에도 나가지 않는다는 R2 경계가
-- approved_ai_briefing_v1 뷰다 — 한 줄도 이 뷰를 거쳐야만 읽히도록 뷰에 컬럼을 노출한다.
-- ============================================================================

ALTER TABLE ai_draft_versions ADD COLUMN one_liner TEXT;

-- 핵심 "한 줄" 형식 가드: 값이 있으면 개행 없는 비어 있지 않은 텍스트여야 한다.
-- (레거시 호환을 위해 NULL 은 허용 — 필수 여부는 생성 경로별로 게이트웨이가 강제한다.)
CREATE TRIGGER ai_draft_one_liner_format_guard
BEFORE INSERT ON ai_draft_versions
WHEN NEW.one_liner IS NOT NULL
  AND (length(trim(NEW.one_liner)) = 0 OR instr(NEW.one_liner, char(10)) > 0)
BEGIN SELECT RAISE(ABORT, 'ccc38: AI one-liner must be a non-empty single line'); END;

-- grounded_ai_quality_v1 이 approved_ai_briefing_v1 을 참조하므로 함께 재생성한다.
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
WHERE review.decision = 'approved';

CREATE VIEW grounded_ai_quality_v1 AS
SELECT * FROM approved_ai_briefing_v1
WHERE origin = 'generated' AND grounding_status = 'grounded';
