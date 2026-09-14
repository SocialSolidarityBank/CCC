import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendCaseEntityMapping, readCaseEntityMapping, createCase, listSupportCasesForBeneficiary,
  type CaseEntityEvidence,
} from '@ccc/core/gateway';
import { setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';
import { proveCaseEntityMappingSchema } from './support/migration-parity';

const t = setupD1();
const { counselor, service, admin } = testActors;
beforeEach(async () => { await t.reset(); });
async function fixture() {
  const beneficiary = await createCase(t.env, counselor,
    await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
  const id = (await listSupportCasesForBeneficiary(t.env, counselor, beneficiary.id)).programs[0]!.supportCase.id;
  return { id, beneficiaryId: beneficiary.id };
}
function evidence(id: string): CaseEntityEvidence {
  return { sourceKind: 'support_case', sourceId: id, sourceRevision: '1',
    sourceStart: 0, sourceEnd: 8, quote: '합성 식별 근거' };
}
const append = (id: string, expectedRevision: number, value: string, kind: 'person' | 'institution' = 'person', number?: number) =>
  appendCaseEntityMapping(t.env, service, id, {
    expectedRevision, kind, value, evidence: evidence(id), ...(number === undefined ? {} : { number }),
  });

// CAS 제거 시 두 요청이 같은 번호로 성공하거나 한쪽 내용을 덮어쓴다.
describe('case owned encrypted identity mapping', () => {
  it('commits one contending writer and never reuses a number after an alias write', async () => {
    const { id } = await fixture();
    const raced = await Promise.allSettled([append(id, 0, '가상인물갑'), append(id, 0, '가상인물을')]);
    expect(raced.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await readCaseEntityMapping(t.env, service, id)).toMatchObject({ revision: 1, personCounter: 1, institutionCounter: 0 });
    expect(await append(id, 1, '가상별칭', 'person', 1)).toMatchObject({ revision: 2, number: 1 });
    expect(await append(id, 2, '다른가상인물')).toMatchObject({ revision: 3, number: 2 });
    expect(await append(id, 3, '가상기관', 'institution')).toMatchObject({ revision: 4, number: 1 });
    const map = await readCaseEntityMapping(t.env, service, id);
    expect(map).toMatchObject({ personCounter: 2, institutionCounter: 1 });
    expect(map!.entities.find(e => e.kind === 'person' && e.number === 1)!.aliases)
      .toEqual([{ value: '가상별칭', evidence: evidence(id) }]);
    await expect(append(id, 4, '없는번호별칭', 'person', 3)).rejects.toThrow();
    expect((await readCaseEntityMapping(t.env, service, id))!.revision).toBe(4);
    const writes = await t.db.prepare("SELECT detail FROM audit_log WHERE target_id=? AND action='update' AND detail LIKE '%entityMapping%'")
      .bind(id).all();
    expect(writes.results).toHaveLength(4);
  });

  // 같은 키를 써도 암호문 안의 기관/사례 결속이 없으면 복사한 표가 열린다.
  it('rejects ciphertext transplanted to another canonical case and keeps evidence out of audit', async () => {
    const first = await fixture(), second = await fixture();
    await append(first.id, 0, '비공개가상값');
    const stored = await t.db.prepare('SELECT enc_entity_map,entity_map_revision,entity_map_key_version FROM support_cases WHERE id=?')
      .bind(first.id).first<{ enc_entity_map: string; entity_map_revision: number; entity_map_key_version: number }>();
    expect(stored!.enc_entity_map).not.toContain('비공개가상값');
    const audit = JSON.stringify((await t.db.prepare('SELECT detail FROM audit_log WHERE support_case_id=?').bind(first.id).all()).results);
    expect(audit).not.toContain('비공개가상값');
    expect(audit).not.toContain('합성 식별 근거');
    await t.db.prepare('UPDATE support_cases SET enc_entity_map=?,entity_map_revision=1,entity_map_key_version=? WHERE id=?')
      .bind(stored!.enc_entity_map, stored!.entity_map_key_version, second.id).run();
    await expect(readCaseEntityMapping(t.env, service, second.id)).rejects.toThrow();
    expect((await readCaseEntityMapping(t.env, service, first.id))!.entities[0]!.value).toBe('비공개가상값');
    await expect(readCaseEntityMapping(t.env, { ...service, orgId: 'org_other' }, first.id)).rejects.toThrow();
  });

  it('denies human actors and cross-case evidence without allocating a number', async () => {
    const first = await fixture(), second = await fixture();
    await expect(readCaseEntityMapping(t.env, admin, first.id)).rejects.toThrow();
    await expect(appendCaseEntityMapping(t.env, counselor, first.id, {
      expectedRevision: 0, kind: 'person', value: '가상인물', evidence: evidence(first.id),
    })).rejects.toThrow();
    await expect(appendCaseEntityMapping(t.env, service, first.id, {
      expectedRevision: 0, kind: 'person', value: '가상인물', evidence: evidence(second.id),
    })).rejects.toThrow();
    expect(await readCaseEntityMapping(t.env, service, first.id)).toBeNull();
  });

  it('rejects obsolete vault lifecycle and key versions rather than reopening or resetting the map', async () => {
    const { id, beneficiaryId } = await fixture();
    await append(id, 0, '가상인물');
    t.env.PII_KEY_VERSION = '2';
    await expect(readCaseEntityMapping(t.env, service, id)).rejects.toThrow();
    delete t.env.PII_KEY_VERSION;
    await t.db.prepare('UPDATE participant_pii_vault SET version=version+1 WHERE beneficiary_id=?').bind(beneficiaryId).run();
    await expect(readCaseEntityMapping(t.env, service, id)).rejects.toThrow();
    await expect(append(id, 1, '다른가상인물')).rejects.toThrow();
    expect(await t.db.prepare('SELECT entity_map_revision FROM support_cases WHERE id=?').bind(id).first())
      .toEqual({ entity_map_revision: 1 });
  });

  it('enforces the same storage transition proof queued for PostgreSQL parity', async () => {
    const { id } = await fixture();
    await proveCaseEntityMappingSchema(t.env.DB, id);
  });
});
