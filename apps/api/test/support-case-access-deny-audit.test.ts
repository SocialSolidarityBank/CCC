import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  assertSupportCaseAccess,
  createBeneficiaryWithInitialSupportCase,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

const { counselor, unassignedCounselor } = testActors;

const t = setupD1();

describe('assertSupportCaseAccess deny audit (CCC-116)', () => {
  it('rejects an unassigned counselor and records a deny_access audit row', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    await expect(assertSupportCaseAccess(t.env, unassignedCounselor, created.supportCaseId))
      .rejects.toBeInstanceOf(ForbiddenError);

    const rows = await t.db.prepare(
      `SELECT actor_id, actor_role, target_table, target_id, detail, created_at
       FROM audit_log WHERE action = 'deny_access'`,
    ).all<{
      actor_id: string;
      actor_role: string;
      target_table: string;
      target_id: string;
      detail: string | null;
      created_at: string;
    }>();

    expect(rows.results).toHaveLength(1);
    const denial = rows.results[0];
    expect(denial?.actor_id).toBe(unassignedCounselor.userId);
    expect(denial?.actor_role).toBe('counselor');
    expect(denial?.target_table).toBe('support_cases');
    expect(denial?.target_id).toBe(created.supportCaseId);
    // 행위자·역할·대상 케이스·시각만 남긴다 — 내용(detail)은 비어 있어야 한다.
    expect(denial?.detail).toBeNull();
    expect(denial?.created_at).toBeTruthy();
  });

  it('does not record deny_access when access is granted', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    await expect(assertSupportCaseAccess(t.env, counselor, created.supportCaseId))
      .resolves.toMatchObject({ id: created.supportCaseId });

    const row = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'deny_access'",
    ).first<{ count: number }>();
    expect(row).toEqual({ count: 0 });
  });
});
