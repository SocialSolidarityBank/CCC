-- ============================================================================
-- 마이그레이션 0027 — 내용 불일치 저장 구조 (D45 · ADR-0018 · CCC-43 · 2026-07-29)
--
-- 번호가 0025가 아닌 이유: 0025는 병렬 티켓 CCC-38, 0026은 CCC-39가 예약했다.
--
-- 브리핑 영역 ③ '내용 불일치'의 정본 저장소. 검출은 기록이 **공식화되는 시점**
-- (수기 메모 저장 · AI 정리 승인)에 실행해 여기 저장하고, 브리핑은 저장된 결과만
-- 읽는다 — 화면이 AI 응답을 기다리지 않는다(ADR-0018이 실시간 검사를 명시 기각).
--
-- 행 하나 = 불일치 한 쌍. AI 는 어느 쪽이 맞는지 판단하지 않으므로(R5) 저장하는 것도
-- **양쪽 원문 인용 + 각각의 회차 참조**뿐이다. 인용은 가명 처리된 공식 기록 텍스트에서
-- 그대로 발췌한 것만 게이트웨이·프로바이더 검증을 통과한다(R3 — PII 미유입).
--
--   * kind: cross_session(회차 간 불일치) | within_session(회차 내 모순).
--     within 이면 양쪽 회차가 같다 — CHECK 로 강제한다.
--   * trigger_session_id: 이 검출을 일으킨 공식화 회차. 같은 회차가 다시 공식화
--     (예: AI 정리 승인)되면 **미처리 행만** 지우고 새 결과로 교체한다.
--   * resolution_* 3컬럼: 처리 3종(situation_changed/record_error/confirmed)은
--     후속 티켓 CCC-42의 자리다 — ADR-0018 '영향' 절의 권고대로 스키마만 미리 둔다.
--     NULL = 미처리. CCC-43 범위에서는 항상 NULL 이고 브리핑은 미처리만 보여준다.
--
-- 원본 불변(ADR-0018 "처리는 표시일 뿐"):
--   * UPDATE 는 처리 3컬럼만 허용 — 인용·회차·유형을 고치는 UPDATE 는 트리거가 막는다.
--   * 처리된 행은 DELETE 불가(접힌 이력으로 보존) — 미처리 행만 재검출 교체로 지워진다.
--
-- 이 마이그레이션은 추가(additive) 전용이다. 앞선 마이그레이션의 테이블·트리거를 바꾸지
-- 않는다. 접근 권한(담당 실무자·기관 관리자, D7)·감사(D14)·검출 파이프라인 게이트는
-- 게이트웨이가 강제한다(R1).
-- ============================================================================

CREATE TABLE session_discrepancies (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  support_case_id    TEXT NOT NULL REFERENCES support_cases (id),
  kind               TEXT NOT NULL CHECK (kind IN ('cross_session', 'within_session')),
  trigger_session_id TEXT NOT NULL REFERENCES sessions (id),
  left_session_id    TEXT NOT NULL REFERENCES sessions (id),
  left_quote         TEXT NOT NULL CHECK (length(trim(left_quote)) BETWEEN 1 AND 500),
  right_session_id   TEXT NOT NULL REFERENCES sessions (id),
  right_quote        TEXT NOT NULL CHECK (length(trim(right_quote)) BETWEEN 1 AND 500),
  detected_at        TEXT NOT NULL,
  -- 처리 3종 (CCC-42 자리, ADR-0018). NULL = 미처리.
  resolution_status  TEXT CHECK (resolution_status IN ('situation_changed', 'record_error', 'confirmed')),
  resolved_by        TEXT,
  resolved_at        TEXT,
  created_at         TEXT NOT NULL,
  -- 회차 내 모순은 같은 회차의 양쪽 인용이다.
  CHECK (kind <> 'within_session' OR left_session_id = right_session_id),
  -- 회차 간 불일치는 서로 다른 회차여야 한다.
  CHECK (kind <> 'cross_session' OR left_session_id <> right_session_id),
  -- 처리 3컬럼은 함께 채워진다 — 반쪽 처리 상태를 만들지 않는다.
  CHECK (
    (resolution_status IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (resolution_status IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX idx_session_discrepancies_case
  ON session_discrepancies (org_id, support_case_id, resolution_status);
CREATE INDEX idx_session_discrepancies_trigger
  ON session_discrepancies (org_id, trigger_session_id);

-- 인용·회차·유형은 불변 — 처리 3컬럼 외의 UPDATE 를 막는다.
CREATE TRIGGER session_discrepancies_content_immutable
BEFORE UPDATE ON session_discrepancies
WHEN OLD.id <> NEW.id
  OR OLD.org_id <> NEW.org_id
  OR OLD.support_case_id <> NEW.support_case_id
  OR OLD.kind <> NEW.kind
  OR OLD.trigger_session_id <> NEW.trigger_session_id
  OR OLD.left_session_id <> NEW.left_session_id
  OR OLD.left_quote <> NEW.left_quote
  OR OLD.right_session_id <> NEW.right_session_id
  OR OLD.right_quote <> NEW.right_quote
  OR OLD.detected_at <> NEW.detected_at
  OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'session_discrepancies: detected content is immutable');
END;

-- 처리된 행은 이력이다 — 삭제를 막는다(미처리 행만 재검출 교체로 지워진다).
CREATE TRIGGER session_discrepancies_resolved_no_delete
BEFORE DELETE ON session_discrepancies
WHEN OLD.resolution_status IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'session_discrepancies: resolved rows are retained history');
END;
