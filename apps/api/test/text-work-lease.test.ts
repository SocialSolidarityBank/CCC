// CCC-120 — 텍스트 일감 임대 상태와 완료 스냅샷 연결 (마이그레이션 0036)
// 폴링(listTextWorkItems)이 pending → processing 전환과 함께 임대를 부여해 같은
// 일감이 두 장비에 나가지 않는지, 만료된 임대가 다른 장비로 재분배되며 시도 횟수가
// 오르는지, 완료(completeTextWorkItem)가 같은 회차의 스냅샷과 반드시 연결되는지 고정한다.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  completeTextWorkItem,
  createCase,
  createCounselingRecord,
  enqueueTextWorkItem,
  ForbiddenError,
  getTextWorkItemSource,
  listSupportCasesForBeneficiary,
  listTextWorkItems,
  recordMaskedSourceSnapshot,
  recordPilotTextAiConsentEvidence,
  updateParticipantConsent,
  ValidationError,
  type Actor,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 픽스처가 케이스·회차·동의를 매번 새로 만든다. text-work-materials.test.ts 와 같은 이유로 여유를 준다.
vi.setConfig({ testTimeout: 30_000 });

const { counselor, service } = testActors;
// 두 번째 처리 장비. 서비스 토큰 식별자(userId)가 다르면 다른 장비다(D13).
const secondDevice: Actor = { userId: 'service.second@example.invalid', orgId: 'org_demo', role: 'service' };

const t = setupD1();

beforeEach(async () => {
  await t.reset();
});

async function fixtureCase(): Promise<{ caseId: string; supportCaseId: string }> {
  const caseRecord = await createCase(t.env, counselor, {});
  const { programs } = await listSupportCasesForBeneficiary(t.env, counselor, caseRecord.id);
  const supportCaseId = programs[0]?.supportCase.id;
  if (supportCaseId === undefined) throw new Error('expected initial support case');
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  // CCC-110: 사용 허용은 근거 행이 아니라 support_cases.consent_text_ai_at 이 결정한다.
  // 실제 동의 경로로 현재 동의 컬럼을 세운다.
  await updateParticipantConsent(t.env, counselor, supportCaseId, {
    privacy: true,
    recordingAi: true,
  });
  await recordPilotTextAiConsentEvidence(t.env, counselor, caseRecord.id, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: 'a'.repeat(64),
    evidenceRef: `r2://pilot-evidence/${caseRecord.id}`,
    evidenceSha256: 'f'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });
  return { caseId: caseRecord.id, supportCaseId };
}

