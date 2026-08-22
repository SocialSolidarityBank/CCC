// CCC-43 — 내용 불일치 검출·저장·표시 (D45 · ADR-0018)
// ① 프로바이더 출력 검증(원문 인용 강제·판단 금지, R5) ② 게이트웨이 저장·불변·브리핑
// ③ 라우트 훅(수기 저장 시 검출 실행, 실패해도 저장은 성공 — D8) 을 검증한다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  collectDiscrepancyDetectionSources,
  createCase,
  createManualSession,
  enqueueTextWorkItem,
  ForbiddenError,
  listTextWorkItems,
  recordMaskedSourceSnapshot,
  getParticipantBriefing,
  listCounselingRecords,
  listRecordErrorSessionIds,
  listSupportCasesForBeneficiary,
  recordPilotTextAiConsentEvidence,
  replaceSessionDiscrepancies,
  resolveSessionDiscrepancy,
  updateParticipantPii,
  ValidationError,
} from '../../../db/gateway';
import {
  AiProviderProhibitedOutputError,
  AiProviderUnavailableError,
  CodexProviderAdapter,
  DISCREPANCY_PROMPT_VERSION,
  validateDiscrepancyDetectionOutput,
  validateDiscrepancyDetectionRequest,
  type AiProviderConfig,
  type AiProviderOutput,
  type AiProviderRequest,
  type AiProviderTestAdapter,
  type DiscrepancyDetectionRequest,
} from '../src/ai-provider';
import worker from './support/local-worker';
import { setupD1, testActors } from './support/d1';

// 이 파일의 픽스처는 케이스·회차·동의·스냅샷을 매번 새로 만든다 — 전체 스위트를 병렬로
// 돌리면 기본 5초 안에 끝나지 않아 내용과 무관하게 시간 초과로 떨어진다(브랜치 이전부터
// 같은 증상). 단독 실행에서는 여유가 충분하고, 늘려도 실패는 여전히 실패로 잡힌다.
vi.setConfig({ testTimeout: 30_000 });

const { counselor, admin, service } = testActors;
const t = setupD1();
const SHA256 = 'a'.repeat(64);

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function serviceHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': service.userId,
    'X-CCC-Org-Id': service.orgId,
    'X-CCC-Role': 'service',
  };
}

function wholeTextEvidence(sessionId: string, maskedText: string, sha256: string) {
  return {
    id: crypto.randomUUID(),
    sourceRef: sessionId,
    sourceSha256: sha256,
    evidenceQuote: maskedText,
    sourceStart: 0,
    sourceEnd: [...maskedText].length,
  };
}

/** 장비가 만든 2차 마스킹 스냅샷을 직접 심는다 — 라우트 왕복 없이 같은 상태를 만든다. */
async function seedMaskedSnapshot(sessionId: string, text: string): Promise<void> {
  const maskedText = text.trim().length === 0 ? 'MASKED_SOURCE_BASELINE' : text;
  const sha256 = await sha256Hex(maskedText);
  await recordMaskedSourceSnapshot(t.env, service, sessionId, {
    maskedText,
    sha256,
    maskingPipelineVersion: 'ner-mask-v1',
    evidence: [wholeTextEvidence(sessionId, maskedText, sha256)],
  });
}

/**
 * 처리 장비 흉내 (ADR-0027) — 대기 중인 텍스트 일감을 전부 가져와 2차 마스킹
 * 스냅샷을 만들고 완료 처리한다. 스냅샷 POST 라우트가 불일치 재검출을 돌린다.
 * `mask` 로 NER 마스킹을 대신한다(기본값은 원문 그대로 = 마스킹할 것이 없는 경우).
 */
async function runDeviceTextJobs(mask: (text: string) => string = (text) => text): Promise<number> {
  const listed = await worker.fetch(new Request('https://api.test/pipeline/text-jobs', {
    headers: serviceHeaders(),
  }), t.env);
  const { jobs } = await listed.json() as { jobs: Array<{ id: string; sessionId: string }> };
  for (const job of jobs) {
    const sourceResponse = await worker.fetch(
      new Request(`https://api.test/pipeline/text-jobs/${job.id}/source`, { headers: serviceHeaders() }),
      t.env,
    );
    if (sourceResponse.status !== 200) throw new Error(`text job source failed: ${sourceResponse.status}`);
    const { text } = await sourceResponse.json() as { text: string };
    const maskedText = mask(text);
    const snapshotResponse = await worker.fetch(new Request(`https://api.test/sessions/${job.sessionId}/ai/source`, {
      method: 'POST',
      headers: serviceHeaders(),
      body: JSON.stringify({
        maskedText,
        sha256: await sha256Hex(maskedText),
        maskingPipelineVersion: 'ner-mask-v1',
        // 텍스트 일감에는 발췌할 근거가 따로 없다 — 마스킹된 본문 전체가 한 조각이다.
        evidence: [wholeTextEvidence(job.sessionId, maskedText, await sha256Hex(maskedText))],
      }),
    }), t.env);
    if (snapshotResponse.status !== 201) {
      throw new Error(`snapshot post failed: ${snapshotResponse.status} ${await snapshotResponse.text()}`);
    }
    await worker.fetch(new Request(`https://api.test/pipeline/text-jobs/${job.id}/complete`, {
      method: 'POST',
      headers: serviceHeaders(),
    }), t.env);
  }
  return jobs.length;
}

// 테스트마다 독립 D1 — setupD1 계약상 reset() 이 컨텍스트를 만든다.
beforeEach(async () => {
  await t.reset();
});

// 제출 ID 는 케이스가 달라도 재사용하면 재생(replay)·유일성에 걸린다 — 매번 새로 발급.
function submissionId(): string {
  return crypto.randomUUID();
}

async function createCaseWithSessions(memos: string[], withSnapshots = false): Promise<{
  caseId: string;
  supportCaseId: string;
  sessionIds: string[];
}> {
  const caseRecord = await createCase(t.env, counselor, {});
  const sessionIds: string[] = [];
  for (const [index, memo] of memos.entries()) {
    const session = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: submissionId(),
      heldAt: `2026-07-0${index + 1}T10:00:00.000Z`,
      channel: 'in_person',
      memo,
      gasScores: [],
    });
    sessionIds.push(session.id);
  }
  const { programs } = await listSupportCasesForBeneficiary(t.env, counselor, caseRecord.id);
  const supportCaseId = programs[0]?.supportCase.id;
  if (supportCaseId === undefined) throw new Error('expected initial support case');

  // 검출 재료는 2차 마스킹 스냅샷뿐이다(R3 · ADR-0027). 라우트를 거치지 않고 만든
  // 회차라 공식화 훅이 돌지 않으므로 스냅샷을 직접 심는다(장비가 한 일과 같은 결과).
  // 저장·처리만 보는 테스트에는 필요 없어서 기본값은 끔 — 매 픽스처가 느려진다.
  if (withSnapshots) {
    await enableTextAiConsent(caseRecord.id);
    for (const [index, sessionId] of sessionIds.entries()) {
      await seedMaskedSnapshot(sessionId, memos[index] ?? '');
    }
  }

  return { caseId: caseRecord.id, supportCaseId, sessionIds };
}

