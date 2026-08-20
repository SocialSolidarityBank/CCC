import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  PilotTextAiConsentRequiredError,
  ValidationError,
  assertPilotTextAiConsent,
  assignCase,
  createCase,
  getCase,
  listAuditLog,
  listAssignees,
  listCases,
  purgePii,
  recordPilotTextAiConsentEvidence,
  registerPii,
  revealPii,
  transferCase,
  unassignCase,
} from '../../../db/gateway';
import { ANIMAL_SLUG_BENEFICIARY_ID_PATTERN } from '../../../db/animal-slugs';
import { setupD1, testActors } from './support/d1';

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
const SHA256 = 'a'.repeat(64);

describe('gateway foundation', () => {
  it('creates an assigned case, blocks an unassigned counselor, and records audit events', async () => {
    await t.reset();

    const created = await createCase(t.env, counselor, { programType: 'financial_support_v1' });

    expect(created.id).toMatch(ANIMAL_SLUG_BENEFICIARY_ID_PATTERN);
    await expect(getCase(t.env, unassignedCounselor, created.id)).rejects.toBeInstanceOf(ForbiddenError);

    const audit = await listAuditLog(t.env, admin, { caseId: created.id });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining(['create', 'assign']));
  });
  it('fails legacy case creation, assignment, and transfer closed without organization settings', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, {});
    await t.db.prepare('DELETE FROM organization_settings WHERE org_id = ?')
      .bind(counselor.orgId)
      .run();

    await expect(createCase(t.env, counselor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignCase(t.env, admin, created.id, unassignedCounselor.userId, 'secondary'))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(transferCase(t.env, admin, created.id, counselor.userId, unassignedCounselor.userId))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects unknown and inactive human assignees without provisioning directory rows', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, {});
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
    const created = await createCase(t.env, counselor, {});

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
    const created = await createCase(t.env, counselor, {});
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

  it('enforces the purge due date while preserving the vault row', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, {});
    await registerPii(t.env, admin, created.id, { name: 'NAME_DEMO' });

    await expect(purgePii(t.env, admin, created.id)).rejects.toThrow('not due');

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
    await purgePii(t.env, admin, created.id);

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
    const created = await createCase(t.env, counselor, {});
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
    const created = await createCase(t.env, counselor, {});

    await expect(getCase(t.env, otherOrgAdmin, created.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('limits case lists to assigned counselors and rejects the service role', async () => {
    await t.reset();
    const created = await createCase(t.env, counselor, {});

    await expect(listCases(t.env, counselor)).resolves.toEqual([
      expect.objectContaining({ id: created.id }),
    ]);
    await expect(listCases(t.env, unassignedCounselor)).resolves.toEqual([]);
    await expect(listCases(t.env, service)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('persists complete pilot text-AI evidence and rejects malformed or unauthorized writers without evidence writes', async () => {
    await t.reset();
    t.env.TEXT_AI_PILOT_ENABLED = '1';
    const created = await createCase(t.env, counselor, {});
    const input = {
      noticeVersion: 'pilot-text-ai-v1',
      noticeSha256: SHA256,
      evidenceRef: 'r2://opaque-pilot-evidence',
      evidenceSha256: 'b'.repeat(64),
      effectiveAt: '2026-01-01T00:00:00.000Z',
    };

    await expect(assertPilotTextAiConsent(t.env, counselor, created.id))
      .rejects.toBeInstanceOf(PilotTextAiConsentRequiredError);

    const evidence = await recordPilotTextAiConsentEvidence(t.env, counselor, created.id, input);
    expect(evidence).toMatchObject({
      id: expect.any(String),
      caseId: created.id,
      ...input,
      capturedBy: counselor.userId,
      createdAt: expect.any(String),
    });
    // CCC-110: 근거 행만으로는 여전히 거부다 — 사용 허용은 support_cases.consent_text_ai_at
    // 이 결정한다. 현재 동의를 세운 뒤에야 최신 근거가 돌아온다.
    await expect(assertPilotTextAiConsent(t.env, counselor, created.id))
      .rejects.toBeInstanceOf(PilotTextAiConsentRequiredError);
    await t.db.prepare(
      'UPDATE support_cases SET consent_text_ai_at = ? WHERE legacy_case_id = ? OR id = ?',
    ).bind('2026-01-01T00:00:00.000Z', created.id, created.id).run();
    await expect(assertPilotTextAiConsent(t.env, counselor, created.id))
      .resolves.toEqual(evidence);

    const malformedEvidenceRef = 'malformed pilot evidence';
    const malformedError = await recordPilotTextAiConsentEvidence(t.env, counselor, created.id, {
      ...input,
      evidenceRef: malformedEvidenceRef,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(malformedError).toBeInstanceOf(ValidationError);
    const malformedMessage = malformedError instanceof Error ? malformedError.message : String(malformedError);
    expect(malformedMessage).not.toContain(malformedEvidenceRef);

    await expect(recordPilotTextAiConsentEvidence(t.env, unassignedCounselor, created.id, {
      ...input,
      evidenceRef: 'r2://opaque-unassigned',
      evidenceSha256: 'c'.repeat(64),
    })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPilotTextAiConsentEvidence(t.env, otherOrgAdmin, created.id, {
      ...input,
      evidenceRef: 'r2://opaque-cross-org',
      evidenceSha256: 'd'.repeat(64),
    })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPilotTextAiConsentEvidence(t.env, service, created.id, {
      ...input,
      evidenceRef: 'r2://opaque-service',
      evidenceSha256: 'e'.repeat(64),
    })).rejects.toBeInstanceOf(ForbiddenError);

    const persisted = await t.db.prepare(
      `SELECT
         evidence.id,
         evidence.org_id,
         support_case.legacy_case_id AS case_id,
         evidence.notice_version,
         evidence.notice_sha256,
         evidence.evidence_ref,
         evidence.evidence_sha256,
         evidence.captured_by,
         evidence.effective_at,
         evidence.created_at
       FROM pilot_text_ai_consent_evidence AS evidence
       JOIN support_cases AS support_case ON support_case.id = evidence.support_case_id
       WHERE support_case.legacy_case_id = ?
       ORDER BY evidence.id`,
    ).bind(created.id).all<{
      id: string;
      org_id: string;
      case_id: string;
      notice_version: string;
      notice_sha256: string;
      evidence_ref: string;
      evidence_sha256: string;
      captured_by: string;
      effective_at: string;
      created_at: string;
    }>();
    expect(persisted.results).toEqual([{
      id: evidence.id,
      org_id: counselor.orgId,
      case_id: created.id,
      notice_version: input.noticeVersion,
      notice_sha256: input.noticeSha256,
      evidence_ref: input.evidenceRef,
      evidence_sha256: input.evidenceSha256,
      captured_by: counselor.userId,
      effective_at: input.effectiveAt,
      created_at: evidence.createdAt,
    }]);

    const audit = await t.db.prepare(
      `SELECT actor_id, actor_role, action, target_table, detail
       FROM audit_log
       WHERE case_id = ? AND target_table = ?
       ORDER BY id`,
    ).bind(created.id, 'pilot_text_ai_consent_evidence').all<{
      actor_id: string;
      actor_role: string;
      action: string;
      target_table: string;
      detail: string | null;
    }>();
    const successfulRows = audit.results.filter((entry) => entry.action === 'create');
    const deniedRows = audit.results.filter((entry) => entry.action === 'deny');
    expect(successfulRows).toEqual([{
      actor_id: counselor.userId,
      actor_role: counselor.role,
      action: 'create',
      target_table: 'pilot_text_ai_consent_evidence',
      detail: '{"purpose":"text_ai_pilot"}',
    }]);
    expect(deniedRows).toEqual([
      {
        actor_id: counselor.userId,
        actor_role: counselor.role,
        action: 'deny',
        target_table: 'pilot_text_ai_consent_evidence',
        detail: '{"reason":"pilot_text_ai_consent_required"}',
      },
      // CCC-110: 근거 행 기록 뒤, 현재 동의(consent_text_ai_at)를 세우기 전의 거부.
      {
        actor_id: counselor.userId,
        actor_role: counselor.role,
        action: 'deny',
        target_table: 'pilot_text_ai_consent_evidence',
        detail: '{"reason":"pilot_text_ai_consent_required"}',
      },
      {
        actor_id: counselor.userId,
        actor_role: counselor.role,
        action: 'deny',
        target_table: 'pilot_text_ai_consent_evidence',
        detail: '{"reason":"invalid_pilot_text_ai_evidence"}',
      },
      {
        actor_id: unassignedCounselor.userId,
        actor_role: unassignedCounselor.role,
        action: 'deny',
        target_table: 'pilot_text_ai_consent_evidence',
        detail: '{"reason":"forbidden"}',
      },
      {
        actor_id: otherOrgAdmin.userId,
        actor_role: otherOrgAdmin.role,
        action: 'deny',
        target_table: 'pilot_text_ai_consent_evidence',
        detail: '{"reason":"forbidden"}',
      },
      {
        actor_id: service.userId,
        actor_role: service.role,
        action: 'deny',
        target_table: 'pilot_text_ai_consent_evidence',
        detail: '{"reason":"forbidden"}',
      },
    ]);
    const serializedAudit = JSON.stringify(audit.results);
    for (const opaqueValue of [
      input.noticeVersion,
      input.noticeSha256,
      input.evidenceRef,
      input.evidenceSha256,
      input.effectiveAt,
      malformedEvidenceRef,
      'r2://opaque-unassigned',
      'c'.repeat(64),
      'r2://opaque-cross-org',
      'd'.repeat(64),
      'r2://opaque-service',
      'e'.repeat(64),
    ]) {
      expect(serializedAudit).not.toContain(opaqueValue);
    }
  });
});
