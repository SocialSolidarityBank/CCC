// CCC-110 (P0-7) — canonical AI consent withdrawal stops actual AI use.
//
// A real append-only withdrawal must close all three text AI authorization points:
// agent claim, masked snapshot storage and draft creation. Re-granting consent later
// must preserve the event history and must not revive the cancelled job.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  appendSupportCaseConsentEvent,
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createGeneratedAiDraft,
  claimAgentJobs,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  enqueueTextWorkItem,
  releaseAgentJob,
  recordMaskedSourceSnapshot,
} from '@ccc/core/gateway';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId } from './support/d1';
import {
  claimRequest,
  seedCanonicalSttConsent,
  seedNerQualification,
  TEXT_ONLY_RUNTIME,
} from './support/agent-jobs';
import { registrationInput } from './support/registration';

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

async function consentHistory(supportCaseId: string): Promise<string[]> {
  const rows = await t.db.prepare(
    `SELECT decision FROM consent_events
     WHERE support_case_id = ? AND domain = 'external_llm_cross_border_processing'
     ORDER BY event_sequence`,
  ).bind(supportCaseId).all<{ decision: string }>();
  return rows.results.map((row) => row.decision);
}

describe('텍스트 AI 동의 철회 종단 (CCC-110 · P0-7)', () => {
  it('철회하면 일감 목록·스냅샷 저장·초안 생성이 전부 거부되고 근거 이력은 남는다', async () => {
    await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
      sttMode: 'local',
      llmMode: 'openai',
    });
    t.env.CCC_STT_MODE = 'local';
    t.env.CCC_LLM_MODE = 'openai';
    t.env.TEXT_AI_PILOT_ENABLED = '1';

    // 1) 등록이 6종 동의를 남긴다 — 이후 STT 픽스처는 이미 grant 인 도메인을 건드리지 않는다.
    const creation = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(t.env, counselor, {
        programId: testProgramId(counselor.orgId),
        intakeAt: '2026-07-16T09:00:00.000Z',
      }),
    );
    await seedCanonicalSttConsent(t.env, counselor, creation.supportCaseId);
    expect(await consentHistory(creation.supportCaseId)).toEqual(['grant']);

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
    const qualification = await seedNerQualification(t.db);
    const before = await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification));
    const claimed = before.jobs.find((job) => job.sessionId === sessionId);
    expect(claimed).toBeDefined();

    // claim 이 곧 임대다(S5). 임대를 되돌려 놓아야 이후 claim 이 0건인 이유가
    // 임대가 아니라 **동의 철회**임을 고정할 수 있다.
    await releaseAgentJob(t.env, service, claimed?.jobId ?? '', {
      claimToken: claimed?.claimToken ?? '',
      attempt: 1,
      outcome: 'transient',
      reason: 'engine_unavailable',
    });

    // 3) Append a canonical withdrawal against the current disclosure and revision.
    const current = (await getSupportCaseConsent(t.env, counselor, creation.supportCaseId))
      .find((item) => item.domain === 'external_llm_cross_border_processing');
    const disclosure = (await issueSupportCaseConsentDisclosures(t.env, counselor, creation.supportCaseId))
      .find((item) => item.domain === 'external_llm_cross_border_processing');
    if (current?.state !== 'granted' || current.revision === null || disclosure === undefined) {
      throw new Error('expected current canonical LLM consent');
    }
    await appendSupportCaseConsentEvent(t.env, counselor, creation.supportCaseId, {
      domain: current.domain,
      decision: 'withdraw',
      provider: current.provider,
      providerLegalRecipient: current.providerLegalRecipient,
      providerCountry: current.providerCountry,
      purpose: current.purpose,
      retentionDuration: current.retentionDuration,
      copyVersion: disclosure.copyVersion,
      copyHash: disclosure.copyHash,
      disclosureSnapshotId: disclosure.snapshotId,
      effectiveAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      correctionOfEventId: null,
      expectedRevision: current.revision,
    });
    expect(await consentHistory(creation.supportCaseId)).toEqual(['grant', 'withdraw']);

    // 4) 열린 작업이 취소되고 claim 후보에서 사라진다 (S5 F4). 원본 큐 행은 남는다.
    const after = await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification));
    expect(after.jobs.some((job) => job.sessionId === sessionId)).toBe(false);
    const jobRow = await t.db.prepare(
      'SELECT state FROM agent_jobs WHERE session_id = ?',
    ).bind(sessionId).first<{ state: string }>();
    expect(jobRow?.state).toBe('cancelled');
    const queueRow = await t.db.prepare(
      'SELECT status FROM ai_text_work_queue WHERE session_id = ?',
    ).bind(sessionId).first<{ status: string }>();
    // 큐 행은 append-only 이력이라 삭제되지 않는다 — 상태는 Agent 작업이 갖는다.
    expect(queueRow?.status).toBe('pending');

    // 5) 스냅샷 저장 거부 — grant 이력은 남아도 현재 canonical 동의가 없으면 닫힌다.
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
    })).rejects.toMatchObject({ code: 'consent_not_effective' });

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
      consentRevision: 'a'.repeat(64),
      consentReceipt: { required: [], consentRevision: 'a'.repeat(64) },
      modelId: 'gpt-5-codex',
      promptVersion: 'prompt-v1',
      schemaVersion: 'schema-v1',
      evidence: [],
    })).rejects.toMatchObject({ code: 'consent_not_effective' });

    // 7) Re-consent does not revive a cancelled terminal job; a new enqueue is required.
    await seedCanonicalSttConsent(t.env, counselor, creation.supportCaseId);
    expect(await consentHistory(creation.supportCaseId)).toEqual(['grant', 'withdraw', 'grant']);
    const afterReconsent = await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification));
    expect(afterReconsent.jobs.some((job) => job.sessionId === sessionId)).toBe(false);

    await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
    const restored = await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification));
    expect(restored.jobs.some((job) => job.sessionId === sessionId)).toBe(true);
  });
});