describe('validateDiscrepancyDetectionOutput — 인용 원문 강제·판단 금지 (R5·R3)', () => {
  const request: DiscrepancyDetectionRequest = validateDiscrepancyDetectionRequest({
    triggerRef: '00000000-0000-4000-8000-000000000002',
    sources: [
      { sourceRef: '00000000-0000-4000-8000-000000000001', text: '채무는 은행 대출뿐이라고 말함' },
      { sourceRef: '00000000-0000-4000-8000-000000000002', text: '지인 채무 상환이 밀려 있음. 이번 달 지출은 정리함. 지출 내역은 아직 정리 전임.' },
    ],
  });
  const trigger = request.triggerRef;
  const prior = '00000000-0000-4000-8000-000000000001';

  it('원문 인용 쌍(회차 간·회차 내)은 통과한다', () => {
    const output = validateDiscrepancyDetectionOutput({
      discrepancies: [
        {
          kind: 'cross_session',
          leftRef: prior,
          leftQuote: '채무는 은행 대출뿐이라고 말함',
          rightRef: trigger,
          rightQuote: '지인 채무 상환이 밀려 있음',
        },
        {
          kind: 'within_session',
          leftRef: trigger,
          leftQuote: '이번 달 지출은 정리함',
          rightRef: trigger,
          rightQuote: '지출 내역은 아직 정리 전임',
        },
      ],
    }, request);
    expect(output.discrepancies).toHaveLength(2);
  });

  it('빈 목록은 정상 결과다', () => {
    expect(validateDiscrepancyDetectionOutput({ discrepancies: [] }, request).discrepancies).toHaveLength(0);
  });

  it('소스 원문에 없는 인용은 거부한다 — 지어낸 문장은 인용이 아니다', () => {
    expect(() => validateDiscrepancyDetectionOutput({
      discrepancies: [{
        kind: 'cross_session',
        leftRef: prior,
        leftQuote: '소스에 존재하지 않는 문장',
        rightRef: trigger,
        rightQuote: '지인 채무 상환이 밀려 있음',
      }],
    }, request)).toThrowError(AiProviderProhibitedOutputError);
  });

  it('트리거 회차가 끼지 않은 쌍은 거부한다', () => {
    expect(() => validateDiscrepancyDetectionOutput({
      discrepancies: [{
        kind: 'within_session',
        leftRef: prior,
        leftQuote: '채무는 은행 대출뿐이라고 말함',
        rightRef: prior,
        rightQuote: '채무는 은행 대출뿐이라고 말함',
      }],
    }, request)).toThrowError(AiProviderProhibitedOutputError);
  });

  it('유형·회차 모순(within 인데 서로 다른 회차)은 거부한다', () => {
    expect(() => validateDiscrepancyDetectionOutput({
      discrepancies: [{
        kind: 'within_session',
        leftRef: prior,
        leftQuote: '채무는 은행 대출뿐이라고 말함',
        rightRef: trigger,
        rightQuote: '지인 채무 상환이 밀려 있음',
      }],
    }, request)).toThrowError(AiProviderProhibitedOutputError);
  });

  it('판단·해석 필드가 붙으면 거부한다 (R5)', () => {
    expect(() => validateDiscrepancyDetectionOutput({
      discrepancies: [{
        kind: 'cross_session',
        leftRef: prior,
        leftQuote: '채무는 은행 대출뿐이라고 말함',
        rightRef: trigger,
        rightQuote: '지인 채무 상환이 밀려 있음',
        verdict: 'left is wrong',
      }],
    }, request)).toThrowError(AiProviderProhibitedOutputError);
  });
});

describe('collectDiscrepancyDetectionSources — 공식 텍스트 수집·가명 처리 (R2·R3)', () => {
  it('회차별 수기 메모를 오래된 순으로 모으고 등록 실명은 가명 ID 로 치환한다', async () => {
    const fixture = await createCaseWithSessions([
      '홍길동 님은 채무가 은행 대출뿐이라고 말함',
      '홍길동 님이 지인 채무 상환이 밀려 있다고 말함',
    ], true);
    await updateParticipantPii(t.env, counselor, fixture.caseId, {
      supportCaseContextId: fixture.supportCaseId,
      expectedVersion: 1,
      name: '홍길동',
    });

    const material = await collectDiscrepancyDetectionSources(t.env, counselor, fixture.sessionIds[1] ?? '');
    expect(material.supportCaseId).toBe(fixture.supportCaseId);
    expect(material.triggerSessionId).toBe(fixture.sessionIds[1]);
    expect(material.sources.map((source) => source.sessionId)).toEqual(fixture.sessionIds);
    for (const source of material.sources) {
      expect(source.text).not.toContain('홍길동');
      expect(source.text).toContain(fixture.caseId);
    }
    // PII 복호화 감사(D14)가 남는다.
    const audit = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'decrypt_pii' AND target_table = 'pii_vault' AND detail LIKE '%discrepancy_detection_masking%'",
    ).first<{ count: number }>();
    expect(Number(audit?.count ?? 0)).toBeGreaterThan(0);
  });

  // ADR-0027 의 핵심 보증 — 이 테스트가 깨지면 1차 치환만 거친 메모가 사업자로 나간다.
  it('2차 마스킹 스냅샷이 없는 회차는 재료에서 빠진다 (R3)', async () => {
    const fixture = await createCaseWithSessions(['아들 김철수가 보증을 섰다고 말함'], true);
    const later = await createManualSession(t.env, counselor, fixture.caseId, {
      submissionId: submissionId(),
      heldAt: '2026-07-09T10:00:00.000Z',
      channel: 'in_person',
      memo: '아들 김철수 연락처를 받아 적음',
      gasScores: [],
    });

    // 스냅샷이 있는 회차만 재료다 — 방금 만든 회차의 메모 원문은 나가지 않는다.
    const material = await collectDiscrepancyDetectionSources(t.env, counselor, fixture.sessionIds[0] ?? '');
    expect(material.sources.map((source) => source.sessionId)).toEqual([fixture.sessionIds[0]]);
    expect(JSON.stringify(material.sources)).not.toContain('연락처를 받아 적음');

    // 트리거 회차 자체에 스냅샷이 없으면 재료가 비어 호출자가 검출을 스킵한다.
    const skipped = await collectDiscrepancyDetectionSources(t.env, counselor, later.id);
    expect(skipped.sources.some((source) => source.sessionId === later.id)).toBe(false);
  });

  // 큐는 삭제가 없다(0029) — 처리할 수 없는 행을 내보내면 장비가 매 폴링마다 같은 행에
  // 걸려 실패하고 큐가 영원히 쌓인다. 조건이 갖춰질 때까지 안 보이는 것이 계약이다.
  it('② 동의 근거가 없으면 텍스트 일감이 장비에 보이지 않는다', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모']);
    t.env.TEXT_AI_PILOT_ENABLED = '1';
    await enqueueTextWorkItem(t.env, counselor, fixture.sessionIds[0] ?? '', 'manual_record');

    const before = await listTextWorkItems(t.env, service);
    expect(before).toHaveLength(0);

    // ② 를 기록하는 순간 같은 행이 저절로 보인다 — 큐를 다시 쌓을 필요가 없다.
    await enableTextAiConsent(fixture.caseId);
    const after = await listTextWorkItems(t.env, service);
    expect(after.map((item) => item.sessionId)).toEqual([fixture.sessionIds[0]]);

    // 파일럿이 꺼져 있으면 스냅샷 저장이 전부 거부되므로 역시 내보내지 않는다.
    delete t.env.TEXT_AI_PILOT_ENABLED;
    expect(await listTextWorkItems(t.env, service)).toHaveLength(0);
  });

  it('비담당 실무자는 수집할 수 없다 (D7)', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모']);
    await expect(
      collectDiscrepancyDetectionSources(t.env, testActors.unassignedCounselor, fixture.sessionIds[0] ?? ''),
    ).rejects.toThrowError(ForbiddenError);
  });
});

