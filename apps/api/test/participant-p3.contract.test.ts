import { describe, expect, it } from 'vitest';
import { assignSupportCase, closeSupportCase, createBeneficiaryWithInitialSupportCase, createSupportCase, createCounselingRecord, createIntakeRecord, updateParticipantPii, type Actor, type DirectoryAccountsView, type SupportCaseCreationResult } from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { grantTestPractitionerRole, setupD1, testActors, testProgramId } from './support/d1';
import { registrationConsentEvents, registrationInput } from './support/registration';
import type { ProgramListResponse, ProgramMutationResponse } from '@ccc/contracts/program-admission';
import { intakeInput, intakeQuestionnaire } from './support/intake';

const t = setupD1();
const { counselor, unassignedCounselor: requester, admin, otherOrgAdmin } = testActors;
const requestReason = '합성 인계 요청';
const pii = { name: '합성 당사자', phone: '010-0000-1234', email: 'synthetic@example.invalid', birthDate: '1990-02-03', account: 'PRIVATE_ACCOUNT_CANARY' };
function http(actor: Actor, path: string, body?: object, method = 'POST') {
  return handleRequest(new Request(`http://localhost${path}`, body === undefined ? {} : {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), t.env, async () => actor);
}
async function seed() {
  await t.reset();
  const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
  await updateParticipantPii(t.env, counselor, created.beneficiaryId, { supportCaseContextId: created.supportCaseId, expectedVersion: 1, ...pii });
  await t.db.prepare('UPDATE users SET name = ? WHERE id = ?').bind('합성 담당 실무자', counselor.userId).run();
  return created;
}
async function piiAuditCount() {
  return (await t.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'read_participant_pii'").first<{ count: number }>())!.count;
}
async function latestPiiAudit() {
  const row = await t.db.prepare("SELECT detail, org_id AS orgId FROM audit_log WHERE action = 'read_participant_pii' ORDER BY id DESC LIMIT 1").first<{ detail: string; orgId: string }>();
  if (row === null) throw new Error('missing PII read receipt');
  return { ...JSON.parse(row.detail), orgId: row.orgId };
}

describe('D88 participant serialization and D86 restricted access', () => {
  it('returns email and participation names through the list, with one PII audit even for email-only contacts', async () => {
    const created = await seed();
    await updateParticipantPii(t.env, counselor, created.beneficiaryId, { supportCaseContextId: created.supportCaseId, expectedVersion: 2, name: null, phone: null });
    await t.db.prepare('UPDATE programs SET display_name = ? WHERE id = ?').bind('합성 생활 지원', testProgramId(counselor.orgId)).run();
    const before = await piiAuditCount();
    const response = await http(counselor, '/participants');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ results: [{ beneficiaryId: created.beneficiaryId, email: pii.email, programNames: ['합성 생활 지원'] }] });
    expect(JSON.stringify(body)).not.toContain(pii.account);
    expect(JSON.stringify(body)).not.toContain(pii.birthDate);
    expect(await piiAuditCount()).toBe(before + 1);
    expect(await latestPiiAudit()).toMatchObject({ orgId: counselor.orgId, fields: expect.arrayContaining(['email']), beneficiaryIds: [created.beneficiaryId], count: 1 });
    expect(await (await http(otherOrgAdmin, '/participants')).json()).toEqual({ results: [] });
  });

  it('exposes authorized hub birth date and record progress without widening generic record responses', async () => {
    const created = await seed();
    await createCounselingRecord(t.env, counselor, created.supportCaseId, { schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-01T09:00:00.000Z', channel: 'in_person', memo: '합성 수기 기록', gasScores: [], actionItems: [], flags: [] });
    const before = await piiAuditCount();
    const response = await http(admin, `/participants/${created.beneficiaryId}/hub`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ restricted: false, participantBirthDate: pii.birthDate, status: 'active', closedAt: null, sessionCount: 1, lastSessionAt: '2026-09-01T09:00:00.000Z' });
    expect(JSON.stringify(body)).not.toContain(pii.account);
    expect(await piiAuditCount()).toBe(before + 1);
    expect(await latestPiiAudit()).toMatchObject({ fields: expect.arrayContaining(['email', 'birth_date']), count: 1 });
    const generic = await (await http(counselor, `/participants/${created.beneficiaryId}/support-cases`)).text();
    expect(generic).not.toContain(pii.birthDate);
    expect(generic).not.toContain(pii.email);
    const write = await handleRequest(new Request(`http://localhost/support-cases/${created.supportCaseId}/overall-goal`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ overallGoal: '관리자 비담당 쓰기 시도' }),
    }), t.env, async () => admin);
    expect(write.status).toBe(403);
  });

  it('returns only the restricted hub identification and participation shape to an unassigned worker', async () => {
    const created = await seed();
    const response = await http(requester, `/participants/${created.beneficiaryId}/hub`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ beneficiaryId: created.beneficiaryId, restricted: true, participantName: pii.name, participantPhone: pii.phone, participantEmail: pii.email,
      programs: [{ id: created.supportCaseId, beneficiaryId: created.beneficiaryId, programId: testProgramId(counselor.orgId), programName: expect.any(String), programType: 'financial_support_v1', status: 'active', authorized: false, assigneeNames: ['합성 담당 실무자'] }] });
    expect(JSON.stringify(body)).not.toContain(pii.birthDate);
    expect(JSON.stringify(body)).not.toContain(pii.account);
    expect((await http(requester, `/participants/${created.beneficiaryId}/support-cases`)).status).toBe(403);
    expect((await http(requester, `/support-cases/${created.supportCaseId}/consent`)).status).toBe(403);
    expect((await http(otherOrgAdmin, `/participants/${created.beneficiaryId}/hub`)).status).toBe(403);
    expect((await http(testActors.service, `/participants/${created.beneficiaryId}/hub`)).status).toBe(403);
  });

  it('lists other participation names but excludes unauthorized and draft-only records from hub progress', async () => {
    const created = await seed();
    const context = await (await http(admin, '/programs')).json() as ProgramListResponse;
    const programResponse = await http(admin, '/programs', {
      displayName: '합성 다른 사업', storageMode: 'supabase_seoul', processingMode: 'external_allowed',
      confirmation: { copyVersion: context.admissionCopy.version, copyHash: context.admissionCopy.hash,
        installationPolicyVersion: context.installation.policyVersion, installationConfigHash: context.installation.configHash },
    });
    expect(programResponse.status).toBe(201);
    const { program } = await programResponse.json() as ProgramMutationResponse;
    const other = await createSupportCase(t.env, admin, created.beneficiaryId, {
      schemaVersion: 1, submissionId: crypto.randomUUID(), programId: program.id,
      initialAssigneeUserId: requester.userId,
      consentEvents: await registrationConsentEvents(t.env, admin, program.id),
    });
    const record = { schemaVersion: 2 as const, submissionId: crypto.randomUUID(), heldAt: '2026-09-02T09:00:00.000Z', channel: 'in_person' as const, memo: '합성 기록', gasScores: [], actionItems: [], flags: [] };
    await createCounselingRecord(t.env, requester, other.supportCaseId, record);
    const draft = await createCounselingRecord(t.env, counselor, created.supportCaseId, { ...record, submissionId: crypto.randomUUID(), heldAt: '2026-09-03T09:00:00.000Z' });
    await t.db.prepare("UPDATE sessions SET memo = NULL, ai_status = 'review_ready' WHERE id = ?")
      .bind(draft.record.id).run();
    const listing = await (await http(counselor, '/participants')).json() as { results: Array<{ programNames: string[] }> };
    expect(listing.results[0]!.programNames).toContain('합성 다른 사업');
    const own = await (await http(counselor, `/participants/${created.beneficiaryId}/hub`)).json() as { sessionCount: number; lastSessionAt: string | null; programs: Array<{ id: string }> };
    expect(own).toMatchObject({ sessionCount: 0, lastSessionAt: null });
    expect(own.programs.find(entry => entry.id === other.supportCaseId)).toEqual({
      id: other.supportCaseId, beneficiaryId: created.beneficiaryId, programId: program.id, programName: '합성 다른 사업',
      programType: 'financial_support_v1', status: 'active', authorized: false, assigneeNames: [],
    });
    expect(await (await http(admin, `/participants/${created.beneficiaryId}/hub`)).json())
      .toMatchObject({ sessionCount: 1, lastSessionAt: record.heldAt });
  });
});

