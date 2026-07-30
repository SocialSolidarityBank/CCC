-- ============================================================================
-- 마이그레이션 0029 — 텍스트 일감 큐 (D51 · ADR-0022 · ADR-0025 · 2026-07-31)
--
-- 왜 필요한가. 처리 장비의 일감 목록은 `audio_r2_key IS NOT NULL` 로 걸러서
-- (gateway.ts `listPipelineJobs`) **수기 메모만 있는 회차가 장비 눈에 보이지 않는다.**
-- 그 결과 그 회차에는 2차 마스킹(NER) 스냅샷이 영영 생기지 않고, 불일치 검출은
-- 1차 치환만 거친 메모 원문을 사업자로 보내고 있었다(R3 위반 — ADR-0025 가 기록).
-- 이 표가 그 구멍을 메운다: 기록이 공식화될 때마다 한 행이 쌓이고, 장비가 같은
-- 폴링에서 오디오 큐와 함께 가져가 마스킹한 뒤 스냅샷을 만든다.
--
-- 왜 기존 표를 안 쓰는가(ADR-0022 '함께 정한 것'):
--   * `sessions.ai_status` 재사용 불가 — 불일치 재검출은 **이미 승인된 회차도** 다시
--     일감으로 만든다. 그 회차를 '대기 중'으로 되돌리면 승인 이력과 부딪힌다.
--   * `ai_work_items` 재사용 불가 — `UNIQUE (session_id, kind)` 가 같은 회차의
--     재검출을 막는다. 그 제약은 지금 승인 경계의 안전장치라 풀지 않는다.
--
-- 재대기(pending)는 회차당 1건으로 묶는다(부분 유니크 인덱스). 같은 회차가 연달아
-- 공식화돼도 큐가 부풀지 않고, 장비는 가장 최신 텍스트 한 번만 마스킹하면 된다.
-- 처리 이력은 done 행으로 남는다 — 삭제하지 않는다(D14 감사 추적).
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_text_work_queue (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases (id),
  session_id      TEXT NOT NULL REFERENCES sessions (id),
  -- 무엇이 이 일감을 만들었는가. 수기 저장(D5 즉시 공식) | AI 정리 승인(R2).
  reason          TEXT NOT NULL CHECK (reason IN ('manual_record', 'ai_draft_approved')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  enqueued_at     TEXT NOT NULL,
  completed_at    TEXT,
  -- done 이면 완료 시각이 있고, pending 이면 없다. 상태와 시각이 어긋나지 못하게.
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

-- 폴링 순서 = 오래된 것부터. 상태를 앞에 둬 대기 행만 훑는다.
CREATE INDEX IF NOT EXISTS idx_ai_text_work_queue_pending
  ON ai_text_work_queue (org_id, status, enqueued_at);

-- 같은 회차의 대기 행은 1건 — 재공식화는 기존 대기 행을 그대로 둔다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_text_work_queue_one_pending_per_session
  ON ai_text_work_queue (org_id, session_id) WHERE status = 'pending';

-- 완료 행은 불변이다(D14). 되돌리기가 필요하면 새 대기 행을 넣는다.
CREATE TRIGGER IF NOT EXISTS ai_text_work_queue_done_is_final
BEFORE UPDATE ON ai_text_work_queue
WHEN OLD.status = 'done'
BEGIN
  SELECT RAISE(ABORT, 'completed text work items are immutable');
END;

CREATE TRIGGER IF NOT EXISTS ai_text_work_queue_no_delete
BEFORE DELETE ON ai_text_work_queue
BEGIN
  SELECT RAISE(ABORT, 'text work items are append-only');
END;
