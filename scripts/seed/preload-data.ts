/**
 * 운영 미러 상수 — 로컬 캡처/검증 DB 부트스트랩용(순수 데이터, D1 접근 없음).
 *
 * 여기 값은 운영(prod) D1 의 현재 상태를 그대로 반영해야 한다. 게이트웨이 가드가
 * 읽는 최소 집합만 담는다:
 *   - organization_settings 1행('bss')             → assertOrganizationSettings
 *   - users 8행(활성)                                → assertActiveHumanUser / 세션 제출 트리거
 *   - beneficiaries 스텁 2행(A001·swallow-001)       → beneficiaries_insert_pending_guard 충족 +
 *                                                      allocateBeneficiaryId 라운드로빈 기준점
 * 운영 audit 162행·기존 케이스 그래프는 어떤 가드도 읽지 않으므로 프리로드하지 않는다(검증됨).
 *
 * 드리프트 가드(오케스트레이터 절차): RUNBOOK 1단계에서 운영 users/beneficiaries/audit COUNT 를
 * 다시 조회해 이 상수와 일치하는지 확인한다. 다르면 이 파일을 갱신한 뒤 재생성한다 —
 * 원격 쿼리는 오케스트레이터가 수행하며, 이 툴 자체는 원격 D1 에 절대 접근하지 않는다.
 */

export const ORG_ID = 'bss';

/** 운영 audit_log 기준선(행 수). manifest 기대치 산정에 쓴다. */
export const OPERATIONAL_AUDIT_BASELINE = 162;

/**
 * 프리로드 행의 created_at/updated_at 은 고정 상수로 쓴다(now() 금지).
 * 이유: 캡처 DB 와 검증 DB 가 각각 다른 시각에 프리로드되므로, 시계값을 쓰면 프리로드
 * 행부터 두 DB 가 달라진다. 고정값이면 프리로드가 바이트 동일해져 시드 행 diff 가 깨끗하다.
 */
export const PRELOAD_AT = '2026-01-01 00:00:00';

export interface OperationalUser {
  id: string;
  email: string;
  role: 'admin' | 'counselor' | 'service';
}

/** 운영 활성 users 8명. active=1, org_id='bss', time_zone NULL 로 프리로드한다. 실직원 이메일은 공개 레포 가명화(counselor-NN@example.test) — 운영 실값은 시드 실행 시 로컬에서만 주입(RUNBOOK 2단계). */
export const OPERATIONAL_USERS: readonly OperationalUser[] = [
  { id: '8fd733ce-e1f2-4483-9cc7-37390b86b2f2', email: 'account@bss.or.kr', role: 'admin' },
  { id: '08debf30-ba77-4b7c-8854-1d2d738781e1', email: 'ai00@ggbss.or.kr', role: 'counselor' },
  { id: '5a34b456-7bf9-499e-9165-c6ffb4a1da24', email: 'counselor-01@example.test', role: 'counselor' },
  { id: 'c9d86cc6-c750-4e1f-93ec-1a04d4fae728', email: 'counselor-02@example.test', role: 'counselor' },
  { id: '522c6100-4dc5-4fdd-bd59-4e7774f68d11', email: 'counselor-03@example.test', role: 'counselor' },
  { id: '48aab0c0-4490-4569-9b4e-fad487226d6b', email: 'counselor-04@example.test', role: 'counselor' },
  { id: '0424278c-b712-43dc-b30e-d2fc11b55dc6', email: 'counselor-05@example.test', role: 'counselor' },
  // service 행의 email 은 Access 서비스 토큰의 Client ID(자격증명의 공개 절반)다. 위 5명과
  // 같은 이유로 가명화한다 — 이것만으로 인증되지는 않지만 Access 팀 도메인과 합치면 어느
  // non-identity 정책을 노려야 하는지를 알려준다. 프리로드는 로컬 미러 DB 를 채울 뿐이고
  // 드리프트 가드는 COUNT 만 비교하므로(이메일 값을 보지 않는다) 실값이 필요 없다.
  { id: 'b025ca3c-8fbd-47d6-bd2b-9d70f8d25213', email: 'service-token-client-id.access', role: 'service' },
] as const;

/** 등록(create) actor: 운영 관리자 계정. admin 경로는 initialAssigneeUserId 필수. */
export const ADMIN_ACTOR_ID = '8fd733ce-e1f2-4483-9cc7-37390b86b2f2';

/** 주담당으로 지정할 운영 상담사 ID. content.ts 가 참조한다. 키는 가명(counselor01~05) — 실직원 이메일 로컬파트가 키로 쓰이면 매핑이 복원되므로 금지. */
export const COUNSELOR_IDS = {
  ai00: '08debf30-ba77-4b7c-8854-1d2d738781e1',
  counselor01: '5a34b456-7bf9-499e-9165-c6ffb4a1da24',
  counselor02: 'c9d86cc6-c750-4e1f-93ec-1a04d4fae728',
  counselor03: '522c6100-4dc5-4fdd-bd59-4e7774f68d11',
  counselor04: '48aab0c0-4490-4569-9b4e-fad487226d6b',
  counselor05: '0424278c-b712-43dc-b30e-d2fc11b55dc6',
} as const;

/** 기존 운영 beneficiaries 스텁(로컬은 'pending' 으로 — insert-pending 가드 충족용). */
export const OPERATIONAL_BENEFICIARY_STUBS = ['A001', 'swallow-001'] as const;

export interface RawStatement {
  sql: string;
  params: (string | number | null)[];
}

/**
 * 캡처 없이 실행하는 raw 프리로드 문장(harness 가 실 D1 에 직접 건다).
 * 실행 순서: organization_settings → users → beneficiaries 스텁.
 */
export function preloadStatements(): RawStatement[] {
  const statements: RawStatement[] = [];

  statements.push({
    sql: `INSERT INTO organization_settings (
             org_id, time_zone, pii_purge_grace_days, version, created_at, updated_at
           ) VALUES (?, 'Asia/Seoul', 365, 1, ?, ?)`,
    params: [ORG_ID, PRELOAD_AT, PRELOAD_AT],
  });

  for (const user of OPERATIONAL_USERS) {
    statements.push({
      sql: `INSERT INTO users (id, org_id, email, role, active, time_zone, created_at)
             VALUES (?, ?, ?, ?, 1, NULL, ?)`,
      params: [user.id, ORG_ID, user.email, user.role, PRELOAD_AT],
    });
  }

  for (const stubId of OPERATIONAL_BENEFICIARY_STUBS) {
    statements.push({
      sql: `INSERT INTO beneficiaries (id, org_id, initialization_state, created_at, updated_at)
             VALUES (?, ?, 'pending', ?, ?)`,
      params: [stubId, ORG_ID, PRELOAD_AT, PRELOAD_AT],
    });
  }

  return statements;
}
