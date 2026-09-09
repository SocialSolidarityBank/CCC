import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';
import { Miniflare } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import type { Actor } from '@ccc/core/gateway';
import { createD1Database } from '@ccc/db-d1';
import { createR2AudioStore } from '@ccc/audio-r2';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import type { ApiEnv } from '@ccc/http-api/identity';
import type { AudioStore } from '@ccc/contracts/runtime';

export type TestApiEnv = ApiEnv & { audioStore: AudioStore };
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { PROGRAM_ADMISSION_COPY, PROGRAM_ADMISSION_COPY_VERSION } from '@ccc/contracts/program-admission';
const TEST_PII_KEY = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

/** 모든 API 계약 테스트가 읽는 SQLite migration SSOT(E3-1a). */
export const SQLITE_MIGRATIONS_PATH = fileURLToPath(new URL(
  '../../../../migrations/sqlite/',
  import.meta.url,
));

export interface D1TestContext {
  env: TestApiEnv;
  db: D1Database;
  bucket: R2Bucket;
  dispose(): Promise<void>;
}

/** 테스트 공용 Actor 픽스처. userId는 파일 간에 겹쳐도 각 테스트가 독립 DB를 쓰므로 안전하다. */
export const testActors = {
  counselor: { userId: 'counselor@example.invalid', orgId: 'org_demo', role: 'counselor' },
  unassignedCounselor: { userId: 'other@example.invalid', orgId: 'org_demo', role: 'counselor' },
  inactiveCounselor: { userId: 'inactive@example.invalid', orgId: 'org_demo', role: 'counselor' },
  admin: { userId: 'admin@example.invalid', orgId: 'org_demo', role: 'admin' },
  otherOrgCounselor: { userId: 'counselor.other@example.invalid', orgId: 'org_other', role: 'counselor' },
  otherOrgAdmin: { userId: 'admin.other@example.invalid', orgId: 'org_other', role: 'admin' },
  service: { userId: 'service@example.invalid', orgId: 'org_demo', role: 'service' },
} satisfies Record<string, Actor>;
/** 테스트에서 기관별 합성 사업을 참조할 때 쓰는 결정적 ID. */
export function testProgramId(orgId: string): string {
  return `test-program:${orgId}`;
}

