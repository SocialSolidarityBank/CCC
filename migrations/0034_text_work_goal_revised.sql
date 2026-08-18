-- ============================================================================
-- 마이그레이션 0034: 텍스트 일감 큐에 'goal_revised' 사유 추가 (D69 · ADR-0036 · CCC-103)
--
-- 왜 필요한가. 목표 문구(전체 목표 · 세부 목표)에도 제3자 이름 같은 개인정보가 섞일 수
-- 있다(ADR-0036 결정 4). 따라서 목표도 처리 장비의 2차 마스킹을 거친 스냅샷이 된 뒤에만
-- 사업자로 나간다(R3 · D57). 목표가 확정·수정되면 그 케이스의 회차들을 다시 큐에 올려
-- 장비가 바뀐 문구까지 담은 스냅샷을 새로 만들게 한다. 0029 의 사유 두 종(수기 저장 ·
-- AI 정리 승인)만으로는 이 투입 지점을 표현할 수 없다.
--
-- SQLite 는 CHECK 제약을 바꾸는 ALTER TABLE 이 없다. 그래서 0033 과 같은 순서로 표를
-- 통째로 바꾼다: 새 표 생성 → 데이터 복사 → 옛 표 DROP(딸린 인덱스·트리거가 함께 사라진다)
-- → RENAME → 인덱스 2종·트리거 2종 재생성. 이름은 0029 원문 그대로다.
--
-- 기존 행 보존 검증: 아래 INSERT ... SELECT 는 컬럼 8개를 1:1 로 옮긴다. 사유·상태 값은
-- 손대지 않으므로 옛 'manual_record' · 'ai_draft_approved' 행은 pending · done 구분까지
-- 그대로 남는다(done 행의 completed_at 도 함께 옮겨져 상태·시각 CHECK 를 통과한다).
-- 이 표를 참조하는 외래 키는 없어(다른 표가 queue.id 를 가리키지 않는다) RENAME 이
-- 안전하다. 검증은 apps/api/test/text-work-materials.test.ts 의 0034 테스트가 맡는다.
-- ============================================================================

CREATE TABLE ai_text_work_queue_new (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  support_case_id TEXT NOT NULL REFERENCES support_cases (id),
  session_id      TEXT NOT NULL REFERENCES sessions (id),
  -- 무엇이 이 일감을 만들었는가. 수기 저장(D5 즉시 공식) | AI 정리 승인(R2) |
  -- 목표 확정·수정(D69 · ADR-0036 결정 4. 바뀐 목표 문구를 스냅샷에 다시 담기 위해).
  reason          TEXT NOT NULL CHECK (reason IN ('manual_record', 'ai_draft_approved', 'goal_revised')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  enqueued_at     TEXT NOT NULL,
  completed_at    TEXT,
  -- done 이면 완료 시각이 있고, pending 이면 없다. 상태와 시각이 어긋나지 못하게.
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);

INSERT INTO ai_text_work_queue_new (
  id, org_id, support_case_id, session_id, reason, status, enqueued_at, completed_at
)
SELECT
  id, org_id, support_case_id, session_id, reason, status, enqueued_at, completed_at
FROM ai_text_work_queue;

-- 옛 표를 지우면 그 표에 딸린 인덱스 2종·트리거 2종도 함께 사라진다. 삭제 트리거는
-- DROP TABLE 을 막지 않는다(행 단위 DELETE 에만 걸린다).
DROP TABLE ai_text_work_queue;
ALTER TABLE ai_text_work_queue_new RENAME TO ai_text_work_queue;

-- 폴링 순서 = 오래된 것부터. 상태를 앞에 둬 대기 행만 훑는다.
CREATE INDEX IF NOT EXISTS idx_ai_text_work_queue_pending
  ON ai_text_work_queue (org_id, status, enqueued_at);

-- 같은 회차의 대기 행은 1건이다. 재공식화는 기존 대기 행을 그대로 둔다. 사유 컬럼은 키에
-- 없다: 목표 수정이 이미 대기 중인 회차를 다시 올려도 행이 늘지 않고 먼저 쌓인 사유가 남는다.
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
