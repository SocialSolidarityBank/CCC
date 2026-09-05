/**
 * 로컬·원격 미리보기 시드가 필요한 최소 디렉터리 데이터.
 *
 * 운영 상태를 미러하지 않는다. 생성된 preload.sql 은 빈 disposable DB 에만 적용하며,
 * seed.sql 은 이 fixture 의 사용자 수, 기관과 pending 스텁 조건을 검사한 뒤 시작한다.
 */

export const ORG_ID = 'bss';

/**
 * 프리로드 행의 created_at/updated_at 은 고정 상수로 쓴다(now() 금지).
 * 이유: 캡처 DB 와 검증 DB 가 각각 다른 시각에 프리로드되므로, 시계값을 쓰면 프리로드
 * 행부터 두 DB 가 달라진다. 고정값이면 프리로드가 바이트 동일해져 시드 행 diff 가 깨끗하다.
 */
export const PRELOAD_AT = '2026-01-01 00:00:00';

export interface PreviewUser {
  id: string;
  email: string;
  role: 'admin' | 'counselor' | 'service';
}

/** 로컬·원격 미리보기 전용 활성 사용자. */
export const PREVIEW_USERS: readonly PreviewUser[] = [
  { id: '8fd733ce-e1f2-4483-9cc7-37390b86b2f2', email: 'account@bss.or.kr', role: 'admin' },
  { id: '08debf30-ba77-4b7c-8854-1d2d738781e1', email: 'ai00@ggbss.or.kr', role: 'counselor' },
  { id: '5a34b456-7bf9-499e-9165-c6ffb4a1da24', email: 'counselor-01@example.test', role: 'counselor' },
  { id: 'c9d86cc6-c750-4e1f-93ec-1a04d4fae728', email: 'counselor-02@example.test', role: 'counselor' },
  { id: '522c6100-4dc5-4fdd-bd59-4e7774f68d11', email: 'counselor-03@example.test', role: 'counselor' },
  { id: '48aab0c0-4490-4569-9b4e-fad487226d6b', email: 'counselor-04@example.test', role: 'counselor' },
  { id: '0424278c-b712-43dc-b30e-d2fc11b55dc6', email: 'counselor-05@example.test', role: 'counselor' },
  // 서비스 행은 미리보기 권한 흐름을 재현하는 가상 신원이다.
  { id: 'b025ca3c-8fbd-47d6-bd2b-9d70f8d25213', email: 'service-token-client-id.access', role: 'service' },
] as const;

/** 미리보기 등록(create) actor. admin 경로는 initialAssigneeUserId 필수. */
export const ADMIN_ACTOR_ID = '8fd733ce-e1f2-4483-9cc7-37390b86b2f2';

/** 미리보기 주담당 사용자 ID. */
export const COUNSELOR_IDS = {
  ai00: '08debf30-ba77-4b7c-8854-1d2d738781e1',
  counselor01: '5a34b456-7bf9-499e-9165-c6ffb4a1da24',
  counselor02: 'c9d86cc6-c750-4e1f-93ec-1a04d4fae728',
  counselor03: '522c6100-4dc5-4fdd-bd59-4e7774f68d11',
  counselor04: '48aab0c0-4490-4569-9b4e-fad487226d6b',
  counselor05: '0424278c-b712-43dc-b30e-d2fc11b55dc6',
} as const;

/** 슬러그 할당 기준점을 만드는 미리보기 전용 pending 스텁. */
export const PREVIEW_BENEFICIARY_STUBS = ['A001', 'swallow-001'] as const;

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

  for (const user of PREVIEW_USERS) {
    statements.push({
      sql: `INSERT INTO users (id, org_id, email, role, active, time_zone, created_at)
             VALUES (?, ?, ?, ?, 1, NULL, ?)`,
      params: [user.id, ORG_ID, user.email, user.role, PRELOAD_AT],
    });
  }

  for (const stubId of PREVIEW_BENEFICIARY_STUBS) {
    statements.push({
      sql: `INSERT INTO beneficiaries (id, org_id, initialization_state, created_at, updated_at)
             VALUES (?, ?, 'pending', ?, ?)`,
      params: [stubId, ORG_ID, PRELOAD_AT, PRELOAD_AT],
    });
  }

  return statements;
}