describe('replaceSessionDiscrepancies — 저장·교체·불변 (ADR-0018)', () => {
  it('저장 후 재검출은 미처리 행만 교체하고 처리된 행은 남긴다', async () => {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모']);
    const [first, second] = fixture.sessionIds;
    const stored = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [
      {
        kind: 'cross_session',
        leftSessionId: first ?? '',
        leftQuote: '첫 메모',
        rightSessionId: second ?? '',
        rightQuote: '둘째 메모',
      },
      {
        kind: 'within_session',
        leftSessionId: second ?? '',
        leftQuote: '둘째 메모',
        rightSessionId: second ?? '',
        rightQuote: '둘째 메모',
      },
    ]);
    expect(stored).toHaveLength(2);
    expect(stored.every((row) => row.resolutionStatus === null)).toBe(true);

    // 한 행을 처리 상태로 — 처리 3컬럼만 바꾸는 UPDATE 는 트리거가 허용한다(CCC-42 경로).
    await t.db.prepare(
      `UPDATE session_discrepancies
       SET resolution_status = 'confirmed', resolved_by = ?, resolved_at = '2026-07-29T00:00:00.000Z'
       WHERE id = ?`,
    ).bind(counselor.userId, stored[0]?.id ?? '').run();

    const replaced = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', []);
    expect(replaced).toHaveLength(0);
    const remaining = await t.db.prepare(
      'SELECT id, resolution_status FROM session_discrepancies WHERE trigger_session_id = ?',
    ).bind(second).all<{ id: string; resolution_status: string | null }>();
    // 미처리 1건은 지워지고 처리된 1건만 이력으로 남는다.
    expect(remaining.results).toHaveLength(1);
    expect(remaining.results[0]?.id).toBe(stored[0]?.id);
    expect(remaining.results[0]?.resolution_status).toBe('confirmed');
  });

  it('인용·회차는 DB 트리거로도 불변이고 처리된 행은 삭제되지 않는다', async () => {
    const fixture = await createCaseWithSessions(['첫 메모']);
    const trigger = fixture.sessionIds[0] ?? '';
    const [row] = await replaceSessionDiscrepancies(t.env, counselor, trigger, [{
      kind: 'within_session',
      leftSessionId: trigger,
      leftQuote: '첫 메모',
      rightSessionId: trigger,
      rightQuote: '첫 메모',
    }]);
    await expect(
      t.db.prepare('UPDATE session_discrepancies SET left_quote = ? WHERE id = ?')
        .bind('조작된 인용', row?.id ?? '').run(),
    ).rejects.toThrowError(/immutable/);

    await t.db.prepare(
      `UPDATE session_discrepancies
       SET resolution_status = 'record_error', resolved_by = 'x', resolved_at = '2026-07-29T00:00:00.000Z'
       WHERE id = ?`,
    ).bind(row?.id ?? '').run();
    await expect(
      t.db.prepare('DELETE FROM session_discrepancies WHERE id = ?').bind(row?.id ?? '').run(),
    ).rejects.toThrowError(/retained history/);
  });

  it('트리거 회차가 끼지 않은 쌍·타 케이스 회차·과길이 인용은 저장을 거부한다', async () => {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모', '셋째 메모']);
    const [first, second, third] = fixture.sessionIds;
    const other = await createCaseWithSessions(['다른 케이스 메모']);

    await expect(replaceSessionDiscrepancies(t.env, counselor, third ?? '', [{
      kind: 'cross_session',
      leftSessionId: first ?? '',
      leftQuote: '첫 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    }])).rejects.toThrowError(ValidationError);

    await expect(replaceSessionDiscrepancies(t.env, counselor, third ?? '', [{
      kind: 'cross_session',
      leftSessionId: other.sessionIds[0] ?? '',
      leftQuote: '다른 케이스 메모',
      rightSessionId: third ?? '',
      rightQuote: '셋째 메모',
    }])).rejects.toThrowError(ForbiddenError);

    await expect(replaceSessionDiscrepancies(t.env, counselor, third ?? '', [{
      kind: 'within_session',
      leftSessionId: third ?? '',
      leftQuote: 'ㅁ'.repeat(501),
      rightSessionId: third ?? '',
      rightQuote: '셋째 메모',
    }])).rejects.toThrowError(ValidationError);
  });

  it('같은 쌍이 다른 트리거 회차로 다시 검출돼도 한 건만 남는다 (중복 방지)', async () => {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모']);
    const [first, second] = fixture.sessionIds;
    const pair = {
      kind: 'cross_session' as const,
      leftSessionId: first ?? '',
      leftQuote: '첫 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    };
    // 검출은 수기 저장과 AI 초안 승인 양쪽에서 돌아가므로 트리거 회차가 달라질 수 있다.
    expect(await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [pair])).toHaveLength(1);
    expect(await replaceSessionDiscrepancies(t.env, counselor, first ?? '', [pair])).toHaveLength(0);

    const rows = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM session_discrepancies WHERE support_case_id = ? AND resolution_status IS NULL',
    ).bind(fixture.supportCaseId).first<{ count: number }>();
    expect(Number(rows?.count ?? 0)).toBe(1);

    // 같은 트리거의 재검출은 교체다 — 지운 자리에 다시 넣는다(중복 방지가 교체를 막지 않는다).
    expect(await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [pair])).toHaveLength(1);
    const after = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM session_discrepancies WHERE support_case_id = ? AND resolution_status IS NULL',
    ).bind(fixture.supportCaseId).first<{ count: number }>();
    expect(Number(after?.count ?? 0)).toBe(1);
  });

  it('저장은 감사 로그(create)를 남긴다 (D14)', async () => {
    const fixture = await createCaseWithSessions(['첫 메모']);
    const trigger = fixture.sessionIds[0] ?? '';
    await replaceSessionDiscrepancies(t.env, counselor, trigger, [{
      kind: 'within_session',
      leftSessionId: trigger,
      leftQuote: '첫 메모',
      rightSessionId: trigger,
      rightQuote: '첫 메모',
    }]);
    const audit = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'create' AND target_table = 'session_discrepancies' AND target_id = ?",
    ).bind(trigger).first<{ count: number }>();
    expect(Number(audit?.count ?? 0)).toBe(1);
  });
});

