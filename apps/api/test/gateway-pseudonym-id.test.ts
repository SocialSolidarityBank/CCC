import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  ForbiddenError,
  ValidationError,
  createCase,
  getCase,
  listSupportCasesForBeneficiary,
} from '../../../db/gateway';
import {
  ANIMAL_SLUGS,
  ANIMAL_SLUG_BENEFICIARY_ID_PATTERN,
  ANIMAL_SLUG_KOREAN_NAMES,
  LEGACY_BENEFICIARY_ID_PATTERN,
  isBeneficiaryId,
} from '../../../db/animal-slugs';
import { setupD1, testActors } from './support/d1';

const { counselor, admin } = testActors;
const t = setupD1();

const adminHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'admin.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'admin',
};

function animalAt(index: number): string {
  const slug = ANIMAL_SLUGS[index % ANIMAL_SLUGS.length];
  if (slug === undefined) throw new Error('animal pool is empty');
  return slug;
}

/** 테스트 시드 전용 — 발급 경쟁 상태를 재현하기 위한 원시 참여자 행 삽입. */
async function seedBeneficiary(id: string, orgId: string): Promise<void> {
  await t.db.prepare(
    "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES (?, ?, 'pending')",
  ).bind(id, orgId).run();
}

describe('animal slug mapping (single source, D20 · ADR-0004)', () => {
  it('curates about 20 hope-symbol animals with one-word lowercase slugs and Korean names', () => {
    expect(ANIMAL_SLUGS.length).toBeGreaterThanOrEqual(15);
    for (const slug of ANIMAL_SLUGS) {
      expect(slug).toMatch(/^[a-z]+$/);                      // 한 단어 소문자 영문
      expect(ANIMAL_SLUG_KOREAN_NAMES[slug].length).toBeGreaterThan(0);
    }
    expect(new Set(ANIMAL_SLUGS).size).toBe(ANIMAL_SLUGS.length);
  });

  it('accepts both id formats and rejects everything else', () => {
    for (const valid of ['A017', 'A1000', `${animalAt(0)}-001`, `${animalAt(0)}-1000`]) {
      expect(isBeneficiaryId(valid)).toBe(true);
    }
    for (const invalid of [
      'a017', 'A01', 'B017',                       // 레거시 형식 위반
      `${animalAt(0)}-01`,                         // 순번 2자리
      `${animalAt(0).toUpperCase()}-001`,          // 대문자 슬러그
      `${animalAt(0)}_001`, `${animalAt(0)}-001-1`,
      'dragon-001',                                // 큐레이션 목록 밖 동물
      '', '-001', `${animalAt(0)}-`,
    ]) {
      expect(isBeneficiaryId(invalid)).toBe(false);
    }
  });
});

