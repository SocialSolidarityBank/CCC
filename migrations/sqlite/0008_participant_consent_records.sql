-- ============================================================================
-- Migration 0008 — 참여자 동의 기록 (D15 · D23 · 티켓 #19)
--
-- 참여자 등록 시 받은 동의를 항목별 체크(녹음·텍스트 AI 분리, D15)·일시·기록자로
-- 저장하는 전용 기록 테이블을 신설한다. 동의 문안·서명은 저장하지 않는다(D23):
-- 시스템은 오프라인(종이·구두)으로 받은 동의의 "기록"만 남긴다.
--
-- support_cases.consent_recording_at / consent_text_ai_at 는 그대로 유지한다 —
-- 두 컬럼은 파이프라인 게이트(녹음 업로드 허용 여부, D15)의 진실 원천이고, 이 표는
-- 그 위에 "누가 언제 그 결정을 기록했나"(기록자·일시)를 덧붙인다. 등록 게이트웨이가
-- 두 곳을 한 배치에서 함께 쓰므로 값이 어긋나지 않는다.
--
-- 이 마이그레이션은 추가(additive) 전용이다. 0001~0007 테이블·트리거를 바꾸지 않는다.
-- 실패 문자열은 참여자 그래프의 다른 가드와 동일한 고정값('participant_schema_violation')을
-- 써서 PII·제출 내용이 SQL 오류로 새지 않게 한다.
-- ============================================================================

-- 항목별 동의 시각은 NULL 이면 미동의(D15 미동의 경로). recorded_by 는 기록자,
-- recorded_at 은 기록 일시다. 한 참여자·참여사업에 대해 등록 시 1건이 기록되며,
-- 재동의 이력이 필요하면 append 로 쌓는다(추가 전용).
CREATE TABLE participant_consent_records (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  beneficiary_id        TEXT NOT NULL REFERENCES beneficiaries (id),
  support_case_id       TEXT NOT NULL REFERENCES support_cases (id),
  consent_recording_at  TEXT,                                 -- 녹음·음성 분석 동의 시각 (NULL = 미동의, D15)
  consent_text_ai_at    TEXT,                                 -- 텍스트 AI 정리 동의 시각 (NULL = 미동의, D15)
  recorded_by           TEXT NOT NULL,                        -- 기록자 (Access 사용자)
  recorded_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_participant_consent_records_scope
  ON participant_consent_records (org_id, beneficiary_id, support_case_id, recorded_at DESC);

-- 삽입 가드: 참여자·참여사업이 같은 조직에서 서로 맞물려 존재해야 하고, 기록자는
-- 활성 담당 사용자여야 하며, 항목별 동의 시각은 NULL 이거나 기록 일시와 같아야 한다
-- (한 번의 등록 행위로 기록됐음을 DB 차원에서 강제).
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
     OR (NEW.consent_text_ai_at IS NOT NULL AND NEW.consent_text_ai_at <> NEW.recorded_at);
END;

-- D23·D14: 동의 기록은 추가 전용. 수정·삭제를 DB 차원에서 차단한다.
CREATE TRIGGER participant_consent_records_no_update
BEFORE UPDATE ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'D23: participant consent records are append-only');
END;

CREATE TRIGGER participant_consent_records_no_delete
BEFORE DELETE ON participant_consent_records
BEGIN
  SELECT RAISE(ABORT, 'D23: participant consent records are append-only');
END;
