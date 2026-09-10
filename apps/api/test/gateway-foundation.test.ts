import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  ConsentContractError,
  ValidationError,
  assertPilotTextAiConsent,
  assignCase,
  createCase,
  getCase,
  listAuditLog,
  listAssignees,
  listCases,
  requestSupportCaseAssignment,
  processParticipantPiiRetention,
  purgeParticipantPii,
  registerPii,
  revealPii,
  transferCase,
  unassignCase,
} from '@ccc/core/gateway';
import { ANIMAL_SLUG_BENEFICIARY_ID_PATTERN } from '@ccc/contracts/animal-slugs';
import { setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';
import { seedCanonicalSttConsent } from './support/agent-jobs';

const {
  counselor,
  unassignedCounselor,
  inactiveCounselor,
  admin,
  otherOrgCounselor,
  otherOrgAdmin,
  service,
} = testActors;

const t = setupD1();

describe('gateway foundation', () => {
  it('creates an assigned case, blocks an unassigned counselor, and records audit events', async () => {
    await t.reset();

    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));

    expect(created.id).toMatch(ANIMAL_SLUG_BENEFICIARY_ID_PATTERN);
    await expect(getCase(t.env, unassignedCounselor, created.id)).rejects.toBeInstanceOf(ForbiddenError);

    const audit = await listAuditLog(t.env, admin, { supportCaseId: created.id, limit: 100 });
    expect(audit.items.map((entry) => entry.action)).toEqual(expect.arrayContaining(['create', 'assign']));
    expect(audit.items.every((entry) => !('targetId' in entry))).toBe(true);
  });
  it('returns audit metadata in stable bounded descending pages', async () => {
    await t.reset();
    await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
    await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));

    const first = await listAuditLog(t.env, admin, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toEqual(expect.objectContaining({
      id: expect.any(Number),
      actorId: expect.any(String),
      actorRole: expect.any(String),
      action: expect.any(String),
      targetTable: expect.any(String),
      beneficiaryId: expect.anything(),
      supportCaseId: expect.anything(),
      createdAt: expect.any(String),
    }));
    expect(first.items[0]).not.toHaveProperty('targetId');
    expect(first.items[0]).not.toHaveProperty('detail');

    const second = await listAuditLog(t.env, admin, { limit: 1, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.id).toBeLessThan(first.items[0]!.id);
  });

  it('requires an active institution-admin role for audit reads', async () => {
    await t.reset();
    await expect(listAuditLog(t.env, counselor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAuditLog(t.env, service)).rejects.toBeInstanceOf(ForbiddenError);
    await t.db.prepare(
      `UPDATE user_role_assignments SET revoked_at = '2026-01-01T00:00:00.000Z'
       WHERE user_id = ? AND org_id = ? AND role = 'institution_admin'`,
    ).bind(admin.userId, admin.orgId).run();
    await expect(listAuditLog(t.env, admin)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects offset timestamps before lexicographic audit range comparison', async () => {
    await t.reset();
    await expect(listAuditLog(t.env, admin, {
      from: '2026-09-09T09:00:00+09:00',
      to: '2026-09-09T10:00:00.000Z',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('does not expose a legacy case through a requested assignment', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
    const supportCase = await t.db.prepare(
      'SELECT id FROM support_cases WHERE legacy_case_id = ? AND org_id = ?',
    ).bind(created.id, counselor.orgId).first<{ id: string }>();
    if (supportCase === null) throw new Error('support case fixture is missing');
    await t.db.prepare(
      `UPDATE support_case_assignees
       SET status = 'ended', unassigned_at = datetime('now')
       WHERE support_case_id = ? AND status = 'active'`,
    ).bind(supportCase.id).run();
    await requestSupportCaseAssignment(
      t.env,
      admin,
      supportCase.id,
      unassignedCounselor.userId,
      'primary',
    );

    await expect(listCases(t.env, unassignedCounselor)).resolves.toEqual([]);
  });
  it('fails legacy case creation, assignment, and transfer closed without organization settings', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
    // 고지 발급은 기관 설정을 지우기 전에 끝내 둔다 — 막혀야 하는 것은 등록 자체다.
    const blocked = await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) });
    await t.db.prepare('DELETE FROM organization_settings WHERE org_id = ?')
      .bind(counselor.orgId)
      .run();

    await expect(createCase(t.env, counselor, blocked)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignCase(t.env, admin, created.id, unassignedCounselor.userId, 'secondary'))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(transferCase(t.env, admin, created.id, counselor.userId, unassignedCounselor.userId))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects unknown and inactive human assignees without provisioning directory rows', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
    const unknownUserId = 'unknown@example.invalid';

    for (const userId of [unknownUserId, inactiveCounselor.userId]) {
      await expect(assignCase(t.env, admin, created.id, userId, 'secondary'))
        .rejects.toBeInstanceOf(ForbiddenError);
      await expect(transferCase(t.env, admin, created.id, counselor.userId, userId))
        .rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(t.db.prepare('SELECT id FROM users WHERE id = ?')
      .bind(unknownUserId)
      .first()).resolves.toBeNull();
  });

  it('encrypts PII, allows only an admin to reveal it, and keeps plaintext out of audit detail', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));

    // enc_email(#32·D3)도 이름·연락처·계좌와 같은 AES-GCM 경로로 저장·복호화됨을 함께 확인한다.
    await registerPii(t.env, admin, created.id, {
      name: 'NAME_DEMO',
      phone: 'PHONE_DEMO',
      account: 'ACCOUNT_DEMO',
      email: 'EMAIL_DEMO@example.invalid',
    });

    const vault = await t.db
      .prepare(
        `SELECT beneficiary_id AS case_id, org_id, enc_name, enc_phone, enc_account, enc_email
         FROM participant_pii_vault WHERE beneficiary_id = ?`,
      )
      .bind(created.id)
      .first<{
        case_id: string;
        org_id: string;
        enc_name: string | null;
        enc_phone: string | null;
        enc_account: string | null;
        enc_email: string | null;
      }>();
    if (vault === null) throw new Error('expected PII vault row');
    expect(vault.case_id).toBe(created.id);
    expect(vault.org_id).toBe(counselor.orgId);
    if (
      vault.enc_name === null || vault.enc_phone === null
      || vault.enc_account === null || vault.enc_email === null
    ) {
      throw new Error('expected encrypted PII fields');
    }
    expect(vault.enc_name).not.toHaveLength(0);
    expect(vault.enc_phone).not.toHaveLength(0);
    expect(vault.enc_account).not.toHaveLength(0);
    expect(vault.enc_email).not.toHaveLength(0);
    expect(vault.enc_name).not.toContain('NAME_DEMO');
    expect(vault.enc_phone).not.toContain('PHONE_DEMO');
    expect(vault.enc_account).not.toContain('ACCOUNT_DEMO');
    expect(vault.enc_email).not.toContain('EMAIL_DEMO');

    await expect(revealPii(t.env, counselor, created.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revealPii(t.env, admin, created.id)).resolves.toEqual({
      name: 'NAME_DEMO',
      phone: 'PHONE_DEMO',
      account: 'ACCOUNT_DEMO',
      email: 'EMAIL_DEMO@example.invalid',
    });

    const audit = await t.db
      .prepare(
        'SELECT actor_id, actor_role, action, target_table, target_id, case_id, detail FROM audit_log WHERE case_id = ?',
      )
      .bind(created.id)
      .all<{
        actor_id: string;
        actor_role: string;
        action: string;
        target_table: string;
        target_id: string | null;
        case_id: string | null;
        detail: string | null;
      }>();
    const serializedAudit = JSON.stringify(audit.results);
    for (const plaintext of ['NAME_DEMO', 'PHONE_DEMO', 'ACCOUNT_DEMO', 'EMAIL_DEMO']) {
      expect(serializedAudit).not.toContain(plaintext);
    }
  });

  it('denies cross-org, service, and unassigned counselor PII reveals without plaintext or decrypt audits', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
    const pii = {
      name: 'NAME_REVEAL_DENIED',
      phone: 'PHONE_REVEAL_DENIED',
      account: 'ACCOUNT_REVEAL_DENIED',
    };
    await registerPii(t.env, admin, created.id, pii);

    const crossOrgAdminError = await revealPii(t.env, otherOrgAdmin, created.id).then(
      () => undefined,
      (error: unknown) => error,
    );
    const serviceError = await revealPii(t.env, service, created.id).then(
      () => undefined,
      (error: unknown) => error,
    );
    const crossOrgCounselorError = await revealPii(t.env, otherOrgCounselor, created.id).then(
      () => undefined,
      (error: unknown) => error,
    );
    const unassignedCounselorError = await revealPii(t.env, unassignedCounselor, created.id).then(
      () => undefined,
      (error: unknown) => error,
    );

    for (const error of [
      crossOrgAdminError,
      serviceError,
      crossOrgCounselorError,
      unassignedCounselorError,
    ]) {
      expect(error).toBeInstanceOf(ForbiddenError);
      const message = error instanceof Error ? error.message : String(error);
      for (const plaintext of Object.values(pii)) {
        expect(message).not.toContain(plaintext);
      }
    }

    const audit = await t.db.prepare(
      'SELECT action, target_table, target_id, case_id, detail FROM audit_log WHERE case_id = ? ORDER BY id',
    ).bind(created.id).all<{
      action: string;
      target_table: string;
      target_id: string | null;
      case_id: string | null;
      detail: string | null;
    }>();
    expect(audit.results.filter((entry) => entry.action === 'decrypt_pii')).toEqual([]);

    const serializedAudit = JSON.stringify(audit.results);
    for (const plaintext of Object.values(pii)) {
      expect(serializedAudit).not.toContain(plaintext);
    }
  });

  it('requires archive review before purge while preserving the vault row', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
    await registerPii(t.env, admin, created.id, { name: 'NAME_DEMO' });

    await expect(processParticipantPiiRetention(t.env))
      .resolves.toEqual({ attempted: 0, archived: 0, requeued: 0 });

    await t.db
      .prepare(
        `UPDATE support_cases
         SET status = 'closed',
             closed_at = '2020-01-01 00:00:00',
             closed_reason = 'legacy purge test',
             closed_by_actor_id = ?,
             updated_at = '2020-01-01 00:00:00'
         WHERE legacy_case_id = ? AND org_id = ? AND status = 'active'`,
      )
      .bind(counselor.userId, created.id, counselor.orgId)
      .run();
    await processParticipantPiiRetention(t.env);
    await purgeParticipantPii({ ...t.env, PII_PURGE_ENABLED: '1' }, admin, created.id);

    await expect(revealPii(t.env, admin, created.id)).resolves.toEqual({
      name: null,
      phone: null,
      account: null,
      email: null,
    });
    const vault = await t.db
      .prepare(
        `SELECT beneficiary_id AS case_id, org_id, enc_name, enc_phone, enc_account, purged_at
         FROM participant_pii_vault WHERE beneficiary_id = ?`,
      )
      .bind(created.id)
      .first<{
        case_id: string;
        org_id: string;
        enc_name: string | null;
        enc_phone: string | null;
        enc_account: string | null;
        purged_at: string | null;
      }>();
    if (vault === null) throw new Error('expected preserved PII vault row');
    expect(vault).toEqual({
      case_id: created.id,
      org_id: counselor.orgId,
      enc_name: null,
      enc_phone: null,
      enc_account: null,
      purged_at: expect.any(String),
    });
  });

  it('preserves assignment history during transfer and protects the final active assignee', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
    const secondaryUser = 'secondary.demo@example.invalid';
    const replacementUser = 'replacement.demo@example.invalid';
    await t.db.batch([
      t.db.prepare(
        `INSERT INTO users (id, org_id, email, role, active, time_zone)
         VALUES (?, ?, ?, 'counselor', 1, NULL)`,
      ).bind(secondaryUser, counselor.orgId, secondaryUser),
      t.db.prepare(
        `INSERT INTO users (id, org_id, email, role, active, time_zone)
         VALUES (?, ?, ?, 'counselor', 1, NULL)`,
      ).bind(replacementUser, counselor.orgId, replacementUser),
    ]);

    await assignCase(t.env, admin, created.id, secondaryUser, 'secondary');
    // 이미 활성 담당인 사용자 재배정은 500(UNIQUE 위반) 대신 검증 에러로 거부한다.
    await expect(assignCase(t.env, admin, created.id, secondaryUser, 'secondary'))
      .rejects.toBeInstanceOf(ValidationError);
    await transferCase(t.env, admin, created.id, counselor.userId, replacementUser);
    const assignments = await listAssignees(t.env, admin, created.id, { includeHistory: true });

    const formerPrimary = assignments.find((entry) => entry.userId === counselor.userId);
    if (formerPrimary === undefined) throw new Error('expected former primary assignment history');
    expect(formerPrimary.caseId).toBe(created.id);
    expect(formerPrimary.role).toBe('primary');
    expect(formerPrimary.assignedAt).toEqual(expect.any(String));
    expect(formerPrimary.unassignedAt).toEqual(expect.any(String));

    const activeReplacement = assignments.find((entry) => entry.userId === replacementUser);
    if (activeReplacement === undefined) throw new Error('expected replacement assignment');
    expect(activeReplacement.caseId).toBe(created.id);
    expect(activeReplacement.role).toBe('primary');
    expect(activeReplacement.assignedAt).toEqual(expect.any(String));
    expect(activeReplacement.unassignedAt).toBeNull();

    await unassignCase(t.env, admin, created.id, secondaryUser);
    await expect(unassignCase(t.env, admin, created.id, replacementUser)).rejects.toThrow('last active assignee');
  });

  it('rejects an org mismatch before returning a case', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));

    await expect(getCase(t.env, otherOrgAdmin, created.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('limits case lists to assigned counselors and rejects the service role', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));

    await expect(listCases(t.env, counselor)).resolves.toEqual([
      expect.objectContaining({ id: created.id }),
    ]);
    await expect(listCases(t.env, unassignedCounselor)).resolves.toEqual([]);
    await expect(listCases(t.env, service)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('opens the text-AI gate only on canonical six-domain consent and denies others content-free', async () => {
    await t.reset();
    t.env.TEXT_AI_PILOT_ENABLED = '1';
    // 국외 LLM 처리를 거절한 채로 연다 — 정본 게이트가 처음에는 닫혀 있어야 이 테스트가 성립한다.
    const created = await createCase(t.env, counselor, await registrationInput(
      t.env, counselor, { programId: testProgramId(counselor.orgId) },
      { external_llm_cross_border_processing: 'decline' },
    ));

    await expect(assertPilotTextAiConsent(t.env, counselor, created.id))
      .rejects.toBeInstanceOf(ConsentContractError);

    const scope = await t.db.prepare('SELECT id FROM support_cases WHERE legacy_case_id=? OR id=?')
      .bind(created.id, created.id).first<{ id: string }>();
    if (scope === null) throw new Error('expected canonical support case');
    await seedCanonicalSttConsent(t.env, counselor, scope.id);

    const grant = await assertPilotTextAiConsent(t.env, counselor, created.id);
    expect(grant.receipt.required.map((entry) => entry.domain)).toEqual([
      'external_llm_cross_border_processing',
      'personal_data_collection_use',
      'sensitive_information_processing',
    ]);
    // 게이트를 여는 근거는 그 시점의 국외 처리 동의 이벤트 하나로 특정된다.
    const llmEvent = await t.db.prepare(
      `SELECT id FROM consent_events
       WHERE support_case_id = ? AND domain = 'external_llm_cross_border_processing'
         AND decision = 'grant' ORDER BY event_sequence DESC LIMIT 1`,
    ).bind(scope.id).first<{ id: string }>();
    expect(grant.id).toBe(llmEvent?.id);

    for (const outsider of [unassignedCounselor, otherOrgAdmin, service]) {
      await expect(assertPilotTextAiConsent(t.env, outsider, created.id))
        .rejects.toBeInstanceOf(ForbiddenError);
    }

    const audit = await t.db.prepare(
      `SELECT actor_id, actor_role, action, target_table, detail FROM audit_log
       WHERE case_id = ? AND target_table = 'consent_events' ORDER BY id`,
    ).bind(created.id).all<{
      actor_id: string; actor_role: string; action: string; target_table: string; detail: string | null;
    }>();
    expect(audit.results.filter((row) => row.action === 'read')).toEqual([{
      actor_id: counselor.userId,
      actor_role: counselor.role,
      action: 'read',
      target_table: 'consent_events',
      detail: '{"purpose":"text_ai_grant_check"}',
    }]);
    // 거부도 content-free 다 — 사유 코드 말고는 아무것도 싣지 않는다.
    expect(audit.results.filter((row) => row.action === 'deny').map((row) => row.detail))
      .toContain('{"reason":"consent_not_effective"}');
    for (const detail of audit.results.map((row) => row.detail)) {
      expect(detail).toMatch(/^\{"(purpose|reason)":"[a-z_]+"\}$/);
    }
  });
});
