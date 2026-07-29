// CCC-43 — 내용 불일치 검출·저장·표시 (D45 · ADR-0018)
// ① 프로바이더 출력 검증(원문 인용 강제·판단 금지, R5) ② 게이트웨이 저장·불변·브리핑
// ③ 라우트 훅(수기 저장 시 검출 실행, 실패해도 저장은 성공 — D8) 을 검증한다.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectDiscrepancyDetectionSources,
  createCase,
  createManualSession,
  ForbiddenError,
  getParticipantBriefing,
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

const { counselor, admin } = testActors;
const t = setupD1();
const SHA256 = 'a'.repeat(64);

// 테스트마다 독립 D1 — setupD1 계약상 reset() 이 컨텍스트를 만든다.
beforeEach(async () => {
  await t.reset();
});

// 제출 ID 는 케이스가 달라도 재사용하면 재생(replay)·유일성에 걸린다 — 매번 새로 발급.
function submissionId(): string {
  return crypto.randomUUID();
}

async function createCaseWithSessions(memos: string[]): Promise<{
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
    ]);
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

  it('기관 관리자도 처리할 수 있다 (D7 — 전체 목표의 "담당 실무자만"과 다른 층)', async () => {
    const fixture = await storedPair();
    const resolved = await resolveSessionDiscrepancy(t.env, admin, fixture.id, 'confirmed');
    expect(resolved.resolutionStatus).toBe('confirmed');
    expect(resolved.resolvedBy).toBe(admin.userId);
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
}

describe('라우트 훅 — 수기 저장 시 검출·저장 (CCC-43 수용 기준)', () => {
  it('수기 메모 저장이 검출을 실행해 결과가 브리핑에 나타난다', async () => {
    const fixture = await createCaseWithSessions(['첫 상담에서 채무는 은행 대출뿐이라고 말함']);
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

    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    expect(briefing.discrepancies).toHaveLength(1);
    expect(briefing.discrepancies[0]?.kind).toBe('cross_session');
    expect(briefing.discrepancies[0]?.left.quote).toContain('은행 대출뿐');
    expect(briefing.discrepancies[0]?.right.quote).toContain('지인 채무 상환');
    // 검출 경로 PII 미유입(R3) — 프로바이더에 간 텍스트는 가명 처리본이라 인용도 실명이 없다.
    expect(JSON.stringify(briefing.discrepancies)).not.toContain('홍길동');
  });

  it('프로바이더 실패는 스킵일 뿐 기록 저장은 성공한다 (D8)', async () => {
    const fixture = await createCaseWithSessions(['첫 상담 메모']);
    await enableTextAiConsent(fixture.caseId);
    t.env.AI_PROVIDER_ADAPTER = fakeDetectionAdapter(async () => {
      throw new Error('provider down');
    });

    const response = await postManualRecord(fixture.supportCaseId, '둘째 상담 메모', 2);
    expect(response.status).toBe(201);
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
    const fixture = await createCaseWithSessions(['첫 상담 메모']);
    await enableTextAiConsent(fixture.caseId);
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
    const briefing = await getParticipantBriefing(t.env, counselor, fixture.caseId, fixture.supportCaseId);
    expect(briefing.discrepancies).toHaveLength(0);
  });

  it('관리자용 확인: 검출 결과는 admin 열람에도 그대로 보인다 (D7)', async () => {
    const fixture = await createCaseWithSessions(['첫 메모']);
    const trigger = fixture.sessionIds[0] ?? '';
    await replaceSessionDiscrepancies(t.env, counselor, trigger, [{
      kind: 'within_session',
      leftSessionId: trigger,
      leftQuote: '첫 메모',
      rightSessionId: trigger,
      rightQuote: '첫 메모',
    }]);
    const briefing = await getParticipantBriefing(t.env, admin, fixture.caseId, fixture.supportCaseId);
    expect(briefing.discrepancies).toHaveLength(1);
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
