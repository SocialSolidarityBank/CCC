import { describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { setupD1, testActors } from './support/d1';

const { counselor } = testActors;
const t = setupD1();

const CREATED_AT = '2026-07-01 00:00:00';

/**
 * 0007 직전(0006까지 적용) 상태를 만든다. schema-triggers.test.ts의
 * createPreCutoverD1 패턴을 따르되, 레거시 데이터 시드는 0005 백필이 정식
 * 경로로 옮기도록 0004까지 적용한 시점에 넣는다.
 */
async function createPreSlugExpandD1() {
  const miniflare = new Miniflare({
    compatibilityDate: '2026-07-06',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
  });
  const db = await miniflare.getD1Database('DB');
  const migrationsUrl = new URL(['..', '..', '..', 'migrations'].join('/'), import.meta.url);
  const migrations = await readD1Migrations(migrationsUrl.pathname);
  const slugExpandMigration = migrations[6];
  if (slugExpandMigration === undefined) {
    throw new Error('expected the animal slug expand migration at position 0007');
  }
  for (const migration of migrations.slice(0, 4)) {
    await db.batch(migration.queries.map((query) => db.prepare(query)));
  }
  // 레거시 파일럿 데이터 시드 (0005·0006이 beneficiaries/support_cases로 백필한다).
  await db.prepare(
    `INSERT INTO cases (id, org_id, intake_at, extra, created_at, updated_at)
     VALUES ('A017', 'org_demo', '2026-07-01T00:00:00.000Z', '{"legacy":"source"}', ?, ?)`,
  ).bind(CREATED_AT, CREATED_AT).run();
  await db.prepare(
    `INSERT INTO case_assignees (id, org_id, case_id, user_id, role, assigned_at)
     VALUES ('legacy-primary-assignment', 'org_demo', 'A017', 'legacy-counselor', 'primary', ?)`,
  ).bind(CREATED_AT).run();
  for (const migration of migrations.slice(4, 6)) {
    await db.batch(migration.queries.map((query) => db.prepare(query)));
  }
  return { miniflare, db, slugExpandMigration };
}

describe('0007 beneficiaries id CHECK expand (D20 · ADR-0004 · 티켓 #11)', () => {
  it('widens the id CHECK to both formats after all migrations', async () => {
    await t.reset();
    // 레거시 형식과 슬러그 형식 모두 통과한다 (확장 단계 — 병행 허용).
    for (const beneficiaryId of ['A017', 'A1000', 'swallow-001', 'swallow-1000']) {
      await t.db.prepare(
        "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES (?, ?, 'pending')",
      ).bind(beneficiaryId, counselor.orgId).run();
    }
    // 형식 위반은 여전히 CHECK가 막는다.
    for (const beneficiaryId of [
      'a017', 'A01', 'B017',
      'swallow-01', 'Swallow-001', 'swallow_001',
      'swallow-001x', 'swallow-001-1', '-001', 'swallow-',
    ]) {
      await expect(t.db.prepare(
        "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES (?, ?, 'pending')",
      ).bind(beneficiaryId, counselor.orgId).run()).rejects.toThrow('CHECK constraint failed');
    }
  });

  it('keeps the DB CHECK shape-based while the app enforces the curated pool', async () => {
    await t.reset();
    // DB는 모양(소문자단어-숫자3+)만 검사한다. 큐레이션 목록 검증(예: dragon 거부)은
    // 단일 출처 db/animal-slugs.ts의 앱 레벨 검증 몫이다 — gateway-pseudonym-id 테스트 참조.
    await expect(t.db.prepare(
      "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES ('dragon-001', ?, 'pending')",
    ).bind(counselor.orgId).run()).resolves.toBeTruthy();
  });

  it('rebuilds the parent table without losing the legacy graph or its constraints', async () => {
    const { miniflare, db, slugExpandMigration } = await createPreSlugExpandD1();
    try {
      // 0007 적용 (테이블 재구성).
      await db.batch(slugExpandMigration.queries.map((query) => db.prepare(query)));

      // 레거시 참여자와 FK 그래프가 그대로 보존된다.
      await expect(db.prepare(
        'SELECT id, org_id, initialization_state FROM beneficiaries WHERE id = ?',
      ).bind('A017').first()).resolves.toEqual({
        id: 'A017',
        org_id: 'org_demo',
        initialization_state: 'complete',
      });
      await expect(db.prepare(
        `SELECT COUNT(*) AS count
         FROM support_cases
         JOIN beneficiaries ON beneficiaries.id = support_cases.beneficiary_id
         WHERE support_cases.legacy_case_id = 'A017'`,
      ).first()).resolves.toEqual({ count: 1 });
      await expect(db.prepare(
        'SELECT COUNT(*) AS count FROM pragma_foreign_key_check',
      ).first()).resolves.toEqual({ count: 0 });

      // 넓어진 CHECK: 슬러그 삽입 허용, 쓰레기 거부.
      await db.prepare(
        "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES ('swallow-001', 'org_demo', 'pending')",
      ).run();
      await expect(db.prepare(
        "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES ('swallow-01', 'org_demo', 'pending')",
      ).run()).rejects.toThrow('CHECK constraint failed');

      // 자식 FK는 재구성된 테이블에 이름으로 다시 결합된다.
      const supportCaseFks = await db.prepare(
        "SELECT `table` AS parent FROM pragma_foreign_key_list('support_cases') WHERE `from` = 'beneficiary_id'",
      ).all<{ parent: string }>();
      expect(supportCaseFks.results.map((row) => row.parent)).toEqual(['beneficiaries']);
      // 고아 삽입은 거부된다 (insert 가드 트리거가 FK보다 먼저 걸려도 무방 — 둘 다 차단 계층).
      await expect(db.prepare(
        `INSERT INTO support_cases (
           id, org_id, beneficiary_id, legacy_case_id, creation_kind, created_at, updated_at
         ) VALUES ('orphan-support-case', 'org_demo', 'heron-999', 'A999', 'legacy_import', ?, ?)`,
      ).bind(CREATED_AT, CREATED_AT).run()).rejects.toThrow();

      // 테이블과 함께 삭제됐던 가드 트리거·인덱스가 재생성되어 있다.
      await expect(db.prepare(
        "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES ('crane-001', 'org_demo', 'complete')",
      ).run()).rejects.toThrow('participant_schema_violation');
      const objects = await db.prepare(
        `SELECT name FROM sqlite_master
         WHERE name IN ('idx_beneficiaries_org_initialization',
                        'beneficiaries_insert_pending_guard',
                        'beneficiaries_complete_guard')
         ORDER BY name`,
      ).all<{ name: string }>();
      expect(objects.results.map((row) => row.name)).toEqual([
        'beneficiaries_complete_guard',
        'beneficiaries_insert_pending_guard',
        'idx_beneficiaries_org_initialization',
      ]);

      // 재구성 보조 산출물이 남지 않는다 (0006의 no_private_suffixes 프로브와 같은 취지).
      await expect(db.prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE name IN ('beneficiaries_rebuild_copy', 'beneficiary_animal_slug_expand_assertions')`,
      ).first()).resolves.toEqual({ count: 0 });
    } finally {
      await miniflare.dispose();
    }
  }, 20_000);
});
