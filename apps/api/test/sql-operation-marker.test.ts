import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  createBeneficiaryWithInitialSupportCase,
  transferSupportCase,
  updateSupportCaseExtra,
  type Actor,
} from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';
import type { Database } from '@ccc/contracts/database';

const t = setupD1();
const { admin, counselor, unassignedCounselor } = testActors;

describe('SQL portability operation markers', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await t.reset();
  });

  it('keeps operation markers unique across mutations', async () => {
    const first = await createBeneficiaryWithInitialSupportCase(t.env, counselor, { programType: 'financial_support_v1' });
    const second = await createBeneficiaryWithInitialSupportCase(t.env, counselor, { programType: 'financial_support_v1' });
    const marker = '11111111-1111-4111-8111-111111111111';

    await t.db.prepare('UPDATE support_cases SET operation_marker = ? WHERE id = ?')
      .bind(marker, first.supportCaseId).run();
    await expect(t.db.prepare('UPDATE support_cases SET operation_marker = ? WHERE id = ?')
      .bind(marker, second.supportCaseId).run()).rejects.toThrow();
  });

  it('commits a matching mutation and audit, and rolls both back when the audit fails', async () => {
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, { programType: 'financial_support_v1' });
    await updateSupportCaseExtra(t.env, counselor, created.supportCaseId, { stable: true });
    await expect(t.db.prepare(
      `SELECT extra, operation_marker FROM support_cases WHERE id = ?`,
    ).bind(created.supportCaseId).first()).resolves.toEqual({
      extra: JSON.stringify({ stable: true }),
      operation_marker: expect.any(String),
    });
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'update' AND target_table = 'support_cases' AND target_id = ?`,
    ).bind(created.supportCaseId).first<number>('count')).resolves.toBe(1);

    const before = await t.db.prepare(
      'SELECT extra, operation_marker FROM support_cases WHERE id = ?',
    ).bind(created.supportCaseId).first();
    await t.db.prepare(
      `CREATE TRIGGER sql_test_block_support_case_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'update' AND NEW.target_table = 'support_cases'
       BEGIN SELECT RAISE(ABORT, 'test_audit_failure'); END`,
    ).run();
    await expect(updateSupportCaseExtra(
      t.env,
      counselor,
      created.supportCaseId,
      { stable: false },
    )).rejects.toThrow();
    await expect(t.db.prepare(
      'SELECT extra, operation_marker FROM support_cases WHERE id = ?',
    ).bind(created.supportCaseId).first()).resolves.toEqual(before);
  });

  it('allows only one secondary successor when same-millisecond transfers cross the batch boundary together', async () => {
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, { programType: 'financial_support_v1' });
    const targets = [
      {
        userId: 'first-transfer-target@example.invalid',
        orgId: counselor.orgId,
        role: 'counselor',
      },
      {
        userId: 'second-transfer-target@example.invalid',
        orgId: counselor.orgId,
        role: 'counselor',
      },
    ] as const satisfies readonly Actor[];
    for (const target of targets) {
      await t.db.prepare(
        `INSERT INTO users (id, org_id, email, role, active, created_at)
         VALUES (?, ?, ?, 'counselor', 1, ?)`,
      ).bind(target.userId, target.orgId, target.userId, '2026-09-05T12:00:00.000Z').run();
    }
    const sourceAssignmentId = 'secondary-transfer-source';
    await t.db.prepare(
      `INSERT INTO support_case_assignees (
         id, org_id, support_case_id, user_id, role, status, accepted_at, assigned_at
       ) VALUES (?, ?, ?, ?, 'secondary', 'active', ?, ?)`,
    ).bind(
      sourceAssignmentId,
      counselor.orgId,
      created.supportCaseId,
      unassignedCounselor.userId,
      '2026-09-05T11:00:00.000Z',
      '2026-09-05T11:00:00.000Z',
    ).run();

    const originalDatabase = t.env.DB;
    let arrivals = 0;
    let release!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const racingDatabase: Database = {
      prepare(sql) {
        return originalDatabase.prepare(sql);
      },
      async batch(statements) {
        arrivals += 1;
        if (arrivals === 2) release();
        await bothReady;
        return originalDatabase.batch(statements);
      },
    };
    const raceEnv = { ...t.env, DB: racingDatabase };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-05T12:00:00.000Z'));
    try {
      const results = await Promise.allSettled(targets.map((target) => transferSupportCase(
        raceEnv,
        admin,
        created.supportCaseId,
        unassignedCounselor.userId,
        target.userId,
      )));
      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(ConflictError);
    } finally {
      vi.useRealTimers();
    }

    const source = await t.db.prepare(
      `SELECT status, operation_marker FROM support_case_assignees WHERE id = ?`,
    ).bind(sourceAssignmentId).first();
    expect(source).toEqual({ status: 'ended', operation_marker: expect.any(String) });
    const successors = await t.db.prepare(
      `SELECT user_id FROM support_case_assignees
       WHERE support_case_id = ? AND role = 'secondary'
         AND user_id IN (?, ?) AND status = 'active' AND unassigned_at IS NULL`,
    ).bind(created.supportCaseId, targets[0].userId, targets[1].userId).all<{ user_id: string }>();
    expect(successors.results).toHaveLength(1);
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'transfer' AND target_table = 'support_case_assignees' AND support_case_id = ?`,
    ).bind(created.supportCaseId).first<number>('count')).resolves.toBe(1);
  });
});
