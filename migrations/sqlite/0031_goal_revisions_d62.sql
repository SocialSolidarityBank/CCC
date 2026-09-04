-- ============================================================================
-- 마이그레이션 0031 — 목표 문구 이력 표 + 수정 금지 폐지 (D62 · ADR-0032 · CCC-71)
--
-- 왜 필요한가. D62 가 D12 의 "세부 목표 문구 수정 금지"를 폐지했다 — GAS 가 보류인
-- 동안 점수가 안 붙는 문구는 고쳐도 깨질 이력이 없다. 대신 전체 목표와 세부 목표는
-- 수정 시 이전 문구·수정자·시각을 보존한다(덧붙이기 전용). 지원금이 걸린 사업에서
-- 목표 변경은 책임 소재가 걸린 정보이고, 인테이크에서 합의한 원문이 사라지면 안 되며,
-- 내용 불일치 감지가 목표 변경 시점을 알아야 헛짚지 않는다.
--
-- 저장 방식 결정(ADR-0032 §4 가 이 티켓에 위임한 것). audit_log detail 확장(1후보)은
-- 기각한다 — 감사 조회(listAuditLog)는 admin 전용인데 이 이력은 담당 실무자도 봐야
-- 하고(케이스 이관), 감사 detail 에는 자유 텍스트(케이스 내용)를 싣지 않는 기존 원칙이
-- 있다(setSupportCaseOverallGoal 의 R3 태도). 따라서 전용 이력 표 1건을 만든다.
--
-- 무엇을 하나.
--   1. goals_title_immutable 트리거 제거 (D12 폐지)
--   2. goal_revisions 표 신설 — 한 행 = 한 번의 문구 확정(최초 작성 포함),
--      title = 그 시점 이후의 문구. goal_id NULL 이면 전체 목표
--      (support_cases.overall_goal, title NULL = 지움), NOT NULL 이면 세부 목표.
--   3. 덧붙이기 전용 강제 + 삽입 정합 가드 (0009 세션 목표 가드와 같은 방식)
--   4. goals_no_reopen 트리거 — 닫은 목표는 다시 열지 않는다(D62 §5, Q 확정).
--      세션 목표(schedule_session_goals)는 이력이 없다(회기 전 자유 수정) — 이 표와 무관.
-- ============================================================================

DROP TRIGGER goals_title_immutable;

CREATE TABLE goal_revisions (
  id              INTEGER PRIMARY KEY,                       -- 추가 전용 순서 보장 (audit_log 방식)
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases (id),
  goal_id         TEXT REFERENCES goals (id),                -- NULL = 전체 목표
  title           TEXT,                                      -- 확정된 문구. NULL = 지움(전체 목표만)
  edited_by       TEXT NOT NULL,                             -- 수정자 (users.id)
  edited_at       TEXT NOT NULL
);

CREATE INDEX idx_goal_revisions_case ON goal_revisions (support_case_id, id);
CREATE INDEX idx_goal_revisions_goal ON goal_revisions (goal_id, id) WHERE goal_id IS NOT NULL;

-- 삽입 정합 가드: 케이스는 같은 기관에 존재해야 하고, goal_id 를 채웠다면 같은
-- 케이스의 목표여야 하며(세부 목표는 문구가 필수), 수정자는 활성 실무자·관리자여야
-- 한다. FK 는 D1 에서 강제되지 않으므로 가드가 진실 원천(0009 와 동일).
CREATE TRIGGER goal_revisions_insert_guard
BEFORE INSERT ON goal_revisions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = NEW.support_case_id AND org_id = NEW.org_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.goal_id IS NOT NULL
    AND (
      NEW.title IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM goals
        WHERE id = NEW.goal_id
          AND org_id = NEW.org_id
          AND support_case_id = NEW.support_case_id
      )
    );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.edited_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;

-- 덧붙이기 전용: 쌓인 줄은 고치거나 지우지 않는다 (D62 §4).
CREATE TRIGGER goal_revisions_no_update
BEFORE UPDATE ON goal_revisions
BEGIN SELECT RAISE(ABORT, 'D62: goal_revisions is append-only'); END;
CREATE TRIGGER goal_revisions_no_delete
BEFORE DELETE ON goal_revisions
BEGIN SELECT RAISE(ABORT, 'D62: goal_revisions is append-only'); END;

-- 닫은 목표는 다시 열지 않는다. 같은 목표가 다시 필요해지면 같은 문구로 새로 만든다.
CREATE TRIGGER goals_no_reopen
BEFORE UPDATE OF status ON goals
WHEN OLD.status = 'closed' AND NEW.status = 'active'
BEGIN SELECT RAISE(ABORT, 'D62: a closed goal cannot be reopened'); END;
