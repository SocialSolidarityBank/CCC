-- ============================================================================
-- Migration 0009 — 상담 일정의 세션 목표·맞춤형 질문 (D28 · D29 · 티켓 #35)
--
-- 상담 일정을 등록할 때 상담사가 적는 "이번 회차에서 다룰 것"(세션 목표, D28)과
-- "이번 상담에서 직접 묻고 싶은 것"(맞춤형 질문)을 일정별로 저장하는 전용 테이블을
-- 신설한다. 세션 목표는 인테이크에서 확정한 케이스 목표(goals, D12)의 하위 목표로
-- 선택 연결할 수 있고(복수·미연결 허용), GAS는 여전히 케이스 목표에만 매긴다 —
-- 이 표는 목표 문구와 연결만 담는다(점수 없음, R5·D6 유지).
--
-- 이 마이그레이션은 추가(additive) 전용이다. 0001~0008 테이블·트리거를 바꾸지 않는다.
-- 실패 문자열은 참여자 그래프의 다른 가드와 동일한 고정값('participant_schema_violation')을
-- 써서 케이스 내용이 SQL 오류 메시지로 새지 않게 한다.
-- ============================================================================

-- 세션 목표 — 한 상담 일정(schedule_id)에 순번(ordinal)으로 쌓인다. case_goal_id 가
-- NULL 이면 미연결(D28). support_case_id 는 일정의 참여사업과 반드시 일치해야 하며
-- (가드가 강제), case_goal_id 링크도 같은 참여사업의 active 목표만 허용한다.
CREATE TABLE schedule_session_goals (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  schedule_id       TEXT NOT NULL REFERENCES counseling_schedules (id),
  support_case_id   TEXT NOT NULL REFERENCES support_cases (id),
  case_goal_id      TEXT REFERENCES goals (id),            -- NULL = 미연결 (D28)
  body              TEXT NOT NULL,                         -- 이번 회차에서 다룰 것
  ordinal           INTEGER NOT NULL,
  created_by        TEXT NOT NULL,                         -- 작성 상담사 (Access 사용자)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (schedule_id, ordinal)
);

CREATE INDEX idx_schedule_session_goals_schedule
  ON schedule_session_goals (schedule_id, ordinal);

-- 맞춤형 질문 — 세션 목표와 같은 일정 스코프. AI 생성 질문("오늘 확인할 질문")과
-- 별개로 상담사가 직접 적는다.
CREATE TABLE schedule_custom_questions (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  schedule_id       TEXT NOT NULL REFERENCES counseling_schedules (id),
  support_case_id   TEXT NOT NULL REFERENCES support_cases (id),
  body              TEXT NOT NULL,                         -- 상담사가 직접 적는 질문
  ordinal           INTEGER NOT NULL,
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (schedule_id, ordinal)
);

CREATE INDEX idx_schedule_custom_questions_schedule
  ON schedule_custom_questions (schedule_id, ordinal);

-- 세션 목표 삽입 가드: 일정이 같은 조직·참여사업에서 존재하고, 작성자는 활성 담당
-- 사용자여야 하며, case_goal_id 를 연결했다면 같은 참여사업의 active 케이스 목표여야
-- 한다(타 케이스·closed 연결 차단). FK 는 D1 에서 강제되지 않으므로 가드가 진실 원천.
CREATE TRIGGER schedule_session_goals_insert_guard
BEFORE INSERT ON schedule_session_goals
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM counseling_schedules
    WHERE id = NEW.schedule_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NEW.case_goal_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM goals
      WHERE id = NEW.case_goal_id
        AND org_id = NEW.org_id
        AND support_case_id = NEW.support_case_id
        AND status = 'active'
    );
END;

-- 맞춤형 질문 삽입 가드: 일정·조직·참여사업 정합 + 활성 담당 작성자.
CREATE TRIGGER schedule_custom_questions_insert_guard
BEFORE INSERT ON schedule_custom_questions
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM counseling_schedules
    WHERE id = NEW.schedule_id
      AND org_id = NEW.org_id
      AND support_case_id = NEW.support_case_id
  );

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.created_by AND org_id = NEW.org_id
      AND active = 1 AND role IN ('admin', 'counselor')
  );
END;
