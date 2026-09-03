// CCC-73 — AI 재료 배선 (D62 §7 · ADR-0032)
// CCC-103: 목표와 메모를 AI 재료로 (D69 · ADR-0036)
// 텍스트 일감 원문(getTextWorkItemSource)이 케이스 컨텍스트(전체 목표 으뜸, 활성 세부
// 목표, 인테이크 지원욕구·지원방향, 완료 일정의 회기 목표)를 깔고 회차 텍스트를 잇는지,
// 이력의 이전 문구·무응답 선택값·닫힌 목표가 재료에서 빠지는지 고정한다. 목표 확정·수정이
// 큐에 다시 올리는 범위(enqueueTextWorkForGoalChange)와 마이그레이션 0034 도 여기서 잡는다.
// 이 원문은 장비 마스킹을 거친 스냅샷이 되어야만 사업자로 나간다(D57 게이트). 사업자 호출부
// 쪽 보증은 routes.test.ts 의 CCC-73 테스트가 잡는다.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { Miniflare } from 'miniflare';
import { createD1Database } from '@ccc/db-d1';
import worker from './support/local-worker';
import {
  activateAiProviderConfiguration,
  approveGeneratedAiDraft,
  closeGoal,
  createBeneficiaryWithInitialSupportCase,
  createCase,
  createCounselingRecord,
  createCounselingSchedule,
  createGeneratedAiDraft,
  createGoal,
  createIntakeRecord,
  enqueueTextWorkForGoalChange,
  enqueueTextWorkItem,
  getActiveAiProviderRuntimeMetadataForService,
  getTextWorkItemSource,
  listSupportCasesForBeneficiary,
  listTextWorkItems,
  recordMaskedSourceSnapshot,
  recordPilotTextAiConsentEvidence,
  registerAiProviderConfiguration,
  setSupportCaseOverallGoal,
  updateParticipantConsent,
  updateParticipantPii,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

/**
 * 재료 하나(텍스트 맥락)뿐인 초안의 재료 증빙과 대조 3종 (D69 · ADR-0036).
 * 축은 셋 다 재료 없음이라 항목이 0개다.
 */
function singleTextMaterialInput(snapshotId: string, snapshotSha256: string) {
  return {
    materials: [{ kind: 'text_context' as const, snapshotId, snapshotSha256 }],
    contrast: [
      { axis: 'missing_from_memo' as const, status: 'no_transcript' as const, findings: [] },
      { axis: 'missing_from_transcript' as const, status: 'no_transcript' as const, findings: [] },
      { axis: 'undiscussed_session_goal' as const, status: 'no_session_goal' as const, findings: [] },
    ],
  };
}


// 픽스처가 케이스·인테이크·회차·동의를 매번 새로 만든다. 전체 스위트 병렬 실행에서
// 기본 5초를 넘길 수 있어 discrepancies.test.ts 와 같은 이유로 여유를 준다.
vi.setConfig({ testTimeout: 30_000 });

const { admin, counselor, service } = testActors;
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
  // 실제 동의 경로(② 체크)로 현재 동의 컬럼을 세운다 — 근거 행만 있는 픽스처는
  // 철회된 케이스와 구분되지 않아 가드에 걸린다.
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

async function saveRecord(
  supportCaseId: string,
  memo: string,
  options?: {
    details?: { sessionGoalNote?: string };
    heldAt?: string;
    schedule?: { id: string; version: number };
  },
): Promise<string> {
  const result = await createCounselingRecord(t.env, counselor, supportCaseId, {
    submissionId: crypto.randomUUID(),
    heldAt: options?.heldAt ?? '2026-07-08T10:00:00.000Z',
    channel: 'in_person',
    memo,
    gasScores: [],
    actionItems: [],
    flags: [],
    ...(options?.details === undefined ? {} : { details: options.details }),
    ...(options?.schedule === undefined
      ? {}
      : { scheduleId: options.schedule.id, expectedScheduleVersion: options.schedule.version }),
  });
  return result.record.id;
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 이 회차에 승인된 AI 정리를 만든다. approved_ai_briefing_v1 은 뷰라서 직접 넣을 수 없고,
 * 프로바이더 설정 → 마스킹 스냅샷 → 초안 → 승인의 실제 경로를 다 밟아야 행이 생긴다
 * (gateway-domain.test.ts 의 createPilotDraft 와 같은 골격).
 */
async function approveBriefingFor(caseId: string, sessionId: string): Promise<void> {
  const config = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: 'codex',
    adapterVersion: 'v1',
    configHash: 'b'.repeat(64),
    approvalRefs: ['privacy-security-approval'],
  });
  await activateAiProviderConfiguration(t.env, admin, config.id);

  const evidenceQuote = 'MASKED_EVIDENCE_FOR_APPROVAL';
  const snapshotHash = await sha256Hex(evidenceQuote);
  const snapshot = await recordMaskedSourceSnapshot(t.env, service, sessionId, {
    maskedText: evidenceQuote,
    sha256: snapshotHash,
    maskingPipelineVersion: 'ner-mask-v1',
    evidence: [{
      id: `approved-evidence-${sessionId}`,
      sourceRef: 'memo:approved-source',
      sourceSha256: snapshotHash,
      evidenceQuote,
      sourceStart: 0,
      sourceEnd: evidenceQuote.length,
    }],
  });
  if (snapshot.caseId !== caseId) throw new Error('masked source snapshot case mismatch');

  const selection = await getActiveAiProviderRuntimeMetadataForService(t.env, service, sessionId);
  const link = {
    sourceEvidenceItemId: `approved-evidence-${sessionId}`,
    evidenceQuote,
    sourceRef: 'memo:approved-source',
    sourceStart: 0,
    sourceEnd: evidenceQuote.length,
  };
  const draft = await createGeneratedAiDraft(t.env, service, sessionId, {
    summaryText: 'APPROVED_AI_SUMMARY',
    claims: [{
      claimKey: 'approved-claim',
      section: 'other_topics',
      text: 'APPROVED_AI_SUMMARY',
    }],
    flagSuggestions: [],
    oneLiner: 'APPROVED_AI_ONE_LINER',
    questions: [
      { title: '지출 계획에 변동이 있었나요?', reason: '지난 회차에서 지출 변동이 언급되었습니다.' },
      { title: '주거비 변화가 있었나요?', reason: '지난 회차에서 주거비 부담이 화제였습니다.' },
    ],
    sourceSnapshotId: snapshot.id,
    sourceSnapshotHash: snapshot.sha256,
    ...singleTextMaterialInput(snapshot.id, snapshot.sha256),
    providerConfigId: selection.providerConfigId,
    consentEvidenceId: selection.consentEvidenceId,
    modelId: 'gpt-5-codex',
    promptVersion: 'prompt-v1',
    schemaVersion: 'schema-v1',
    evidence: [
      { ...link, claimKey: 'approved-claim' },
      { ...link, claimKey: 'question_1' },
      { ...link, claimKey: 'question_2' },
    ],
  });
  await approveGeneratedAiDraft(t.env, counselor, draft.workItemId, draft.version);
}

