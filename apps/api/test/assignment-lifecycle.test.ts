import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  ValidationError,
  acceptSupportCaseAssignment,
  assertSupportCaseAccess,
  createBeneficiaryWithInitialSupportCase,
  deactivateUser,
  forceTransferSupportCase,
  getInviteForSignup,
  listCounselorAssignments,
  listSupportCaseAssignees,
  reactivateUser,
  requestSupportCaseAssignment,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 배정 상태 머신 (CCC-123 · D74 · 정책 §2.3): 요청(requested)은 아무 게이트도 열지 않고,
// 수락(active) 시 권한이 시작되며 이전 주담당이 끝난다. 강제 이관은 사유 필수 + 안내 확인
// 기록 + 전건 감사. 퇴사·휴직 체크리스트는 배정 종료 + 토큰 폐기 + 재활성화 시 미복원.

const t = setupD1();

async function seedCase(): Promise<{ beneficiaryId: string; supportCaseId: string }> {
  await t.reset();
  // 미배정 실무자는 접근 테스트 대상이라 실무자 역할 부여가 필요하다(멱등 INSERT OR IGNORE).
  await t.db.prepare(
    `INSERT OR IGNORE INTO user_role_assignments (
       id, org_id, user_id, role, source, granted_by
     ) VALUES (?, ?, ?, 'practitioner', 'manual', ?)`,
  ).bind(
    `test-practitioner:${testActors.unassignedCounselor.orgId}:${testActors.unassignedCounselor.userId}`,
    testActors.unassignedCounselor.orgId,
    testActors.unassignedCounselor.userId,
    testActors.admin.userId,
  ).run();
  return createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
}

