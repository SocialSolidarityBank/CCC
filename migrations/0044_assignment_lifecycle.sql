-- 0044 배정 상태 머신 (D74 · CCC-123 P1-5)
--
-- 정책(docs/policy/internal-operations-policy.md §2.3)과 용어집(CONTEXT.md 배정 요청·이관
-- 수락·강제 이관·당사자 안내 확인)을 코드로 옮긴다. **배정 요청만으로는 아무 것도 열리지
-- 않는다.** 수락(본인) 또는 강제 이관(기관 관리자 + 사유 + 당사자 안내 확인)이 있어야
-- 활성(active)이 되고, 활성 담당만 상담 내용·PII 접근을 낸다.
--
-- 기존 행은 status='active' 로 소급한다(기존 담당 권한 불변, 요청 0건). 접근 게이트의
-- WHERE 는 status='active' 로 좁힘 — requested 행은 어떤 게이트에서도 열리지 않는다.
--
--   requested: 배정 요청(관리자). 접근 0.
--   active   : 수락·강제 이관 후. 접근 허용.
--   ended    : 종료(이관 수락 시 이전 담당 종료 · 해지 · 퇴사). 재활성화돼도 복원 없음.
--
-- 당사자 안내 확인(체크한 사람·시각)은 시스템 밖 전화·대면 결과를 기록만 하는 필드다 —
-- 확인하지 않아도 이관을 막지 않는다(정책 §2.3). 강제 이관 사유도 별도 기둥으로 남긴다.

-- CHECK constraint는 ALTER TABLE로 바꿀 수 없어 status 컬럼을 통째로 추가한다.
ALTER TABLE support_case_assignees ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('requested', 'active', 'ended'));

-- 배정 요청한 사람(기관 관리자). 수락·강제 이관이 아니라 요청 순간의 기록자다.
ALTER TABLE support_case_assignees ADD COLUMN acceptance_requested_by TEXT;

-- 수락 시각(본인 수락 또는 강제 이관 실행 시각). 유효한 활성 담당이 된 순간이다.
ALTER TABLE support_case_assignees ADD COLUMN accepted_at TEXT;

-- 강제 이관 사유(필수). 종료 사유도 여기 적는다(해지·퇴사). 정상 종료는 NULL.
ALTER TABLE support_case_assignees ADD COLUMN transfer_reason TEXT;

-- 당사자 안내 확인(체크한 사람 · 시각). 시스템 밖 안내·의사 확인 결과 기록 전용.
ALTER TABLE support_case_assignees ADD COLUMN notified_by TEXT;
ALTER TABLE support_case_assignees ADD COLUMN notified_at TEXT;

-- 활성 배정의 유일성 정의를 유지한다: unassigned_at NULL 인 행 중 활성 단계만 겹침 방지.
DROP INDEX IF EXISTS uq_support_case_assignees_active;
CREATE UNIQUE INDEX uq_support_case_assignees_active
  ON support_case_assignees (support_case_id, user_id)
  WHERE unassigned_at IS NULL AND status IN ('requested', 'active');

-- 요청 건이 늘어나는 조회(기관 전체 활성 담당)를 위한 인덱스.
CREATE INDEX idx_support_case_assignees_status
  ON support_case_assignees (org_id, status, unassigned_at);

-- 퇴사·휴직 체크리스트(CCC-123): 발급자 비활성화 시 미사용 초대 토큰을 폐기한다.
-- status CHECK(issued/used)는 DDL 고정이라 값 바꿈 없이 revoked_at로 폐기 마킹하고,
-- 가입 게이트가 revoked_at IS NULL 을 요구한다.
ALTER TABLE invite_tokens ADD COLUMN revoked_at TEXT;

-- 주담당 하나 제약을 인덱스에서 트랜잭션으로 옮긴다. 정책 §2.3은 '수락 시점에 이전 담당
-- 권한 종료'라 요청 단계에서는 활성 주담당과 공존해야 하는데, 기존 unique(role=primary,
-- unassigned_at IS NULL)가 이를 막는다. '활성 주담당 ≤ 1'은 accept·force 이관 게이트웨이가
-- 원자 배치 안에서 유지한다(테스트로 고정). 활성 API 응답은 어차피 status='active' 로 좁히므로
-- 위 인덱스 해제로 노출이 넓어지지 않는다.
DROP INDEX IF EXISTS uq_support_case_assignees_primary;