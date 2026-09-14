import { beforeEach, describe, expect, it } from 'vitest';
import type { ProgramListResponse, ProgramMutationResponse } from '@ccc/contracts/program-admission';
import {
  activateAiProviderConfiguration,
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createCounselingSchedule,
  createGoal,
  createIntakeRecord,
  createSupportCase,
  getActiveAiProviderRuntimeMetadataForService,
  recordMaskedSourceSnapshot,
  registerAiProviderConfiguration,
  setSupportCaseOverallGoal,
  updateParticipantPii,
  type Actor,
} from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { seedCanonicalSttConsent, sha256Hex } from './support/agent-jobs';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId } from './support/d1';
import { intakeInput, intakeQuestionnaire } from './support/intake';
import { registrationConsentEvents, registrationInput } from './support/registration';

const t = setupD1();
const { admin, counselor, otherOrgAdmin, service, unassignedCounselor } = testActors;

beforeEach(async () => {
  await t.reset();
});

function http(actor: Actor, path: string, init: RequestInit = {}): Promise<Response> {
  return handleRequest(new Request(`http://localhost${path}`, init), t.env, async () => actor);
}

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = csv.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < csv.length) {
    const char = csv[index]!;
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      }
      if (char === '"') quoted = false;
      else field += char;
      index += 1;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
    index += 1;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function createOtherProgram(): Promise<string> {
  const contextResponse = await http(admin, '/programs');
  const context = await contextResponse.json() as ProgramListResponse;
  const response = await http(admin, '/programs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      displayName: '다른 사업 제외 표식',
      storageMode: 'supabase_seoul',
      processingMode: 'external_allowed',
      confirmation: {
        copyVersion: context.admissionCopy.version,
        copyHash: context.admissionCopy.hash,
        installationPolicyVersion: context.installation.policyVersion,
        installationConfigHash: context.installation.configHash,
      },
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as ProgramMutationResponse).program.id;
}

async function createUnapprovedDraft(sessionId: string): Promise<void> {
  const maskedText = 'MASKED_CSV_SOURCE';
  const hash = await sha256Hex(maskedText);
  const evidenceId = `csv-evidence-${sessionId}`;
  const snapshot = await recordMaskedSourceSnapshot(t.env, service, sessionId, {
    maskedText,
    sha256: hash,
    maskingPipelineVersion: 'ner-mask-v1',
    evidence: [{
      id: evidenceId,
      sourceRef: 'memo:csv-source',
      sourceSha256: hash,
      evidenceQuote: maskedText,
      sourceStart: 0,
      sourceEnd: maskedText.length,
    }],
  });
  const selection = await getActiveAiProviderRuntimeMetadataForService(t.env, service, sessionId);
  const scope = await t.db.prepare('SELECT support_case_id FROM sessions WHERE id = ?')
    .bind(sessionId).first<{ support_case_id: string }>();
  if (scope === null) throw new Error('missing CSV draft fixture session');
  const workItemId = crypto.randomUUID();
  const draftId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await t.db.batch([
    t.db.prepare(
      `INSERT INTO ai_work_items (id, org_id, support_case_id, session_id, kind, created_at)
       VALUES (?, ?, ?, ?, 'text_ai_briefing', ?)`,
    ).bind(workItemId, counselor.orgId, scope.support_case_id, sessionId, createdAt),
    t.db.prepare(
      `INSERT INTO ai_draft_versions (
         id, work_item_id, version, parent_version_id, summary_text, questions_json,
         source_snapshot_id, source_snapshot_hash, consent_evidence_id, consent_revision,
         consent_receipt_json, provider_config_id, model_id, prompt_version, schema_version,
         origin, creation_mode, grounding_status, created_by, created_at, one_liner, claims_json
       ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated',
                 'provider_generated', 'grounded', ?, ?, ?, ?)`,
    ).bind(
      draftId,
      workItemId,
      'UNAPPROVED_DRAFT_CANARY',
      JSON.stringify([
        { title: '합성 질문 하나', reason: '합성 사유 하나' },
        { title: '합성 질문 둘', reason: '합성 사유 둘' },
      ]),
      snapshot.id,
      snapshot.sha256,
      selection.consentEvidenceId,
      selection.consentRevision,
      JSON.stringify(selection.consentReceipt),
      selection.providerConfigId,
      'gpt-5-codex',
      'csv-contract-v1',
      'schema-v1',
      service.userId,
      createdAt,
      'UNAPPROVED_ONE_LINER_CANARY',
      JSON.stringify([{ claimKey: 'csv-claim', section: 'other_topics', text: 'UNAPPROVED_DRAFT_CANARY' }]),
    ),
  ]);
}

