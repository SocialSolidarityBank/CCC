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

export async function createD1TestContext(
  options: { provisionDirectory?: boolean } = {},
): Promise<D1TestContext> {
  const miniflare = new Miniflare({
    compatibilityDate: '2026-07-06',
    d1Databases: ['DB'],
    r2Buckets: ['AUDIO_BUCKET'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
  });
  const db = await miniflare.getD1Database('DB');
  const bucket = (await miniflare.getR2Bucket('AUDIO_BUCKET')) as unknown as R2Bucket;
  const migrationsUrl = new URL(['..', '..', '..', '..', 'migrations'].join('/'), import.meta.url);
  const migrations = await readD1Migrations(migrationsUrl.pathname);

  for (const migration of migrations) {
    await db.batch(migration.queries.map((query) => db.prepare(query)));
  }
  if (options.provisionDirectory !== false) {
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

  return {
    db,
    bucket,
    env: {
      DB: db,
      PII_ENC_KEY: TEST_PII_KEY,
      AUDIO_BUCKET: bucket,
    },
    dispose: () => miniflare.dispose(),
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
