-- ============================================================================
-- 마이그레이션 0036: 텍스트 일감 임대 상태와 완료 스냅샷 연결 (CCC-120)
--
-- 왜 필요한가. 지금은 폴링이 대기 행을 읽기만 해서, 장비가 둘이면 같은 일감을
-- 동시에 집는다(둘 다 status = 'pending' 을 본다). 그리고 완료 행은 "어느 스냅샷이
-- 이 일감의 산출물인가"를 기록하지 않아, 집계·검증이 회차로 추측해야 했다.
--
-- 무엇을 더하는가.
--   1) status 에 'processing' 추가. 폴링이 pending → processing 전환과 함께
--      임대를 부여한다(lease_owner = 서비스 토큰 식별자, lease_expires_at = 만료 시각).
--      임대가 만료된 processing 행은 다시 폴링에 노출되고, 노출될 때마다
--      attempt_count 가 오른다(임대 부여 횟수 = 시도 횟수).
--   2) completed_snapshot_id. 완료 시 같은 회차의 마스킹 스냅샷
--      (ai_masked_source_snapshots)을 반드시 연결한다. 0036 이전에 완료된 행은
--      NULL 로 남는다(기존 행 호환 — NOT NULL 을 걸 수 없는 이유).
--
-- SQLite 는 CHECK 제약을 바꾸는 ALTER TABLE 이 없다. 그래서 0033·0034 와 같은
-- 순서로 표를 통째로 바꾼다: 새 표 생성 → 데이터 복사 → 옛 표 DROP(딸린 인덱스·
-- 트리거가 함께 사라진다) → RENAME → 인덱스 2종·트리거 2종 재생성.
--
-- 기존 행 보존 검증: 아래 INSERT ... SELECT 는 옛 컬럼 8개를 1:1 로 옮기고, 새
-- 컬럼은 기본값(NULL · 0)으로 채운다. 옛 pending 행은 임대 없음(CHECK 통과),
-- 옛 done 행은 completed_at 그대로에 스냅샷 NULL(CHECK 통과)이다. 이 표를
-- 참조하는 외래 키는 없어 RENAME 이 안전하다. 검증은
-- apps/api/test/text-work-lease.test.ts 가 맡는다.
-- ============================================================================

CREATE TABLE ai_text_work_queue_new (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  support_case_id       TEXT NOT NULL REFERENCES support_cases (id),
  session_id            TEXT NOT NULL REFERENCES sessions (id),
  -- 무엇이 이 일감을 만들었는가. 수기 저장(D5 즉시 공식) | AI 정리 승인(R2) |
  -- 목표 확정·수정(0034 · D69 · ADR-0036 결정 4).
  reason                TEXT NOT NULL CHECK (reason IN ('manual_record', 'ai_draft_approved', 'goal_revised')),
  -- pending(대기) → processing(장비가 임대 중) → done(완료). 만료된 processing 은
  -- 상태를 되돌리지 않고 다음 폴링이 임대를 덮어쓴다(임대 컬럼이 진실이다).
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done')),
  enqueued_at           TEXT NOT NULL,
  completed_at          TEXT,
  -- 임대 (CCC-120): 폴링이 pending → processing 전환하며 부여한다.
  lease_owner           TEXT,
  lease_expires_at      TEXT,
  -- 임대가 부여된 횟수. 만료 재분배가 일어날 때마다 1씩 오른다.
  attempt_count         INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  -- 이 일감이 만든(같은 회차의) 마스킹 스냅샷. 완료 시 서버가 회차로 역추적해 연결한다.
  completed_snapshot_id TEXT REFERENCES ai_masked_source_snapshots (id),
  -- done 이면 완료 시각이 있고, 아니면 없다. 상태와 시각이 어긋나지 못하게.
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  -- pending 은 임대가 없다. processing 은 임대 주인·만료가 반드시 있다.
  -- done 은 마지막 임대를 기록으로 남긴다(0036 이전 완료 행은 임대 없이 done).
  CHECK (status <> 'pending' OR (lease_owner IS NULL AND lease_expires_at IS NULL)),
  CHECK (status <> 'processing' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  -- 완료 스냅샷은 done 행에만 있다. NOT NULL 이 아닌 이유는 머리 주석 참고.
  CHECK (completed_snapshot_id IS NULL OR status = 'done')
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

-- 폴링 순서 = 오래된 것부터. 상태를 앞에 둬 대기·임대 행만 훑는다.
CREATE INDEX IF NOT EXISTS idx_ai_text_work_queue_pending
  ON ai_text_work_queue (org_id, status, enqueued_at);

-- 같은 회차의 열린 행(대기 + 임대 중)은 1건이다. 0029·0034 의 '대기 1건' 을 넓힌
-- 것: 임대 중에 재공식화가 와도 INSERT OR IGNORE 가 흡수해 행이 늘지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_text_work_queue_one_open_per_session
  ON ai_text_work_queue (org_id, session_id) WHERE status IN ('pending', 'processing');

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