/** 큐에 쌓인 행을 사유·상태까지 그대로 읽는다(테스트 전용 직접 조회). */
async function queueRows(): Promise<Array<{ session_id: string; reason: string; status: string }>> {
  const result = await t.db.prepare(
    'SELECT session_id, reason, status FROM ai_text_work_queue ORDER BY enqueued_at, id',
  ).all<{ session_id: string; reason: string; status: string }>();
  return result.results;
}

/** 장비 폴링과 같은 경로로 일감을 찾아 원문을 꺼낸다. */
async function sourceForSession(sessionId: string): Promise<string> {
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  const items = await listTextWorkItems(t.env, service);
  const item = items.find((entry) => entry.sessionId === sessionId);
  if (item === undefined) throw new Error('expected a pending text work item');
  const { text } = await getTextWorkItemSource(t.env, service, item.id);
  return text;
}

describe('getTextWorkItemSource — AI 재료 배선 (CCC-73 · D62 §7)', () => {
  it('전체 목표를 으뜸으로, 인테이크 선택값을 기본으로 깔고 회차 텍스트를 잇는다', async () => {
    const { supportCaseId } = await fixtureCase();
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '전세 보증금을 마련한다');
    await createIntakeRecord(t.env, counselor, supportCaseId, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-07-01T10:00:00.000Z',
      channel: 'in_person',
      answers: [
        { key: 'need_primary', response: 'answered', text: '주거 안정' },
        // 무응답 선택값은 재료에 싣지 않는다.
        { key: 'need_secondary', response: 'declined' },
        { key: 'summary_direction', response: 'answered', text: '긴급 주거비 지원 연계' },
      ],
    });
    const sessionId = await saveRecord(
      supportCaseId,
      '보증금 마련 계획을 함께 세웠다',
      { details: { sessionGoalNote: '대출 서류 준비 여부 확인' } },
    );

    const text = await sourceForSession(sessionId);
    const lines = text.split('\n');
    expect(lines[0]).toBe('[전체 목표] 전세 보증금을 마련한다');
    expect(lines[1]).toBe('[지원욕구 1순위] 주거 안정');
    expect(lines[2]).toBe('[지원방향] 긴급 주거비 지원 연계');
    expect(lines[3]).toBe('보증금 마련 계획을 함께 세웠다');
    // 워크인 폴백 자유 글(D62 §7)은 회차 텍스트 뒤에 붙는다.
    expect(lines[4]).toBe('[이번 상담에서 확인할 것] 대출 서류 준비 여부 확인');
    expect(text).not.toContain('지원욕구 2순위');
  });

  it('컨텍스트가 비어 있으면 회차 텍스트만 나간다(빈 라벨 없음)', async () => {
    const { supportCaseId } = await fixtureCase();
    const sessionId = await saveRecord(supportCaseId, '오늘 상담 내용을 수기로 남긴다');

    const text = await sourceForSession(sessionId);
    expect(text).toBe('오늘 상담 내용을 수기로 남긴다');
  });

  it('전체 목표의 이전 문구(이력)는 재료에 싣지 않는다', async () => {
    const { supportCaseId } = await fixtureCase();
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, 'OLD_GOAL_PHRASE 첫 합의 문구');
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '다듬은 최종 문구');
    const sessionId = await saveRecord(supportCaseId, '문구를 다듬은 뒤의 상담');

    const text = await sourceForSession(sessionId);
    expect(text).toContain('[전체 목표] 다듬은 최종 문구');
    expect(text).not.toContain('OLD_GOAL_PHRASE');

    // 대조군: 이력 자체는 두 줄 쌓여 있다. 이력이 있어도 재료는 현재 문구뿐이어야
    // 이 테스트가 실제 제외를 증명한다(헛도는 테스트 방지).
    const revisions = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM goal_revisions WHERE support_case_id = ? AND goal_id IS NULL',
    ).bind(supportCaseId).first<{ count: number }>();
    expect(Number(revisions?.count)).toBe(2);
  });

  it('컨텍스트에 실린 등록 실명도 1차 치환을 거친다 (R3)', async () => {
    const { caseId, supportCaseId } = await fixtureCase();
    await updateParticipantPii(t.env, counselor, caseId, {
      supportCaseContextId: supportCaseId,
      expectedVersion: 1,
      name: '홍길동',
    });
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '홍길동 님의 채무를 정리한다');
    const sessionId = await saveRecord(supportCaseId, '상환 계획을 점검했다');

    const text = await sourceForSession(sessionId);
    expect(text).toContain('[전체 목표]');
    expect(text).not.toContain('홍길동');
  });
});