describe('getParticipantBriefing — 영역 ③은 저장된 결과만 읽는다', () => {
  it('미처리·처리됨을 상담일과 함께 싣고 미처리를 앞세운다 (CCC-42)', async () => {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모']);
    const [first, second] = fixture.sessionIds;
    const stored = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [
      {
        kind: 'cross_session',
        leftSessionId: first ?? '',
        leftQuote: '첫 메모',
        rightSessionId: second ?? '',
        rightQuote: '둘째 메모',
      },
      {
        kind: 'within_session',
        leftSessionId: second ?? '',
        leftQuote: '둘째 메모',
        rightSessionId: second ?? '',
        rightQuote: '둘째 메모',
      },
    ]);
    await t.db.prepare(
      `UPDATE session_discrepancies
       SET resolution_status = 'situation_changed', resolved_by = 'x', resolved_at = '2026-07-29T00:00:00.000Z'
       WHERE id = ?`,
    ).bind(stored[1]?.id ?? '').run();

    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    // 처리된 항목도 함께 온다 — 화면이 접힌 이력으로 내린다(ADR-0018: 삭제되지 않는다).
    expect(briefing.discrepancies).toHaveLength(2);
    const item = briefing.discrepancies[0];
    // 미처리가 앞이다 — 화면이 정렬을 다시 만들지 않아도 되게.
    expect(item?.resolution).toBeNull();
    expect(item?.kind).toBe('cross_session');
    expect(item?.left.sessionId).toBe(first);
    expect(item?.left.heldAt).toBe('2026-07-01T10:00:00.000Z');
    expect(item?.left.quote).toBe('첫 메모');
    expect(item?.right.sessionId).toBe(second);
    expect(item?.right.quote).toBe('둘째 메모');

    const resolved = briefing.discrepancies[1];
    expect(resolved?.id).toBe(stored[1]?.id);
    expect(resolved?.resolution).toEqual({
      status: 'situation_changed',
      resolvedAt: '2026-07-29T00:00:00.000Z',
    });
    // 처리자 userId 는 화면에 쓰지 않으므로 응답에 싣지 않는다 — 감사에만 남는다(D14).
    expect(resolved).not.toHaveProperty('resolvedBy');
  });

  it('상담 기록 조회가 각 회차에 걸린 불일치 연결을 함께 싣는다 (D73)', async () => {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모']);
    const [first, second] = fixture.sessionIds;
    const [stored] = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [{
      kind: 'cross_session',
      leftSessionId: first ?? '',
      leftQuote: '첫 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    }]);

    const records = await listCounselingRecords(t.env, counselor, fixture.supportCaseId);
    const firstRecord = records.find((record) => record.id === first);
    const secondRecord = records.find((record) => record.id === second);
    const expected = [{
      id: stored?.id,
      kind: 'cross_session',
      leftSessionId: first,
      rightSessionId: second,
      resolutionStatus: null,
    }];
    expect(firstRecord?.discrepancies).toEqual(expected);
    expect(secondRecord?.discrepancies).toEqual(expected);
  });

  it('처리된 이력은 최근 20건까지만 싣고 미처리는 자르지 않는다', async () => {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모']);
    const [first, second] = fixture.sessionIds;
    // 처리된 이력 25건 — 게이트웨이는 한 번에 8건까지만 받으므로(DISCREPANCY_ITEM_LIMIT)
    // 상한을 넘기려면 직접 넣는다. 인용을 달리해 서로 다른 쌍으로 만든다.
    for (let index = 0; index < 25; index += 1) {
      await t.db.prepare(
        `INSERT INTO session_discrepancies (
           id, org_id, support_case_id, kind, trigger_session_id,
           left_session_id, left_quote, right_session_id, right_quote,
           detected_at, resolution_status, resolved_by, resolved_at, created_at
         ) VALUES (?, ?, ?, 'cross_session', ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        counselor.orgId,
        fixture.supportCaseId,
        second ?? '',
        first ?? '',
        `첫 메모 ${index}`,
        second ?? '',
        `둘째 메모 ${index}`,
        '2026-07-20T00:00:00.000Z',
        counselor.userId,
        // 처리 시각을 벌려 '최근 20건'의 경계를 확인할 수 있게 한다.
        `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        '2026-07-20T00:00:00.000Z',
      ).run();
    }
    const unresolved = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [{
      kind: 'within_session',
      leftSessionId: second ?? '',
      leftQuote: '둘째 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    }]);
    expect(unresolved).toHaveLength(1);

    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    const resolvedItems = briefing.discrepancies.filter((item) => item.resolution !== null);
    const openItems = briefing.discrepancies.filter((item) => item.resolution === null);
    expect(openItems).toHaveLength(1);
    expect(resolvedItems).toHaveLength(20);
    // 잘린 5건은 가장 오래 전에 처리한 것들이다 — 2026-07-01~05.
    const oldest = resolvedItems
      .map((item) => item.resolution?.resolvedAt ?? '')
      .sort()[0];
    expect(oldest).toBe('2026-07-06T00:00:00.000Z');

    const records = await listCounselingRecords(t.env, counselor, fixture.supportCaseId);
    const recordDiscrepancyIds = new Set(
      records.flatMap((record) => record.discrepancies.map((item) => item.id)),
    );
    const briefingDiscrepancyIds = new Set(briefing.discrepancies.map((item) => item.id));
    expect(recordDiscrepancyIds).toEqual(briefingDiscrepancyIds);
  });
});

// ── 처리 3종 (CCC-42) ────────────────────────────────────────────────────────

describe('resolveSessionDiscrepancy — 처리 3종·원본 불변·감사 (CCC-42)', () => {
  async function storedPair(): Promise<{
    caseId: string;
    supportCaseId: string;
    sessionIds: string[];
    id: string;
  }> {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모']);
    const [first, second] = fixture.sessionIds;
    const [row] = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [{
      kind: 'cross_session',
      leftSessionId: first ?? '',
      leftQuote: '첫 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    }]);
    if (row === undefined) throw new Error('expected a stored discrepancy');
    return { ...fixture, id: row.id };
  }

  it('처리 3종을 저장하고 처리자·시각을 남기며 원본(인용·회차)은 그대로다', async () => {
    for (const status of ['situation_changed', 'record_error', 'confirmed'] as const) {
      const fixture = await storedPair();
      const resolved = await resolveSessionDiscrepancy(t.env, counselor, fixture.id, status);
      expect(resolved.resolutionStatus).toBe(status);
      expect(resolved.resolvedBy).toBe(counselor.userId);
      expect(resolved.resolvedAt).not.toBeNull();
      // 처리는 표시일 뿐 — 인용·회차는 그대로다(ADR-0018).
      expect(resolved.leftQuote).toBe('첫 메모');
      expect(resolved.rightQuote).toBe('둘째 메모');
      expect(resolved.leftSessionId).toBe(fixture.sessionIds[0]);
      await t.reset();
    }
  });

  it('처리 종류는 다시 바꿀 수 있고 바꾼 전건이 감사에 남는다 (D14 · Q 결정)', async () => {
    const fixture = await storedPair();
    await resolveSessionDiscrepancy(t.env, counselor, fixture.id, 'confirmed');
    const changed = await resolveSessionDiscrepancy(t.env, counselor, fixture.id, 'record_error');
    expect(changed.resolutionStatus).toBe('record_error');

    const audit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE action = 'resolve_discrepancy' AND target_id = ?
       ORDER BY id`,
    ).bind(fixture.id).all<{ detail: string }>();
    expect(audit.results).toHaveLength(2);
    expect(JSON.parse(audit.results[0]?.detail ?? '{}')).toMatchObject({
      status: 'confirmed',
      previousStatus: null,
    });
    expect(JSON.parse(audit.results[1]?.detail ?? '{}')).toMatchObject({
      status: 'record_error',
      previousStatus: 'confirmed',
    });
  });

  it('처리 종류 값이 아니면 거부하고 없는 항목은 열지 않는다', async () => {
    const fixture = await storedPair();
    await expect(
      resolveSessionDiscrepancy(t.env, counselor, fixture.id, 'wrong' as never),
    ).rejects.toThrowError(ValidationError);
    await expect(
      resolveSessionDiscrepancy(t.env, counselor, crypto.randomUUID(), 'confirmed'),
    ).rejects.toThrowError(ForbiddenError);
  });

  it('비담당 실무자와 다른 기관 실무자는 실제 항목도 처리할 수 없다 (D7)', async () => {
    const fixture = await storedPair();
    for (const stranger of [testActors.unassignedCounselor, testActors.otherOrgCounselor]) {
      await expect(
        resolveSessionDiscrepancy(t.env, stranger, fixture.id, 'confirmed'),
      ).rejects.toThrowError(ForbiddenError);
      await expect(
        listRecordErrorSessionIds(t.env, stranger, fixture.supportCaseId),
      ).rejects.toThrowError(ForbiddenError);
    }
    // 거절은 아무것도 바꾸지 않는다 — 처리 3컬럼은 그대로 비어 있다.
    const row = await t.db.prepare('SELECT resolution_status FROM session_discrepancies WHERE id = ?')
      .bind(fixture.id).first<{ resolution_status: string | null }>();
    expect(row?.resolution_status).toBeNull();
  });

  it('담당이 아닌 기관 관리자는 불일치를 처리할 수 없다 (D74)', async () => {
    const fixture = await storedPair();
    await expect(
      resolveSessionDiscrepancy(t.env, admin, fixture.id, 'confirmed'),
    ).rejects.toThrowError(ForbiddenError);
    const row = await t.db.prepare(
      'SELECT resolution_status, resolved_by FROM session_discrepancies WHERE id = ?',
    ).bind(fixture.id).first<{ resolution_status: string | null; resolved_by: string | null }>();
    expect(row).toEqual({ resolution_status: null, resolved_by: null });
  });

  it("'기록 오류' 처리는 원본을 지우지 않고 그 회차를 표시 대상으로만 올린다", async () => {
    const fixture = await storedPair();
    expect(await listRecordErrorSessionIds(t.env, counselor, fixture.supportCaseId)).toEqual([]);
    await resolveSessionDiscrepancy(t.env, counselor, fixture.id, 'record_error');
    // 0027 에 어느 쪽이 오류인지 담는 칸이 없어 쌍의 양쪽 회차가 모두 표시 대상이다.
    expect(new Set(await listRecordErrorSessionIds(t.env, counselor, fixture.supportCaseId)))
      .toEqual(new Set([fixture.sessionIds[0], fixture.sessionIds[1]]));
    // 원본 회차(수기 메모)는 그대로다.
    const session = await t.db.prepare('SELECT memo FROM sessions WHERE id = ?')
      .bind(fixture.sessionIds[0]).first<{ memo: string }>();
    expect(session?.memo).toBe('첫 메모');
  });

  it('이미 처리한 쌍은 재검출이 다시 올리지 않는다 (Q 결정 — 중복 처리 방지)', async () => {
    const fixture = await storedPair();
    await resolveSessionDiscrepancy(t.env, counselor, fixture.id, 'confirmed');
    const [first, second] = fixture.sessionIds;
    const again = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [{
      kind: 'cross_session',
      leftSessionId: first ?? '',
      leftQuote: '첫 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    }]);
    expect(again).toHaveLength(0);
    const rows = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM session_discrepancies WHERE support_case_id = ?',
    ).bind(fixture.supportCaseId).first<{ count: number }>();
    expect(Number(rows?.count ?? 0)).toBe(1);

    // 좌우가 뒤집혀 와도 같은 쌍이다 — 어느 쪽이 left 인지는 프로바이더가 그때 정한다.
    const swapped = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [{
      kind: 'cross_session',
      leftSessionId: second ?? '',
      leftQuote: '둘째 메모',
      rightSessionId: first ?? '',
      rightQuote: '첫 메모',
    }]);
    expect(swapped).toHaveLength(0);

    // 인용이 다르면 다른 건이므로 새로 올라온다.
    const different = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [{
      kind: 'within_session',
      leftSessionId: second ?? '',
      leftQuote: '둘째 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    }]);
    expect(different).toHaveLength(1);
  });
});

// ── 라우트 훅 — 공식화 시점 검출 실행 (D8: 실패해도 저장은 성공) ─────────────────────

const fakeProviderConfig: AiProviderConfig = {
  registryVersion: 'phase1.v1',
  providerId: 'codex',
  adapterVersion: 'v1',
  configVersion: 'test-config',
  model: 'test-model',
};

function fakeDetectionAdapter(
  detect: (request: DiscrepancyDetectionRequest) => Promise<unknown>,
): AiProviderTestAdapter {
  return {
    providerId: 'codex',
    adapterVersion: 'v1',
    testOnly: true,
    config: fakeProviderConfig,
    generate: async (_request: AiProviderRequest): Promise<AiProviderOutput> => {
      throw new Error('generate is not under test');
    },
    detectDiscrepancies: detect,
  };
}

function counselorHeaders(): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': counselor.userId,
    'X-CCC-Org-Id': counselor.orgId,
    'X-CCC-Role': 'counselor',
  };
}

async function postManualRecord(supportCaseId: string, memo: string, sequence: number): Promise<Response> {
  return worker.fetch(new Request(`https://api.test/support-cases/${supportCaseId}/records`, {
    method: 'POST',
    headers: counselorHeaders(),
    body: JSON.stringify({
      submissionId: submissionId(),
      heldAt: `2026-07-1${sequence}T10:00:00.000Z`,
      channel: 'in_person',
      memo,
      gasScores: [],
      actions: [],
      flags: [],
    }),
  }), t.env);
}

async function enableTextAiConsent(caseId: string): Promise<void> {
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  await recordPilotTextAiConsentEvidence(t.env, counselor, caseId, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: SHA256,
    evidenceRef: `r2://pilot-evidence/${caseId}`,
    evidenceSha256: 'f'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });
  // CCC-110: 사용 허용은 support_cases.consent_text_ai_at 이 결정한다 — 근거 행과 별개로 세운다.
  await t.db.prepare(
    'UPDATE support_cases SET consent_text_ai_at = ? WHERE legacy_case_id = ? OR id = ?',
  ).bind('2026-01-01T00:00:00.000Z', caseId, caseId).run();
}

describe('라우트 훅 — 수기 저장 시 검출·저장 (CCC-43 수용 기준)', () => {
  it('수기 메모 저장 → 장비 마스킹 → 검출 결과가 브리핑에 나타난다', async () => {
    const fixture = await createCaseWithSessions(['첫 상담에서 채무는 은행 대출뿐이라고 말함'], true);
    await enableTextAiConsent(fixture.caseId);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async (request) => {
      const priorRef = request.sources[0]?.sourceRef ?? '';
      const priorText = request.sources[0]?.text ?? '';
      const triggerText = request.sources.find((source) => source.sourceRef === request.triggerRef)?.text ?? '';
      return {
        discrepancies: [{
          kind: 'cross_session',
          leftRef: priorRef,
          leftQuote: priorText,
          rightRef: request.triggerRef,
          rightQuote: triggerText,
        }],
      };
    });

    const response = await postManualRecord(fixture.supportCaseId, '지인 채무 상환이 밀려 있다고 말함', 2);
    expect(response.status).toBe(201);
    // 저장 시점에는 스냅샷이 없어 검출이 스킵된다 — 장비가 마스킹을 마쳐야 돈다(ADR-0027).
    expect(await runDeviceTextJobs()).toBe(1);

    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    expect(briefing.discrepancies).toHaveLength(1);
    expect(briefing.discrepancies[0]?.kind).toBe('cross_session');
    expect(briefing.discrepancies[0]?.left.quote).toContain('은행 대출뿐');
    expect(briefing.discrepancies[0]?.right.quote).toContain('지인 채무 상환');
    // 검출 경로 PII 미유입(R3) — 프로바이더에 간 텍스트는 가명 처리본이라 인용도 실명이 없다.
    expect(JSON.stringify(briefing.discrepancies)).not.toContain('홍길동');
  });

  it('프로바이더 실패는 스킵일 뿐 기록 저장은 성공한다 (D8)', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모'], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async () => {
      throw new Error('provider down');
    });

    const response = await postManualRecord(fixture.supportCaseId, '둘째 상담 메모', 2);
    expect(response.status).toBe(201);
    await runDeviceTextJobs();
    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    expect(briefing.discrepancies).toHaveLength(0);
  });

  it('텍스트 AI 동의가 없으면 검출을 건너뛰고 저장만 된다 (D15)', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모']);
    t.env.TEXT_AI_PILOT_ENABLED = '1';
    let called = false;
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async () => {
      called = true;
      return { discrepancies: [] };
    });

    const response = await postManualRecord(fixture.supportCaseId, '둘째 상담 메모', 2);
    expect(response.status).toBe(201);
    expect(called).toBe(false);
  });

  it('판단이 섞인 프로바이더 출력은 저장되지 않는다 (R5 fail-closed)', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모'], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async (request) => ({
      discrepancies: [{
        kind: 'within_session',
        leftRef: request.triggerRef,
        leftQuote: '소스에 없는 지어낸 인용',
        rightRef: request.triggerRef,
        rightQuote: '소스에 없는 지어낸 인용',
      }],
    }));

    const response = await postManualRecord(fixture.supportCaseId, '둘째 상담 메모', 2);
    expect(response.status).toBe(201);
    await runDeviceTextJobs();
    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    expect(briefing.discrepancies).toHaveLength(0);
  });

  it('담당이 아닌 기관 관리자는 검출 결과 브리핑을 열람할 수 없다 (D74)', async () => {
    const fixture = await createCaseWithSessions(['첫 메모']);
    const trigger = fixture.sessionIds[0] ?? '';
    await replaceSessionDiscrepancies(t.env, counselor, trigger, [{
      kind: 'within_session',
      leftSessionId: trigger,
      leftQuote: '첫 메모',
      rightSessionId: trigger,
      rightQuote: '첫 메모',
    }]);
    await expect(
      getParticipantBriefing(t.env, admin, fixture.caseId, fixture.supportCaseId),
    ).rejects.toThrowError(ForbiddenError);
  });
});