async function seedExportFixture() {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, admin.userId, {
    sttMode: 'off',
    llmMode: 'openai',
  }, '선택 사업');
  t.env.CCC_LLM_MODE = 'openai';
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
  }));
  await updateParticipantPii(t.env, counselor, created.beneficiaryId, {
    supportCaseContextId: created.supportCaseId,
    expectedVersion: 1,
    name: '김한글',
    phone: '010-1234-5678',
    email: 'csv@example.invalid',
    account: '합성계좌-123',
    birthDate: '1990-02-03',
    region: '서울',
    gender: '응답하지 않음',
  });
  await setSupportCaseOverallGoal(t.env, counselor, created.supportCaseId, '주거 안정과 생활 회복');
  const goal = await createGoal(t.env, counselor, created.supportCaseId, { title: '월세 계획 세우기' });
  const schedule = await createCounselingSchedule(t.env, counselor, {
    beneficiaryId: created.beneficiaryId,
    supportCaseId: created.supportCaseId,
    scheduledAt: '2026-09-14T09:00:00.000Z',
    sessionGoals: [{ body: '지원 일정 확인', caseGoalId: goal.id }],
    customQuestions: ['서류 준비 상황은 어떤가요?'],
  });
  const intake = await intakeInput(t.env, counselor, created.supportCaseId);
  intake.questionnaire = intakeQuestionnaire(intake.questionnaire.moduleSnapshot, [{
    key: 'managerOpinion', response: 'answered', text: '인테이크 전체 기록 표식',
  }]);
  await createIntakeRecord(t.env, counselor, created.supportCaseId, intake);
  const record = await createCounselingRecord(t.env, counselor, created.supportCaseId, {
    schemaVersion: 2,
    submissionId: crypto.randomUUID(),
    heldAt: '2026-09-14T09:00:00.000Z',
    channel: 'visit',
    memo: '한글, 쉼표와 "따옴표"\n둘째 줄까지 보존',
    changes: [{ area: 'housing', text: '월세 지원 결과를 기다립니다' }],
    counselorOpinion: '전체 회차 의견 표식',
    nextQuestions: ['다음 회차 질문 표식'],
    gasScores: [],
    actionItems: [{ description: '서류 제출하기', owner: 'beneficiary', dueDate: '2026-09-20' }],
    flags: [{ flagType: 'housing_livelihood_shock', quote: '주거 상황이 급변했습니다' }],
    scheduleId: schedule.id,
    expectedScheduleVersion: schedule.version,
  });
  await seedCanonicalSttConsent(t.env, counselor, created.supportCaseId);
  const config = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: 'codex',
    adapterVersion: 'v1',
    configHash: 'c'.repeat(64),
    approvalRefs: ['privacy-security-approval'],
  });
  await activateAiProviderConfiguration(t.env, admin, config.id);
  await createUnapprovedDraft(record.record.id);
  await t.db.prepare("UPDATE sessions SET audio_r2_key = ?, ai_status = 'review_ready' WHERE id = ?")
    .bind('audio/AUDIO_OBJECT_CANARY', record.record.id).run();

  const otherProgramId = await createOtherProgram();
  const other = await createSupportCase(t.env, admin, created.beneficiaryId, {
    schemaVersion: 1,
    submissionId: crypto.randomUUID(),
    programId: otherProgramId,
    initialAssigneeUserId: counselor.userId,
    consentEvents: await registrationConsentEvents(t.env, admin, otherProgramId),
  });
  await createCounselingRecord(t.env, counselor, other.supportCaseId, {
    schemaVersion: 2,
    submissionId: crypto.randomUUID(),
    heldAt: '2026-09-15T09:00:00.000Z',
    channel: 'visit',
    memo: 'OTHER_PROGRAM_SESSION_CANARY',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  return { ...created, selectedSessionId: record.record.id, otherSupportCaseId: other.supportCaseId };
}

describe('GET /support-cases/:id/export.csv', () => {
  it('exports every selected-case section and complete session content without drafts, audio, or another program', async () => {
    const fixture = await seedExportFixture();
    const response = await http(counselor, `/support-cases/${fixture.supportCaseId}/export.csv`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''ccc-support-case-${fixture.supportCaseId}.csv; filename="ccc-support-case-${fixture.supportCaseId}.csv"`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['구획', '사업ID', '사례ID', '회차ID', '항목종류', '항목ID', '상위항목ID', '순서', '필드', '값']);
    const sections = new Set(rows.slice(1).map((row) => row[0]));
    expect(sections).toEqual(new Set([
      '당사자 기본정보', '선택 사업과 사례', '담당 이력', '동의 이력', '목표', '일정',
      '인테이크 기록', '상담 기록', '액션', '리스크 플래그', '불일치', '승인 AI 기록',
      '리포트', '종결과 보관',
    ]));
    expect(csv).toContain('김한글');
    expect(csv).toContain('csv@example.invalid');
    expect(csv).toContain('주거 안정과 생활 회복');
    expect(csv).toContain('월세 계획 세우기');
    expect(csv).toContain('서류 제출하기');
    expect(csv).toContain('주거 상황이 급변했습니다');
    expect(csv).toContain(fixture.selectedSessionId);
    expect(csv).toContain('인테이크 전체 기록 표식');
    expect(csv).toContain('전체 회차 의견 표식');
    expect(csv).toContain('서류 준비 상황은 어떤가요?');
    expect(rows.some((row) => row[9] === '한글, 쉼표와 "따옴표"\n둘째 줄까지 보존')).toBe(true);
    expect(csv).not.toContain(fixture.otherSupportCaseId);
    expect(csv).not.toContain('다른 사업 제외 표식');
    expect(csv).not.toContain('OTHER_PROGRAM_SESSION_CANARY');
    expect(csv).not.toContain('UNAPPROVED_DRAFT_CANARY');
    expect(csv).not.toContain('UNAPPROVED_ONE_LINER_CANARY');
    expect(csv).not.toContain('AUDIO_OBJECT_CANARY');
  });

  it('denies unauthorized exports and records one successful download audit', async () => {
    const fixture = await seedExportFixture();
    for (const actor of [unassignedCounselor, otherOrgAdmin, service]) {
      expect((await http(actor, `/support-cases/${fixture.supportCaseId}/export.csv`)).status).toBe(403);
    }
    const before = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'export' AND support_case_id = ?",
    ).bind(fixture.supportCaseId).first<{ count: number }>();
    expect((await http(admin, `/support-cases/${fixture.supportCaseId}/export.csv`)).status).toBe(200);
    const audits = await t.db.prepare(
      "SELECT actor_id, target_table, support_case_id, detail FROM audit_log WHERE action = 'export' AND support_case_id = ? ORDER BY id",
    ).bind(fixture.supportCaseId).all<{ actor_id: string; target_table: string; support_case_id: string; detail: string }>();
    expect(audits.results).toHaveLength((before?.count ?? 0) + 1);
    expect(audits.results.at(-1)).toMatchObject({
      actor_id: admin.userId,
      target_table: 'cases',
      support_case_id: fixture.supportCaseId,
    });
    expect(JSON.parse(audits.results.at(-1)!.detail)).toMatchObject({
      schemaVersion: 1,
      prepared: true,
      format: 'csv',
      rowCount: expect.any(Number),
    });
  });
});