describe('getTextWorkItemSource: 목표 3층 재료 (CCC-103 · D69 · ADR-0036)', () => {
  it('활성 세부 목표와 완료 일정의 회기 목표를 순서대로 깐다', async () => {
    const { caseId, supportCaseId } = await fixtureCase();
    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '전세 보증금을 마련한다');
    // 생성 시각을 일부러 삽입 순서와 반대로 둔다. 순서를 정하는 것이 삽입 순서가 아니라
    // created_at 임을 이 대조가 증명한다(id 는 무작위 UUID 라 같은 밀리초에 만들어지면
    // 흔들린다 - 시각을 갈라 그 흔들림도 함께 없앤다).
    const later = await createGoal(t.env, counselor, caseId, { title: '주 1회 가계부 점검하기' });
    const earlier = await createGoal(t.env, counselor, caseId, { title: '매달 30만원 저축하기' });
    await t.db.prepare('UPDATE goals SET created_at = ? WHERE id = ?')
      .bind('2026-07-11T00:00:00.000Z', later.id).run();
    await t.db.prepare('UPDATE goals SET created_at = ? WHERE id = ?')
      .bind('2026-07-10T00:00:00.000Z', earlier.id).run();
    // 닫힌 세부 목표는 지난 기록이라 재료에서 빠진다(D62 §5).
    const closing = await createGoal(t.env, counselor, caseId, { title: 'CLOSED_GOAL_PHRASE 폐기된 목표' });
    await closeGoal(t.env, counselor, closing.id, 'stopped');

    const schedule = await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: caseId,
      supportCaseId,
      scheduledAt: '2026-07-16T10:00:00.000Z',
      sessionGoals: [{ body: '저축 통장 개설 확인' }, { body: '지출 항목 정리' }],
    });
    const sessionId = await saveRecord(supportCaseId, '통장을 개설하고 지출을 정리했다', {
      heldAt: '2026-07-16T10:05:00.000Z',
      schedule: { id: schedule.id, version: schedule.version },
    });

    const text = await sourceForSession(sessionId);
    expect(text.split('\n')).toEqual([
      '[전체 목표] 전세 보증금을 마련한다',
      '[세부 목표] 매달 30만원 저축하기',
      '주 1회 가계부 점검하기',
      '[회기 목표] 저축 통장 개설 확인',
      '지출 항목 정리',
      '통장을 개설하고 지출을 정리했다',
    ]);
    expect(text).not.toContain('CLOSED_GOAL_PHRASE');
  });

  it('일정에 연결되지 않은 회차에는 회기 목표 구획이 없다', async () => {
    const { caseId, supportCaseId } = await fixtureCase();
    // 대조군: 회기 목표를 가진 일정이 같은 케이스에 실제로 있다. 그래도 이 회차가 그
    // 일정을 닫지 않았으면 실리지 않아야 "연결로 고른다"가 증명된다(헛도는 테스트 방지).
    await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: caseId,
      supportCaseId,
      scheduledAt: '2026-07-16T10:00:00.000Z',
      sessionGoals: [{ body: 'UNLINKED_SESSION_GOAL_PHRASE' }],
    });
    const sessionId = await saveRecord(supportCaseId, '일정 없이 들른 상담을 적었다');

    const text = await sourceForSession(sessionId);
    expect(text).toBe('일정 없이 들른 상담을 적었다');
    expect(text).not.toContain('회기 목표');
    expect(text).not.toContain('UNLINKED_SESSION_GOAL_PHRASE');
  });
});