type TestProgramRuntimeModes = {
  deploymentMode?: 'community-cloud' | 'local-single' | 'local-office';
  sttMode: 'off' | 'local' | 'azure';
  llmMode: 'off' | 'openai';
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function seedProgramWithRuntimeModes(
  db: D1Database,
  orgId: string,
  confirmedBy: string,
  modes: TestProgramRuntimeModes,
  displayName: string,
): Promise<void> {
  const deploymentMode = modes.deploymentMode ?? 'community-cloud';
  const storageMode = deploymentMode === 'community-cloud' ? 'supabase_seoul' : 'local_encrypted';
  const copyHash = await sha256Hex(canonicalizeJcs(PROGRAM_ADMISSION_COPY));
  const installationConfigHash = await sha256Hex(canonicalizeJcs({
    deploymentMode,
    sttMode: modes.sttMode,
    llmMode: modes.llmMode,
  }));
  await db.batch([
    db.prepare(
      `INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET version = 1, stt_mode = excluded.stt_mode, llm_mode = excluded.llm_mode`,
    ).bind(orgId, modes.sttMode, modes.llmMode),
    db.prepare(
      `INSERT INTO programs (
         id, org_id, display_name, program_type, storage_mode, processing_mode,
         version, admission_confirmed_by, admission_confirmed_at,
         admission_confirmed_storage_mode, admission_confirmed_processing_mode,
         admission_copy_version, admission_copy_hash,
         admission_installation_config_hash, admission_installation_policy_version
       ) VALUES (?, ?, ?, 'financial_support_v1', ?, 'external_allowed',
                 1, ?, '2026-01-01T00:00:00.000Z', ?, 'external_allowed',
                 ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET
         org_id = excluded.org_id, display_name = excluded.display_name,
         storage_mode = excluded.storage_mode, processing_mode = excluded.processing_mode,
         version = excluded.version, admission_confirmed_by = excluded.admission_confirmed_by,
         admission_confirmed_at = excluded.admission_confirmed_at,
         admission_confirmed_storage_mode = excluded.admission_confirmed_storage_mode,
         admission_confirmed_processing_mode = excluded.admission_confirmed_processing_mode,
         admission_copy_version = excluded.admission_copy_version,
         admission_copy_hash = excluded.admission_copy_hash,
         admission_installation_config_hash = excluded.admission_installation_config_hash,
         admission_installation_policy_version = excluded.admission_installation_policy_version`,
    ).bind(
      testProgramId(orgId),
      orgId,
      displayName,
      storageMode,
      confirmedBy,
      storageMode,
      PROGRAM_ADMISSION_COPY_VERSION,
      copyHash,
      installationConfigHash,
    ),
  ]);
}

/** 최신 스키마에서 처리 모드를 명시적으로 맞춘 테스트 전용 합성 사업 픽스처. */
export async function seedTestProgramWithRuntimeModes(
  db: D1Database,
  orgId: string,
  confirmedBy: string,
  modes: TestProgramRuntimeModes,
  displayName = '테스트 사업',
): Promise<void> {
  await seedProgramWithRuntimeModes(db, orgId, confirmedBy, modes, displayName);
}

/** 최신 스키마를 직접 준비하는 테스트 전용 합성 사업 픽스처. 기본 모드는 의도적으로 off/off 이다. */
export async function seedTestProgram(
  db: D1Database,
  orgId: string,
  confirmedBy: string,
  displayName = '테스트 사업',
): Promise<void> {
  await seedTestProgramWithRuntimeModes(db, orgId, confirmedBy, { sttMode: 'off', llmMode: 'off' }, displayName);
}

/** 0054 이전 마이그레이션 업그레이드 테스트에서만 쓰는 원시 참가자 그래프. */
export async function seedHistoricalParticipant(
  db: D1Database,
  actor: Actor,
  suffix: string,
  createdAt = '2026-07-14 09:00:00',
): Promise<{ beneficiaryId: string; supportCaseId: string }> {
  const beneficiaryId = `A${suffix}`;
  const supportCaseId = `historical-support-case:${actor.orgId}:${suffix}`;
  const assignmentId = `historical-assignment:${actor.orgId}:${suffix}`;
  await db.batch([
    db.prepare(
      `INSERT INTO beneficiaries (id, org_id, initialization_state, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?)`,
    ).bind(beneficiaryId, actor.orgId, createdAt, createdAt),
    db.prepare(
      `INSERT INTO participant_pii_vault (
         beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version, version,
         retention_change_kind, retention_changed_at, created_at, updated_at
       ) VALUES (?, ?, NULL, NULL, NULL, 1, 1, 'create', ?, ?, ?)`,
    ).bind(beneficiaryId, actor.orgId, createdAt, createdAt, createdAt),
    db.prepare(
      `INSERT INTO support_cases (
         id, org_id, beneficiary_id, legacy_case_id, program_type, status,
         intake_at, creation_kind, created_at, updated_at
       ) VALUES (?, ?, ?, NULL, 'financial_support_v1', 'active', ?, 'initial', ?, ?)`,
    ).bind(supportCaseId, actor.orgId, beneficiaryId, createdAt, createdAt, createdAt),
    db.prepare(
      `INSERT INTO support_case_assignees (
         id, org_id, support_case_id, user_id, role, assigned_at
       ) VALUES (?, ?, ?, ?, 'primary', ?)`,
    ).bind(assignmentId, actor.orgId, supportCaseId, actor.userId, createdAt),
    db.prepare(
      `INSERT INTO audit_log (
         org_id, actor_id, actor_role, action, target_table, target_id,
         beneficiary_id, support_case_id, case_id, detail, created_at
       ) VALUES (?, ?, ?, 'create', 'beneficiaries', ?, ?, NULL, NULL, ?, ?)`,
    ).bind(actor.orgId, actor.userId, actor.role, beneficiaryId, beneficiaryId, '{"schemaVersion":1}', createdAt),
    db.prepare(
      `INSERT INTO audit_log (
         org_id, actor_id, actor_role, action, target_table, target_id,
         beneficiary_id, support_case_id, case_id, detail, created_at
       ) VALUES (?, ?, ?, 'create', 'support_cases', ?, ?, ?, NULL, ?, ?)`,
    ).bind(actor.orgId, actor.userId, actor.role, supportCaseId, beneficiaryId, supportCaseId, '{"schemaVersion":1}', createdAt),
    db.prepare(
      `INSERT INTO audit_log (
         org_id, actor_id, actor_role, action, target_table, target_id,
         beneficiary_id, support_case_id, case_id, detail, created_at
       ) VALUES (?, ?, ?, 'assign', 'support_case_assignees', ?, ?, ?, NULL, ?, ?)`,
    ).bind(actor.orgId, actor.userId, actor.role, assignmentId, beneficiaryId, supportCaseId, '{"role":"primary","initial":true}', createdAt),
    db.prepare(
      `UPDATE beneficiaries SET initialization_state = 'complete', updated_at = ?
       WHERE id = ? AND org_id = ? AND initialization_state = 'pending'`,
    ).bind(createdAt, beneficiaryId, actor.orgId),
  ]);
  return { beneficiaryId, supportCaseId };
}

export async function grantTestPractitionerRole(
  db: D1Database,
  actor: Actor,
  grantedBy: Actor = testActors.admin,
): Promise<void> {
  await db.prepare(
    `INSERT INTO user_role_assignments (
       id, org_id, user_id, role, source, granted_by
     ) VALUES (?, ?, ?, 'practitioner', 'manual', ?)`,
  ).bind(
    `test-practitioner:${actor.orgId}:${actor.userId}`,
    actor.orgId,
    actor.userId,
    grantedBy.userId,
  ).run();
}

const testOrganizationSettings = [
  { orgId: 'org_demo', timeZone: 'Asia/Seoul' },
  { orgId: 'org_other', timeZone: 'UTC' },
] as const;

// Service actors are intentionally absent: the human directory is authoritative.
const testHumanDirectory = [
  { actor: testActors.counselor, active: true },
  { actor: testActors.unassignedCounselor, active: true },
  { actor: testActors.inactiveCounselor, active: false },
  { actor: testActors.admin, active: true },
  { actor: testActors.otherOrgCounselor, active: true },
  { actor: testActors.otherOrgAdmin, active: true },
  { actor: { userId: 'counselor.routes@example.invalid', orgId: 'org_demo', role: 'counselor' }, active: true },
  { actor: { userId: 'unassigned.routes@example.invalid', orgId: 'org_demo', role: 'counselor' }, active: true },
  { actor: { userId: 'admin.routes@example.invalid', orgId: 'org_demo', role: 'admin' }, active: true },
  { actor: { userId: 'counselor.other.routes@example.invalid', orgId: 'org_other', role: 'counselor' }, active: true },
] as const;

function createMiniflare(d1Persist: string): Miniflare {
  return new Miniflare({
    compatibilityDate: '2026-07-06',
    d1Databases: ['DB'],
    r2Buckets: ['AUDIO_BUCKET'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    d1Persist,
  });
}

/**
 * 마이그레이션을 적용한 **템플릿 DB 를 워커 프로세스당 한 번만** 만들고, 각 테스트는
 * 그 디스크 사본을 받는다 (2026-08-02).
 *
 * 왜: 종전에는 테스트마다 마이그레이션 28개를 다시 돌렸다. 실측하면 reset() 1회가
 * **마이그레이션 920ms + Miniflare 기동 83ms** 였고, 마이그레이션이 92% 였다
 * (ALTER TABLE 이 많아 SQLite 가 테이블을 다시 만든다). 템플릿 사본은 **1~2ms** 다.
 * CI 의 verify 잡 16분 중 pnpm test 가 13.6분이었고, 그중 api 가 768초였다.
 *
 * 격리는 그대로다 — 사본은 테스트마다 새 디렉터리이고 dispose 에서 지운다.
 * 픽스처(기관 설정·사용자 명부)도 템플릿에 구워 두므로 사본에 이미 들어 있다.
 * provisionDirectory 여부에 따라 템플릿이 갈리므로 캐시 키를 둘로 나눈다.
 */
const templates = new Map<string, Promise<string>>();

// 템플릿은 프로세스가 살아 있는 동안만 쓴다. CI 러너는 통째로 버려지지만 로컬에서는
// tmp 에 쌓이므로 종료 때 지운다. `exit` 훅은 **동기**라 프라미스를 기다릴 수 없어,
// 만들어진 경로를 그때그때 이 배열에 적어 두고 그것만 동기로 지운다.
const templatePaths: string[] = [];
process.once('exit', () => {
  for (const dir of templatePaths) rmSync(dir, { recursive: true, force: true });
});

async function templateDir(provisionDirectory: boolean): Promise<string> {
  const key = provisionDirectory ? 'with-directory' : 'bare';
  // 캐시에 **프라미스**를 넣는다 — 같은 프로세스에서 동시에 들어와도 한 번만 만든다.
  const cached = templates.get(key);
  if (cached !== undefined) return cached;

  const building = (async () => {
    const dir = mkdtempSync(join(tmpdir(), `ccc-d1-template-${key}-`));
    templatePaths.push(dir);
    const miniflare = createMiniflare(dir);
    try {
      const db = await miniflare.getD1Database('DB');
      const migrations = await readD1Migrations(SQLITE_MIGRATIONS_PATH);
      for (const migration of migrations) {
        await db.batch(migration.queries.map((query) => db.prepare(query)));
      }
      if (provisionDirectory) {
        const copyHash = await sha256Hex(canonicalizeJcs(PROGRAM_ADMISSION_COPY));
        const installationConfigHash = await sha256Hex(canonicalizeJcs({
          deploymentMode: 'community-cloud',
          sttMode: 'off',
          llmMode: 'off',
        }));
        await db.batch([
          ...testOrganizationSettings.map((setting) => db.prepare(
            `INSERT INTO organization_settings (
               org_id, time_zone, pii_purge_grace_days, version
             ) VALUES (?, ?, 180, 1)`,
          ).bind(setting.orgId, setting.timeZone)),
          ...testHumanDirectory.map(({ actor, active }) => db.prepare(
            `INSERT INTO users (id, org_id, email, role, active, time_zone)
             VALUES (?, ?, ?, ?, ?, NULL)`,
          ).bind(actor.userId, actor.orgId, actor.userId, actor.role, active ? 1 : 0)),
          ...testOrganizationSettings.map((setting) => db.prepare(
            `INSERT INTO program_admission_policies (org_id, version, stt_mode, llm_mode)
             VALUES (?, 1, 'off', 'off')`,
          ).bind(setting.orgId)),
          ...testOrganizationSettings.map((setting) => {
            const admin = setting.orgId === testActors.admin.orgId
              ? testActors.admin
              : testActors.otherOrgAdmin;
            return db.prepare(
              `INSERT INTO programs (
                 id, org_id, display_name, program_type, storage_mode, processing_mode,
                 version, admission_confirmed_by, admission_confirmed_at,
                 admission_confirmed_storage_mode, admission_confirmed_processing_mode,
                 admission_copy_version, admission_copy_hash,
                 admission_installation_config_hash, admission_installation_policy_version
               ) VALUES (?, ?, ?, 'financial_support_v1', 'supabase_seoul', 'external_allowed',
                         1, ?, '2026-01-01T00:00:00.000Z', 'supabase_seoul', 'external_allowed',
                         ?, ?, ?, 1)`,
            ).bind(
              testProgramId(setting.orgId),
              setting.orgId,
              '테스트 사업',
              admin.userId,
              PROGRAM_ADMISSION_COPY_VERSION,
              copyHash,
              installationConfigHash,
            );
          }),
        ]);
      }
    } finally {
      // 사본을 뜨기 전에 반드시 닫는다 — 열린 채로 복사하면 디스크에 안 내려간 쓰기가 빠진다.
      await miniflare.dispose();
    }
    return dir;
  })();

  templates.set(key, building);
  return building;
}

/**
 * miniflare 의 Node 쪽 바인딩 프록시는 스트림 인자를 길이 없는 청크 전송으로 보내고,
 * workerd R2 는 길이를 모르는 본문을 거부한다. FixedLengthStream 은 Workers 전역이라
 * Node 하네스에는 없다. 그래서 하네스에서만 검사가 끝난 스트림을 모아 넘긴다.
 * 운영(workerd)에서는 어댑터가 FixedLengthStream 으로 선언 길이를 유지한다.
 */
function bufferStreamPuts(bucket: R2Bucket): R2Bucket {
  return {
    put: async (
      key: string,
      value: Parameters<R2Bucket['put']>[1],
      options?: Parameters<R2Bucket['put']>[2],
    ) => bucket.put(
      key,
      value instanceof ReadableStream ? await new Response(value).arrayBuffer() : value,
      options,
    ),
    get: (key: string) => bucket.get(key),
    head: (key: string) => bucket.head(key),
    delete: (keys: string) => bucket.delete(keys),
    list: (options?: R2ListOptions) => bucket.list(options),
  } as unknown as R2Bucket;
}

export async function createD1TestContext(
  options: { provisionDirectory?: boolean } = {},
): Promise<D1TestContext> {
  const source = await templateDir(options.provisionDirectory !== false);
  const runDir = mkdtempSync(join(tmpdir(), 'ccc-d1-run-'));
  cpSync(source, runDir, { recursive: true });

  const miniflare = createMiniflare(runDir);
  const db = await miniflare.getD1Database('DB');
  const bucket = (await miniflare.getR2Bucket('AUDIO_BUCKET')) as unknown as R2Bucket;

  return {
    db,
    bucket,
    env: {
      DB: createD1Database(db),
      secretStore: createEnvironmentSecretStore({ PII_ENC_KEY: TEST_PII_KEY }),
      audioStore: createR2AudioStore(bufferStreamPuts(bucket)),
      installationMode: 'community-cloud',
    },
    dispose: async () => {
      await miniflare.dispose();
      rmSync(runDir, { recursive: true, force: true });
    },
  };
}

/** 현재 테스트에 살아 있는 D1 컨텍스트에 대한 접근자. */
export interface ManagedD1 {
  /** 새 컨텍스트를 만든다(이전 것이 있으면 정리). 각 it() 시작에서 호출한다. */
  reset(): Promise<void>;
  readonly env: TestApiEnv;
  readonly db: D1Database;
  readonly bucket: R2Bucket;
}

/**
 * D1 컨텍스트 수명(생성·afterEach 정리)을 한곳에서 관리한다.
 * 각 테스트 파일 상단에서 한 번 호출해 반복되는 let context / afterEach 보일러플레이트를 제거한다.
 */
export function setupD1(options: { provisionDirectory?: boolean } = {}): ManagedD1 {
  let context: D1TestContext | undefined;

  afterEach(async () => {
    await context?.dispose();
    context = undefined;
  });

  return {
    async reset() {
      await context?.dispose();
      context = await createD1TestContext(options);
    },
    get env() {
      if (context === undefined) {
        throw new Error('D1 context is not initialized; call reset() first');
      }
      return context.env;
    },
    get db() {
      if (context === undefined) {
        throw new Error('D1 context is not initialized; call reset() first');
      }
      return context.db;
    },
    get bucket() {
      if (context === undefined) {
        throw new Error('D1 context is not initialized; call reset() first');
      }
      return context.bucket;
    },
  };
}
