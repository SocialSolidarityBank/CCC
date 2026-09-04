-- ============================================================================
-- Migration 0014 — 인테이크 기록 뼈대 (CCC-7 · 티켓 #54 · 인테이크 설계 v0.3)
--
-- 첫 상담(인테이크) 기록을 처음부터 끝까지 한 건 저장하는 최소 경로(P1)를 위한
-- 스키마 확장이다. 세 가지를 추가한다:
--
--   1) sessions.kind — 기록 종류('regular'|'intake'). 기존 행은 'regular' 로 백필한다.
--      일정(counseling_schedules.session_kind, 0010)과 값 어휘를 통일한다. 인테이크
--      1회 규칙(케이스당 kind='intake' 세션 1건)은 gateway(createIntakeRecord)가
--      원자 배치의 INSERT ... WHERE 가드로 강제한다(R1).
--   2) sessions.intake_details — 인테이크 서술형 항목(원하는 도움 3문 등)을 담는 격리
--      JSON. 코어 3층 구조 준수: 브리핑·통계가 쓰는 코어(6영역·GAS·액션·플래그)는 정규
--      구조로 두고, 서술형은 확장 슬롯 성격의 JSON 으로 격리한다 — 통계·브리핑 쿼리에
--      노출하지 않는다. sessions.extra 와 구분해 인테이크 전용 서술 항목만 담는다.
--   3) participant_consent_records.consent_privacy_at — 필수 통합 동의(개인정보 수집·
--      이용)의 기록 시각(NULL=미동의). 화면 동의 체크 2개 중 "개인정보 수집·이용"이
--      이 컬럼, "녹음·AI 정리"는 기존 2컬럼(consent_recording_at·consent_text_ai_at)에
--      동시 기록된다(v0.3 — D15 법률 검토 결과에 따라 마이그레이션 없이 되돌리기 쉬운
--      구조). insert_guard 를 갱신해 새 컬럼도 NULL 이거나 recorded_at 과 같도록 강제한다
--      (기존 2컬럼과 동일한 "한 번의 기록 행위" 정합 규칙).
--
-- 이 마이그레이션은 추가(additive) 전용이다. ALTER TABLE ADD COLUMN 은 기존 행을
-- DEFAULT 로 백필하므로(과거 세션은 모두 regular) 데이터 이관이 필요 없다. 동의 가드
-- 트리거만 DROP 후 재생성하며, 기존 세 검사는 문구 그대로 두고 privacy 검사 한 블록만
-- 덧붙인다. db/schema.sql(누적본)에도 같은 정의를 반영한다.
-- ============================================================================

ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'regular'
  CHECK (kind IN ('regular', 'intake'));

ALTER TABLE sessions ADD COLUMN intake_details TEXT;

ALTER TABLE participant_consent_records ADD COLUMN consent_privacy_at TEXT;

-- 삽입 가드 갱신: 기존 검사(케이스 정합·기록자 자격·녹음/AI 시각 정합)는 그대로 두고,
-- 필수 통합 동의(consent_privacy_at)도 NULL 이거나 기록 일시와 같도록 검사를 덧붙인다.
DROP TRIGGER participant_consent_records_insert_guard;

CREATE TRIGGER participant_consent_records_insert_guard
BEFORE INSERT ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id
      AND org_id = NEW.org_id
      AND beneficiary_id = NEW.beneficiary_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.recorded_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (NEW.consent_recording_at IS NOT NULL AND NEW.consent_recording_at <> NEW.recorded_at)
     OR (NEW.consent_text_ai_at IS NOT NULL AND NEW.consent_text_ai_at <> NEW.recorded_at)
     OR (NEW.consent_privacy_at IS NOT NULL AND NEW.consent_privacy_at <> NEW.recorded_at);
END;
