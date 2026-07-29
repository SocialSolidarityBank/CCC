import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase, updateParticipantPii } from '../../../db/gateway';
import { ANIMAL_SLUGS, ANIMAL_SLUG_KOREAN_NAMES } from '../../../db/animal-slugs';
import { setupD1, testActors } from './support/d1';

// 당사자 검색(티켓 #16 · D21) HTTP 계약: 부분 일치, PII 무포함, 접근 범위.
// 발급은 기관 내 라운드로빈이라 생성 순서로 슬러그가 결정된다(가명 ID 발급 테스트가 프라이어 아트).
const firstSlug = ANIMAL_SLUGS[0]!;   // 예: swallow (제비)
const secondSlug = ANIMAL_SLUGS[1]!;  // 예: crane (두루미)
const thirdSlug = ANIMAL_SLUGS[2]!;   // 예: dolphin (돌고래)
const firstId = `${firstSlug}-001`;
const secondId = `${secondSlug}-001`;
const thirdId = `${thirdSlug}-001`;
const firstKoreanName = ANIMAL_SLUG_KOREAN_NAMES[firstSlug];
const secondKoreanName = ANIMAL_SLUG_KOREAN_NAMES[secondSlug];
// 검색은 가명 ID 오름차순으로 반환한다(SQLite BINARY = 바이트 순 = JS 기본 정렬).
const ownedIdsSorted = [firstId, secondId].slice().sort();
const allIdsSorted = [firstId, secondId, thirdId].slice().sort();

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

interface SearchResult {
  beneficiaryId: string;
  status: 'active' | 'closed';
  programCount: number;
  name: string | null;
}

async function search(
  actor: { userId: string; orgId: string; role: string },
  query: string,
): Promise<{ status: number; text: string; results: SearchResult[] }> {
  const response = await worker.fetch(new Request(
    `http://localhost/participants/search?q=${encodeURIComponent(query)}`,
    { headers: headersFor(actor) },
  ), t.env);
  const text = await response.text();
  let results: SearchResult[] = [];
  if (response.status === 200) {
    results = (JSON.parse(text) as { results: SearchResult[] }).results;
  }
  return { status: response.status, text, results };
}

interface SeededParticipants {
  ownedFirst: { beneficiaryId: string; supportCaseId: string };
  ownedSecond: { beneficiaryId: string; supportCaseId: string };
  hiddenThird: { beneficiaryId: string; supportCaseId: string };
}

// counselor 가 담당하는 두 케이스와, 다른 담당 실무자가 담당하는 한 케이스를 같은 기관에 심는다.
async function seedParticipants(): Promise<SeededParticipants> {
  await t.reset();
  const ownedFirst = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  const ownedSecond = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  const hiddenThird = await createBeneficiaryWithInitialSupportCase(t.env, testActors.unassignedCounselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  return { ownedFirst, ownedSecond, hiddenThird };
}

describe('GET /participants/search', () => {
  it('matches on pseudonym-id substring, shared number, and Korean display name', async () => {
    const seeded = await seedParticipants();
    expect(seeded.ownedFirst.beneficiaryId).toBe(firstId);
    expect(seeded.ownedSecond.beneficiaryId).toBe(secondId);

    // 가명 ID(양형식) 부분 일치: 슬러그 조각.
    const bySlug = await search(testActors.counselor, firstSlug);
    expect(bySlug.status).toBe(200);
    expect(bySlug.results.map((r) => r.beneficiaryId)).toEqual([firstId]);

    // 공통 순번 부분 일치: 담당 두 건 모두(가명 ID 오름차순), 숨은 건은 제외.
    const byNumber = await search(testActors.counselor, '001');
    expect(byNumber.results.map((r) => r.beneficiaryId)).toEqual(ownedIdsSorted);

    // 한글 표시명 부분 일치: 동물 슬러그로 환원되어 걸린다.
    const byKorean = await search(testActors.counselor, firstKoreanName);
    expect(byKorean.results.map((r) => r.beneficiaryId)).toEqual([firstId]);

    const bySecondKorean = await search(testActors.counselor, secondKoreanName);
    expect(bySecondKorean.results.map((r) => r.beneficiaryId)).toEqual([secondId]);

    // 요약 필드: 진행 상태·참여 사업 수 + 실명(D24). PII 미기입이라 실명은 null.
    expect(byKorean.results[0]).toEqual({ beneficiaryId: firstId, status: 'active', programCount: 1, name: null });
  });

  it('exposes the realname to an authorized actor but never the phone or account (D24·ADR-0005)', async () => {
    const seeded = await seedParticipants();
    const secretName = '홍길동';
    await updateParticipantPii(t.env, testActors.admin, seeded.ownedFirst.beneficiaryId, {
      supportCaseContextId: seeded.ownedFirst.supportCaseId,
      expectedVersion: 1,
      name: secretName,
      phone: '010-0000-1234',
      account: '123-456-789',
    });

    const found = await search(testActors.admin, firstSlug);
    expect(found.status).toBe(200);
    expect(found.results).toHaveLength(1);
    // D24: 선택 UI 실명 목록을 위해 실명은 실린다. 응답 키는 4종(실명 포함).
    expect(Object.keys(found.results[0]!).sort()).toEqual(['beneficiaryId', 'name', 'programCount', 'status']);
    expect(found.results[0]!.name).toBe(secretName);
    // 연락처·계좌는 검색 응답 어디에도 실리지 않는다(실명만 노출).
    expect(found.text).not.toContain('010-0000-1234');
    expect(found.text).not.toContain('123-456-789');
  });

  it('scopes results to assigned cases for counselors and org-wide for admins', async () => {
    const seeded = await seedParticipants();

    const counselorView = await search(testActors.counselor, '001');
    expect(counselorView.results.map((r) => r.beneficiaryId)).toEqual(ownedIdsSorted);
    // 다른 담당 실무자의 케이스(가명 ID 조각조차)는 노출되지 않는다.
    expect(counselorView.text).not.toContain(thirdId);
    expect(counselorView.results.map((r) => r.beneficiaryId)).not.toContain(seeded.hiddenThird.beneficiaryId);

    const adminView = await search(testActors.admin, '001');
    expect(adminView.results.map((r) => r.beneficiaryId)).toEqual(allIdsSorted);
  });

  it('does not cross organization boundaries', async () => {
    await seedParticipants();
    const otherOrg = await search(testActors.otherOrgAdmin, '001');
    expect(otherOrg.status).toBe(200);
    expect(otherOrg.results).toEqual([]);
  });

  it('rejects an empty or whitespace-only query', async () => {
    await seedParticipants();
    for (const query of ['', '   ']) {
      const response = await worker.fetch(new Request(
        `http://localhost/participants/search?q=${encodeURIComponent(query)}`,
        { headers: headersFor(testActors.counselor) },
      ), t.env);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    }
  });

  it('rejects an unsupported query parameter', async () => {
    await seedParticipants();
    const response = await worker.fetch(new Request(
      'http://localhost/participants/search?q=001&limit=5',
      { headers: headersFor(testActors.counselor) },
    ), t.env);
    expect(response.status).toBe(400);
  });
});
