-- ============================================================================
-- 마이그레이션 0022 - 당사자 자기 가입(self signup)을 위한 동의 기록자 + 토큰
-- 이중 소비 가드 (D39 · ADR-0016 · CCC-28)
--
-- 번호 이력: 이 파일은 PR #5 에서 **0019** 로 태어났다. 짝인 0018 이 0021 로 올라가면서
--   함께 0022 가 됐다(main 의 0020 이 먼저 머지·적용됨). 0021 다음에 와야 한다 —
--   invite_tokens 트리거가 그 테이블을 전제한다.
--
-- 배경: 당사자는 users 디렉터리에 들지 않고 고유 토큰 링크로 가입한다(ADR-0016
--   결정 4·6). 가입 제출은 한 트랜잭션 안에서 당사자+케이스+담당 배정+동의 기록
--   +토큰 소비를 원자적으로 수행한다(completeParticipantSignup, R1 관문).
--
-- 이 마이그레이션이 푸는 두 가지 DB 제약:
--
--   1) 동의 기록자 = 본인('self'). 기존 participant_consent_records_insert_guard 는
--      recorded_by 가 활성 users(admin|counselor) 행이어야만 허용한다. 자기 가입에서는
--      당사자가 아직 디렉터리에 없으므로 기록자를 'self' 로 둔다(ADR-0016 결정 6,
--      법률 검토 전 프로토타입). 가드를 'recorded_by = self 이거나 활성 사용자' 로
--      넓힌다. 나머지 검사(케이스 정합·동의 시각 정합)는 그대로 둔다.
--
--   2) 토큰 이중 소비를 DB 차원에서 차단. 가입 트랜잭션은 토큰 소비 UPDATE 를 같은
--      배치에 넣는다. JS 에서 UPDATE 의 changes 를 보는 방식으로는 원자성을 못 지킨다
--      — 배치가 커밋된 뒤에야 changes 를 읽으므로, 동시 이중 제출은 통과한 쪽이
--      당사자를 만들고 진 쪽의 소비 UPDATE 가 0 행을 맞춰 고아 당사자를 남긴다.
--      그래서 beneficiaries_complete_guard 와 같은 결정론 가드를 토큰에도 둔다:
--      used -> used 전이(이미 소비된 토큰을 다시 소비하려는 배치)를 RAISE(ABORT) 해
--      트랜잭션 전체를 되감는다. 정상 issued -> used 전이는 WHEN 절에 걸리지 않아
--      통과한다. 독립 경로(consumeInviteToken)는 WHERE status='issued' 가 used 행을
--      걸러내 UPDATE 가 0 행이라 가드가 발화하지 않으므로 기존 계약(ForbiddenError)은
--      그대로다.
--
-- 추가(additive) 전용은 아니다: 동의 가드를 넓히기 위해 기존 트리거를 한 번
--   교체(DROP+CREATE)한다. 행 데이터·다른 트리거는 건드리지 않는다.
-- ============================================================================

-- 1) 동의 기록자 가드: 'self'(자기 가입) 또는 같은 기관의 활성 담당 사용자.
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

  -- 'self' 는 자기 가입(당사자 본인)의 기록자 표식. 그 외는 기존대로 활성 사용자여야 한다.
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
END;

-- 2) 토 이중 소비 차단: used 로의 전이는 issued 에서만 허용.
CREATE TRIGGER invite_tokens_no_double_consume
BEFORE UPDATE ON invite_tokens
WHEN NEW.status = 'used' AND OLD.status <> 'issued'
BEGIN
  SELECT RAISE(ABORT, 'invite_token_already_used');
END;