describe('텍스트 일감 큐: 녹음 회차와 목표 수정 (CCC-103 · D69)', () => {
  it('녹음 회차의 메모도 큐에 오르고 장비 목록에 보인다', async () => {
    const { supportCaseId } = await fixtureCase();
    const sessionId = await saveRecord(supportCaseId, '녹음과 함께 수기 메모도 남겼다');
    // 이 회차에는 오디오가 있다. 오디오 큐(listPipelineJobs)와 텍스트 큐는 서로를 배제하지
    // 않는다(ADR-0036 결정 2: "녹음 회차의 메모도 포함한다").
    await t.db.prepare('UPDATE sessions SET audio_r2_key = ?, ai_status = ? WHERE id = ?')
      .bind(`audio/${sessionId}/fixture`, 'uploaded', sessionId).run();

    await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
    const items = await listTextWorkItems(t.env, service);
    expect(items.map((item) => item.sessionId)).toContain(sessionId);
    const { text } = await getTextWorkItemSource(t.env, service, items[0]!.id);
    expect(text).toBe('녹음과 함께 수기 메모도 남겼다');
  });

  it('목표 수정은 미승인 공식 텍스트 회차만 goal_revised 로 올린다', async () => {
    const { caseId, supportCaseId } = await fixtureCase();
    const pendingSessionId = await saveRecord(supportCaseId, '아직 AI 정리를 승인하지 않은 회차');
    const approvedSessionId = await saveRecord(supportCaseId, '이미 AI 정리를 승인한 회차', {
      heldAt: '2026-07-09T10:00:00.000Z',
    });
    await approveBriefingFor(caseId, approvedSessionId);

    await setSupportCaseOverallGoal(t.env, counselor, supportCaseId, '보증금과 생활비를 함께 본다');
    await enqueueTextWorkForGoalChange(t.env, counselor, supportCaseId);

    expect(await queueRows()).toEqual([
      { session_id: pendingSessionId, reason: 'goal_revised', status: 'pending' },
    ]);
  });

  it('이미 대기 중인 회차는 부분 유니크 인덱스가 흡수한다', async () => {
    const { caseId, supportCaseId } = await fixtureCase();
    const sessionId = await saveRecord(supportCaseId, '수기 저장으로 이미 큐에 오른 회차');
    await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');

    await createGoal(t.env, counselor, caseId, { title: '월세 연체 해소' });
    await enqueueTextWorkForGoalChange(t.env, counselor, caseId);

    // 행은 늘지 않고 먼저 쌓인 사유가 남는다. 장비는 최신 텍스트를 한 번만 마스킹한다.
    expect(await queueRows()).toEqual([
      { session_id: sessionId, reason: 'manual_record', status: 'pending' },
    ]);
  });

  it('목표 API 네 곳이 큐 적재 훅을 건다', async () => {
    const headers = {
      'X-CCC-User-Id': counselor.userId,
      'X-CCC-Org-Id': counselor.orgId,
      'X-CCC-Role': counselor.role,
      'content-type': 'application/json',
    };
    // 게이트웨이를 직접 부르는 픽스처 준비 단계는 훅을 돌리지 않는다. 큐는 매번 빈 채로
    // 시작하고, 아래 요청 하나가 유일한 적재 원인이다.
    async function routeFixture(): Promise<{ caseId: string; supportCaseId: string; sessionId: string; goalId: string }> {
      await t.reset();
      const { caseId, supportCaseId } = await fixtureCase();
      const sessionId = await saveRecord(supportCaseId, '훅 배선 확인용 회차');
      const goal = await createGoal(t.env, counselor, caseId, { title: '배선 확인 전 목표' });
      expect(await queueRows()).toEqual([]);
      return { caseId, supportCaseId, sessionId, goalId: goal.id };
    }

    const calls: Array<(fixture: Awaited<ReturnType<typeof routeFixture>>) => Request> = [
      // ① 전체 목표 확정·수정
      ({ supportCaseId }) => new Request(`http://localhost/support-cases/${supportCaseId}/overall-goal`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ overallGoal: '주거를 먼저 안정시킨다' }),
      }),
      // ② 세부 목표 신설
      ({ caseId }) => new Request(`http://localhost/cases/${caseId}/goals`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: '보증금 300만원 모으기' }),
      }),
      // ③ 세부 목표 문구 수정
      ({ goalId }) => new Request(`http://localhost/goals/${goalId}/title`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ title: '보증금 500만원 모으기' }),
      }),
      // ④ 세부 목표 닫기
      ({ goalId }) => new Request(`http://localhost/goals/${goalId}/close`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: 'achieved' }),
      }),
    ];

    for (const buildRequest of calls) {
      const fixture = await routeFixture();
      const response = await worker.fetch(buildRequest(fixture), t.env);
      expect(response.status).toBeLessThan(300);
      expect(await queueRows()).toEqual([
        { session_id: fixture.sessionId, reason: 'goal_revised', status: 'pending' },
      ]);
    }
  });
});