/**
 * CCC-47 — 실측(2026-07-31)에서 스냅샷 POST 는 ok 로 끝나고 예외·로그가 0건이었다.
 * "불일치 0건"이 정상인지 고장인지 바깥에서 구분할 수 없다는 뜻이다. 아래는 그 다섯
 * 상황이 감사 기록에서 **서로 다른 값**으로 남는지, 그리고 그 기록에 상담 내용이
 * 섞이지 않는지(R3)를 본다.
 */
describe('AI 호출 관측 — 시도·실패 사유·저장 건수 (CCC-47)', () => {
  interface AiCallDetail {
    kind: string;
    outcome: string;
    reason?: string;
    status?: number;
    sourceCount?: number;
    storedCount?: number;
    durationMs?: number;
    model?: string;
    promptVersion?: string;
  }

  /** 이 회차에 남은 ai_call 기록을 시간순으로. 마지막이 가장 최근 시도다. */
  async function aiCalls(sessionId: string): Promise<AiCallDetail[]> {
    const rows = await t.db.prepare(
      "SELECT detail FROM audit_log WHERE action = 'ai_call' AND target_id = ? ORDER BY id",
    ).bind(sessionId).all<{ detail: string }>();
    return rows.results.map((row) => JSON.parse(row.detail) as AiCallDetail);
  }

  /** 마지막 시도의 원문 감사 행 — 내용 유입 검사(R3)는 detail 문자열 전체를 본다. */
  async function lastAiCallRaw(sessionId: string): Promise<string> {
    const row = await t.db.prepare(
      "SELECT detail FROM audit_log WHERE action = 'ai_call' AND target_id = ? ORDER BY id DESC LIMIT 1",
    ).bind(sessionId).first<{ detail: string }>();
    return row?.detail ?? '';
  }

  /** 마지막 회차 id — 라우트가 만든 회차는 응답 본문에서 받는다. */
  async function postAndSession(supportCaseId: string, memo: string, sequence: number): Promise<string> {
    const response = await postManualRecord(supportCaseId, memo, sequence);
    expect(response.status).toBe(201);
    const body = await response.json() as { record?: { id?: string } };
    const sessionId = body.record?.id;
    if (sessionId === undefined) throw new Error(`unexpected record response: ${JSON.stringify(body)}`);
    return sessionId;
  }

  it('① 사업자 미설정은 provider_unavailable/config_missing 으로 남는다', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모'], true);
    // 주입 어댑터를 치우면 실제 해석 경로가 돈다 — 설정도 키도 없는 운영 초기 상태다.
    delete t.env.AI_PROVIDER_ADAPTER;
    delete t.env.AI_PROVIDER_CONFIG;

    const sessionId = await postAndSession(fixture.supportCaseId, '둘째 상담 메모', 2);
    await runDeviceTextJobs();

    const calls = await aiCalls(sessionId);
    expect(calls.at(-1)?.outcome).toBe('provider_unavailable');
    expect(calls.at(-1)?.reason).toBe('config_missing');
  });

  it('② 키 오류(401)와 ③ 모델명 오류(404)는 상태 코드로 갈린다', async () => {
    // 어댑터 단위로 본다 — 이 둘을 가르는 것은 오직 응답 코드다(CCC-47 완료 기준 1).
    const config: AiProviderConfig = { ...fakeProviderConfig, registryVersion: 'phase1.v1' };
    const responder = (status: number): typeof fetch => (async () => new Response('{}', { status })) as unknown as typeof fetch;

    for (const status of [401, 404]) {
      const adapter = new CodexProviderAdapter(config, 'test-key', responder(status));
      const error = await adapter.detectDiscrepancies({
        triggerRef: crypto.randomUUID(),
        sources: [{ sourceRef: crypto.randomUUID(), text: '본문' }],
      }).then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(AiProviderUnavailableError);
      expect((error as AiProviderUnavailableError).reason).toBe('http_status');
      expect((error as AiProviderUnavailableError).status).toBe(status);
    }

    // 망 장애는 상태 코드 자체가 없다 — 같은 값으로 뭉뚱그려지지 않는다.
    const unreachable = new CodexProviderAdapter(config, 'test-key', (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch);
    const networkError = await unreachable.detectDiscrepancies({
      triggerRef: crypto.randomUUID(),
      sources: [{ sourceRef: crypto.randomUUID(), text: '본문' }],
    }).then(() => null, (caught: unknown) => caught);
    expect((networkError as AiProviderUnavailableError).reason).toBe('network');
    expect((networkError as AiProviderUnavailableError).status).toBeUndefined();
  });

  it('②③ 그 상태 코드가 감사 기록까지 그대로 간다 — 401 과 404 가 다른 줄로 남는다', async () => {
    // 위 테스트는 어댑터가 무엇을 던지는지까지만 본다. 기록 경로가 그 숫자를 보존하는지는
    // 별개이고, 이것이 완료 기준 1 이 실제로 서는 자리다.
    for (const status of [401, 404]) {
      const fixture = await createCaseWithSessions(['첫 상담 메모'], true);
      t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async () => {
        throw new AiProviderUnavailableError('http_status', status);
      });

      const sessionId = await postAndSession(fixture.supportCaseId, '둘째 상담 메모', 2);
      await runDeviceTextJobs();

      const last = (await aiCalls(sessionId)).at(-1);
      // 설정이 없어 못 부른 것(provider_unavailable)과 달리 불렀는데 실패한 것이다.
      expect(last?.outcome).toBe('provider_error');
      expect(last?.reason).toBe('http_status');
      expect(last?.status).toBe(status);
    }
  });

  it('④ 인용 검증 실패는 output_rejected 로 남는다 — 정상 빈 결과와 다르다', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모'], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async (request) => ({
      discrepancies: [{
        kind: 'within_session',
        leftRef: request.triggerRef,
        leftQuote: '소스에 없는 지어낸 인용',
        rightRef: request.triggerRef,
        rightQuote: '소스에 없는 지어낸 인용',
      }],
    }));

    const sessionId = await postAndSession(fixture.supportCaseId, '둘째 상담 메모', 2);
    await runDeviceTextJobs();

    const calls = await aiCalls(sessionId);
    expect(calls.at(-1)?.outcome).toBe('output_rejected');
    expect(calls.at(-1)?.storedCount).toBeUndefined();
  });

  it('⑤ 정상 빈 결과는 empty 로, 저장된 결과는 stored 와 건수로 남는다', async () => {
    const empty = await createCaseWithSessions(['첫 상담 메모'], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async () => ({ discrepancies: [] }));
    const emptySession = await postAndSession(empty.supportCaseId, '둘째 상담 메모', 2);
    await runDeviceTextJobs();

    const emptyCalls = await aiCalls(emptySession);
    expect(emptyCalls.at(-1)?.outcome).toBe('empty');
    expect(emptyCalls.at(-1)?.storedCount).toBe(0);
    // 사업자를 실제로 불렀다는 사실이 남는다 — 재료 회차 수와 모델·프롬프트 판까지.
    expect(emptyCalls.at(-1)?.sourceCount).toBeGreaterThan(0);
    expect(emptyCalls.at(-1)?.model).toBe(fakeProviderConfig.model);
    expect(emptyCalls.at(-1)?.promptVersion).toBe(DISCREPANCY_PROMPT_VERSION);

    const stored = await createCaseWithSessions(['첫 상담에서 채무는 은행 대출뿐이라고 말함'], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async (request) => {
      const prior = request.sources[0];
      const triggerText = request.sources.find((source) => source.sourceRef === request.triggerRef)?.text ?? '';
      return {
        discrepancies: [{
          kind: 'cross_session',
          leftRef: prior?.sourceRef ?? '',
          leftQuote: prior?.text ?? '',
          rightRef: request.triggerRef,
          rightQuote: triggerText,
        }],
      };
    });
    const storedSession = await postAndSession(stored.supportCaseId, '지인 채무 상환이 밀려 있다고 말함', 2);
    await runDeviceTextJobs();

    const storedCalls = await aiCalls(storedSession);
    expect(storedCalls.at(-1)?.outcome).toBe('stored');
    expect(storedCalls.at(-1)?.storedCount).toBe(1);
  });

  it('스냅샷 대기는 저장 시점에 skipped_no_snapshot 으로 남는다 — "안 불렀다"가 보인다', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모'], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async () => ({ discrepancies: [] }));

    const sessionId = await postAndSession(fixture.supportCaseId, '둘째 상담 메모', 2);
    // 장비를 돌리기 전 = 트리거 회차에 2차 마스킹 스냅샷이 아직 없다.
    const beforeDevice = await aiCalls(sessionId);
    expect(beforeDevice).toHaveLength(1);
    expect(beforeDevice[0]?.outcome).toBe('skipped_no_snapshot');

    await runDeviceTextJobs();
    const afterDevice = await aiCalls(sessionId);
    expect(afterDevice).toHaveLength(2);
    expect(afterDevice[1]?.outcome).toBe('empty');
  });

  it('기록 어느 줄에도 상담 내용이 들어가지 않는다 (R3)', async () => {
    const secret = '지인에게 빌린 돈을 갚지 못하고 있다';
    const fixture = await createCaseWithSessions([secret], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async (request) => {
      const prior = request.sources[0];
      const triggerText = request.sources.find((source) => source.sourceRef === request.triggerRef)?.text ?? '';
      return {
        discrepancies: [{
          kind: 'cross_session',
          leftRef: prior?.sourceRef ?? '',
          leftQuote: prior?.text ?? '',
          rightRef: request.triggerRef,
          rightQuote: triggerText,
        }],
      };
    });

    const triggerMemo = '이자만 내고 원금은 그대로라고 말함';
    const sessionId = await postAndSession(fixture.supportCaseId, triggerMemo, 2);
    await runDeviceTextJobs();

    const detail = await lastAiCallRaw(sessionId);
    expect(detail.length).toBeGreaterThan(0);
    expect(detail).not.toContain(secret);
    expect(detail).not.toContain(triggerMemo);
    expect(detail).not.toContain('홍길동');
    // 남은 것은 분류·숫자·설정값뿐이라는 것을 키 목록으로 못 박는다.
    expect(Object.keys(JSON.parse(detail) as AiCallDetail).sort()).toEqual([
      'durationMs', 'kind', 'model', 'outcome', 'promptVersion', 'sourceCount', 'storedCount',
    ]);
  });

  it('실패 경로에서도 줄이 남고 기록 저장 응답은 그대로 201 이다 (D8)', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모'], true);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async () => {
      // 우리 오류 계층 밖의 예외 — 분류되지 않아도 사건 자체는 남아야 한다.
      throw new Error('provider down');
    });

    const sessionId = await postAndSession(fixture.supportCaseId, '둘째 상담 메모', 2);
    await runDeviceTextJobs();

    expect((await aiCalls(sessionId)).at(-1)?.outcome).toBe('failed_other');
    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    expect(briefing.discrepancies).toHaveLength(0);
  });
});

