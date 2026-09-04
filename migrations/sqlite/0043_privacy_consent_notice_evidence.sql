-- CCC-125: 개인정보 ① 동의에도 당시 문안 버전·해시·오프라인 원본 참조를 남긴다.
-- 기존 행은 소급해 증거를 만들지 않는다. 새로 동의한 스냅샷부터 세 값이 필수다.

ALTER TABLE participant_consent_records ADD COLUMN privacy_notice_version TEXT;
ALTER TABLE participant_consent_records ADD COLUMN privacy_notice_sha256 TEXT;
ALTER TABLE participant_consent_records ADD COLUMN privacy_evidence_ref TEXT;

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
  WHERE NEW.recorded_by <> 'self' AND NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.recorded_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (NEW.consent_recording_at IS NOT NULL AND NEW.consent_recording_at <> NEW.recorded_at)
     OR (NEW.consent_text_ai_at IS NOT NULL AND NEW.consent_text_ai_at <> NEW.recorded_at)
     OR (NEW.consent_privacy_at IS NOT NULL AND NEW.consent_privacy_at <> NEW.recorded_at);

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (
    NEW.consent_privacy_at IS NOT NULL
    AND (
      NEW.privacy_notice_version IS NULL
      OR length(NEW.privacy_notice_version) < 3
      OR NEW.privacy_notice_sha256 IS NULL
      OR length(NEW.privacy_notice_sha256) <> 64
      OR NEW.privacy_notice_sha256 GLOB '*[^0-9a-f]*'
      OR NEW.privacy_evidence_ref IS NULL
      OR NEW.privacy_evidence_ref NOT GLOB 'offline://*'
    )
  )
  OR (
    NEW.consent_privacy_at IS NULL
    AND (
      NEW.privacy_notice_version IS NOT NULL
      OR NEW.privacy_notice_sha256 IS NOT NULL
      OR NEW.privacy_evidence_ref IS NOT NULL
    )
  );
END;