describe('worker-origin assignment request', () => {
  it.each(['coassign', 'transfer'])('requires administrator review for %s and never lets the requester self-accept', async decision => {
    const created = await seed();
    const path = `/support-cases/${created.supportCaseId}/assignment-requests`;
    const response = await http(requester, path, { reason: requestReason });
    expect(response.status).toBe(201);
    const pending = await response.json() as { id: string; status: string; userId: string; acceptanceRequestedBy: string };
    expect(pending).toMatchObject({ status: 'requested', userId: requester.userId, acceptanceRequestedBy: requester.userId });
    expect((await http(requester, path, { reason: requestReason })).status).toBe(409);
    expect((await http(requester, `/support-cases/${created.supportCaseId}/assignees/${pending.id}/accept`, {})).status).toBe(403);
    const review = `${path}/${pending.id}/review`;
    expect((await http(requester, review, { decision })).status).toBe(403);
    expect((await http(otherOrgAdmin, review, { decision })).status).toBe(403);
    expect((await http(requester, `/support-cases/${created.supportCaseId}/consent`)).status).toBe(403);
    const approved = await http(admin, review, { decision });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ status: 'active', userId: requester.userId, role: decision === 'transfer' ? 'primary' : 'secondary' });
    expect((await http(requester, `/support-cases/${created.supportCaseId}/consent`)).status).toBe(200);
    expect((await http(counselor, `/support-cases/${created.supportCaseId}/consent`)).status).toBe(decision === 'transfer' ? 403 : 200);
    expect((await http(admin, review, { decision })).status).toBe(409);
    const audits = await t.db.prepare("SELECT detail FROM audit_log WHERE org_id = ? AND target_id = ? AND action = 'update'").bind(admin.orgId, pending.id).all<{ detail: string }>();
    expect(audits.results.map(row => JSON.parse(row.detail))).toEqual([expect.objectContaining({ decision })]);
  });

  it('records rejection without granting access and refuses malformed or foreign requests', async () => {
    const created = await seed();
    const path = `/support-cases/${created.supportCaseId}/assignment-requests`;
    expect((await http(requester, path, { reason: ' ' })).status).toBe(400);
    expect((await http(requester, path, { reason: requestReason, userId: counselor.userId })).status).toBe(400);
    expect((await http(otherOrgAdmin, path, { reason: requestReason })).status).toBe(403);
    const pending = await (await http(requester, path, { reason: requestReason })).json() as { id: string };
    const review = `${path}/${pending.id}/review`;
    expect((await http(admin, review, { decision: 'reject', reason: ' ' })).status).toBe(400);
    const rejected = await http(admin, review, { decision: 'reject', reason: '합성 배정 거절' });
    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toMatchObject({ id: pending.id, status: 'ended' });
    expect((await http(requester, `/support-cases/${created.supportCaseId}/consent`)).status).toBe(403);
    expect((await http(admin, review, { decision: 'coassign' })).status).toBe(409);
  });

  it('commits only one competing review and rechecks the requested worker before approval', async () => {
    const created = await seed();
    const path = `/support-cases/${created.supportCaseId}/assignment-requests`;
    const pending = await (await http(requester, path, { reason: requestReason })).json() as { id: string };
    const review = `${path}/${pending.id}/review`;
    await t.db.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(requester.userId).run();
    expect((await http(admin, review, { decision: 'coassign' })).status).toBe(403);
    await t.db.prepare('UPDATE users SET active = 1 WHERE id = ?').bind(requester.userId).run();
    const results = await Promise.all([
      http(admin, review, { decision: 'coassign' }),
      http(admin, review, { decision: 'reject', reason: '합성 경합 거절' }),
    ]);
    expect(results.map(response => response.status).sort()).toEqual([200, 409]);
    const accepted = results[0]!.status === 200;
    expect((await http(requester, `/support-cases/${created.supportCaseId}/consent`)).status).toBe(accepted ? 200 : 403);
    const audit = await t.db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE org_id = ? AND target_id = ? AND action = 'update'")
      .bind(admin.orgId, pending.id).first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });
});