describe('라우트 — 처리 3종 엔드포인트 (CCC-42)', () => {
  async function storedPair(): Promise<{ supportCaseId: string; id: string; sessionIds: string[] }> {
    const fixture = await createCaseWithSessions(['첫 메모', '둘째 메모']);
    const [first, second] = fixture.sessionIds;
    const [row] = await replaceSessionDiscrepancies(t.env, counselor, second ?? '', [{
      kind: 'cross_session',
      leftSessionId: first ?? '',
      leftQuote: '첫 메모',
      rightSessionId: second ?? '',
      rightQuote: '둘째 메모',
    }]);
    if (row === undefined) throw new Error('expected a stored discrepancy');
    return { supportCaseId: fixture.supportCaseId, id: row.id, sessionIds: fixture.sessionIds };
  }

  async function putResolution(
    supportCaseId: string,
    discrepancyId: string,
    body: unknown,
  ): Promise<Response> {
    return worker.fetch(new Request(
      `https://api.test/support-cases/${supportCaseId}/discrepancies/${discrepancyId}/resolution`,
      { method: 'PUT', headers: counselorHeaders(), body: JSON.stringify(body) },
    ), t.env);
  }

  it('처리 요청이 저장되고 잘못된 값·주소 불일치는 거부된다', async () => {
    const fixture = await storedPair();
    const ok = await putResolution(fixture.supportCaseId, fixture.id, { status: 'record_error' });
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ resolutionStatus: 'record_error' });

    expect((await putResolution(fixture.supportCaseId, fixture.id, { status: 'nope' })).status).toBe(400);

    // 주소의 참여 사업이 그 항목의 소속과 다르면 통과시키지 않는다.
    const other = await createCaseWithSessions(['다른 케이스 메모']);
    expect((await putResolution(other.supportCaseId, fixture.id, { status: 'confirmed' })).status).toBe(403);

    // 거절은 상태를 바꾸지 않는다 — 검사가 저장보다 앞이라야 성립한다(403 이 기록을 바꾸면 안 된다).
    const row = await t.db.prepare('SELECT resolution_status FROM session_discrepancies WHERE id = ?')
      .bind(fixture.id).first<{ resolution_status: string | null }>();
    expect(row?.resolution_status).toBe('record_error');
    // 바뀌지 않았으니 처리 감사도 늘지 않는다(D14).
    const audit = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'resolve_discrepancy' AND target_id = ?",
    ).bind(fixture.id).first<{ count: number }>();
    expect(Number(audit?.count ?? 0)).toBe(1);
  });

  it("기록 목록 응답이 '기록 오류' 처리된 회차를 함께 싣는다", async () => {
    const fixture = await storedPair();
    await putResolution(fixture.supportCaseId, fixture.id, { status: 'record_error' });
    const response = await worker.fetch(new Request(
      `https://api.test/support-cases/${fixture.supportCaseId}/records?official=true`,
      { headers: counselorHeaders() },
    ), t.env);
    expect(response.status).toBe(200);
    const body = await response.json() as { recordErrorSessionIds: string[] };
    expect(new Set(body.recordErrorSessionIds)).toEqual(new Set(fixture.sessionIds));
  });
});
