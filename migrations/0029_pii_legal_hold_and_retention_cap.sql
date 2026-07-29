-- ============================================================================
-- 마이그레이션 0029 — 법적 보류 + 보존 상한 5년 · G2
--   근거: docs/consent/consent-implementation-gates-v1.md §2 G2, D32(보존·아카이브),
--         D10(파기 예정일)·D14(감사).
--
-- 왜 두 개를 한 쌍으로 넣나:
--   지금 자동 파기 cron 은 보관 기간(purge_due, 기본 1년)이 지나면 금고를 비운다.
--   그 경로에 **예외가 없어서** 다른 법령상 보존 의무나 법적 분쟁으로 남겨야 하는
--   기록도 함께 지워진다 — D32 가 요구한 예외가 코드에 없다.
--   그래서 ① 자동 파기를 멈추는 **법적 보류** 플래그를 넣고,
--         ② 그 보류가 무한정 늘어나지 못하게 **상한(종결 + 5년)** 을 천장으로 둔다.
--   상한만 넣으면 닿을 데이터가 없다(1년에 이미 파기된다). 보류가 있어야 상한이 의미를 갖는다.
--
-- 상한 숫자는 게이트웨이 전역 상수(RETENTION_CAP_YEARS, 기본 5)다 — **기관별 변동을
-- 허용하지 않는다**(게이트 문서 G2: 허용하려면 동의서 3절을 먼저 재기술해야 한다).
--
-- retention_change_kind 를 건드리지 않는 이유:
--   그 컬럼은 열거 CHECK 이고 participant_pii_vault_retention_guard 가 허용 전이를
--   일일이 나열한다. 값을 추가하면 SQLite 에서 테이블을 통째로 재구축해야 하고,
--   그 과정에서 기존 보증(파기 조합 CHECK·불변 가드)을 다시 세워야 한다.
--   보류는 그 기계와 층이 다른 사실이므로 **컬럼만 추가하고 변경 이력은 audit_log**
--   ('set_legal_hold'/'clear_legal_hold')에 남긴다 — audit_log.action 은 자유 문자열이라
--   스키마를 건드리지 않는다(CCC-42 선례).
--
-- 사유(legal_hold_reason)는 자유 텍스트라 **감사 detail 에 싣지 않는다**(R3,
-- 0028 의 emergency_registration_reason 과 같은 태도). 값은 이 컬럼에만 산다.
--
-- 추가(additive) 전용. 실패 문자열은 참여자 그래프의 다른 가드와 같은 고정값이라
-- 사유·PII 가 SQL 오류로 새지 않는다.
-- ============================================================================

ALTER TABLE participant_pii_vault ADD COLUMN legal_hold_at TEXT;      -- 보류 시작 시각 (NULL = 보류 없음)
ALTER TABLE participant_pii_vault ADD COLUMN legal_hold_reason TEXT;  -- 보류 사유 (자유 텍스트, 감사 미기재)
ALTER TABLE participant_pii_vault ADD COLUMN legal_hold_by TEXT;      -- 보류를 건 사람 (기관 관리자)

-- 보류는 등록 시점에 존재하지 않는다 — 나중에 관리자가 건다. 새 행이 보류를 안고
-- 태어나면 "언제 누가 걸었나"가 비게 되므로 삽입 자체를 막는다.
CREATE TRIGGER participant_pii_vault_legal_hold_insert_guard
BEFORE INSERT ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.legal_hold_at IS NOT NULL
     OR NEW.legal_hold_reason IS NOT NULL
     OR NEW.legal_hold_by IS NOT NULL;
END;

-- 세 컬럼은 "전부 있음"(보류 중) 또는 "전부 없음"(해제)이다. 사유·행위자 없는 보류는
-- 책임 추적이 안 되는 파기 정지라 DB 차원에서 막는다(D14).
CREATE TRIGGER participant_pii_vault_legal_hold_consistency_guard
BEFORE UPDATE OF legal_hold_at, legal_hold_reason, legal_hold_by
ON participant_pii_vault
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (NEW.legal_hold_at IS NULL) <> (NEW.legal_hold_reason IS NULL)
     OR (NEW.legal_hold_at IS NULL) <> (NEW.legal_hold_by IS NULL);

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.legal_hold_at IS NOT NULL AND TRIM(NEW.legal_hold_reason) = '';

  -- 이미 파기된 금고에 보류를 거는 것은 의미가 없다(지울 것이 없다).
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.legal_hold_at IS NOT NULL AND NEW.purged_at IS NOT NULL;
END;

-- **파기 차단**: 보류 중인 금고는 파기되지 않는다 — 예외 없다.
--
-- 상한(종결 + 5년)을 여기서 계산하지 않는 이유: 그러면 그 숫자가 SQL 과 게이트웨이
-- 상수 두 곳에 살고, 한쪽만 바뀌면 조용히 갈라진다. 게이트 문서가 "설정값"을 요구하므로
-- 숫자는 게이트웨이 한 곳(RETENTION_CAP_YEARS)에만 둔다.
--
-- 그래서 규칙을 이렇게 갈랐다:
--   * DB 불변식(여기)     — 보류 중이면 못 지운다. 단순하고 우회 불가.
--   * 게이트웨이 정책      — 상한이 지나면 그 건이 파기 검토 큐에 오르고, 관리자가
--                            **보류를 해제한 뒤** 파기한다(해제·파기 각각 감사 1건).
--
-- 결과적으로 감사 기록이 더 정직해진다 — "상한이 지나 관리자가 보류를 풀고 파기했다"가
-- 두 행으로 남는다. 게이트웨이의 자동 파기 후보 질의도 보류 건을 빼지만(정상 경로),
-- 이 트리거는 코드가 그 필터를 잃어버렸을 때의 최후 방어선이다 — PII 는 잘못 지우는
-- 쪽이 더 비싸므로 fail-closed 로 둔다.
CREATE TRIGGER participant_pii_vault_legal_hold_purge_guard
BEFORE UPDATE OF purged_at ON participant_pii_vault
WHEN OLD.legal_hold_at IS NOT NULL AND NEW.purged_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'participant_schema_violation'); END;

-- 파기 검토 큐 조회용(보류 중인 미파기 금고를 기관별로 훑는다).
CREATE INDEX idx_participant_pii_vault_legal_hold
  ON participant_pii_vault (org_id, legal_hold_at) WHERE purged_at IS NULL;