describe('마이그레이션 0034: 텍스트 일감 큐 사유 확장 (CCC-103)', () => {
  it('기존 행을 그대로 옮기고 goal_revised 를 받으면서 인덱스·트리거를 되살린다', async () => {
    const miniflare = new Miniflare({
      compatibilityDate: '2026-07-06',
      d1Databases: ['DB'],
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } };',
    });
    try {
      const db = await miniflare.getD1Database('DB');
      const migrationsUrl = new URL(['..', '..', '..', 'migrations'].join('/'), import.meta.url);
      const migrations = await readD1Migrations(migrationsUrl.pathname);
      // 0034 를 내용으로 찾는다. 뒤에 다른 마이그레이션이 붙어도 헛돌지 않는다.
      const upgradeIndex = migrations.findIndex(
        (migration) => migration.queries.some((query) => query.includes('goal_revised')),
      );
      const upgradeMigration = migrations[upgradeIndex];
      if (upgradeMigration === undefined) {
        throw new Error('expected migration 0034 goal_revised contract');
      }
      for (const migration of migrations.slice(0, upgradeIndex)) {
        await db.batch(migration.queries.map((query) => db.prepare(query)));
      }

      const upgradeEnv = { DB: createD1Database(db), PII_ENC_KEY: 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=' };
      const createdAt = '2026-07-14 09:00:00';
      await db.prepare(
        `INSERT INTO organization_settings (
           org_id, time_zone, pii_purge_grace_days, version, created_at, updated_at
         ) VALUES (?, 'Asia/Seoul', 180, 1, ?, ?)`,
      ).bind(counselor.orgId, createdAt, createdAt).run();
      await db.prepare(
        `INSERT INTO users (id, org_id, email, role, active)
         VALUES (?, ?, 'migration-0034@example.invalid', 'counselor', 1)`,
      ).bind(counselor.userId, counselor.orgId).run();
      const participant = await createBeneficiaryWithInitialSupportCase(upgradeEnv, counselor, {
        programType: 'financial_support_v1',
        intakeAt: '2026-07-14T09:00:00.000Z',
      });

      const sessionIds = ['migration-0034-session-a', 'migration-0034-session-b'];
      for (const [index, sessionId] of sessionIds.entries()) {
        await db.prepare(
          `INSERT INTO sessions (
             id, org_id, support_case_id, counselor_id, held_at, channel, memo,
             submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'in_person', ?, ?, ?, ?, 'none', ?, ?)`,
        ).bind(
          sessionId,
          counselor.orgId,
          participant.supportCaseId,
          counselor.userId,
          createdAt,
          'Migration fixture memo.',
          `4444444${index}-4444-4444-8444-444444444444`,
          'a'.repeat(64),
          counselor.userId,
          createdAt,
          createdAt,
        ).run();
      }
      await db.prepare(
        `INSERT INTO ai_text_work_queue (
           id, org_id, support_case_id, session_id, reason, status, enqueued_at, completed_at
         ) VALUES
           ('queue-pending', ?, ?, ?, 'manual_record', 'pending', ?, NULL),
           ('queue-done', ?, ?, ?, 'ai_draft_approved', 'done', ?, ?)`,
      ).bind(
        counselor.orgId, participant.supportCaseId, sessionIds[0], createdAt,
        counselor.orgId, participant.supportCaseId, sessionIds[1], createdAt, createdAt,
      ).run();

      await db.batch(upgradeMigration.queries.map((query) => db.prepare(query)));

      // 1) 옛 사유·상태·완료 시각이 그대로 살아 있다.
      await expect(db.prepare(
        'SELECT id, reason, status, completed_at FROM ai_text_work_queue ORDER BY id',
      ).all().then((result) => result.results)).resolves.toEqual([
        { id: 'queue-done', reason: 'ai_draft_approved', status: 'done', completed_at: createdAt },
        { id: 'queue-pending', reason: 'manual_record', status: 'pending', completed_at: null },
      ]);
      await expect(db.prepare('PRAGMA foreign_key_check').all()
        .then((result) => result.results)).resolves.toEqual([]);

      // 2) 새 사유는 받고, 목록에 없는 사유는 여전히 막는다.
      await db.prepare(
        `INSERT INTO ai_text_work_queue (id, org_id, support_case_id, session_id, reason, status, enqueued_at)
         VALUES ('queue-goal', ?, ?, ?, 'goal_revised', 'pending', ?)`,
      ).bind(counselor.orgId, participant.supportCaseId, sessionIds[1], createdAt).run();
      await expect(db.prepare(
        `INSERT INTO ai_text_work_queue (id, org_id, support_case_id, session_id, reason, status, enqueued_at)
         VALUES ('queue-bogus', ?, ?, ?, 'not_a_reason', 'pending', ?)`,
      ).bind(counselor.orgId, participant.supportCaseId, sessionIds[1], createdAt).run())
        .rejects.toThrow(/CHECK constraint failed/);

      // 3) 회차당 대기 1건 부분 유니크 인덱스가 살아 있다.
      await expect(db.prepare(
        `INSERT INTO ai_text_work_queue (id, org_id, support_case_id, session_id, reason, status, enqueued_at)
         VALUES ('queue-duplicate', ?, ?, ?, 'goal_revised', 'pending', ?)`,
      ).bind(counselor.orgId, participant.supportCaseId, sessionIds[1], createdAt).run())
        .rejects.toThrow(/UNIQUE constraint failed/);

      // 4) 완료 행 불변·삭제 금지 트리거 2종이 살아 있다(D14).
      await expect(db.prepare(
        "UPDATE ai_text_work_queue SET status = 'pending', completed_at = NULL WHERE id = 'queue-done'",
      ).run()).rejects.toThrow('completed text work items are immutable');
      await expect(db.prepare("DELETE FROM ai_text_work_queue WHERE id = 'queue-pending'").run())
        .rejects.toThrow('text work items are append-only');
    } finally {
      await miniflare.dispose();
    }
  });
});
