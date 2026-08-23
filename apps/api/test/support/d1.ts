import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { Miniflare } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import type { Actor } from '../../../../db/gateway';
import type { ApiEnv } from '../../src/identity';

const TEST_PII_KEY = 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';

export interface D1TestContext {
  env: ApiEnv;
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
      const migrationsUrl = new URL(['..', '..', '..', '..', 'migrations'].join('/'), import.meta.url);
      const migrations = await readD1Migrations(migrationsUrl.pathname);
      for (const migration of migrations) {
        await db.batch(migration.queries.map((query) => db.prepare(query)));
      }
      if (provisionDirectory) {
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
      DB: db,
      PII_ENC_KEY: TEST_PII_KEY,
      AUDIO_BUCKET: bucket,
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
  readonly env: ApiEnv;
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