describe('existing administrator practitioner directory contract', () => {
  it('uses an active canonical worker directory ID for registration and rejects it after deactivation', async () => {
    await t.reset();
    const userId = crypto.randomUUID();
    await t.db.prepare("INSERT INTO users(id, org_id, email, name, role, active) VALUES (?, ?, ?, ?, 'counselor', 1)").bind(userId, admin.orgId, 'synthetic-worker@example.invalid', '합성 실무자').run();
    const response = await http(admin, '/settings/accounts');
    expect(response.status).toBe(200);
    const directory = await response.json() as DirectoryAccountsView;
    const option = directory.accounts.find(account => account.id === userId && account.active && account.roles.includes('worker'));
    expect(option).toMatchObject({ id: userId, name: '합성 실무자', roles: ['worker'] });
    expect(directory.accounts.some(account => account.id === otherOrgAdmin.userId)).toBe(false);
    expect((await http(counselor, '/settings/accounts')).status).toBe(403);
    const input = await registrationInput(t.env, admin, { programId: testProgramId(admin.orgId), initialAssigneeUserId: option!.id });
    const created = await http(admin, '/participants', input);
    expect(created.status).toBe(201);
    const participant = await created.json() as { supportCaseId: string };
    const assignments = await (await http(admin, `/support-cases/${participant.supportCaseId}/assignees`)).json();
    expect(assignments).toMatchObject({ assignees: [expect.objectContaining({ userId, status: 'active' })] });
    await t.db.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(userId).run();
    // 재시도 영수증에 걸리지 않도록 새 등록 시도로 보낸다 — 비활성 실무자 지정은 그때 막혀야 한다.
    expect((await http(admin, '/participants', { ...input, idempotencyKey: crypto.randomUUID() })).status).toBe(403);
  });
});

