import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

interface CandidatesBody {
  candidates: Array<{
    beneficiaryId: string;
    supportCaseId: string;
    programType: string;
    participantName: string | null;
    participantPhone: string | null;
    participantEmail: string | null;
  }>;
}

function getCandidates(actor: { userId: string; orgId: string; role: string }): Promise<Response> {
  return worker.fetch(new Request('http://localhost/schedules/candidates', {
    headers: headersFor(actor),
  }), t.env);
}

// 콜드스타트 회귀 방지(티켓 #19): 후보 기준이 '일정 보유'가 아니라 '담당 활성 참여사업'이어야
// 방금 등록해 아직 일정이 없는 당사자도 첫 상담을 등록할 수 있다.
describe('GET /schedules/candidates (콜드스타트 해소)', () => {
  it('includes a just-registered participant that has no schedule yet', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-16T09:00:00.000Z',
    });

    const response = await getCandidates(testActors.counselor);
    expect(response.status).toBe(200);
    const body = await response.json() as CandidatesBody;
    // PII 미기입 당사자라 실명·연락처·이메일은 전부 null 로 실린다(D31·D24).
    expect(body.candidates).toContainEqual({
      beneficiaryId: created.beneficiaryId,
      supportCaseId: created.supportCaseId,
      programType: 'financial_support_v1',
      participantName: null,
      participantPhone: null,
      participantEmail: null,
      // D35 · ADR-0014 §5: 상담 등록 1단계가 이 값으로 상담 유형 기본값을 잡는다
      // (없으면 '인테이크', 있으면 '기본 상담'). 이 픽스처는 인테이크와 함께 등록됐다.
      intakeAt: '2026-07-16T09:00:00.000Z',
    });
  });

  it('scopes counselor candidates to their own active assignments', async () => {
    await t.reset();
    const mine = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-16T09:00:00.000Z',
    });
    const others = await createBeneficiaryWithInitialSupportCase(t.env, testActors.unassignedCounselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-16T09:00:00.000Z',
    });

    const body = await (await getCandidates(testActors.counselor)).json() as CandidatesBody;
    const ids = body.candidates.map((c) => c.beneficiaryId);
    expect(ids).toContain(mine.beneficiaryId);
    expect(ids).not.toContain(others.beneficiaryId);
  });

  it('lets an admin see every active support case in the org', async () => {
    await t.reset();
    const a = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-16T09:00:00.000Z',
    });
    const b = await createBeneficiaryWithInitialSupportCase(t.env, testActors.unassignedCounselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-16T09:00:00.000Z',
    });

    const body = await (await getCandidates(testActors.admin)).json() as CandidatesBody;
    const ids = body.candidates.map((c) => c.beneficiaryId);
    expect(ids).toContain(a.beneficiaryId);
    expect(ids).toContain(b.beneficiaryId);
  });

  it('writes a read audit row scoped to schedule candidates', async () => {
    await t.reset();
    await getCandidates(testActors.counselor);
    const audit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE actor_id = ? AND action = 'read' AND target_table = 'support_cases'
       ORDER BY id DESC LIMIT 1`,
    ).bind(testActors.counselor.userId).first<{ detail: string }>();
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit!.detail)).toMatchObject({ list: 'schedule_candidates' });
  });
});