describe('assignment request (CCC-123 requested status)', () => {
  it('denies all access to the assignee until accepted, then grants it and ends prior primary', async () => {
    const seeded = await seedCase();
    // 기존 담당(primary, active)이 접근할 수 있다.
    await expect(assertSupportCaseAccess(t.env, testActors.counselor, seeded.supportCaseId)).resolves.toBeTruthy();

    // 관리자가 새 담당(미배정 실무자)에게 배정을 요청한다 → requested, 접근 0.
    await requestSupportCaseAssignment(
      t.env, testActors.admin, seeded.supportCaseId, testActors.unassignedCounselor.userId, 'primary',
    );
    await expect(
      assertSupportCaseAccess(t.env, testActors.unassignedCounselor, seeded.supportCaseId),
    ).rejects.toThrow(ForbiddenError);
    const pendingCounselorAssignments = await listCounselorAssignments(
      t.env,
      testActors.admin,
      testActors.unassignedCounselor.userId,
    );
    expect(pendingCounselorAssignments.participants).toHaveLength(0);
    await expect(
      listSupportCaseAssignees(t.env, testActors.admin, seeded.supportCaseId),
    ).resolves.toHaveLength(1);
    const assignmentHistory = await listSupportCaseAssignees(
      t.env,
      testActors.admin,
      seeded.supportCaseId,
      { includeHistory: true },
    );
    expect(assignmentHistory.map((assignment) => assignment.status).sort()).toEqual([
      'active',
      'requested',
    ]);

    // 배정받은 본인만 수락할 수 있다(제3자는 Forbidden).
    const pending = await t.db.prepare(
      `SELECT id FROM support_case_assignees
       WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND status = 'requested'`,
    ).bind(testActors.admin.orgId, seeded.supportCaseId, testActors.unassignedCounselor.userId).first<{ id: string }>();
    if (pending === null) throw new Error('requested assignment fixture is missing');
    await expect(
      acceptSupportCaseAssignment(t.env, testActors.admin, pending.id),
    ).rejects.toThrow(ForbiddenError);

    // 수락 → 활성 + 이전 주담당 종료.
    await acceptSupportCaseAssignment(t.env, testActors.unassignedCounselor, pending.id);
    await expect(
      assertSupportCaseAccess(t.env, testActors.unassignedCounselor, seeded.supportCaseId),
    ).resolves.toBeTruthy();
    const rows = await t.db.prepare(
      `SELECT user_id AS userId, status, unassigned_at AS unassignedAt, accepted_at AS acceptedAt
       FROM support_case_assignees WHERE org_id = ? AND support_case_id = ?
       ORDER BY assigned_at`,
    ).bind(testActors.admin.orgId, seeded.supportCaseId).all();
    const byUser = Object.fromEntries(rows.results.map((r) => [r.userId, r]));
    expect((byUser[testActors.counselor.userId] as { status: string }).status).toBe('ended');
    expect((byUser[testActors.counselor.userId] as { unassignedAt: string | null }).unassignedAt).not.toBeNull();
    expect((byUser[testActors.unassignedCounselor.userId] as { status: string }).status).toBe('active');
    expect((byUser[testActors.unassignedCounselor.userId] as { acceptedAt: string | null }).acceptedAt).not.toBeNull();
    // 활성 주담당은 1명뿐이다(인덱스 제약 폐지 후 트랜잭션 유지).
    const actives = Object.values(byUser).filter((r) => (r as { status: string }).status === 'active');
    expect(actives).toHaveLength(1);
  });

  it('keeps an admin self-assignment requested when the institution has multiple active people', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, testActors.unassignedCounselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-02T00:00:00.000Z',
    });
    await t.db.prepare(
      `INSERT OR IGNORE INTO user_role_assignments (
         id, org_id, user_id, role, source, granted_by
       ) VALUES (?, ?, ?, 'practitioner', 'manual', ?)`,
    ).bind(
      `test-practitioner:${testActors.admin.orgId}:${testActors.admin.userId}`,
      testActors.admin.orgId,
      testActors.admin.userId,
      testActors.admin.userId,
    ).run();
    await requestSupportCaseAssignment(
      t.env, testActors.admin, created.supportCaseId, testActors.admin.userId, 'primary',
    );
    await expect(t.db.prepare(
      `SELECT status FROM support_case_assignees
       WHERE support_case_id = ? AND user_id = ? AND unassigned_at IS NULL`,
    ).bind(created.supportCaseId, testActors.admin.userId).first()).resolves.toEqual({
      status: 'requested',
    });
  });

  it('immediately accepts a self-assignment only when one active human remains', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, testActors.unassignedCounselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-02T00:00:00.000Z',
    });
    await t.db.prepare(
      `INSERT OR IGNORE INTO user_role_assignments (
         id, org_id, user_id, role, source, granted_by
       ) VALUES (?, ?, ?, 'practitioner', 'manual', ?)`,
    ).bind(
      `test-practitioner:${testActors.admin.orgId}:${testActors.admin.userId}`,
      testActors.admin.orgId,
      testActors.admin.userId,
      testActors.admin.userId,
    ).run();
    await t.db.prepare(
      `UPDATE support_case_assignees
       SET status = 'ended', unassigned_at = datetime('now')
       WHERE support_case_id = ? AND status = 'active'`,
    ).bind(created.supportCaseId).run();
    await t.db.prepare(
      `UPDATE users SET active = 0
       WHERE org_id = ? AND id <> ? AND role IN ('admin', 'counselor')`,
    ).bind(testActors.admin.orgId, testActors.admin.userId).run();

    await requestSupportCaseAssignment(
      t.env, testActors.admin, created.supportCaseId, testActors.admin.userId, 'primary',
    );
    await expect(t.db.prepare(
      `SELECT status, accepted_at AS acceptedAt FROM support_case_assignees
       WHERE support_case_id = ? AND user_id = ? AND unassigned_at IS NULL`,
    ).bind(created.supportCaseId, testActors.admin.userId).first()).resolves.toMatchObject({
      status: 'active',
      acceptedAt: expect.any(String),
    });
  });

  it('allows requested primary overlap but the database rejects a second active primary', async () => {
    const seeded = await seedCase();
    await requestSupportCaseAssignment(
      t.env, testActors.admin, seeded.supportCaseId, testActors.unassignedCounselor.userId, 'primary',
    );
    await t.db.prepare(
      `INSERT OR IGNORE INTO user_role_assignments (
         id, org_id, user_id, role, source, granted_by
       ) VALUES (?, ?, ?, 'practitioner', 'manual', ?)`,
    ).bind(
      `test-practitioner:${testActors.admin.orgId}:${testActors.admin.userId}`,
      testActors.admin.orgId,
      testActors.admin.userId,
      testActors.admin.userId,
    ).run();

    await expect(t.db.prepare(
      `INSERT INTO support_case_assignees (
         id, org_id, support_case_id, user_id, role, status, accepted_at, assigned_at
       ) VALUES (?, ?, ?, ?, 'primary', 'active', datetime('now'), datetime('now'))`,
    ).bind(
      'second-active-primary',
      testActors.admin.orgId,
      seeded.supportCaseId,
      testActors.admin.userId,
    ).run()).rejects.toThrow('UNIQUE constraint failed');

    const counts = await t.db.prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS activeCount,
         SUM(CASE WHEN status = 'requested' THEN 1 ELSE 0 END) AS requestedCount
       FROM support_case_assignees WHERE support_case_id = ? AND role = 'primary'`,
    ).bind(seeded.supportCaseId).first<{ activeCount: number; requestedCount: number }>();
    expect(counts).toEqual({ activeCount: 1, requestedCount: 1 });
  });
});

describe('forced transfer (CCC-123)', () => {
  it('requires a reason, ends the current primary immediately, and records the notice check', async () => {
    const seeded = await seedCase();
    const previous = await t.db.prepare(
      `SELECT id, user_id AS userId FROM support_case_assignees
       WHERE support_case_id = ? AND role = 'primary' AND status = 'active'`,
    ).bind(seeded.supportCaseId).first<{ id: string; userId: string }>();
    if (previous === null) throw new Error('active primary fixture is missing');

    // 사유 없이 이관 시도 → 거부.
    await expect(
      forceTransferSupportCase(t.env, testActors.admin, {
        supportCaseId: seeded.supportCaseId,
        toUserId: testActors.unassignedCounselor.userId,
        reason: '',
      }),
    ).rejects.toThrow(ValidationError);

    await forceTransferSupportCase(t.env, testActors.admin, {
      supportCaseId: seeded.supportCaseId,
      toUserId: testActors.unassignedCounselor.userId,
      reason: '퇴사로 인한 강제 이관',
      notifiedBy: testActors.admin.userId,
      notifiedAt: '2026-08-23T09:00:00.000Z',
    });

    // 기존 담당은 즉시 ended, 새 담당은 active(수락 없이).
    const targetRow = await t.db.prepare(
      `SELECT id, status, transfer_reason AS reason, notified_by AS notifiedBy, notified_at AS notifiedAt
       FROM support_case_assignees WHERE org_id = ? AND support_case_id = ? AND user_id = ?`,
    ).bind(
      testActors.admin.orgId,
      seeded.supportCaseId,
      testActors.unassignedCounselor.userId,
    ).first<{
      id: string;
      status: string;
      reason: string;
      notifiedBy: string;
      notifiedAt: string;
    }>();
    if (targetRow === null) throw new Error('forced transfer target fixture is missing');
    expect(targetRow).toEqual({
      id: expect.any(String),
      status: 'active', reason: '퇴사로 인한 강제 이관',
      notifiedBy: testActors.admin.userId, notifiedAt: '2026-08-23T09:00:00.000Z',
    });
    await expect(
      assertSupportCaseAccess(t.env, testActors.unassignedCounselor, seeded.supportCaseId),
    ).resolves.toBeTruthy();
    await expect(
      assertSupportCaseAccess(t.env, testActors.counselor, seeded.supportCaseId),
    ).rejects.toThrow(ForbiddenError);

    const audit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE org_id = ? AND support_case_id = ? AND action = 'update'
         AND target_id = ?`,
    ).bind(
      testActors.admin.orgId,
      seeded.supportCaseId,
      targetRow.id,
    ).first<{ detail: string }>();
    expect(JSON.parse(audit?.detail ?? '{}')).toEqual({
      forcedTransfer: true,
      reason: '퇴사로 인한 강제 이관',
      notified: true,
      notifiedBy: testActors.admin.userId,
      notifiedAt: '2026-08-23T09:00:00.000Z',
      previousAssignmentId: previous.id,
      previousUserId: previous.userId,
    });

    await expect(t.db.prepare(
      `UPDATE support_case_assignees
       SET notified_by = ?, notified_at = datetime('now')
       WHERE id = ?`,
    ).bind(
      testActors.counselor.userId,
      targetRow.id,
    ).run()).rejects.toThrow('assignment_lifecycle_immutable');

    await deactivateUser(
      t.env,
      testActors.admin,
      testActors.unassignedCounselor.userId,
      { reason: '퇴사' },
    );
    await expect(t.db.prepare(
      'SELECT transfer_reason AS reason FROM support_case_assignees WHERE id = ?',
    ).bind(targetRow.id).first()).resolves.toEqual({
      reason: '퇴사로 인한 강제 이관',
    });
    await expect(t.db.prepare(
      'UPDATE support_case_assignees SET transfer_reason = ? WHERE id = ?',
    ).bind('사후 덮어쓰기', targetRow.id).run()).rejects.toThrow(
      'assignment_lifecycle_immutable',
    );
  });
});

