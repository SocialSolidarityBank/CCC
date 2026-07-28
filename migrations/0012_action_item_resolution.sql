-- ============================================================================
-- Migration 0012 — 미해결 액션 4상태 처리 어휘 (CCC-5 · 티켓 #54 · 설계 v0.2)
--
-- 정기 상담 기록지가 미해결 액션 아이템을 회차에서 [완료/진행 중/못 함/보류]
-- 4상태 + 처리 한 줄 메모로 원클릭 처리하도록, action_items 에 처리 어휘 컬럼을
-- 덧붙인다. 기존 해결 여부(resolved_at·resolved_by)는 그대로 두고 함께 유지한다
-- (expand 방식) — '완료(done)' 처리 시에만 resolved_at·resolved_by 를 채워 기존
-- 미해결 목록 뷰(idx_actions_open · resolved_at IS NULL)와 record 응답의
-- resolved 불리언 의미를 보존한다. '진행 중/못 함/보류'는 resolved_at 을 NULL 로
-- 남겨 미해결 목록에 계속 노출하되, 처리 이력(어떤 회차에서 어떤 상태로 처리했는지)
-- 을 다음 4컬럼에 남긴다:
--   * resolution_status     — 처리 상태 4값(done/in_progress/not_done/hold)
--   * resolution_note       — 처리 한 줄(선택)
--   * resolution_at         — 처리 일시(상태와 무관하게 처리 시각)
--   * resolution_session_id — 처리한 회차(session)의 id
--
-- SQLite 의 ALTER TABLE ADD COLUMN 은 기존 데이터·CHECK·트리거를 건드리지 않고
-- 컬럼을 테이블 끝에 덧붙인다(0009 enc_email · 0010 session_kind 와 같은 추가 전용
-- 패턴). NULL 허용이므로 기존 행은 그대로 두고, 재처리 시 최신 처리 상태로 덮어쓴다.
-- db/schema.sql 은 이 컬럼을 누적 결과 마지막 절로 함께 반영한다.
--
-- 이 마이그레이션은 추가(additive) 전용이다. 0001~0011 테이블·트리거를 바꾸지 않는다.
-- ============================================================================

ALTER TABLE action_items ADD COLUMN resolution_status TEXT
  CHECK (resolution_status IN ('done', 'in_progress', 'not_done', 'hold'));

ALTER TABLE action_items ADD COLUMN resolution_note TEXT;

ALTER TABLE action_items ADD COLUMN resolution_at TEXT;

ALTER TABLE action_items ADD COLUMN resolution_session_id TEXT REFERENCES sessions (id);