describe('animal slug pseudonym id issuance (gateway, 티켓 #11)', () => {
  it('issues {animal}-{NNN} ids round-robin through the pool, starting each animal at 001', async () => {
    await t.reset();
    const first = await createCase(t.env, counselor, { programType: 'financial_support_v1' });
    const second = await createCase(t.env, counselor, {});
    const third = await createCase(t.env, counselor, {});

    expect(first.id).toBe(`${animalAt(0)}-001`);
    expect(second.id).toBe(`${animalAt(1)}-001`);
    expect(third.id).toBe(`${animalAt(2)}-001`);
    for (const record of [first, second, third]) {
      expect(record.id).toMatch(ANIMAL_SLUG_BENEFICIARY_ID_PATTERN);
    }

    // 발급된 슬러그 ID는 조회 경로도 그대로 통과한다.
    const fetched = await getCase(t.env, counselor, first.id);
    expect(fetched.id).toBe(first.id);
  });

  it('continues the per-animal sequence with zero padding when the rotation returns', async () => {
    await t.reset();
    // 슬러그 발급 수를 정확히 풀 크기로 맞춰 라운드로빈이 첫 동물로 돌아오게 한다.
    await seedBeneficiary(`${animalAt(0)}-001`, counselor.orgId);
    await seedBeneficiary(`${animalAt(0)}-002`, counselor.orgId);
    await seedBeneficiary(`${animalAt(0)}-003`, counselor.orgId);
    for (let i = 1; i <= ANIMAL_SLUGS.length - 3; i += 1) {
      await seedBeneficiary(`${animalAt(i)}-001`, counselor.orgId);
    }

    const created = await createCase(t.env, counselor, {});
    expect(created.id).toBe(`${animalAt(0)}-004`);
  });

  it('scopes the sequence to the organization', async () => {
    await t.reset();
    await seedBeneficiary(`${animalAt(0)}-005`, 'org_other');

    const created = await createCase(t.env, counselor, {});
    // 다른 조직의 순번(005)과 무관하게 조직 내 첫 발급은 001이다.
    expect(created.id).toBe(`${animalAt(0)}-001`);
  });

  it('skips a number already taken by another organization (global primary key)', async () => {
    await t.reset();
    await seedBeneficiary(`${animalAt(0)}-001`, 'org_other');

    const created = await createCase(t.env, counselor, {});
    // 정확히 그 번호가 전역에서 선점된 경우에만 전역 최대값 다음으로 건너뛴다.
    expect(created.id).toBe(`${animalAt(0)}-002`);
  });

  it('issues distinct valid ids under concurrent creation (F7 retry)', async () => {
    await t.reset();
    const [first, second] = await Promise.all([
      createCase(t.env, counselor, {}),
      createCase(t.env, admin, { intakeAt: '2026-07-16T09:00:00.000Z' }),
    ]);
    expect(first.id).not.toBe(second.id);
    expect(isBeneficiaryId(first.id)).toBe(true);
    expect(isBeneficiaryId(second.id)).toBe(true);
  });
});

describe('dual-format acceptance (expand — 기존 A형식 요청 보존)', () => {
  it('passes both id formats through gateway validation and rejects unknown shapes', async () => {
    await t.reset();
    // 유효한 두 형식은 형식 검증을 통과하고, 부재는 접근 오류로 떨어진다.
    for (const validButAbsent of ['A017', `${animalAt(0)}-001`]) {
      await expect(listSupportCasesForBeneficiary(t.env, admin, validButAbsent))
        .rejects.toBeInstanceOf(ForbiddenError);
    }
    // 형식 위반은 검증 오류다.
    for (const invalid of ['a017', `${animalAt(0)}-01`, 'dragon-001', `${animalAt(0).toUpperCase()}-001`]) {
      await expect(listSupportCasesForBeneficiary(t.env, admin, invalid))
        .rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('accepts both id formats on participant routes and still rejects malformed ids', async () => {
    await t.reset();

    const invalid = await worker.fetch(
      new Request('http://localhost/participants/dragon-001/support-cases', { headers: adminHeaders }),
      t.env,
    );
    expect(invalid.status).toBe(400);

    for (const validButAbsent of ['A017', `${animalAt(0)}-777`]) {
      const response = await worker.fetch(
        new Request(`http://localhost/participants/${validButAbsent}/support-cases`, { headers: adminHeaders }),
        t.env,
      );
      expect(response.status).not.toBe(400); // 형식은 통과, 부재는 접근 오류 계열
    }

    // 실제 발급된 슬러그 ID는 라우트에서 200으로 조회된다.
    const created = await createCase(t.env, admin, {});
    expect(created.id).toMatch(ANIMAL_SLUG_BENEFICIARY_ID_PATTERN);
    const found = await worker.fetch(
      new Request(`http://localhost/participants/${created.id}/support-cases`, { headers: adminHeaders }),
      t.env,
    );
    expect(found.status).toBe(200);

    // 레거시 형식 정규식이 여전히 유효함을 계약으로 고정한다 (수축은 티켓 #15).
    expect(LEGACY_BENEFICIARY_ID_PATTERN.test('A017')).toBe(true);
  });
});
