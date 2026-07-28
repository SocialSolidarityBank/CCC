-- ============================================================================
-- Migration 0010 — 상담 유형·상담 방법 (session_kind · channel) (D4 · D21 · 티켓 #36)
--
-- 상담 일정에 두 가지 분기 축을 추가한다:
--   * session_kind — '기본 상담'(regular)인지 '인테이크'(intake)인지. 인테이크 일정은
--     이번 회차의 세션 목표 대신 케이스 목표(goals, D12)를 확정하는 흐름을 탄다.
--   * channel — 상담 방법. v1 은 대면만이므로 CHECK 로 'in_person' 에 고정한다(D4).
--     전화·화상 확장은 파일럿 이후.
--
-- 명명 주의: 이 channel 은 "상담 일정(약속)의 진행 방법"이고, sessions.channel
-- (0001·0006)은 "실제로 진행된 세션 기록의 채널"로 서로 다른 개념이다. 후자는 수기
-- 경로 때문에 phone/video 도 허용하지만(D4), 일정 축의 이 channel 은 v1 에서 대면만
-- 받는다. 두 컬럼은 각자 테이블에서 독립적으로 관리한다.
--
-- 이 마이그레이션은 추가(additive) 전용이다. 0001~0009 테이블·트리거를 바꾸지 않는다.
-- ALTER TABLE ADD COLUMN 은 기존 행을 DEFAULT 값으로 백필하므로(과거 일정은 모두
-- regular·in_person 으로 해석), 데이터 이관이 필요 없다.
-- ============================================================================

ALTER TABLE counseling_schedules
  ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'regular'
    CHECK (session_kind IN ('regular', 'intake'));

ALTER TABLE counseling_schedules
  ADD COLUMN channel TEXT NOT NULL DEFAULT 'in_person'
    CHECK (channel IN ('in_person'));
