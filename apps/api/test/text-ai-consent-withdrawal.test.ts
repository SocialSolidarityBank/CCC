// CCC-110 (P0-7) — AI 동의 철회가 실제 AI 사용을 막는다.
//
// 텍스트 AI 사용 허용 검사 3곳(서비스·재생성 grant, 호출 전 grant, 텍스트 일감 목록)이
// 과거 동의 근거 행(pilot_text_ai_consent_evidence)만 보지 않고 **현재** 동의 컬럼
// (support_cases.consent_text_ai_at)을 함께 보는지 종단으로 고정한다:
// 동의 저장 → 일감 적재 확인 → 철회 → 일감 목록에서 사라짐 + 스냅샷 저장 거부 +
// AI 초안 생성 경로 거부. 근거 행은 append-only 이력이라 철회 후에도 남아야 한다
// (이력 보존과 사용 허용의 분리).
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createGeneratedAiDraft,
  enqueueTextWorkItem,
  listTextWorkItems,
  recordMaskedSourceSnapshot,
  updateParticipantConsent,
  PilotTextAiConsentRequiredError,
} from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

// 픽스처가 케이스·회차·동의를 매번 새로 만든다 — text-work-materials.test.ts 와 같은 이유로 여유를 준다.
vi.setConfig({ testTimeout: 30_000 });

const { counselor, service } = testActors;
const t = setupD1();

beforeEach(async () => {
  await t.reset();
});

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function evidenceRowCount(supportCaseId: string): Promise<number> {
  const row = await t.db.prepare(
    'SELECT COUNT(*) AS n FROM pilot_text_ai_consent_evidence WHERE support_case_id = ?',
  ).bind(supportCaseId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('텍스트 AI 동의 철회 종단 (CCC-110 · P0-7)', () => {
  it('철회하면 일감 목록·스냅샷 저장·초안 생성이 전부 거부되고 근거 이력은 남는다', async () => {
    t.env.TEXT_AI_PILOT_ENABLED = '1';

    // 1) 동의 저장 — 등록 시점의 ② 체크가 consent_text_ai_at 과 근거 행을 함께 만든다.
    const creation = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      { programType: 'financial_support_v1', intakeAt: '2026-07-16T09:00:00.000Z' },
      undefined,
      { privacy: true, recordingAi: true },
    );
    expect(await evidenceRowCount(creation.supportCaseId)).toBe(1);

    // 2) 회차 저장 → 텍스트 일감 적재 → 장비 폴링에 보인다.
    const record = await createCounselingRecord(t.env, counselor, creation.supportCaseId, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-07-20T10:00:00.000Z',
      channel: 'in_person',
      memo: '동의 철회 종단 테스트용 상담 메모',
      gasScores: [],
      actionItems: [],
      flags: [],
    });
    const sessionId = record.record.id;
    await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
    const before = await listTextWorkItems(t.env, service);
    expect(before.some((item) => item.sessionId === sessionId)).toBe(true);

    // 리스 의미론(CCC-120): 폴링이 곧 임대라 위 호출이 행을 processing 으로 바꿨다.
    // 임대를 과거로 돌려 다시 후보가 되게 한다 — 이후 목록에서 안 보이는 이유가
    // 임대가 아니라 **동의 철회**임을 고정하기 위해서다.
    await t.db.prepare(
      "UPDATE ai_text_work_queue SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE session_id = ?",
    ).bind(sessionId).run();

    // 3) 철회 — ② 체크 해제가 support_cases.consent_text_ai_at 을 NULL 로 되돌린다.
    //    근거 행은 append-only 라 삭제·수정되지 않는다(이력 보존).
    await updateParticipantConsent(t.env, counselor, creation.supportCaseId, {
      privacy: true, recordingAi: false,
    });
    expect(await evidenceRowCount(creation.supportCaseId)).toBe(1);

    // 4) 일감 목록에서 사라진다 — 큐 행은 남아 있어도(삭제 없음) 내보내지 않는다.
    const after = await listTextWorkItems(t.env, service);
    expect(after.some((item) => item.sessionId === sessionId)).toBe(false);
    const queueRow = await t.db.prepare(
      'SELECT status FROM ai_text_work_queue WHERE session_id = ?',
    ).bind(sessionId).first<{ status: string }>();
    // 임대(폴링)로 processing 이 된 행이 그대로 남는다 — 삭제가 아니라 필터다.
    expect(queueRow?.status).toBe('processing');

    // 5) 스냅샷 저장 거부 — 과거 근거 행이 있어도 현재 동의가 없으면 grant 가 닫힌다.
    const maskedText = 'MASKED_AFTER_WITHDRAWAL';
    await expect(recordMaskedSourceSnapshot(t.env, service, sessionId, {
      maskedText,
      sha256: await sha256Hex(maskedText),
      maskingPipelineVersion: 'ner-mask-v1',
      evidence: [{
        id: `withdrawal-evidence-${sessionId}`,
        sourceRef: 'memo:withdrawal-source',
        sourceSha256: await sha256Hex(maskedText),
        evidenceQuote: maskedText,
        sourceStart: 0,
        sourceEnd: maskedText.length,
      }],
    })).rejects.toBeInstanceOf(PilotTextAiConsentRequiredError);

    // 6) AI 초안 생성 경로 거부 — grant 검사가 입력 검증보다 먼저 닫힌다.
    await expect(createGeneratedAiDraft(t.env, service, sessionId, {
      summaryText: 'SHOULD_NOT_BE_STORED',
      claims: [{
        claimKey: 'withdrawal-claim',
        section: 'other_topics',
        text: 'SHOULD_NOT_BE_STORED',
      }],
      flagSuggestions: [],
      oneLiner: 'SHOULD_NOT_BE_STORED',
      questions: [
        { title: '질문 1이 있었나요?', reason: '거부되어야 하므로 저장되지 않습니다.' },
        { title: '질문 2가 있었나요?', reason: '거부되어야 하므로 저장되지 않습니다.' },
      ],
      sourceSnapshotId: 'snapshot-should-not-matter',
      sourceSnapshotHash: 'a'.repeat(64),
      materials: [{ kind: 'text_context', snapshotId: 'snapshot-should-not-matter', snapshotSha256: 'a'.repeat(64) }],
      contrast: [
        { axis: 'missing_from_memo', status: 'no_transcript', findings: [] },
        { axis: 'missing_from_transcript', status: 'no_transcript', findings: [] },
        { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
      ],
      providerConfigId: 'config-should-not-matter',
      consentEvidenceId: 'evidence-should-not-matter',
      modelId: 'gpt-5-codex',
      promptVersion: 'prompt-v1',
      schemaVersion: 'schema-v1',
      evidence: [],
    })).rejects.toBeInstanceOf(PilotTextAiConsentRequiredError);

    // 7) 재동의하면 같은 큐 행이 다시 보인다 — 목록 조건이 삭제가 아니라 필터임을 고정.
    await updateParticipantConsent(t.env, counselor, creation.supportCaseId, {
      privacy: true, recordingAi: true,
    });
    const restored = await listTextWorkItems(t.env, service);
    expect(restored.some((item) => item.sessionId === sessionId)).toBe(true);
  });
});
