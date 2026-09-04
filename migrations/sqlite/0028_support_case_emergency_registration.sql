-- ============================================================================
-- 마이그레이션 0028 — 긴급 등록(① 개인정보 동의 하드 게이트의 예외) · G1
--   근거: docs/consent/consent-implementation-gates-v1.md §2 G1 (2026-07-29 Q 결정1),
--         D44 의 "① 은 게이트가 아니다"를 부분 대체한다(②·③ 미동의 경로 D15 는 불변).
--
-- 무엇이 바뀌나:
--   * 등록(당사자 등록·자기 가입·추가 참여 사업)은 ① 개인정보 수집·이용 동의 없이는
--     막힌다. 급박한 위기 개입만 "긴급 등록"으로 통과하며, 그때는 **사유**와
--     **보완 기한**이 반드시 함께 남는다.
--   * 세 컬럼 전부 등록 시점의 사실이므로 **불변**이다(아래 UPDATE 가드). 나중에 동의를
--     받으면 support_cases.consent_privacy_at 이 채워지고, 그것이 곧 보완 완료 신호다 —
--     긴급 등록 기록 자체를 지워 흔적을 없애지 않는다(D14 감사 태도).
--
-- 보완 기한(consent_privacy_due_at)은 게이트웨이 설정값(EMERGENCY_CONSENT_GRACE_DAYS,
-- 기본 14일)으로 계산해 넣는다. 숫자는 법률 검토가 재개되면 그 상수 한 곳만 바꾼다
-- (검토 트랙은 2026-07-30 Q 결정으로 MVP 범위에서 종료 — 기본값으로 운영).
--
-- 사유(emergency_registration_reason)는 자유 텍스트라 **감사 detail 에 싣지 않는다**
-- (setSupportCaseOverallGoal 과 같은 태도, R3). 값은 이 컬럼에만 산다.
--
-- 이 마이그레이션은 추가(additive) 전용이다. 앞선 마이그레이션의 테이블·트리거를
-- 바꾸지 않는다. 실패 문자열은 참여자 그래프의 다른 가드와 같은 고정값
-- ('participant_schema_violation')이라 사유·PII 가 SQL 오류로 새지 않는다.
-- ============================================================================

ALTER TABLE support_cases ADD COLUMN emergency_registration_at TEXT;      -- 긴급 등록 시각 (NULL = 일반 등록)
ALTER TABLE support_cases ADD COLUMN emergency_registration_reason TEXT;  -- 긴급 등록 사유 (자유 텍스트, 감사 미기재)
ALTER TABLE support_cases ADD COLUMN consent_privacy_due_at TEXT;         -- ① 동의 보완 기한

-- 삽입 가드: 세 컬럼은 "전부 있음" 또는 "전부 없음"이다. 사유 없는 긴급 등록·기한 없는
-- 긴급 등록은 예외를 기록 없는 우회로 만들기 때문에 DB 차원에서 막는다. 반대로 긴급이
-- 아닌데 사유·기한만 남는 것도 막는다(의미 없는 기한이 알림 큐에 뜬다).
-- ① 동의와 긴급 등록이 함께 오는 것도 막는다 — 예외는 동의가 없을 때만 성립한다.
CREATE TRIGGER support_cases_emergency_registration_insert_guard
BEFORE INSERT ON support_cases
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (NEW.emergency_registration_at IS NULL) <> (NEW.consent_privacy_due_at IS NULL)
     OR (NEW.emergency_registration_at IS NULL) <> (NEW.emergency_registration_reason IS NULL);

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.emergency_registration_at IS NOT NULL
    AND (TRIM(NEW.emergency_registration_reason) = '' OR NEW.consent_privacy_at IS NOT NULL);
END;

-- 등록 시점의 사실이므로 이후 수정 금지(support_cases_immutable_identity_guard 와 같은 태도).
CREATE TRIGGER support_cases_emergency_registration_immutable_guard
BEFORE UPDATE OF emergency_registration_at, emergency_registration_reason, consent_privacy_due_at
ON support_cases
WHEN NEW.emergency_registration_at IS NOT OLD.emergency_registration_at
  OR NEW.emergency_registration_reason IS NOT OLD.emergency_registration_reason
  OR NEW.consent_privacy_due_at IS NOT OLD.consent_privacy_due_at
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

-- 보완 대상 조회(긴급 등록 중 기한이 남은·지난 건, 그리고 ① 미기록 전체)를 위한 인덱스.
CREATE INDEX idx_support_cases_privacy_consent_followup
  ON support_cases (org_id, consent_privacy_at, consent_privacy_due_at);