/** 공식 텍스트가 있는 회차를 만들고 대기 일감을 올린다. 회차 id 를 돌려준다. */
async function fixturePendingItem(supportCaseId: string): Promise<string> {
  const result = await createCounselingRecord(t.env, counselor, supportCaseId, {
    submissionId: crypto.randomUUID(),
    heldAt: '2026-07-08T10:00:00.000Z',
    channel: 'in_person',
    memo: 'Lease fixture memo.',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  const sessionId = result.record.id;
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  return sessionId;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 장비가 하듯 회차의 2차 마스킹 스냅샷을 올린다. */
async function uploadSnapshot(sessionId: string): Promise<{ id: string }> {
  const maskedText = `MASKED_LEASE_TEXT_${sessionId}`;
  const sha256 = await sha256Hex(maskedText);
  return recordMaskedSourceSnapshot(t.env, service, sessionId, {
    maskedText,
    sha256,
    maskingPipelineVersion: 'ner-mask-v1',
    evidence: [{
      id: `lease-evidence-${sessionId}`,
      sourceRef: 'memo:lease-source',
      sourceSha256: sha256,
      evidenceQuote: maskedText,
      sourceStart: 0,
      sourceEnd: maskedText.length,
    }],
  });
}

async function queueRow(sessionId: string): Promise<Record<string, unknown>> {
  const row = await t.db.prepare(
    `SELECT id, status, lease_owner, lease_expires_at, attempt_count, completed_snapshot_id, completed_at
     FROM ai_text_work_queue WHERE session_id = ?`,
  ).bind(sessionId).first<Record<string, unknown>>();
  if (row === null) throw new Error('expected a queue row');
  return row;
}

describe('텍스트 일감 임대 (CCC-120 · 마이그레이션 0036)', () => {
  it('폴링이 임대를 부여해 같은 일감이 두 장비에 나가지 않는다', async () => {
    const { supportCaseId } = await fixtureCase();
    const sessionId = await fixturePendingItem(supportCaseId);

    // 첫 장비가 폴링 — 일감을 임대와 함께 받는다.
    const firstPoll = await listTextWorkItems(t.env, service);
    expect(firstPoll).toHaveLength(1);
    const leasedItem = firstPoll[0];
    if (leasedItem === undefined) throw new Error('expected a leased item');
    expect(leasedItem.sessionId).toBe(sessionId);
    expect(leasedItem.attemptCount).toBe(1);
    expect(leasedItem.leaseExpiresAt > new Date().toISOString()).toBe(true);

    // 행이 processing 으로 전환되고 임대 주인이 기록됐다.
    const row = await queueRow(sessionId);
    expect(row.status).toBe('processing');
    expect(row.lease_owner).toBe(service.userId);
    expect(row.attempt_count).toBe(1);

    // 두 번째 장비가 곧바로 폴링해도 임대 중인 일감은 보이지 않는다.
    await expect(listTextWorkItems(t.env, secondDevice)).resolves.toEqual([]);
    // 임대 주인이 다시 폴링해도 만료 전에는 같은 행이 다시 나가지 않는다(중복 처리 방지).
    await expect(listTextWorkItems(t.env, service)).resolves.toEqual([]);

    // 원문은 임대 주인만 받는다.
    await expect(getTextWorkItemSource(t.env, service, leasedItem.id))
      .resolves.toMatchObject({ sessionId });
    await expect(getTextWorkItemSource(t.env, secondDevice, leasedItem.id))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('만료된 임대는 다른 장비로 재분배되고 시도 횟수가 오른다', async () => {
    const { supportCaseId } = await fixtureCase();
    const sessionId = await fixturePendingItem(supportCaseId);
    const [leased] = await listTextWorkItems(t.env, service);
    if (leased === undefined) throw new Error('expected a leased item');

    // 임대 만료를 과거로 돌린다 (시계를 흉내내는 테스트 전용 직접 UPDATE).
    await t.db.prepare(
      "UPDATE ai_text_work_queue SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
    ).bind(leased.id).run();

    // 두 번째 장비의 폴링이 같은 일감을 새 임대로 받는다.
    const secondPoll = await listTextWorkItems(t.env, secondDevice);
    expect(secondPoll).toHaveLength(1);
    expect(secondPoll[0]?.id).toBe(leased.id);
    expect(secondPoll[0]?.attemptCount).toBe(2);

    const row = await queueRow(sessionId);
    expect(row.status).toBe('processing');
    expect(row.lease_owner).toBe(secondDevice.userId);
    expect(row.attempt_count).toBe(2);

    // 옛 임대 주인은 원문 조회도 완료도 할 수 없다.
    await expect(getTextWorkItemSource(t.env, service, leased.id))
      .rejects.toBeInstanceOf(ForbiddenError);
    await uploadSnapshot(sessionId);
    await expect(completeTextWorkItem(t.env, service, leased.id))
      .rejects.toBeInstanceOf(ForbiddenError);
    // 새 임대 주인의 완료는 통과한다.
    await expect(completeTextWorkItem(t.env, secondDevice, leased.id)).resolves.toBeUndefined();
  });

  it('완료는 같은 회차의 스냅샷과 반드시 연결된다', async () => {
    const { supportCaseId } = await fixtureCase();
    const sessionId = await fixturePendingItem(supportCaseId);
    const [leased] = await listTextWorkItems(t.env, service);
    if (leased === undefined) throw new Error('expected a leased item');

    // 스냅샷 없이 완료하면 거부된다 — 스냅샷 없는 완료는 거짓 기록이다.
    await expect(completeTextWorkItem(t.env, service, leased.id))
      .rejects.toBeInstanceOf(ValidationError);

    // 스냅샷을 올린 뒤의 완료는 그 스냅샷 ID 를 역추적해 연결한다(구 클라이언트 호환).
    const snapshot = await uploadSnapshot(sessionId);
    await completeTextWorkItem(t.env, service, leased.id);

    const row = await queueRow(sessionId);
    expect(row.status).toBe('done');
    expect(row.completed_snapshot_id).toBe(snapshot.id);
    expect(row.completed_at).not.toBeNull();

    // 완료 행은 불변이다(0029 트리거 유지) — 다시 완료할 수 없다.
    await expect(completeTextWorkItem(t.env, service, leased.id))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});
