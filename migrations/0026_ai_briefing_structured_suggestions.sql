-- ============================================================================
-- 마이그레이션 0026 — AI 브리핑 제안 구조화 (D45 · CCC-39 · 2026-07-29)
--
-- 번호가 0025가 아닌 이유: 0025는 병렬 티켓 CCC-38, 0027은 CCC-43이 예약했다.
--
-- D45 영역 ①: AI 제안은 "짧은 제목 + 확인해야 하는 이유 + 근거 회차/원문 링크"
-- 구조다. 지금까지 ai_draft_versions.questions_json 은 단문 질문 문자열 배열이었고,
-- 0006의 insert 가드가 **각 원소가 text 타입**임을 강제해 구조화 원소(객체)를
-- 저장할 수 없다. 이 마이그레이션은 그 가드 트리거만 재생성해 원소 형태를 넓힌다:
--
--   * 신형(v2): {"title": "...", "reason": "..."} — 키 정확히 2개, 둘 다 비어 있지 않은 text
--   * 구형(v1): 비어 있지 않은 문자열 (기존 행 위에 human_edited 새 버전을 만들 때
--     부모의 questions_json 을 그대로 복사해야 하므로(provenance 가드) 계속 허용)
--
-- 중복 검사는 구형=원소 값, 신형=title 로 판정한다(제목이 같으면 같은 제안).
-- CASE 분기로 text 원소에 json_extract 를 호출하지 않는다(malformed JSON 오류 방지).
--
-- 개수(생성형 2~3개)·근거 링크(question_N claim, 승인 가드)·append-only 등
-- 나머지 계약은 0003/0006 정의 그대로 두고 이 트리거의 질문 검사 절만 바꾼다.
-- 데이터 마이그레이션 없음 — 기존 v1 행은 그대로 유효하며, 게이트웨이가 읽기 시
-- 구형 문자열을 {title, reason: null} 로 정규화한다.
-- ============================================================================

DROP TRIGGER ai_draft_versions_insert_guard;

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
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.parent_version_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM ai_review_events
                WHERE draft_version_id = NEW.parent_version_id);
  SELECT RAISE(ABORT, 'phase1: generated draft source snapshot scope or hash mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN ai_masked_source_snapshots AS snapshot
      ON snapshot.id = NEW.source_snapshot_id AND snapshot.org_id = work.org_id
     AND snapshot.support_case_id = work.support_case_id
     AND snapshot.session_id = work.session_id AND snapshot.sha256 = NEW.source_snapshot_hash
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'phase1: generated draft consent evidence scope mismatch')
  WHERE NEW.origin = 'generated' AND NOT EXISTS (
    SELECT 1
    FROM ai_work_items AS work
    JOIN pilot_text_ai_consent_evidence AS evidence
      ON evidence.id = NEW.consent_evidence_id AND evidence.org_id = work.org_id
     AND evidence.support_case_id = work.support_case_id
    WHERE work.id = NEW.work_item_id
  );
  SELECT RAISE(ABORT, 'stale_draft_version')
  WHERE NEW.origin = 'generated' AND NEW.consent_evidence_id IS NOT (
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