describe('server-authoritative intake write permission', () => {
  it.each(['writer', 'admin-only', 'nonassigned-admin-practitioner', 'supervisor', 'closed', 'closed-program'] as const)(
    'keeps saved intake readable with one PII audit for %s',
    async (access) => {
      const created = await seed();
      const input = await intakeInput(t.env, counselor, created.supportCaseId);
      input.questionnaire = intakeQuestionnaire(input.questionnaire.moduleSnapshot, [{ key: 'managerOpinion', response: 'answered', text: '합성 인테이크 기록' }]);
      const saved = await createIntakeRecord(t.env, counselor, created.supportCaseId, input);
      let reader: Actor = counselor;
      if (access === 'admin-only' || access === 'nonassigned-admin-practitioner') {
        reader = admin;
        if (access === 'nonassigned-admin-practitioner') await grantTestPractitionerRole(t.db, admin);
      } else if (access === 'supervisor') {
        reader = requester;
        await t.db.batch([
          t.db.prepare('INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)')
            .bind('intake-team', admin.orgId, '합성 감독 팀', admin.userId),
          t.db.prepare('INSERT INTO team_memberships (id, org_id, team_id, user_id, added_by) VALUES (?, ?, ?, ?, ?)')
            .bind('intake-member', admin.orgId, 'intake-team', counselor.userId, admin.userId),
          t.db.prepare('INSERT INTO team_supervisor_grants (id, org_id, team_id, supervisor_user_id, granted_by) VALUES (?, ?, ?, ?, ?)')
            .bind('intake-supervisor', admin.orgId, 'intake-team', requester.userId, admin.userId),
        ]);
      } else if (access === 'closed') {
        await closeSupportCase(t.env, counselor, created.supportCaseId, '합성 종결');
      }
      if (access === 'closed-program') {
        const snapshot = input.questionnaire.moduleSnapshot;
        expect((await http(admin, `/programs/${snapshot.programId}`, {
          expectedVersion: snapshot.programVersion, status: 'closed',
        }, 'PATCH')).status).toBe(200);
        expect(await t.db.prepare('SELECT status FROM support_cases WHERE id = ?')
          .bind(created.supportCaseId).first()).toEqual({ status: 'active' });
      }
      const path = `/support-cases/${created.supportCaseId}/records/intake`;
      const before = await piiAuditCount();
      const auditBefore = await t.db.prepare('SELECT COUNT(*) AS count FROM audit_log').first<{ count: number }>();
      const response = await http(reader, path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        canWrite: access === 'writer', hasIntake: true,
        participant: { name: pii.name },
        saved: { sessionId: saved.record.id, schemaVersion: 2, questionnaire: { answers: expect.arrayContaining([{ key: 'managerOpinion', response: 'answered', text: '합성 인테이크 기록' }]) } },
      });
      expect(await piiAuditCount()).toBe(before + 1);
      const auditAfter = await t.db.prepare('SELECT COUNT(*) AS count FROM audit_log').first<{ count: number }>();
      expect(auditAfter?.count).toBe(auditBefore!.count + 1);

      const edit = { schemaVersion: 3, expectedRevision: 1, heldAt: saved.record.heldAt, channel: 'in_person',
        additionalItemRefs: [], questionWithdrawals: [],
        questionnaire: intakeQuestionnaire(input.questionnaire.moduleSnapshot, [{ key: 'managerOpinion', response: 'answered', text: '합성 수정 기록' }]) };
      const updated = await http(reader, path, edit, 'PUT');
      const closed = access === 'closed' || access === 'closed-program';
      expect(updated.status).toBe(access === 'writer' ? 200 : closed ? 409 : 403);
      if (access !== 'writer') {
        const post = await http(reader, path, { ...input, submissionId: crypto.randomUUID() });
        expect(post.status).toBe(closed ? 409 : 403);
        const unchanged = await t.db.prepare('SELECT intake_details FROM sessions WHERE id = ?')
          .bind(saved.record.id).first<{ intake_details: string }>();
        expect(JSON.parse(unchanged!.intake_details).answers).toContainEqual({ key: 'managerOpinion', response: 'answered', text: '합성 인테이크 기록' });
      }
    },
  );

  it('does not grant intake read access to an unassigned practitioner or a foreign administrator', async () => {
    const created = await seed();
    await createIntakeRecord(t.env, counselor, created.supportCaseId, await intakeInput(t.env, counselor, created.supportCaseId));
    const before = await piiAuditCount();
    for (const reader of [requester, otherOrgAdmin]) {
      expect((await http(reader, `/support-cases/${created.supportCaseId}/records/intake`)).status).toBe(403);
    }
    expect(await piiAuditCount()).toBe(before);
  });

  it('returns writable initial and subsequent creation results for the assigned active practitioner without reading PII', async () => {
    await t.reset();
    const programId = testProgramId(counselor.orgId);
    const input = await registrationInput(t.env, counselor, { programId, name: pii.name });
    const before = await piiAuditCount();
    const initialResponse = await http(counselor, '/participants', input);
    expect(initialResponse.status).toBe(201);
    const initial = await initialResponse.json() as SupportCaseCreationResult;
    expect(initial.canWriteIntake).toBe(true);
    const subsequentResponse = await http(counselor, `/participants/${initial.beneficiaryId}/support-cases`, {
      schemaVersion: 1, submissionId: crypto.randomUUID(), programId,
      sourceSupportCaseId: initial.supportCaseId,
      consentEvents: await registrationConsentEvents(t.env, counselor, programId),
    });
    expect(subsequentResponse.status).toBe(201);
    expect(await subsequentResponse.json()).toMatchObject({ canWriteIntake: true, replayed: false });
    expect(await piiAuditCount()).toBe(before);

    // The initial receipt remains replayable after assignment loss, but is not a write grant.
    await t.db.prepare("UPDATE support_case_assignees SET status = 'ended', unassigned_at = ? WHERE support_case_id = ? AND user_id = ?")
      .bind(new Date().toISOString(), initial.supportCaseId, counselor.userId).run();
    const replay = await http(counselor, '/participants', input);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ supportCaseId: initial.supportCaseId, replayed: true, canWriteIntake: false });
    expect(await piiAuditCount()).toBe(before);
  });

  it.each(['initial', 'subsequent'] as const)(
    'keeps %s creation retries non-writable after program closure without reading PII',
    async (kind) => {
      await t.reset();
      const programId = testProgramId(counselor.orgId);
      const initialInput = await registrationInput(t.env, counselor, { programId });
      const initial = await createBeneficiaryWithInitialSupportCase(t.env, counselor, initialInput);
      const path = kind === 'initial' ? '/participants' : `/participants/${initial.beneficiaryId}/support-cases`;
      const input = kind === 'initial' ? initialInput : {
        schemaVersion: 1, submissionId: crypto.randomUUID(), programId,
        sourceSupportCaseId: initial.supportCaseId,
        consentEvents: await registrationConsentEvents(t.env, counselor, programId),
      };
      const before = await piiAuditCount();
      const response = await http(counselor, path, input);
      expect(response.status).toBe(201);
      const created = await response.json() as SupportCaseCreationResult;
      expect(created.canWriteIntake).toBe(true);
      const snapshot = (await intakeInput(t.env, counselor, created.supportCaseId)).questionnaire.moduleSnapshot;
      expect((await http(admin, `/programs/${programId}`, {
        expectedVersion: snapshot.programVersion, status: 'closed',
      }, 'PATCH')).status).toBe(200);
      expect(await t.db.prepare('SELECT status FROM support_cases WHERE id = ?')
        .bind(created.supportCaseId).first()).toEqual({ status: 'active' });
      const readRegistrationRows = () => Promise.all([
        ['support_cases', 'id'],
        ['support_case_assignees', 'id'],
        ['consent_events', 'id'],
        ['participant_registration_receipts', 'idempotency_key, actor_id'],
      ].map(async ([table, orderBy]) => (await t.db.prepare(
        `SELECT * FROM ${table} WHERE org_id = ? ORDER BY ${orderBy}`,
      ).bind(counselor.orgId).all()).results));
      const rowsBefore = await readRegistrationRows();
      const replay = await http(counselor, path, input);
      if (kind === 'initial') {
        expect(replay.status).toBe(201);
        expect(await replay.json()).toEqual({ ...created, replayed: true, canWriteIntake: false });
      } else {
        // Subsequent registration checks current program admission before looking up its receipt.
        expect(replay.status).toBe(409);
        expect(await replay.json()).toEqual({ error: 'program_admission_required', reason: 'program_closed' });
      }
      expect(await readRegistrationRows()).toEqual(rowsBefore);
      expect(await piiAuditCount()).toBe(before);
    },
  );

  it.each(['initial', 'subsequent'] as const)(
    'recomputes %s creation replay permission after assignment and independent role changes',
    async (kind) => {
      const initial = await seed();
      const initialAssigneeUserId = crypto.randomUUID();
      await t.db.prepare("INSERT INTO users(id, org_id, email, name, role, active) VALUES (?, ?, ?, ?, 'counselor', 1)")
        .bind(initialAssigneeUserId, admin.orgId, 'synthetic-replay-worker@example.invalid', '합성 재시도 실무자').run();
      const programId = testProgramId(admin.orgId);
      const path = kind === 'initial' ? '/participants' : `/participants/${initial.beneficiaryId}/support-cases`;
      const input = kind === 'initial'
        ? await registrationInput(t.env, admin, { programId, initialAssigneeUserId })
        : { schemaVersion: 1, submissionId: crypto.randomUUID(), programId, initialAssigneeUserId,
          consentEvents: await registrationConsentEvents(t.env, admin, programId) };
      const before = await piiAuditCount();
      const response = await http(admin, path, input);
      expect(response.status).toBe(201);
      const created = await response.json() as SupportCaseCreationResult;
      expect(created.canWriteIntake).toBe(false);

      await grantTestPractitionerRole(t.db, admin);
      await assignSupportCase(t.env, admin, created.supportCaseId, admin.userId);
      const assignedReplay = await http(admin, path, input);
      expect(assignedReplay.status).toBe(kind === 'initial' ? 201 : 200);
      expect(await assignedReplay.json()).toEqual({ ...created, replayed: true, canWriteIntake: true });

      // Keep the Actor and assignment unchanged: the database role, not cached roles, decides.
      await t.db.prepare("UPDATE user_role_assignments SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND role = 'practitioner' AND revoked_at IS NULL")
        .bind(new Date().toISOString(), admin.orgId, admin.userId).run();
      const revokedReplay = await http(admin, path, input);
      expect(revokedReplay.status).toBe(kind === 'initial' ? 201 : 200);
      expect(await revokedReplay.json()).toEqual({ ...created, replayed: true, canWriteIntake: false });
      expect(await piiAuditCount()).toBe(before);
    },
  );
});
