-- ============================================================================
-- Migration 0007 — 가명 ID 동물 슬러그 확장 (expand, D20 · ADR-0004 · 티켓 #11)
--
-- beneficiaries.id CHECK를 "레거시 A형식 OR 동물 슬러그 형식" 둘 다 허용하도록
-- 넓힌다. 기존 데이터·형식은 그대로 유지한다(수축은 후속 티켓 #15).
--
-- SQLite는 CHECK 변경을 지원하지 않으므로 테이블을 재구성한다. beneficiaries는
-- FK 부모(support_cases·participant_pii_vault·counseling_schedules·audit_log가
-- 참조)라서 재구성 순서가 중요하다:
--   1. PRAGMA defer_foreign_keys — FK 위반 판정을 트랜잭션 끝으로 미룬다.
--   2. 데이터를 제약 없는 복사 테이블에 보관한다.
--   3. 부모 테이블을 DROP한다(자식 행들이 일시적으로 고아가 되며 위반 카운터 증가).
--   4. 같은 이름으로 새 정의를 CREATE한다 — 자식 FK는 이름으로 재결합한다.
--      (RENAME 스왑을 쓰지 않는 이유: ALTER TABLE ... RENAME은 자식 FK 참조를
--       옛 이름으로 다시 써서 스왑이 깨진다.)
--   5. 행을 다시 INSERT한다 — 부모 키 삽입이 지연 위반 카운터를 되돌려
--      COMMIT 시점 검사를 통과시킨다.
-- 테이블과 함께 삭제된 인덱스·트리거는 0006과 동일 정의로 재생성한다.
-- ============================================================================

PRAGMA defer_foreign_keys = true;

CREATE TABLE beneficiary_animal_slug_expand_assertions (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TABLE beneficiaries_rebuild_copy AS
SELECT id, org_id, initialization_state, created_at, updated_at
FROM beneficiaries;

DROP TABLE beneficiaries;

-- A beneficiary is the permanent participant identity. 가명 ID는 두 형식을
-- 허용한다(확장 단계): 레거시 'A' + 3자리 이상 숫자, 또는 동물 슬러그(소문자
-- 영단어) + '-' + 3자리 이상 숫자. 어느 형식이든 다른 참여자·케이스에 재사용하지
-- 않는다. 동물 슬러그 큐레이션 목록(단일 출처)은 db/animal-slugs.ts.
CREATE TABLE beneficiaries (
  id                   TEXT PRIMARY KEY
                       CHECK (
                         (id GLOB 'A[0-9][0-9][0-9]*' AND substr(id, 2) NOT GLOB '*[^0-9]*')
                         OR (
                           id GLOB '[a-z]*-[0-9][0-9][0-9]*'
                           AND id NOT GLOB '*-*-*'
                           AND substr(id, 1, instr(id, '-') - 1) NOT GLOB '*[^a-z]*'
                           AND substr(id, instr(id, '-') + 1) NOT GLOB '*[^0-9]*'
                         )
                       ),
  org_id               TEXT NOT NULL,
  initialization_state TEXT NOT NULL DEFAULT 'pending'
                       CHECK (initialization_state IN ('pending', 'complete')),
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO beneficiaries (id, org_id, initialization_state, created_at, updated_at)
SELECT id, org_id, initialization_state, created_at, updated_at
FROM beneficiaries_rebuild_copy;

INSERT INTO beneficiary_animal_slug_expand_assertions (id, ok)
SELECT 'beneficiaries_copy_roundtrip', 0
WHERE EXISTS (
  SELECT id, org_id, initialization_state, created_at, updated_at FROM beneficiaries_rebuild_copy
  EXCEPT
  SELECT id, org_id, initialization_state, created_at, updated_at FROM beneficiaries
)
OR EXISTS (
  SELECT id, org_id, initialization_state, created_at, updated_at FROM beneficiaries
  EXCEPT
  SELECT id, org_id, initialization_state, created_at, updated_at FROM beneficiaries_rebuild_copy
);

DROP TABLE beneficiaries_rebuild_copy;

CREATE INDEX idx_beneficiaries_org_initialization
  ON beneficiaries (org_id, initialization_state, id);

-- 트리거 재생성 — 0006과 동일 정의. 복사 INSERT(위)는 'complete' 행을 포함하므로
-- 반드시 데이터 복원 이후에 만든다.
CREATE TRIGGER beneficiaries_insert_pending_guard
BEFORE INSERT ON beneficiaries
WHEN NEW.initialization_state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation');
END;

CREATE TRIGGER beneficiaries_complete_guard
BEFORE UPDATE OF initialization_state ON beneficiaries
WHEN OLD.initialization_state <> NEW.initialization_state
BEGIN
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE OLD.initialization_state <> 'pending' OR NEW.initialization_state <> 'complete';

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM support_cases
         WHERE beneficiary_id = NEW.id AND creation_kind = 'initial') <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*)
         FROM support_case_assignees AS assignment
         JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
         WHERE support_case.beneficiary_id = NEW.id
           AND support_case.creation_kind = 'initial'
           AND assignment.role = 'primary'
           AND assignment.unassigned_at IS NULL) <> 1;

  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log
         WHERE beneficiary_id = NEW.id
           AND (
             (action = 'create' AND target_table = 'beneficiaries' AND target_id = NEW.id
              AND support_case_id IS NULL)
             OR
             (action = 'create' AND target_table = 'support_cases'
              AND target_id = (SELECT id FROM support_cases
                               WHERE beneficiary_id = NEW.id AND creation_kind = 'initial')
              AND support_case_id = target_id)
             OR
             (action = 'assign' AND target_table = 'support_case_assignees'
              AND target_id = (SELECT assignment.id
                               FROM support_case_assignees AS assignment
                               JOIN support_cases AS support_case
                                 ON support_case.id = assignment.support_case_id
                               WHERE support_case.beneficiary_id = NEW.id
                                 AND support_case.creation_kind = 'initial'
                                 AND assignment.role = 'primary'
                                 AND assignment.unassigned_at IS NULL)
              AND support_case_id = (SELECT id FROM support_cases
                                     WHERE beneficiary_id = NEW.id AND creation_kind = 'initial'))
           )) <> 3;
  SELECT RAISE(ABORT, 'participant_schema_violation')
  WHERE (SELECT COUNT(*) FROM audit_log WHERE beneficiary_id = NEW.id) <> 3;
END;

-- 재구성 후 그래프 전체의 FK 무결성을 트랜잭션 안에서 확인한다.
INSERT INTO beneficiary_animal_slug_expand_assertions (id, ok)
SELECT 'final_fk', 0 WHERE EXISTS (SELECT 1 FROM pragma_foreign_key_check);

DROP TABLE beneficiary_animal_slug_expand_assertions;