describe('offboarding checklist (CCC-123 deactivate/reactivate)', () => {
  it('ends assignments and revokes issued tokens; reactivation restores nothing', async () => {
    const seeded = await seedCase();
    // 실무자(unassignedCounselor)를 먼저 담당으로 배정·수락한다(퇴사 시 종료할 배정이 있게).
    await requestSupportCaseAssignment(
      t.env, testActors.admin, seeded.supportCaseId, testActors.unassignedCounselor.userId, 'primary',
    );
    const pending = await t.db.prepare(
      `SELECT id FROM support_case_assignees
       WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND status = 'requested'`,
    ).bind(testActors.admin.orgId, seeded.supportCaseId, testActors.unassignedCounselor.userId).first<{ id: string }>();
    if (pending === null) throw new Error('requested assignment fixture is missing');
    await acceptSupportCaseAssignment(t.env, testActors.unassignedCounselor, pending.id);
    // 실무자(unassignedCounselor)가 발급한 미사용 초대 토큰 하나를 직접 심는다.
    await t.db.prepare(
      `INSERT INTO invite_tokens (
         token, org_id, kind, program_type, issued_by, status, issued_at
       ) VALUES (?, ?, 'counselor', NULL, ?, 'issued', datetime('now'))`,
    ).bind('ccc-offboard-test-token', testActors.admin.orgId, testActors.unassignedCounselor.userId).run();
    await expect(
      getInviteForSignup(t.env, 'ccc-offboard-test-token', 'counselor'),
    ).resolves.toBeTruthy();

    // 퇴사: 배정 종료 + 사용자 비활성 + 토큰 폐기.
    await deactivateUser(t.env, testActors.admin, testActors.unassignedCounselor.userId, { reason: '퇴사' });

    const rows = await t.db.prepare(
      `SELECT status, transfer_reason AS reason FROM support_case_assignees
       WHERE org_id = ? AND support_case_id = ? AND user_id = ?`,
    ).bind(testActors.admin.orgId, seeded.supportCaseId, testActors.unassignedCounselor.userId).all();
    expect(rows.results).toEqual([{ status: 'ended', reason: '퇴사' }]);

    const token = await t.db.prepare('SELECT revoked_at AS revokedAt FROM invite_tokens WHERE token = ?')
      .bind('ccc-offboard-test-token').first<{ revokedAt: string | null }>();
    if (token === null) throw new Error('invite fixture is missing');
    expect(token.revokedAt).not.toBeNull();
    await expect(getInviteForSignup(t.env, 'ccc-offboard-test-token', 'counselor'))
      .rejects.toThrow(ForbiddenError);

    // 재활성화: 사용자만 다시 켜진다. 배정은 ended 로 남는다(미복원).
    await reactivateUser(t.env, testActors.admin, testActors.unassignedCounselor.userId);
    const still = await t.db.prepare(
      `SELECT status FROM support_case_assignees
       WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NOT NULL`,
    ).bind(
      testActors.admin.orgId,
      seeded.supportCaseId,
      testActors.unassignedCounselor.userId,
    ).first<{ status: string }>();
    if (still === null) throw new Error('ended assignment fixture is missing');
    expect(still.status).toBe('ended');
    await expect(
      assertSupportCaseAccess(t.env, testActors.unassignedCounselor, seeded.supportCaseId),
    ).rejects.toThrow(ForbiddenError);
  });
});
