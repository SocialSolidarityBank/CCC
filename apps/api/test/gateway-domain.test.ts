import { describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  DraftVersionRequiredError,
  ForbiddenError,
  StaleDraftVersionError,
  ValidationError,
  activateAiProviderConfiguration,
  approveGeneratedAiDraft,
  approveSession,
  assignSupportCase,
  cancelCounselingSchedule,
  canonicalizeJcs,
  closeCase,
  closeGoal,
  closeSupportCase,
  confirmSpeakerMapping,
  createActionItem,
  createBeneficiaryWithInitialSupportCase,
  createCase,
  createCounselingRecord,
  createCounselingSchedule,
  createFlag,
  createGeneratedAiDraft,
  createGoal,
  createOrganizationSettings,
  completeOrganizationOnboarding,
  getOrganizationProfile,
  createManualSession,
  createSupportCase,
  editAiDraftForSession,
  exportCase,
  getActiveAiProviderRuntimeMetadataForService,
  getApprovedAiBriefing,
  getBriefing,
  getCurrentGeneratedAiDraft,
  getParticipantBriefing,
  getSession,
  getTodaySchedules,
  getNextCounselingScheduleForSupportCase,
  listCounselingRecords,
  listSupportCasesForBeneficiary,
  listFlags,
  listGoals,
  listOpenActionItems,
  listSessions,
  markCounselingScheduleNoShow,
  purgeParticipantPii,
  recordGasScores,
  recordMaskedSourceSnapshot,
  recordPilotTextAiConsentEvidence,
  registerAiProviderConfiguration,
  registerPii,
  revealPii,
  registerRecording,
  rejectGeneratedAiDraft,
  reRegisterParticipantPii,
  rescheduleCounselingSchedule,
  reviewFlag,
  resolveActionItem,
  setSupportCaseOverallGoal,
  updateGoalTitle,
  updateParticipantPii,
  transferSupportCase,
  unassignSupportCase,
  unassignCase,
  updateCaseExtra,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

/**
 * 재료 하나(텍스트 맥락)뿐인 초안의 재료 증빙과 대조 3종 (D69 · ADR-0036).
 * 축은 셋 다 재료 없음이라 항목이 0개다.
 */
function singleTextMaterialInput(snapshotId: string, snapshotSha256: string) {
  return {
    materials: [{ kind: 'text_context' as const, snapshotId, snapshotSha256 }],
    contrast: [
      { axis: 'missing_from_memo' as const, status: 'no_transcript' as const, findings: [] },
      { axis: 'missing_from_transcript' as const, status: 'no_transcript' as const, findings: [] },
      { axis: 'undiscussed_session_goal' as const, status: 'no_session_goal' as const, findings: [] },
    ],
  };
}


const { counselor, admin, service } = testActors;

const t = setupD1();
const SHA256 = 'a'.repeat(64);
const canonicalActors = {
  counselor: { userId: 'user-counselor-1', orgId: 'org_demo', role: 'counselor' as const },
  secondCounselor: { userId: 'user-counselor-2', orgId: 'org_demo', role: 'counselor' as const },
  admin: { userId: 'user-admin-1', orgId: 'org_demo', role: 'admin' as const },
};

async function seedCanonicalDirectory(): Promise<void> {
  await t.db.prepare(
    `INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES
       (?, ?, 'canonical-counselor-1@example.invalid', 'counselor', 1, NULL),
       (?, ?, 'canonical-counselor-2@example.invalid', 'counselor', 1, NULL),
       (?, ?, 'canonical-admin-1@example.invalid', 'admin', 1, NULL)`,
  ).bind(
    canonicalActors.counselor.userId,
    canonicalActors.counselor.orgId,
    canonicalActors.secondCounselor.userId,
    canonicalActors.secondCounselor.orgId,
    canonicalActors.admin.userId,
    canonicalActors.admin.orgId,
  ).run();
}

/** CCC-110: 사용 허용은 support_cases.consent_text_ai_at 이 결정한다 — 근거 행과 별개로 세운다. */
async function grantCurrentTextAiConsent(caseId: string): Promise<void> {
  await t.db.prepare(
    'UPDATE support_cases SET consent_text_ai_at = ? WHERE legacy_case_id = ? OR id = ?',
  ).bind('2026-01-01T00:00:00.000Z', caseId, caseId).run();
}
async function enablePilotForCase(caseId: string): Promise<void> {
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  await recordPilotTextAiConsentEvidence(t.env, counselor, caseId, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: SHA256,
    evidenceRef: `r2://pilot-evidence/${caseId}`,
    evidenceSha256: 'f'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });
  await grantCurrentTextAiConsent(caseId);
}
const PILOT_SOURCE_SEEDS = [
  {
    key: 'initial',
    sourceRef: 'memo:source-1',
    evidenceQuote: 'MASKED_EVIDENCE_DEMO',
  },
  {
    key: 'edit',
    sourceRef: 'memo:source-2',
    evidenceQuote: 'MASKED_EDIT_EVIDENCE',
  },
  {
    key: 'replacement',
    sourceRef: 'memo:replacement',
    evidenceQuote: 'MASKED_REPLACEMENT_EVIDENCE',
  },
  {
    key: 'terminal',
    sourceRef: 'memo:terminal',
    evidenceQuote: 'MASKED_TERMINAL_EVIDENCE',
  },
] as const;

interface SeededSourceEvidence {
  id: string;
  sourceRef: string;
  evidenceQuote: string;
  sourceStart: number;
  sourceEnd: number;
}

interface SeededMaskedSource {
  snapshotId: string;
  snapshotHash: string;
  evidenceByKey: Record<string, SeededSourceEvidence>;
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function seedMaskedSourceSnapshot(
  caseId: string,
  sessionId: string,
  idPrefix: string,
  sources: ReadonlyArray<Readonly<{ key: string; sourceRef: string; evidenceQuote: string }>>,
): Promise<SeededMaskedSource> {
  const maskedText = sources.length === 0
    ? 'MASKED_SOURCE_BASELINE'
    : sources.map((source) => source.evidenceQuote).join('\n');
  const evidenceByKey: Record<string, SeededSourceEvidence> = {};
  let sourceStart = 0;
  for (const source of sources) {
    const sourceEnd = sourceStart + source.evidenceQuote.length;
    evidenceByKey[source.key] = {
      id: `${idPrefix}-evidence-${source.key}`,
      sourceRef: source.sourceRef,
      evidenceQuote: source.evidenceQuote,
      sourceStart,
      sourceEnd,
    };
    sourceStart = sourceEnd + 1;
  }

  const snapshotHash = await sha256Hex(maskedText);
  const snapshot = await recordMaskedSourceSnapshot(t.env, service, sessionId, {
    maskedText,
    sha256: snapshotHash,
    maskingPipelineVersion: 'ner-mask-v1',
    evidence: Object.values(evidenceByKey).map((evidence) => ({
      id: evidence.id,
      sourceRef: evidence.sourceRef,
      sourceSha256: snapshotHash,
      evidenceQuote: evidence.evidenceQuote,
      sourceStart: evidence.sourceStart,
      sourceEnd: evidence.sourceEnd,
    })),
  });
  if (snapshot.caseId !== caseId) throw new Error('masked source snapshot case mismatch');
  return {
    snapshotId: snapshot.id,
    snapshotHash: snapshot.sha256,
    evidenceByKey,
  };
}
const OFFICIAL_CANARIES = {
  transcript: 'UNAPPROVED_TRANSCRIPT_CANARY',
  schema: 'UNAPPROVED_SCHEMA_CANARY',
  contrast: 'UNAPPROVED_CONTRAST_CANARY',
  emotion: 'UNAPPROVED_EMOTION_CANARY',
  draft: 'UNAPPROVED_DRAFT_CANARY',
  oneLiner: 'UNAPPROVED_ONE_LINER_CANARY',
  evidence: 'UNAPPROVED_EVIDENCE_CANARY',
  providerApproval: 'UNAPPROVED_PROVIDER_APPROVAL_CANARY',
  providerModel: 'UNAPPROVED_PROVIDER_MODEL_CANARY',
  consent: 'UNAPPROVED_CONSENT_EVIDENCE_CANARY',
} as const;

interface PendingOfficialCanaryFixture {
  caseId: string;
  sessionId: string;
  workItemId: string;
  draftId: string;
}

function expectNoCanaries(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('expected serializable value');
  for (const canary of canaries) {
    expect(serialized).not.toContain(canary);
  }
}

async function createPendingOfficialCanaryFixture(): Promise<PendingOfficialCanaryFixture> {
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  const config = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: 'codex',
    adapterVersion: 'v1',
    configHash: 'd'.repeat(64),
    approvalRefs: [OFFICIAL_CANARIES.providerApproval],
  });
  await activateAiProviderConfiguration(t.env, admin, config.id);

  const caseRecord = await createCase(t.env, counselor, {});
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '01000000-0000-4000-8000-000000000001',
    heldAt: '2026-01-02T10:00:00.000Z',
    channel: 'in_person',
    memo: 'MANUAL_OFFICIAL_MEMO',
    gasScores: [],
  });
  const consent = await recordPilotTextAiConsentEvidence(t.env, counselor, caseRecord.id, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: SHA256,
    evidenceRef: OFFICIAL_CANARIES.consent,
    evidenceSha256: 'e'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });
  await grantCurrentTextAiConsent(caseRecord.id);
  const source = await seedMaskedSourceSnapshot(
    caseRecord.id,
    session.id,
    'official-canary-source',
    [{
      key: 'official',
      sourceRef: 'memo:official-source',
      evidenceQuote: OFFICIAL_CANARIES.evidence,
    }],
  );
  const evidence = source.evidenceByKey.official;
  if (evidence === undefined) throw new Error('expected seeded official evidence');

  await t.db.prepare(
    `UPDATE sessions
     SET ai_status = ?, transcript = ?, ai_schema = ?, ai_contrast = ?, emotion_scores = ?
     WHERE id = ?`,
  ).bind(
    'review_ready',
    OFFICIAL_CANARIES.transcript,
    JSON.stringify({ [OFFICIAL_CANARIES.schema]: 'masked schema value' }),
    JSON.stringify({
      missingFromMemo: [OFFICIAL_CANARIES.contrast],
      missingFromAudio: [],
      undiscussedGoals: [],
    }),
    JSON.stringify({ [OFFICIAL_CANARIES.emotion]: 0.314159 }),
    session.id,
  ).run();

  const workItemId = 'official-canary-work';
  const draftId = 'official-canary-draft';
  const createdAt = '2026-07-01T00:00:00.000Z';
  const sessionScope = await t.db.prepare(
    'SELECT support_case_id FROM sessions WHERE id = ? AND org_id = ?',
  ).bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
  if (sessionScope === null) throw new Error('expected canonical session scope');
  await t.db.prepare(
    'INSERT INTO ai_work_items (id, org_id, support_case_id, session_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(workItemId, counselor.orgId, sessionScope.support_case_id, session.id, 'text_ai_briefing', createdAt).run();
  await t.db.prepare(
    `INSERT INTO ai_draft_versions (
      id, work_item_id, version, parent_version_id, summary_text, one_liner, questions_json,
      source_snapshot_id, source_snapshot_hash, consent_evidence_id, provider_config_id, model_id, prompt_version, schema_version,
      origin, creation_mode, grounding_status, created_by, created_at
    ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', 'provider_generated', 'grounded', ?, ?)`,
  ).bind(
    draftId,
    workItemId,
    OFFICIAL_CANARIES.draft,
    OFFICIAL_CANARIES.oneLiner,
    JSON.stringify(['상황 일정에 변동이 있었나요?', '주거비 변화가 있었나요?']),
    source.snapshotId,
    source.snapshotHash,
    consent.id,
    config.id,
    OFFICIAL_CANARIES.providerModel,
    'provider-prompt-v1',
    'provider-schema-v1',
    counselor.userId,
    createdAt,
  ).run();
  await t.db.prepare(
    `INSERT INTO ai_evidence_links (
      id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    'official-canary-evidence-link',
    draftId,
    evidence.id,
    'official-claim',
    evidence.evidenceQuote,
    evidence.sourceRef,
    evidence.sourceStart,
    evidence.sourceEnd,
    createdAt,
  ).run();
  await t.db.prepare(
    `INSERT INTO ai_evidence_links (
      id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    'official-canary-question-1',
    draftId,
    evidence.id,
    'question_1',
    evidence.evidenceQuote,
    evidence.sourceRef,
    evidence.sourceStart,
    evidence.sourceEnd,
    createdAt,
    'official-canary-question-2',
    draftId,
    evidence.id,
    'question_2',
    evidence.evidenceQuote,
    evidence.sourceRef,
    evidence.sourceStart,
    evidence.sourceEnd,
    createdAt,
  ).run();

  return {
    caseId: caseRecord.id,
    sessionId: session.id,
    workItemId,
    draftId,
  };
}

async function createReviewReadySession() {
  const caseRecord = await createCase(t.env, counselor, {
    consentRecordingAt: '2026-01-01T00:00:00.000Z',
  });
  await enablePilotForCase(caseRecord.id);
  const goal = await createGoal(t.env, counselor, caseRecord.id, {
    title: 'Maintain a measurable routine for three weeks',
  });
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '01000000-0000-4000-8000-000000000002',
    heldAt: '2026-01-02T10:00:00.000Z',
    channel: 'in_person',
    memo: 'MANUAL_MEMO_DEMO',
    gasScores: [{ goalId: goal.id, score: 0 }],
  });

  await registerRecording(t.env, counselor, session.id, 'audio/demo/session-1');
  const config = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: 'codex',
    adapterVersion: 'v1',
    configHash: 'b'.repeat(64),
    approvalRefs: ['privacy-security-approval'],
  });
  await activateAiProviderConfiguration(t.env, admin, config.id);
  const source = await seedMaskedSourceSnapshot(
    caseRecord.id,
    session.id,
    'review-ready-source',
    [{ key: 'review', sourceRef: 'memo:review', evidenceQuote: 'MASKED_TRANSCRIPT_DEMO' }],
  );
  const sourceEvidence = source.evidenceByKey.review;
  if (sourceEvidence === undefined) throw new Error('expected review source evidence');
  const selection = await getActiveAiProviderRuntimeMetadataForService(t.env, service, session.id);
  const draft = await createGeneratedAiDraft(t.env, service, session.id, {
    summaryText: 'AI_SUMMARY_DEMO',
    oneLiner: 'AI_ONE_LINER_DEMO',
    questions: [
      { title: '상황 일정에 변동이 있었나요?', reason: '지난 회차에서 일정 변동 가능성이 언급되었습니다.' },
      { title: '주거비 변화가 있었나요?', reason: '지난 회차에서 주거비 부담이 화제였습니다.' },
    ],
    sourceSnapshotId: source.snapshotId,
    sourceSnapshotHash: source.snapshotHash,
    ...singleTextMaterialInput(source.snapshotId, source.snapshotHash),
    providerConfigId: selection.providerConfigId,
    consentEvidenceId: selection.consentEvidenceId,
    modelId: 'gpt-5-codex',
    promptVersion: 'prompt-v1',
    schemaVersion: 'schema-v1',
    evidence: [
      {
        claimKey: 'review-claim',
        sourceEvidenceItemId: sourceEvidence.id,
        evidenceQuote: sourceEvidence.evidenceQuote,
        sourceRef: sourceEvidence.sourceRef,
        sourceStart: sourceEvidence.sourceStart,
        sourceEnd: sourceEvidence.sourceEnd,
      },
      {
        claimKey: 'question_1',
        sourceEvidenceItemId: sourceEvidence.id,
        evidenceQuote: sourceEvidence.evidenceQuote,
        sourceRef: sourceEvidence.sourceRef,
        sourceStart: sourceEvidence.sourceStart,
        sourceEnd: sourceEvidence.sourceEnd,
      },
      {
        claimKey: 'question_2',
        sourceEvidenceItemId: sourceEvidence.id,
        evidenceQuote: sourceEvidence.evidenceQuote,
        sourceRef: sourceEvidence.sourceRef,
        sourceStart: sourceEvidence.sourceStart,
        sourceEnd: sourceEvidence.sourceEnd,
      },
    ],
  });
  await t.db.prepare(
    `UPDATE sessions
     SET transcript = ?, ai_schema = ?, ai_contrast = ?, emotion_scores = ?, ai_status = ?
     WHERE id = ?`,
  ).bind(
    'MASKED_TRANSCRIPT_DEMO',
    JSON.stringify({ version: 'opaque' }),
    JSON.stringify({
      missingFromMemo: ['MISSING_MEMO_ITEM'],
      missingFromAudio: ['MISSING_AUDIO_ITEM'],
      undiscussedGoals: [goal.id],
    }),
    JSON.stringify({ combined: 0.4, timeline: [0.1, 0.4] }),
    'review_ready',
    session.id,
  ).run();
  await t.db.prepare(
    `INSERT INTO flags (
       id, org_id, support_case_id, session_id, flag_type, quote, source, review_status, created_at
     )
     SELECT ?, org_id, support_case_id, id, 'contact_loss_risk', ?, 'ai', 'pending', ?
     FROM sessions WHERE id = ? AND org_id = ?`,
  ).bind(
    'review-ready-flag',
    'MASKED_QUOTE_DEMO',
    '2026-07-01T00:00:00.000Z',
    session.id,
    counselor.orgId,
  ).run();
  await t.db.prepare(
    'INSERT INTO ai_gas_evidence (id, org_id, session_id, goal_id, quote, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    'review-ready-gas-evidence',
    counselor.orgId,
    session.id,
    goal.id,
    'MASKED_GAS_QUOTE_DEMO',
    '2026-07-01T00:00:00.000Z',
  ).run();

  return { caseRecord, goal, session, draft };
}
async function createPilotDraft(
  evidence = [{
    claimKey: 'claim-1',
    evidenceQuote: 'MASKED_EVIDENCE_DEMO',
    sourceRef: 'memo:source-1',
    sourceStart: 0,
    sourceEnd: 20,
  }],
) {
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  const config = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: 'codex',
    adapterVersion: 'v1',
    configHash: 'b'.repeat(64),
    approvalRefs: ['privacy-security-approval'],
  });
  await activateAiProviderConfiguration(t.env, admin, config.id);

  const caseRecord = await createCase(t.env, counselor, {});
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '01000000-0000-4000-8000-000000000003',
    heldAt: '2026-01-02T10:00:00.000Z',
    channel: 'in_person',
    memo: 'MANUAL_MEMO_DEMO',
    gasScores: [],
  });
  await recordPilotTextAiConsentEvidence(t.env, counselor, caseRecord.id, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: SHA256,
    evidenceRef: 'r2://opaque-pilot-evidence',
    evidenceSha256: 'c'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });
  await grantCurrentTextAiConsent(caseRecord.id);
  const source = await seedMaskedSourceSnapshot(
    caseRecord.id,
    session.id,
    'pilot-source',
    PILOT_SOURCE_SEEDS,
  );
  const sourceEvidence = evidence.map((item) => {
    const seeded = Object.values(source.evidenceByKey).find((candidate) => (
      candidate.sourceRef === item.sourceRef && candidate.evidenceQuote === item.evidenceQuote
    ));
    if (seeded === undefined) throw new Error(`missing seeded source evidence for ${item.claimKey}`);
    return {
      ...item,
      sourceEvidenceItemId: seeded.id,
      sourceStart: seeded.sourceStart,
      sourceEnd: seeded.sourceEnd,
    };
  });
  const selection = await getActiveAiProviderRuntimeMetadataForService(t.env, service, session.id);
  const draft = await createGeneratedAiDraft(t.env, service, session.id, {
    summaryText: 'GROUNDED_AI_SUMMARY_DEMO',
    oneLiner: 'GROUNDED_AI_ONE_LINER_DEMO',
    questions: [
      { title: '상황 일정에 변동이 있었나요?', reason: '지난 회차에서 일정 변동 가능성이 언급되었습니다.' },
      { title: '주거비 변화가 있었나요?', reason: '지난 회차에서 주거비 부담이 화제였습니다.' },
    ],
    sourceSnapshotId: source.snapshotId,
    sourceSnapshotHash: source.snapshotHash,
    ...singleTextMaterialInput(source.snapshotId, source.snapshotHash),
    providerConfigId: selection.providerConfigId,
    consentEvidenceId: selection.consentEvidenceId,
    modelId: 'gpt-5-codex',
    promptVersion: 'prompt-v1',
    schemaVersion: 'schema-v1',
    evidence: sourceEvidence.length === 0 ? [] : [
      ...sourceEvidence,
      {
        ...sourceEvidence[0]!,
        claimKey: 'question_1',
      },
      {
        ...sourceEvidence[0]!,
        claimKey: 'question_2',
      },
    ],
  });
  return { caseRecord, session, draft, source };
}

describe('gateway domain records', () => {
  it('enforces the active-goal cap, restricts close reasons to the D62 picks, and frees the cap after closing', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});
    const first = await createGoal(t.env, counselor, caseRecord.id, { title: 'Goal one' });
    await createGoal(t.env, counselor, caseRecord.id, { title: 'Goal two' });
    await createGoal(t.env, counselor, caseRecord.id, { title: 'Goal three' });
    await expect(createGoal(t.env, counselor, caseRecord.id, { title: 'Goal four' })).rejects.toBeInstanceOf(ValidationError);

    // 닫기 사유는 선택값 3종(달성/중단/재설정)만 — 빈 사유·자유 텍스트는 거부한다 (D62 §5).
    await expect(closeGoal(t.env, counselor, first.id, '')).rejects.toBeInstanceOf(ValidationError);
    await expect(closeGoal(t.env, counselor, first.id, 'changed circumstances')).rejects.toBeInstanceOf(ValidationError);

    const closed = await closeGoal(t.env, counselor, first.id, 'achieved');
    expect(closed.status).toBe('closed');
    expect(closed.closedReason).toBe('achieved');
    // 구 종료+신설 승계 연결은 만들지 않는다.
    expect(closed.replacedByGoalId).toBeNull();

    // 닫힌 목표는 다시 닫을 수 없고(재개도 없다), 상한에서 빠져 새 목표가 들어간다.
    await expect(closeGoal(t.env, counselor, first.id, 'reset')).rejects.toBeInstanceOf(ValidationError);
    await createGoal(t.env, counselor, caseRecord.id, { title: 'Goal four' });
    expect((await listGoals(t.env, counselor, caseRecord.id)).filter((goal) => goal.status === 'active')).toHaveLength(3);
  });

  it('edits a goal title with the previous wording preserved as history (D62)', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});
    const goal = await createGoal(t.env, counselor, caseRecord.id, { title: '주 1회 저축 습관 만들기' });

    const updated = await updateGoalTitle(t.env, counselor, goal.id, '  주 1회 3만원 저축하기  ');
    expect(updated.title).toBe('주 1회 3만원 저축하기');
    expect((await listGoals(t.env, counselor, caseRecord.id))[0]?.title).toBe('주 1회 3만원 저축하기');

    // 같은 문구 재저장은 이력을 만들지 않는다.
    await updateGoalTitle(t.env, counselor, goal.id, '주 1회 3만원 저축하기');

    // 최초 작성이 첫 줄, 수정이 둘째 줄 — 이전 문구·수정자가 그대로 남는다 (D62 §4).
    const revisions = await t.db.prepare(
      'SELECT title, edited_by FROM goal_revisions WHERE goal_id = ? ORDER BY id',
    ).bind(goal.id).all<{ title: string; edited_by: string }>();
    expect(revisions.results.map((row) => row.title)).toEqual(['주 1회 저축 습관 만들기', '주 1회 3만원 저축하기']);
    expect(revisions.results.every((row) => row.edited_by === counselor.userId)).toBe(true);

    await expect(updateGoalTitle(t.env, counselor, goal.id, '   ')).rejects.toBeInstanceOf(ValidationError);

    // 닫힌 목표는 기록이다 — 문구 수정 거부.
    await closeGoal(t.env, counselor, goal.id, 'stopped');
    await expect(updateGoalTitle(t.env, counselor, goal.id, '닫힌 뒤 수정 시도')).rejects.toBeInstanceOf(ValidationError);
  });

  it('locks goal title edits on a closed support case (D62)', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});
    const goal = await createGoal(t.env, counselor, caseRecord.id, { title: '종결 전 목표' });
    await closeCase(t.env, counselor, caseRecord.id, 'program complete');
    await expect(updateGoalTitle(t.env, counselor, goal.id, '종결 후 수정 시도')).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps generated AI unofficial until immutable approval projects it through the official view', async () => {
    await t.reset();
    const { caseRecord, draft } = await createPilotDraft();

    const reviewRecord = await getCurrentGeneratedAiDraft(t.env, counselor, draft.workItemId);
    expect(reviewRecord.summaryText).toBe('GROUNDED_AI_SUMMARY_DEMO');
    expect((await listSessions(t.env, counselor, caseRecord.id))[0]?.aiSummary).toBeNull();

    const approved = await approveGeneratedAiDraft(t.env, counselor, draft.workItemId, draft.version);
    expect(approved.reviewedAt).not.toBeNull();
    expect((await listSessions(t.env, counselor, caseRecord.id))[0]?.aiSummary).toBe('GROUNDED_AI_SUMMARY_DEMO');
    const briefing = await getBriefing(t.env, counselor, caseRecord.id);
    expect(briefing.lastSessionSummary).toMatchObject({
      source: 'ai',
      text: 'GROUNDED_AI_SUMMARY_DEMO',
      pendingApprovalCount: 0,
    });
    expect(briefing.questions).toEqual(['상황 일정에 변동이 있었나요?', '주거비 변화가 있었나요?']);
  });

  it('falls back to the manual memo while a generated draft remains pending', async () => {
    await t.reset();
    const { caseRecord } = await createPilotDraft();

    const briefing = await getBriefing(t.env, counselor, caseRecord.id);
    expect(briefing.lastSessionSummary).toMatchObject({
      source: 'memo',
      text: 'MANUAL_MEMO_DEMO',
      pendingApprovalCount: 1,
    });
    expect(briefing.questions).toEqual([]);
  });
  it('keeps every unapproved AI canary out of official briefing, list, and export projections', async () => {
    await t.reset();
    const fixture = await createPendingOfficialCanaryFixture();
    const allCanaries = Object.values(OFFICIAL_CANARIES);

    const briefingBefore = await getBriefing(t.env, counselor, fixture.caseId);
    const sessionsBefore = await listSessions(t.env, counselor, fixture.caseId);
    const exportBefore = await exportCase(t.env, counselor, fixture.caseId);
    const approvedBefore = await getApprovedAiBriefing(t.env, counselor, fixture.caseId);

    expect(briefingBefore.lastSessionSummary).toEqual({
      source: 'memo',
      text: 'MANUAL_OFFICIAL_MEMO',
      pendingApprovalCount: 1,
    });
    expect(briefingBefore.questions).toEqual([]);
    expect(sessionsBefore).toHaveLength(1);
    const sessionBefore = sessionsBefore[0];
    if (sessionBefore === undefined) throw new Error('expected official session projection');
    expect(sessionBefore.id).toBe(fixture.sessionId);
    expect({
      transcript: sessionBefore.transcript,
      aiSummary: sessionBefore.aiSummary,
      aiSchema: sessionBefore.aiSchema,
      aiContrast: sessionBefore.aiContrast,
      emotionScores: sessionBefore.emotionScores,
    }).toEqual({
      transcript: null,
      aiSummary: null,
      aiSchema: null,
      aiContrast: null,
      emotionScores: null,
    });
    expect(exportBefore.sessions).toHaveLength(1);
    const exportedSessionBefore = exportBefore.sessions[0];
    if (exportedSessionBefore === undefined) throw new Error('expected exported official session');
    expect(exportedSessionBefore.id).toBe(fixture.sessionId);
    expect({
      transcript: exportedSessionBefore.transcript,
      aiSummary: exportedSessionBefore.aiSummary,
      aiSchema: exportedSessionBefore.aiSchema,
      aiContrast: exportedSessionBefore.aiContrast,
      emotionScores: exportedSessionBefore.emotionScores,
    }).toEqual({
      transcript: null,
      aiSummary: null,
      aiSchema: null,
      aiContrast: null,
      emotionScores: null,
    });
    expect(approvedBefore).toEqual([]);
    // 참여자 브리핑의 회차 줄(핵심 한 줄 포함)도 승인 전에는 어떤 캐너리도 싣지 않는다(R2·CCC-38).
    const briefingScope = await t.db.prepare(
      'SELECT id, beneficiary_id FROM support_cases WHERE COALESCE(legacy_case_id, id) = ?',
    ).bind(fixture.caseId).first<{ id: string; beneficiary_id: string }>();
    if (briefingScope === null) throw new Error('expected canonical support case scope');
    const participantBefore = await getParticipantBriefing(
      t.env, counselor, briefingScope.beneficiary_id, briefingScope.id,
    );
    expect(participantBefore.sessionRows).toEqual([expect.objectContaining({ aiOneLiner: null })]);
    expectNoCanaries(
      { briefingBefore, sessionsBefore, exportBefore, approvedBefore, participantBefore },
      allCanaries,
    );

    const approved = await approveGeneratedAiDraft(t.env, counselor, fixture.workItemId, 1);
    expect(approved.id).toBe(fixture.draftId);
    expect(approved.reviewDecision).toBe('approved');

    const briefingAfter = await getBriefing(t.env, counselor, fixture.caseId);
    const sessionsAfter = await listSessions(t.env, counselor, fixture.caseId);
    const exportAfter = await exportCase(t.env, counselor, fixture.caseId);
    const approvedAfter = await getApprovedAiBriefing(t.env, counselor, fixture.caseId);
    expect(briefingAfter.lastSessionSummary).toEqual({
      source: 'ai',
      text: OFFICIAL_CANARIES.draft,
      pendingApprovalCount: 0,
    });
    expect(briefingAfter.questions).toEqual(['상황 일정에 변동이 있었나요?', '주거비 변화가 있었나요?']);
    // 승인이 끝나야 핵심 한 줄이 공식 뷰와 브리핑 회차 줄에 실린다(CCC-38·D45 영역 ②).
    expect(approvedAfter).toEqual([expect.objectContaining({ oneLiner: OFFICIAL_CANARIES.oneLiner })]);
    const participantAfter = await getParticipantBriefing(
      t.env, counselor, briefingScope.beneficiary_id, briefingScope.id,
    );
    expect(participantAfter.sessionRows).toEqual([expect.objectContaining({
      sessionId: fixture.sessionId,
      aiOneLiner: OFFICIAL_CANARIES.oneLiner,
    })]);
    expect(sessionsAfter).toHaveLength(1);
    const sessionAfter = sessionsAfter[0];
    if (sessionAfter === undefined) throw new Error('expected approved official session');
    expect(sessionAfter.id).toBe(fixture.sessionId);
    expect({
      aiStatus: sessionAfter.aiStatus,
      transcript: sessionAfter.transcript,
      aiSummary: sessionAfter.aiSummary,
      aiSchema: sessionAfter.aiSchema,
      aiContrast: sessionAfter.aiContrast,
      emotionScores: sessionAfter.emotionScores,
    }).toEqual({
      aiStatus: 'approved',
      transcript: null,
      aiSummary: OFFICIAL_CANARIES.draft,
      aiSchema: null,
      aiContrast: null,
      emotionScores: null,
    });
    expect(exportAfter.sessions).toHaveLength(1);
    const exportedSessionAfter = exportAfter.sessions[0];
    if (exportedSessionAfter === undefined) throw new Error('expected approved export session');
    expect(exportedSessionAfter.id).toBe(fixture.sessionId);
    expect({
      aiStatus: exportedSessionAfter.aiStatus,
      transcript: exportedSessionAfter.transcript,
      aiSummary: exportedSessionAfter.aiSummary,
      aiSchema: exportedSessionAfter.aiSchema,
      aiContrast: exportedSessionAfter.aiContrast,
      emotionScores: exportedSessionAfter.emotionScores,
    }).toEqual({
      aiStatus: 'approved',
      transcript: null,
      aiSummary: OFFICIAL_CANARIES.draft,
      aiSchema: null,
      aiContrast: null,
      emotionScores: null,
    });
    expect(approvedAfter).toHaveLength(1);
    const approvedBriefing = approvedAfter[0];
    if (approvedBriefing === undefined) throw new Error('expected approved briefing row');
    expect({
      workItemId: approvedBriefing.workItemId,
      draftVersionId: approvedBriefing.draftVersionId,
      summaryText: approvedBriefing.summaryText,
      questions: approvedBriefing.questions,
      origin: approvedBriefing.origin,
      groundingStatus: approvedBriefing.groundingStatus,
    }).toEqual({
      workItemId: fixture.workItemId,
      draftVersionId: fixture.draftId,
      summaryText: OFFICIAL_CANARIES.draft,
      // SQL 시드가 v1 단문 문자열이라 reason 없이 정규화된다(하위 호환 계약).
      questions: [
        { title: '상황 일정에 변동이 있었나요?', reason: null },
        { title: '주거비 변화가 있었나요?', reason: null },
      ],
      origin: 'generated',
      groundingStatus: 'grounded',
    });
    expectNoCanaries(
      { briefingAfter, sessionsAfter, exportAfter, approvedAfter },
      // 요약과 핵심 한 줄은 승인으로 공식화됐으므로 승인 후에는 보이는 것이 맞다(CCC-38).
      allCanaries.filter((canary) => canary !== OFFICIAL_CANARIES.draft && canary !== OFFICIAL_CANARIES.oneLiner),
    );
  });


  it('keeps service-only actions separate from counselor-owned GAS approval and flag review', async () => {
    await t.reset();
    const { caseRecord, goal, session } = await createReviewReadySession();
    const flags = await listFlags(t.env, counselor, caseRecord.id);
    const aiFlag = flags[0];
    if (aiFlag === undefined) throw new Error('expected AI flag fixture');

    await expect(recordGasScores(t.env, service, session.id, [{ goalId: goal.id, score: 1 }])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(approveSession(t.env, service, session.id, {
      missingFromMemo: [],
      missingFromAudio: [],
      undiscussedGoals: [],
    })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(reviewFlag(t.env, service, aiFlag.id, 'confirmed')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('manages action items and flags while excluding unapproved AI data from export', async () => {
    await t.reset();
    const { caseRecord, session } = await createReviewReadySession();
    const action = await createActionItem(t.env, counselor, caseRecord.id, {
      description: 'ACTION_DEMO',
      owner: 'counselor',
      sessionId: session.id,
    });
    expect(await listOpenActionItems(t.env, counselor, caseRecord.id)).toEqual([
      expect.objectContaining({ id: action.id }),
    ]);
    await resolveActionItem(t.env, counselor, action.id);
    await expect(listOpenActionItems(t.env, counselor, caseRecord.id)).resolves.toEqual([]);

    const manualFlag = await createFlag(t.env, counselor, caseRecord.id, {
      flagType: 'debt_deterioration',
      quote: 'COUNSELOR_QUOTE_DEMO',
      sessionId: session.id,
    });
    expect(manualFlag.reviewStatus).toBe('confirmed');
    const aiFlag = (await listFlags(t.env, counselor, caseRecord.id)).find((flag) => flag.source === 'ai');
    if (aiFlag === undefined) throw new Error('expected AI flag fixture');
    await reviewFlag(t.env, counselor, aiFlag.id, 'rejected');
    expect(await listFlags(t.env, counselor, caseRecord.id)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: aiFlag.id }),
    ]));

    const exported = await exportCase(t.env, counselor, caseRecord.id);
    expect(exported.sessions[0]?.aiSummary).toBeNull();
    expect(exported.sessions[0]?.transcript).toBeNull();
  });



  it('keeps pending AI flags out of the briefing while showing counselor and confirmed flags', async () => {
    await t.reset();
    const { caseRecord, session } = await createReviewReadySession();

    // 수집 직후: AI 제안은 pending — 검토 화면(listFlags)에는 보이고 브리핑에는 안 보인다.
    const pendingFlag = (await listFlags(t.env, counselor, caseRecord.id)).find((flag) => flag.source === 'ai');
    if (pendingFlag === undefined) throw new Error('expected pending AI flag fixture');
    expect(pendingFlag.reviewStatus).toBe('pending');
    let briefing = await getBriefing(t.env, counselor, caseRecord.id);
    expect(briefing.flags).toEqual([]);

    const counselorFlag = await createFlag(t.env, counselor, caseRecord.id, {
      flagType: 'debt_deterioration',
      sessionId: session.id,
    });
    await reviewFlag(t.env, counselor, pendingFlag.id, 'confirmed');

    briefing = await getBriefing(t.env, counselor, caseRecord.id);
    expect(briefing.flags.map((flag) => flag.id).sort()).toEqual([counselorFlag.id, pendingFlag.id].sort());
  });
  it('rejects a versionless session approval wrapper before it can bypass immutable review', async () => {
    await t.reset();
    const { session } = await createReviewReadySession();

    await expect(approveSession(t.env, counselor, session.id, {
      missingFromMemo: [],
      missingFromAudio: [],
      undiscussedGoals: [],
    })).rejects.toBeInstanceOf(DraftVersionRequiredError);
  });

  it('rejects stale generated draft versions after an edit creates the next immutable version', async () => {
    await t.reset();
    const { draft } = await createPilotDraft();


    const selectedEvidenceId = draft.evidence.find((item) => item.claimKey === 'claim-1')?.id;
    if (selectedEvidenceId === undefined) throw new Error('expected current draft evidence');
    const edited = await editAiDraftForSession(t.env, counselor, draft.sessionId, {
      expectedVersion: draft.version,
      evidenceIds: [selectedEvidenceId],
    });
    expect(edited.version).toBe(2);
    await expect(approveGeneratedAiDraft(t.env, counselor, draft.workItemId, draft.version))
      .rejects.toBeInstanceOf(StaleDraftVersionError);
  });

  it('rejects generated drafts without grounded question or summary evidence before persistence', async () => {
    await t.reset();

    await expect(createPilotDraft([])).rejects.toBeInstanceOf(ValidationError);
    await expect(t.db.prepare('SELECT COUNT(*) AS count FROM ai_work_items').first<{ count: number }>())
      .resolves.toEqual({ count: 0 });
    await expect(t.db.prepare('SELECT COUNT(*) AS count FROM ai_draft_versions').first<{ count: number }>())
      .resolves.toEqual({ count: 0 });
    await t.reset();
    await expect(createPilotDraft([{
      claimKey: 'question_9',
      evidenceQuote: 'MASKED_EVIDENCE_DEMO',
      sourceRef: 'memo:source-1',
      sourceStart: 0,
      sourceEnd: 20,
    }])).rejects.toBeInstanceOf(ValidationError);
    await expect(t.db.prepare('SELECT COUNT(*) AS count FROM ai_work_items').first<{ count: number }>())
      .resolves.toEqual({ count: 0 });
    await expect(t.db.prepare('SELECT COUNT(*) AS count FROM ai_draft_versions').first<{ count: number }>())
      .resolves.toEqual({ count: 0 });
    for (const malformedClaimKey of ['question_0', 'question_1suffix']) {
      await t.reset();
      await expect(createPilotDraft([{
        claimKey: malformedClaimKey,
        evidenceQuote: 'MASKED_EVIDENCE_DEMO',
        sourceRef: 'memo:source-1',
        sourceStart: 0,
        sourceEnd: 20,
      }])).rejects.toBeInstanceOf(ValidationError);
      await expect(t.db.prepare('SELECT COUNT(*) AS count FROM ai_work_items').first<{ count: number }>())
        .resolves.toEqual({ count: 0 });
      await expect(t.db.prepare('SELECT COUNT(*) AS count FROM ai_draft_versions').first<{ count: number }>())
        .resolves.toEqual({ count: 0 });
    }
  });
  it('rejects evidence-only edits that select only question links', async () => {
    await t.reset();
    const { draft } = await createPilotDraft();
    const questionEvidenceId = draft.evidence.find((item) => item.claimKey === 'question_1')?.id;
    if (questionEvidenceId === undefined) throw new Error('expected question evidence');

    await expect(editAiDraftForSession(t.env, counselor, draft.sessionId, {
      expectedVersion: draft.version,
      evidenceIds: [questionEvidenceId],
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM ai_draft_versions WHERE work_item_id = ?',
    ).bind(draft.workItemId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });
  it('keeps counselor-entered GAS visible without any approved AI draft', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});
    const goal = await createGoal(t.env, counselor, caseRecord.id, { title: '생활비 계획 유지' });
    const session = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: '01000000-0000-4000-8000-000000000004',
      heldAt: '2020-01-02T10:00:00.000Z',
      channel: 'in_person',
      memo: '수기 메모',
      gasScores: [{ goalId: goal.id, score: 1 }],
    });

    const briefing = await getBriefing(t.env, counselor, caseRecord.id);
    expect(briefing.gasTrend).toEqual([
      expect.objectContaining({
        goal: expect.objectContaining({ id: goal.id }),
        points: [{ heldAt: session.heldAt, score: 1 }],
      }),
    ]);
    expect(briefing.lastSessionSummary).toMatchObject({ source: 'memo', text: '수기 메모' });
  });

  it('supersedes into a new version and rejects its terminal current version', async () => {
    await t.reset();
    const { draft } = await createPilotDraft();


    const selectedEvidenceId = draft.evidence.find((item) => item.claimKey === 'claim-1')?.id;
    if (selectedEvidenceId === undefined) throw new Error('expected current draft evidence');
    const replacement = await editAiDraftForSession(t.env, counselor, draft.sessionId, {
      expectedVersion: draft.version,
      evidenceIds: [selectedEvidenceId],
    });
    expect(replacement).toMatchObject({ version: 2, parentVersionId: draft.id });
    const rejected = await rejectGeneratedAiDraft(t.env, counselor, draft.workItemId, replacement.version);
    expect(rejected.reviewDecision).toBe('rejected');
    await expect(getCurrentGeneratedAiDraft(t.env, counselor, draft.workItemId))
      .resolves.toMatchObject({ version: 2, reviewDecision: 'rejected' });
    await expect(editAiDraftForSession(t.env, counselor, draft.sessionId, {
      expectedVersion: replacement.version,
      evidenceIds: [replacement.evidence[0]!.id],
    })).rejects.toBeInstanceOf(StaleDraftVersionError);
  });


  it('keeps a manual memo immediately official when no AI work exists', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});
    await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: '01000000-0000-4000-8000-000000000005',
      heldAt: '2026-01-02T10:00:00.000Z',
      channel: 'in_person',
      memo: 'IMMEDIATE_MANUAL_FALLBACK',
      gasScores: [],
    });

    const briefing = await getBriefing(t.env, counselor, caseRecord.id);
    expect(briefing.lastSessionSummary).toEqual({
      source: 'memo',
      text: 'IMMEDIATE_MANUAL_FALLBACK',
      pendingApprovalCount: 0,
    });
  });
});

describe('organization settings bootstrap', () => {
  it('creates explicit settings once with an audit receipt', async () => {
    await t.reset();
    const bootstrapAdmin = { userId: 'bootstrap-admin-1', orgId: 'org_bootstrap', role: 'admin' as const };
    await t.db.prepare(
      `INSERT INTO users (id, org_id, email, role, active)
       VALUES (?, ?, 'bootstrap-admin@example.invalid', 'admin', 1)`,
    ).bind(bootstrapAdmin.userId, bootstrapAdmin.orgId).run();

    const settings = await createOrganizationSettings(t.env, bootstrapAdmin, {
      timeZone: 'Asia/Seoul',
      piiPurgeGraceDays: 365,
    });
    expect(settings).toMatchObject({
      orgId: bootstrapAdmin.orgId,
      timeZone: 'Asia/Seoul',
      piiPurgeGraceDays: 365,
      version: 1,
    });
    await expect(createOrganizationSettings(t.env, bootstrapAdmin, {
      timeZone: 'Asia/Seoul',
      piiPurgeGraceDays: 365,
    })).rejects.toBeInstanceOf(ConflictError);

    const audit = await t.db.prepare(
      `SELECT action, target_table, target_id
       FROM audit_log
       WHERE org_id = ? AND target_table = 'organization_settings'`,
    ).bind(bootstrapAdmin.orgId).first<{ action: string; target_table: string; target_id: string }>();
    expect(audit).toEqual({
      action: 'create',
      target_table: 'organization_settings',
      target_id: bootstrapAdmin.orgId,
    });
  });
});

describe('organization onboarding names (CCC-32)', () => {
  it('saves org and program display names admin-only, audited, and re-runnable', async () => {
    await t.reset();

    // 온보딩 전에는 저장값이 없다 — 화면은 labels.ts 하드코딩 라벨로 폴백한다.
    await expect(getOrganizationProfile(t.env, counselor)).resolves.toEqual({
      orgId: counselor.orgId,
      orgName: null,
      programDisplayName: null,
    });

    // 저장은 기관 관리자만 (스펙 #78 — 온보딩은 처음 가입한 관리자의 화면).
    await expect(completeOrganizationOnboarding(t.env, counselor, {
      orgName: '연대은행', programDisplayName: '금융지원 사업',
    })).rejects.toBeInstanceOf(ForbiddenError);

    const saved = await completeOrganizationOnboarding(t.env, admin, {
      orgName: '  연대은행  ', programDisplayName: '금융지원 사업',
    });
    expect(saved).toEqual({
      orgId: admin.orgId,
      orgName: '연대은행',
      programDisplayName: '금융지원 사업',
    });

    // 실무자도 읽을 수 있어야 한다 — 사이드바는 모든 역할의 셸이다.
    await expect(getOrganizationProfile(t.env, counselor)).resolves.toMatchObject({
      orgName: '연대은행',
      programDisplayName: '금융지원 사업',
    });

    // 다시 실행하면 덮어쓴다(수정 경로 겸용) — 409 로 막히지 않는다.
    await expect(completeOrganizationOnboarding(t.env, admin, {
      orgName: '연대은행', programDisplayName: '자활 사업',
    })).resolves.toMatchObject({ programDisplayName: '자활 사업' });

    const audits = await t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE org_id = ? AND action = 'update' AND target_table = 'organization_settings'`,
    ).bind(admin.orgId).first<{ count: number }>();
    expect(audits?.count).toBe(2);
  });

  it('rejects blank names and keeps service role out', async () => {
    await t.reset();
    await expect(completeOrganizationOnboarding(t.env, admin, {
      orgName: '   ', programDisplayName: '금융지원 사업',
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(completeOrganizationOnboarding(t.env, admin, {
      orgName: '연대은행', programDisplayName: '',
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(getOrganizationProfile(t.env, service)).rejects.toBeInstanceOf(ForbiddenError);
    // 설정 행이 없는 기관도 조회는 에러가 아니라 null — 셸이 앱 전체를 잠그면 안 된다.
    await expect(getOrganizationProfile(t.env, {
      userId: 'someone', orgId: 'org_without_settings', role: 'counselor' as const,
    })).resolves.toEqual({ orgId: 'org_without_settings', orgName: null, programDisplayName: null });
  });
});
describe('canonical participant gateway', () => {
  it('routes legacy PII registration through the canonical admin-only atomic mutation', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});

    await expect(registerPii(t.env, counselor, caseRecord.id, {
      name: 'COUNSELOR_MUTATION_MUST_FAIL',
    })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(t.db.prepare(
      `SELECT enc_name, version
       FROM participant_pii_vault AS vault
       JOIN support_cases AS support_case ON support_case.beneficiary_id = vault.beneficiary_id
       WHERE support_case.legacy_case_id = ?`,
    ).bind(caseRecord.id).first()).resolves.toEqual({ enc_name: null, version: 1 });

    await registerPii(t.env, admin, caseRecord.id, {
      name: 'LEGACY_COMPATIBILITY_ADMIN_NAME',
    });

    await expect(revealPii(t.env, admin, caseRecord.id)).resolves.toEqual({
      name: 'LEGACY_COMPATIBILITY_ADMIN_NAME',
      phone: null,
      account: null,
      email: null,
    });
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count
       FROM audit_log
       WHERE action = 'update' AND target_table = 'participant_pii_vault'
         AND target_id = (
           SELECT beneficiary_id FROM support_cases WHERE legacy_case_id = ?
         )`,
    ).bind(caseRecord.id).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });
  it('serializes the exact v1 SupportCase receipt semantic payload with JCS', async () => {
    const canonical = canonicalizeJcs({
      actorId: 'user-counselor-1',
      beneficiaryId: 'A017',
      creatorRole: 'counselor',
      effectiveAssigneeUserId: 'user-counselor-1',
      intakeAt: '2026-07-15T09:00:00.000Z',
      orgId: 'org-1',
      programType: 'financial_support_v1',
      schemaVersion: 1,
      sourceSupportCaseId: 'support-case-existing-1',
    });
    expect(canonical).toBe(
      '{"actorId":"user-counselor-1","beneficiaryId":"A017","creatorRole":"counselor","effectiveAssigneeUserId":"user-counselor-1","intakeAt":"2026-07-15T09:00:00.000Z","orgId":"org-1","programType":"financial_support_v1","schemaVersion":1,"sourceSupportCaseId":"support-case-existing-1"}',
    );
    await expect(sha256Hex(canonical)).resolves.toBe(
      '066a3a100cc988fd7eede436a5bf9cdd8db8887afa7978665b38507b3ff1c597',
    );
  });
  it('supports multi-program actor-scoped receipt replay without PII on creation', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const submissionId = '11111111-1111-4111-8111-111111111111';
    const input = {
      consentPrivacy: true,
      schemaVersion: 1 as const,
      submissionId,
      programType: 'financial_support_v1' as const,
      intakeAt: '2026-07-16T09:00:00.000Z',
      sourceSupportCaseId: initial.supportCaseId,
    };

    const [first, replay] = await Promise.all([
      createSupportCase(t.env, canonicalActors.counselor, initial.beneficiaryId, input),
      createSupportCase(t.env, canonicalActors.counselor, initial.beneficiaryId, input),
    ]);
    expect([first.replayed, replay.replayed].sort()).toEqual([false, true]);
    expect(first.supportCaseId).toBe(replay.supportCaseId);
    const beforeConflict = await t.db.prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM support_cases
          WHERE org_id = ? AND beneficiary_id = ?) AS supportCaseCount,
         (SELECT COUNT(*)
          FROM support_case_assignees AS assignment
          JOIN support_cases AS supportCase ON supportCase.id = assignment.support_case_id
          WHERE assignment.org_id = ? AND supportCase.beneficiary_id = ?) AS assignmentCount,
         (SELECT COUNT(*)
          FROM audit_log
          WHERE org_id = ?) AS auditCount`,
    ).bind(
      canonicalActors.counselor.orgId,
      initial.beneficiaryId,
      canonicalActors.counselor.orgId,
      initial.beneficiaryId,
      canonicalActors.counselor.orgId,
    ).first<{ supportCaseCount: number; assignmentCount: number; auditCount: number }>();
    const participantBeforeConflict = await t.db.prepare(
      `SELECT initialization_state AS initializationState, updated_at AS updatedAt
       FROM beneficiaries WHERE id = ? AND org_id = ?`,
    ).bind(initial.beneficiaryId, canonicalActors.counselor.orgId).first();
    const vaultBeforeConflict = await t.db.prepare(
      `SELECT enc_name AS encName, enc_phone AS encPhone, enc_account AS encAccount,
              version, purge_due AS purgeDue, purged_at AS purgedAt, updated_at AS updatedAt
       FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?`,
    ).bind(initial.beneficiaryId, canonicalActors.counselor.orgId).first();
    // 감사 6건: 최초 등록 3건(create·create·assign) + 추가 사업 3건(create·assign·record_consent).
    // 마지막 1건이 G1 로 늘었다 — 추가 참여 사업도 ① 동의를 받아 이력·감사로 남기기 때문이다.
    expect(beforeConflict).toEqual({ supportCaseCount: 2, assignmentCount: 2, auditCount: 6 });

    await expect(createSupportCase(t.env, canonicalActors.counselor, initial.beneficiaryId, {
      ...input,
      intakeAt: '2026-07-16T10:00:00.000Z',
    })).rejects.toBeInstanceOf(ConflictError);

    await expect(t.db.prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM support_cases
          WHERE org_id = ? AND beneficiary_id = ?) AS supportCaseCount,
         (SELECT COUNT(*)
          FROM support_case_assignees AS assignment
          JOIN support_cases AS supportCase ON supportCase.id = assignment.support_case_id
          WHERE assignment.org_id = ? AND supportCase.beneficiary_id = ?) AS assignmentCount,
         (SELECT COUNT(*)
          FROM audit_log
          WHERE org_id = ?) AS auditCount`,
    ).bind(
      canonicalActors.counselor.orgId,
      initial.beneficiaryId,
      canonicalActors.counselor.orgId,
      initial.beneficiaryId,
      canonicalActors.counselor.orgId,
    ).first()).resolves.toEqual(beforeConflict);
    await expect(t.db.prepare(
      `SELECT initialization_state AS initializationState, updated_at AS updatedAt
       FROM beneficiaries WHERE id = ? AND org_id = ?`,
    ).bind(initial.beneficiaryId, canonicalActors.counselor.orgId).first())
      .resolves.toEqual(participantBeforeConflict);
    await expect(t.db.prepare(
      `SELECT enc_name AS encName, enc_phone AS encPhone, enc_account AS encAccount,
              version, purge_due AS purgeDue, purged_at AS purgedAt, updated_at AS updatedAt
       FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?`,
    ).bind(initial.beneficiaryId, canonicalActors.counselor.orgId).first())
      .resolves.toEqual(vaultBeforeConflict);

    // D36 의 전제 게이트: 이 당사자의 케이스를 **1건도 담당하지 않으면** 페이지가 열리지
    // 않는다. 아직 secondCounselor 는 배정이 없으므로 여기서 막혀야 한다. D36 으로 표시
    // 범위를 기관 전체로 넓혔기 때문에 이 게이트를 같이 지우기 쉬운데, 그러면 D36 의 근거
    // ("이 페이지를 여는 사람은 이미 그 당사자의 담당 실무자라 PII 를 보고 있다")가 무너진다.
    await expect(listSupportCasesForBeneficiary(
      t.env,
      canonicalActors.secondCounselor,
      initial.beneficiaryId,
    )).rejects.toBeInstanceOf(ForbiddenError);

    const adminProgram = await createSupportCase(t.env, canonicalActors.admin, initial.beneficiaryId, {
      consentPrivacy: true,
      schemaVersion: 1,
      submissionId,
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      initialAssigneeUserId: canonicalActors.secondCounselor.userId,
    });
    expect(adminProgram.replayed).toBe(false);
    // D36(2026-07-26): 당사자 정보 허브는 **기관 내 전 참여 사업**을 보여준다. 그래서
    // counselor 도 3건을 다 받되, 방금 secondCounselor 에게 배정된 건은 authorized=false 로
    // 와서 상담 내용이 잠긴다. 표시 범위와 접근 범위를 분리했다는 것을 여기서 고정한다.
    const counselorPrograms = (await listSupportCasesForBeneficiary(
      t.env,
      canonicalActors.counselor,
      initial.beneficiaryId,
    )).programs;
    expect(counselorPrograms).toHaveLength(3);
    expect(counselorPrograms.filter((entry) => entry.authorized)).toHaveLength(2);
    // 비담당 사업은 "누구에게 물어보나"를 답해야 하므로 담당 실무자 표시 이름이 실린다.
    // 단 **이메일로 폴백하지 않는다** — 이 목록은 담당 밖 사업까지 실무자에게 내려가므로,
    // 이메일 폴백을 두면 admin 전용 디렉터리로 막아 둔 직원 이메일이 새어 나간다.
    // 이 픽스처의 users 는 name 이 없으므로 목록은 비어 있어야 한다.
    const locked = counselorPrograms.find((entry) => !entry.authorized);
    expect(locked?.assigneeNames).toEqual([]);
    expect(JSON.stringify(counselorPrograms)).not.toContain('@example.invalid');
    const adminPrograms = (await listSupportCasesForBeneficiary(
      t.env,
      canonicalActors.admin,
      initial.beneficiaryId,
    )).programs;
    expect(adminPrograms).toHaveLength(3);
    expect(adminPrograms.every((entry) => entry.authorized)).toBe(true);
    await expect(t.db.prepare(
      `SELECT enc_name, enc_phone, enc_account
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(initial.beneficiaryId).first()).resolves.toEqual({
      enc_name: null,
      enc_phone: null,
      enc_account: null,
    });
  });

  it('requires an active context for counselor reveal and schedule control while retaining admin authority', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const pii = {
      name: 'PII_REVEAL_NAME_CANARY',
      phone: '010-7000-7001',
      account: 'PII_REVEAL_ACCOUNT_CANARY',
    };
    await updateParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId, {
      supportCaseContextId: initial.supportCaseId,
      expectedVersion: 1,
      ...pii,
    });
    const vault = await t.db.prepare(
      `SELECT enc_name AS encName, enc_phone AS encPhone, enc_account AS encAccount
       FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?`,
    ).bind(initial.beneficiaryId, canonicalActors.counselor.orgId).first<{
      encName: string | null;
      encPhone: string | null;
      encAccount: string | null;
    }>();
    expect(vault).toEqual({
      encName: expect.any(String),
      encPhone: expect.any(String),
      encAccount: expect.any(String),
    });
    expect(vault?.encName).not.toBe(pii.name);
    expect(vault?.encPhone).not.toBe(pii.phone);
    expect(vault?.encAccount).not.toBe(pii.account);

    // D24·ADR-0005: 담당 실무자(활성 배정)에게는 브리핑 응답에 실명·연락처가 실린다(계좌는 제외).
    // 클릭 단위 reveal 은 사라지고, PII 가 실린 화면 조회당 read_participant_pii 감사 1건이 남는다.
    await expect(getParticipantBriefing(
      t.env,
      canonicalActors.counselor,
      initial.beneficiaryId,
      initial.supportCaseId,
    )).resolves.toMatchObject({ participant: { name: pii.name, phone: pii.phone } });
    const piiReadAudit = await t.db.prepare(
      `SELECT org_id AS orgId, actor_id AS actorId, actor_role AS actorRole,
              action, target_table AS targetTable, target_id AS targetId,
              beneficiary_id AS beneficiaryId, support_case_id AS supportCaseId, detail
       FROM audit_log
       WHERE action = 'read_participant_pii' AND beneficiary_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(initial.beneficiaryId).first();
    expect(piiReadAudit).toEqual({
      orgId: canonicalActors.counselor.orgId,
      actorId: canonicalActors.counselor.userId,
      actorRole: 'counselor',
      action: 'read_participant_pii',
      targetTable: 'participant_pii_vault',
      targetId: initial.beneficiaryId,
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      detail: `{"fields":["name","phone"],"beneficiaryIds":["${initial.beneficiaryId}"],"count":1}`,
    });
    const participantAuditLog = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE org_id = ? AND beneficiary_id = ? ORDER BY id`,
    ).bind(canonicalActors.counselor.orgId, initial.beneficiaryId).all<{ detail: string | null }>();
    expectNoCanaries({ vault, auditLog: participantAuditLog.results }, Object.values(pii));
    expectNoCanaries({ vault, piiReadAudit }, Object.values(pii));

    const schedule = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-07-15T00:00:00.000Z',
    });
    const hidden = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.secondCounselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:30:00.000Z',
    });
    const hiddenSchedule = await createCounselingSchedule(t.env, canonicalActors.secondCounselor, {
      beneficiaryId: hidden.beneficiaryId,
      supportCaseId: hidden.supportCaseId,
      scheduledAt: '2026-07-15T00:30:00.000Z',
    });
    const counselorToday = await getTodaySchedules(t.env, canonicalActors.counselor, { date: '2026-07-15' });
    expect(counselorToday.timeZone).toBe('Asia/Seoul');
    expect(counselorToday.schedules.map((item) => item.id)).toEqual([schedule.id]);
    expect(JSON.stringify(counselorToday)).not.toContain(hidden.beneficiaryId);
    // D24·ADR-0005: 담당 실무자 카드에는 실명·연락처가 실린다.
    expect(counselorToday.schedules[0]).toMatchObject({
      participantName: pii.name,
      participantPhone: pii.phone,
    });
    const adminToday = await getTodaySchedules(t.env, canonicalActors.admin, { date: '2026-07-15' });
    expect(adminToday.schedules.map((item) => item.id)).toEqual([
      schedule.id,
      hiddenSchedule.id,
    ]);
    // admin 은 기관 전체 카드에 실명을 본다. 두 번째 당사자는 PII 미기입이라 실명 null.
    expect(adminToday.schedules.find((item) => item.id === schedule.id)?.participantName).toBe(pii.name);
    expect(adminToday.schedules.find((item) => item.id === hiddenSchedule.id)?.participantName).toBeNull();
    await assignSupportCase(
      t.env,
      canonicalActors.admin,
      initial.supportCaseId,
      canonicalActors.admin.userId,
      'secondary',
    );
    await expect(unassignSupportCase(
      t.env,
      canonicalActors.admin,
      initial.supportCaseId,
      canonicalActors.counselor.userId,
    )).rejects.toBeInstanceOf(ValidationError);
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM support_case_assignees
       WHERE support_case_id = ? AND role = 'primary' AND unassigned_at IS NULL`,
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
    await unassignSupportCase(
      t.env,
      canonicalActors.admin,
      initial.supportCaseId,
      canonicalActors.admin.userId,
    );
    await transferSupportCase(
      t.env,
      canonicalActors.admin,
      initial.supportCaseId,
      canonicalActors.counselor.userId,
      canonicalActors.admin.userId,
    );

    // 이관으로 배정을 잃은 실무자는 브리핑(실명 포함) 접근이 막힌다 — 상담 관계가 끊긴다.
    await expect(getParticipantBriefing(
      t.env,
      canonicalActors.counselor,
      initial.beneficiaryId,
      initial.supportCaseId,
    )).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rescheduleCounselingSchedule(t.env, canonicalActors.counselor, schedule.id, {
      expectedVersion: schedule.version,
      scheduledAt: '2026-07-15T01:00:00.000Z',
    })).rejects.toBeInstanceOf(ForbiddenError);
    // admin 은 이관 후에도 실명 열람 권한을 유지한다.
    await expect(getParticipantBriefing(
      t.env,
      canonicalActors.admin,
      initial.beneficiaryId,
      initial.supportCaseId,
    )).resolves.toMatchObject({ participant: { name: pii.name } });
  });

  it('uses terminal team schedule transitions and an atomic immediately-official record replay', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const goal = await createGoal(t.env, canonicalActors.counselor, initial.supportCaseId, {
      title: '생활비 계획 유지',
    });
    const noShowSchedule = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-07-15T00:00:00.000Z',
    });
    const noShow = await markCounselingScheduleNoShow(t.env, canonicalActors.counselor, noShowSchedule.id, {
      expectedVersion: noShowSchedule.version,
    });
    expect(noShow.status).toBe('no_show');
    await expect(cancelCounselingSchedule(t.env, canonicalActors.counselor, noShow.id, {
      expectedVersion: noShow.version,
    })).rejects.toBeInstanceOf(ConflictError);

    const schedule = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-07-16T00:00:00.000Z',
    });
    const rescheduled = await rescheduleCounselingSchedule(t.env, canonicalActors.counselor, schedule.id, {
      expectedVersion: schedule.version,
      scheduledAt: '2026-07-16T10:00:00.000Z',
    });
    await expect(getNextCounselingScheduleForSupportCase(
      t.env,
      canonicalActors.counselor,
      initial.supportCaseId,
    )).resolves.toMatchObject({
      id: schedule.id,
      version: rescheduled.version,
      status: 'scheduled',
    });
    const input = {
      submissionId: '22222222-2222-4222-8222-222222222222',
      heldAt: '2026-07-16T10:05:00.000Z',
      channel: 'in_person' as const,
      memo: 'IMMEDIATE_OFFICIAL_MANUAL_MEMO',
      gasScores: [{ goalId: goal.id, score: 1 as const }],
      actionItems: [{
        description: 'ACTION_ITEM_FOR_RECORD',
        owner: 'counselor' as const,
        dueDate: '2026-07-20',
      }],
      flags: [{
        flagType: 'housing_livelihood_shock' as const,
        quote: 'COUNSELOR_CONFIRMED_FLAG',
      }],
      scheduleId: schedule.id,
      expectedScheduleVersion: rescheduled.version,
    };
    const first = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input);
    expect(first.replayed).toBe(false);
    const replay = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input);
    expect(replay).toMatchObject({ replayed: true, record: { id: first.record.id } });
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'submit_manual_record' AND target_table = 'sessions' AND target_id = ?`,
    ).bind(first.record.id).first<{ count: number }>()).resolves.toEqual({ count: 1 });
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM audit_log WHERE target_table = ? AND target_id = ?',
    ).bind('sessions', first.record.id).first<{ count: number }>()).resolves.toEqual({ count: 1 });
    await expect(createCounselingRecord(
      t.env,
      canonicalActors.counselor,
      initial.supportCaseId,
      { ...input, memo: 'CHANGED_REPLAY_PAYLOAD' },
    )).rejects.toBeInstanceOf(ConflictError);
    await expect(t.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM session_goal_scores WHERE session_id = ?) AS scores,
         (SELECT COUNT(*) FROM action_items WHERE session_id = ?) AS actions,
         (SELECT COUNT(*) FROM flags WHERE session_id = ?) AS flags`,
    ).bind(first.record.id, first.record.id, first.record.id).first()).resolves.toEqual({
      scores: 1,
      actions: 1,
      flags: 1,
    });
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM sessions WHERE support_case_id = ?',
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
    await expect(t.db.prepare(
      'SELECT status, completed_session_id FROM counseling_schedules WHERE id = ?',
    ).bind(schedule.id).first()).resolves.toEqual({
      status: 'completed',
      completed_session_id: first.record.id,
    });
    const records = await listCounselingRecords(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(records).toEqual([expect.objectContaining({
      id: first.record.id,
      memo: 'IMMEDIATE_OFFICIAL_MANUAL_MEMO',
      aiSummary: null,
      completedSchedule: {
        id: schedule.id,
        scheduledAt: rescheduled.scheduledAt,
        status: 'completed',
        version: rescheduled.version + 1,
      },
      gasScores: [expect.objectContaining({ goalId: goal.id, score: 1 })],
      actionItems: [expect.objectContaining({
        description: 'ACTION_ITEM_FOR_RECORD',
        owner: 'counselor',
        dueDate: '2026-07-20',
        resolvedAt: null,
      })],
      confirmedFlags: [expect.objectContaining({
        flagType: 'housing_livelihood_shock',
        reviewStatus: 'confirmed',
        quote: 'COUNSELOR_CONFIRMED_FLAG',
      })],
    })]);
    const actionItemId = records[0]?.actionItems[0]?.id;
    if (actionItemId === undefined) throw new Error('expected record action item');
    await resolveActionItem(t.env, canonicalActors.counselor, actionItemId);
    await expect(listCounselingRecords(t.env, canonicalActors.counselor, initial.supportCaseId))
      .resolves.toEqual([expect.objectContaining({
        actionItems: [expect.objectContaining({ id: actionItemId, resolvedAt: expect.any(String) })],
      })]);
  });
  it('replays concurrent canonical manual-record receipts without duplicate sessions', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const input = {
      submissionId: '99999999-9999-4999-8999-999999999999',
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'CONCURRENT_RECEIPT_SAFE_MANUAL_MEMO',
      gasScores: [],
      actionItems: [],
      flags: [],
    };
    const [first, replay] = await Promise.all([
      createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input),
      createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input),
    ]);
    expect([first.replayed, replay.replayed].sort()).toEqual([false, true]);
    expect(replay.record.id).toBe(first.record.id);
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM sessions WHERE support_case_id = ?',
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
    await expect(createCounselingRecord(
      t.env,
      canonicalActors.counselor,
      initial.supportCaseId,
      { ...input, memo: 'CONFLICTING_CONCURRENT_RECEIPT_PAYLOAD' },
    )).rejects.toBeInstanceOf(ConflictError);
  });
  it('saves manual records with GAS recommended, not required — empty and partial GAS both persist', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const activeGoal = await createGoal(t.env, canonicalActors.counselor, initial.supportCaseId, {
      title: 'active goal may remain unscored',
    });
    const secondActiveGoal = await createGoal(t.env, canonicalActors.counselor, initial.supportCaseId, {
      title: 'second active goal may remain unscored',
    });

    const input = {
      submissionId: '11111111-1111-4111-8111-111111111111',
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'GAS_OPTIONAL_NO_SCORES',
      gasScores: [],
      actionItems: [],
      flags: [],
    };
    const withoutScores = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input);
    expect(withoutScores.replayed).toBe(false);
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM session_goal_scores WHERE session_id = ?',
    ).bind(withoutScores.record.id).first<{ count: number }>()).resolves.toEqual({ count: 0 });

    const partial = await createCounselingRecord(
      t.env,
      canonicalActors.counselor,
      initial.supportCaseId,
      {
        ...input,
        submissionId: '22222222-2222-4222-8222-222222222222',
        memo: 'GAS_OPTIONAL_PARTIAL_SCORES',
        gasScores: [{ goalId: activeGoal.id, score: 1 }],
      },
    );
    expect(partial.replayed).toBe(false);
    const savedScores = await t.db.prepare(
      `SELECT goal_id FROM session_goal_scores
       WHERE session_id = ? ORDER BY goal_id`,
    ).bind(partial.record.id).all<{ goal_id: string }>();
    expect(savedScores.results).toEqual([{ goal_id: activeGoal.id }]);
    // The second active goal stays unscored without blocking the record.
    expect(savedScores.results.some((row) => row.goal_id === secondActiveGoal.id)).toBe(false);
  });
  it('processes unresolved action items with four-state resolutions, rejects other-case targets, and replays without duplicating', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const seeded = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      submissionId: '33333333-3333-4333-8333-333333333333',
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'SEED_ACTIONS_FOR_RESOLUTION',
      gasScores: [],
      actionItems: [
        { description: 'ACTION_TO_HOLD', owner: 'counselor' as const },
        { description: 'ACTION_TO_COMPLETE', owner: 'beneficiary' as const },
      ],
      flags: [],
    });
    const open = await listOpenActionItems(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(open).toHaveLength(2);
    const holdAction = open.find((item) => item.description === 'ACTION_TO_HOLD');
    const doneAction = open.find((item) => item.description === 'ACTION_TO_COMPLETE');
    if (holdAction === undefined || doneAction === undefined) throw new Error('expected seeded actions');

    // Another support case whose action must not be resolvable from the first case.
    const other = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await createCounselingRecord(t.env, canonicalActors.counselor, other.supportCaseId, {
      submissionId: '44444444-4444-4444-8444-444444444444',
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'OTHER_CASE_ACTION',
      gasScores: [],
      actionItems: [{ description: 'OTHER_CASE_ACTION_ITEM', owner: 'counselor' as const }],
      flags: [],
    });
    const otherOpen = await listOpenActionItems(t.env, canonicalActors.counselor, other.supportCaseId);
    const foreignAction = otherOpen[0];
    if (foreignAction === undefined) throw new Error('expected other-case action');
    await expect(createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      submissionId: '55555555-5555-4555-8555-555555555555',
      heldAt: '2026-07-15T11:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'REJECT_FOREIGN_ACTION',
      gasScores: [],
      actionItems: [],
      flags: [],
      actionItemResolutions: [{ actionItemId: foreignAction.id, status: 'done' as const }],
    })).rejects.toBeInstanceOf(ForbiddenError);

    const resolveInput = {
      submissionId: '66666666-6666-4666-8666-666666666666',
      heldAt: '2026-07-15T12:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'RESOLVE_UNRESOLVED_ACTIONS',
      gasScores: [],
      actionItems: [],
      flags: [],
      actionItemResolutions: [
        { actionItemId: holdAction.id, status: 'hold' as const, note: 'WAITING_ON_DOCS' },
        { actionItemId: doneAction.id, status: 'done' as const },
      ],
    };
    const resolved = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, resolveInput);
    expect(resolved.replayed).toBe(false);

    // 'done' drops off the open list; 'hold' stays open but carries the processing row.
    const afterOpen = await listOpenActionItems(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(afterOpen.map((item) => item.id)).toEqual([holdAction.id]);
    await expect(t.db.prepare(
      `SELECT resolution_status, resolution_note, resolution_session_id, resolved_at
       FROM action_items WHERE id = ?`,
    ).bind(holdAction.id).first()).resolves.toEqual({
      resolution_status: 'hold',
      resolution_note: 'WAITING_ON_DOCS',
      resolution_session_id: resolved.record.id,
      resolved_at: null,
    });
    await expect(t.db.prepare(
      `SELECT resolution_status, resolution_session_id, resolved_by,
              CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END AS resolved
       FROM action_items WHERE id = ?`,
    ).bind(doneAction.id).first()).resolves.toEqual({
      resolution_status: 'done',
      resolution_session_id: resolved.record.id,
      resolved_by: canonicalActors.counselor.userId,
      resolved: 1,
    });
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'update' AND target_table = 'action_items' AND target_id IN (?, ?)`,
    ).bind(holdAction.id, doneAction.id).first<{ count: number }>()).resolves.toEqual({ count: 2 });

    // Replay of the same submission does not re-run the resolutions (no extra audit rows).
    const replay = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, resolveInput);
    expect(replay).toMatchObject({ replayed: true, record: { id: resolved.record.id } });
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'update' AND target_table = 'action_items' AND target_id IN (?, ?)`,
    ).bind(holdAction.id, doneAction.id).first<{ count: number }>()).resolves.toEqual({ count: 2 });
  });
  it('captures 6-area snapshots per session, copies unchanged areas from the prior session, cold-starts as unrecorded, and replays without duplicating', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });

    // Session 1 (cold start): two changed areas recorded, four '변화 없음' with no prior → unrecorded.
    const first = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'FIRST_SNAPSHOT',
      gasScores: [],
      actionItems: [],
      flags: [],
      lifeAreas: [
        { areaKey: 'economy' as const, changed: true as const, status: 'crisis' as const },
        { areaKey: 'housing' as const, changed: true as const, status: 'okay' as const, note: 'STABLE_HOUSING' },
        { areaKey: 'employment' as const, changed: false as const },
        { areaKey: 'health' as const, changed: false as const },
        { areaKey: 'mental_health' as const, changed: false as const },
        { areaKey: 'family' as const, changed: false as const },
      ],
    });
    await expect(t.db.prepare(
      `SELECT area_key, status, note FROM session_life_area_snapshots
       WHERE session_id = ? ORDER BY area_key`,
    ).bind(first.record.id).all()).resolves.toMatchObject({
      results: [
        { area_key: 'economy', status: 'crisis', note: null },
        { area_key: 'housing', status: 'okay', note: 'STABLE_HOUSING' },
      ],
    });

    // Session 2 (later): economy changes, the rest '변화 없음'. housing copies status+note from session 1;
    // the four areas without a prior value stay unrecorded.
    const second = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      heldAt: '2026-07-16T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'SECOND_SNAPSHOT',
      gasScores: [],
      actionItems: [],
      flags: [],
      lifeAreas: [
        { areaKey: 'economy' as const, changed: true as const, status: 'strained' as const },
        { areaKey: 'housing' as const, changed: false as const },
        { areaKey: 'employment' as const, changed: false as const },
        { areaKey: 'health' as const, changed: false as const },
        { areaKey: 'mental_health' as const, changed: false as const },
        { areaKey: 'family' as const, changed: false as const },
      ],
    });
    await expect(t.db.prepare(
      `SELECT area_key, status, note FROM session_life_area_snapshots
       WHERE session_id = ? ORDER BY area_key`,
    ).bind(second.record.id).all()).resolves.toMatchObject({
      results: [
        { area_key: 'economy', status: 'strained', note: null },
        { area_key: 'housing', status: 'okay', note: 'STABLE_HOUSING' },
      ],
    });

    // listCounselingRecords exposes each session's own snapshot; latest (held_at DESC) is session 2.
    const records = await listCounselingRecords(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(records[0]).toMatchObject({
      id: second.record.id,
      lifeAreaSnapshot: [
        { areaKey: 'economy', status: 'strained', note: null },
        { areaKey: 'housing', status: 'okay', note: 'STABLE_HOUSING' },
      ],
    });
    expect(records[1]).toMatchObject({
      id: first.record.id,
      lifeAreaSnapshot: [
        { areaKey: 'economy', status: 'crisis', note: null },
        { areaKey: 'housing', status: 'okay', note: 'STABLE_HOUSING' },
      ],
    });

    // getSession 계열도 그 회차의 스냅샷을 싣는다.
    await expect(getSession(t.env, canonicalActors.counselor, second.record.id)).resolves.toMatchObject({
      lifeAreaSnapshot: [
        { areaKey: 'economy', status: 'strained', note: null },
        { areaKey: 'housing', status: 'okay', note: 'STABLE_HOUSING' },
      ],
    });

    // Replay of session 2 does not duplicate snapshot rows.
    const replay = await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      heldAt: '2026-07-16T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'SECOND_SNAPSHOT',
      gasScores: [],
      actionItems: [],
      flags: [],
      lifeAreas: [
        { areaKey: 'economy' as const, changed: true as const, status: 'strained' as const },
        { areaKey: 'housing' as const, changed: false as const },
        { areaKey: 'employment' as const, changed: false as const },
        { areaKey: 'health' as const, changed: false as const },
        { areaKey: 'mental_health' as const, changed: false as const },
        { areaKey: 'family' as const, changed: false as const },
      ],
    });
    expect(replay).toMatchObject({ replayed: true, record: { id: second.record.id } });
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM session_life_area_snapshots WHERE session_id = ?',
    ).bind(second.record.id).first<{ count: number }>()).resolves.toEqual({ count: 2 });
  });
  it('rejects 6-area snapshots that omit an area, carry an unknown key, duplicate, or change without a status', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const base = {
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'INVALID_SNAPSHOT',
      gasScores: [],
      actionItems: [],
      flags: [],
    };
    const allSix = [
      { areaKey: 'economy' as const, changed: false as const },
      { areaKey: 'housing' as const, changed: false as const },
      { areaKey: 'employment' as const, changed: false as const },
      { areaKey: 'health' as const, changed: false as const },
      { areaKey: 'mental_health' as const, changed: false as const },
      { areaKey: 'family' as const, changed: false as const },
    ];

    // Missing an area (only five).
    await expect(createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      ...base,
      submissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      lifeAreas: allSix.slice(0, 5),
    })).rejects.toBeInstanceOf(ValidationError);

    // Unknown area key (replaces family).
    await expect(createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      ...base,
      submissionId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      lifeAreas: [...allSix.slice(0, 5), { areaKey: 'unknown_area' as unknown as 'family', changed: false as const }],
    })).rejects.toBeInstanceOf(ValidationError);

    // Duplicate area (economy twice, family missing).
    await expect(createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      ...base,
      submissionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      lifeAreas: [...allSix.slice(0, 5), { areaKey: 'economy' as const, changed: false as const }],
    })).rejects.toBeInstanceOf(ValidationError);

    // changed=true without a status.
    await expect(createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      ...base,
      submissionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      lifeAreas: [{ areaKey: 'economy' as const, changed: true as unknown as false }, ...allSix.slice(1)],
    })).rejects.toBeInstanceOf(ValidationError);

    // No snapshot rows were written by any rejected attempt.
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM session_life_area_snapshots AS snapshot
       JOIN sessions AS session ON session.id = snapshot.session_id
       WHERE session.support_case_id = ?`,
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });
  it('does not fork concurrent secondary assignment transfers', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    await t.db.prepare(
      `INSERT INTO users (id, org_id, email, role, active, time_zone)
       VALUES (?, ?, ?, 'counselor', 1, NULL)`,
    ).bind(
      'user-counselor-3',
      canonicalActors.counselor.orgId,
      'canonical-counselor-3@example.invalid',
    ).run();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await assignSupportCase(
      t.env,
      canonicalActors.admin,
      initial.supportCaseId,
      canonicalActors.admin.userId,
      'secondary',
    );

    const outcomes = await Promise.allSettled([
      transferSupportCase(
        t.env,
        canonicalActors.admin,
        initial.supportCaseId,
        canonicalActors.admin.userId,
        canonicalActors.secondCounselor.userId,
      ),
      transferSupportCase(
        t.env,
        canonicalActors.admin,
        initial.supportCaseId,
        canonicalActors.admin.userId,
        'user-counselor-3',
      ),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejected === undefined || rejected.status !== 'rejected') {
      throw new Error('expected one stale transfer rejection');
    }
    expect(rejected.reason).toBeInstanceOf(ConflictError);

    const active = await t.db.prepare(
      `SELECT user_id FROM support_case_assignees
       WHERE support_case_id = ? AND unassigned_at IS NULL
       ORDER BY user_id`,
    ).bind(initial.supportCaseId).all<{ user_id: string }>();
    const activeUserIds = active.results.map((assignment) => assignment.user_id);
    expect(activeUserIds).toContain(canonicalActors.counselor.userId);
    expect(activeUserIds.filter((userId) => (
      userId === canonicalActors.secondCounselor.userId || userId === 'user-counselor-3'
    ))).toHaveLength(1);
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'transfer' AND target_table = 'support_case_assignees'
         AND support_case_id = ?`,
    ).bind(initial.supportCaseId).first<{ count: number }>())
      .resolves.toEqual({ count: 1 });
  });
  it('does not audit a stale concurrent close as successful', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00.000Z'));
    try {
      const outcomes = await Promise.allSettled([
        closeSupportCase(t.env, canonicalActors.counselor, initial.supportCaseId, 'program complete'),
        closeSupportCase(t.env, canonicalActors.counselor, initial.supportCaseId, 'program complete'),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      if (rejected === undefined || rejected.status !== 'rejected') {
        throw new Error('expected one stale close rejection');
      }
      expect(rejected.reason).toBeInstanceOf(ConflictError);
    } finally {
      vi.useRealTimers();
    }

    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'close' AND target_table = 'support_cases' AND target_id = ?`,
    ).bind(initial.supportCaseId).first<{ count: number }>())
      .resolves.toEqual({ count: 1 });
  });

  it('schedules retention only after the final SupportCase closes and clears due on later participation', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await closeSupportCase(t.env, canonicalActors.counselor, initial.supportCaseId, 'program complete');
    const dueAfterLastClose = await t.db.prepare(
      'SELECT purge_due FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<{ purge_due: string | null }>();
    expect(dueAfterLastClose?.purge_due).not.toBeNull();
    await expect(purgeParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId))
      .resolves.toEqual({ beneficiaryId: initial.beneficiaryId, purged: false });
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 'purge_pii_noop' AND beneficiary_id = ?`,
    ).bind(initial.beneficiaryId).first<{ count: number }>()).resolves.toEqual({ count: 1 });

    const later = await createSupportCase(t.env, canonicalActors.admin, initial.beneficiaryId, {
      consentPrivacy: true,
      schemaVersion: 1,
      submissionId: '33333333-3333-4333-8333-333333333333',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      initialAssigneeUserId: canonicalActors.secondCounselor.userId,
    });
    await expect(t.db.prepare(
      'SELECT purge_due FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<{ purge_due: string | null }>()).resolves.toEqual({ purge_due: null });
    await closeSupportCase(t.env, canonicalActors.secondCounselor, later.supportCaseId, 'program complete');
    await expect(t.db.prepare(
      'SELECT purge_due FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<{ purge_due: string | null }>())
      .resolves.toEqual(expect.objectContaining({ purge_due: expect.any(String) }));
  });

  it('requires an explicit active-context re-registration to revive a purged participant vault', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await t.db.prepare(
      `UPDATE support_cases
       SET status = 'closed', closed_at = ?, closed_reason = ?, closed_by_actor_id = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(
      '2020-01-01 00:00:00',
      'program complete',
      canonicalActors.counselor.userId,
      '2020-01-01 00:00:00',
      initial.supportCaseId,
    ).run();
    await expect(purgeParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId))
      .resolves.toEqual({ beneficiaryId: initial.beneficiaryId, purged: true });
    const purgedVault = await t.db.prepare(
      'SELECT version FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<{ version: number }>();
    if (purgedVault === null) throw new Error('expected purged participant vault');
    const later = await createSupportCase(t.env, canonicalActors.admin, initial.beneficiaryId, {
      consentPrivacy: true,
      schemaVersion: 1,
      submissionId: '77777777-7777-4777-8777-777777777777',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-17T09:00:00.000Z',
      initialAssigneeUserId: canonicalActors.secondCounselor.userId,
    });
    await expect(updateParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId, {
      supportCaseContextId: later.supportCaseId,
      expectedVersion: purgedVault.version,
      name: 'NOT_ALLOWED',
    })).rejects.toBeInstanceOf(ConflictError);
    await expect(reRegisterParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId, {
      supportCaseContextId: later.supportCaseId,
      expectedVersion: purgedVault.version,
      reason: 'new participation',
      name: 'RE_REGISTERED_NAME',
      phone: '010-1111-1111',
      account: 'RE_REGISTERED_ACCOUNT',
    })).resolves.toMatchObject({
      beneficiaryId: initial.beneficiaryId,
      purgedAt: null,
      version: purgedVault.version + 1,
    });
    // 재등록으로 되살아난 실명은 새 담당 실무자의 브리핑에 실린다(D24).
    await expect(getParticipantBriefing(
      t.env,
      canonicalActors.secondCounselor,
      initial.beneficiaryId,
      later.supportCaseId,
    )).resolves.toMatchObject({ participant: { name: 'RE_REGISTERED_NAME' } });
  });

  it('stores an optional email as ciphertext at registration and leaves it null otherwise (#32)', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const withEmail = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
      email: 'PARTICIPANT_EMAIL_CANARY@example.invalid',
    });
    const withEmailVault = await t.db.prepare(
      'SELECT enc_email, enc_name FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(withEmail.beneficiaryId).first<{ enc_email: string | null; enc_name: string | null }>();
    // 이메일만 등록 경로가 채운다 — 이름·연락처·계좌는 이후 updateParticipantPii 몫이라 null.
    expect(withEmailVault?.enc_name).toBeNull();
    expect(withEmailVault?.enc_email).toEqual(expect.any(String));
    expect(withEmailVault?.enc_email).not.toContain('PARTICIPANT_EMAIL_CANARY');

    const withoutEmail = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:30:00.000Z',
    });
    await expect(t.db.prepare(
      'SELECT enc_email FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(withoutEmail.beneficiaryId).first()).resolves.toEqual({ enc_email: null });

    // 실명(이름·연락처)은 등록만으론 채워지지 않으므로 브리핑 PII 는 null 이고 감사도 남지 않는다.
    const briefing = await getParticipantBriefing(
      t.env, canonicalActors.counselor, withEmail.beneficiaryId, withEmail.supportCaseId,
    );
    expect(briefing.participant).toEqual({ name: null, phone: null });
    await expect(t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'read_participant_pii' AND beneficiary_id = ?",
    ).bind(withEmail.beneficiaryId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });

  it('routes Phase-1 writes through canonical primary-safe receipt semantics', async () => {
    await t.reset();
    const legacyCase = await createCase(t.env, counselor, {});
    const supportCase = await t.db.prepare(
      'SELECT id FROM support_cases WHERE legacy_case_id = ? AND org_id = ?',
    ).bind(legacyCase.id, counselor.orgId).first<{ id: string }>();
    if (supportCase === null) throw new Error('expected legacy SupportCase');

    await assignSupportCase(t.env, admin, supportCase.id, admin.userId, 'secondary');
    await expect(unassignCase(t.env, admin, legacyCase.id, counselor.userId))
      .rejects.toBeInstanceOf(ValidationError);

    const manualInput = {
      submissionId: '01000000-0000-4000-8000-000000000006',
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person' as const,
      memo: 'LEGACY_RECEIPT_SAFE_MANUAL_MEMO',
      gasScores: [],
    };
    const first = await createManualSession(t.env, counselor, legacyCase.id, manualInput);
    const replay = await createManualSession(t.env, counselor, legacyCase.id, manualInput);
    const distinctReceipt = await createManualSession(t.env, counselor, legacyCase.id, {
      ...manualInput,
      submissionId: '01000000-0000-4000-8000-000000000007',
    });
    expect(replay.id).toBe(first.id);
    expect(distinctReceipt.id).not.toBe(first.id);
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM sessions WHERE support_case_id = ?',
    ).bind(supportCase.id).first<{ count: number }>()).resolves.toEqual({ count: 2 });

    const piiLikeExtraKey = 'participant_ssn_991231-1234567';
    const piiLikeExtraValue = 'PII_AUDIT_VALUE_MUST_NOT_PERSIST';
    await expect(updateCaseExtra(t.env, counselor, legacyCase.id, {
      [piiLikeExtraKey]: piiLikeExtraValue,
    }))
      .resolves.toMatchObject({ extra: { [piiLikeExtraKey]: piiLikeExtraValue } });
    const extraAudit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE action = 'update' AND target_table = 'support_cases' AND target_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(supportCase.id).first<{ detail: string }>();
    expect(extraAudit?.detail).toBe('{"field":"extra"}');
    expect(extraAudit?.detail).not.toContain(piiLikeExtraKey);
    expect(extraAudit?.detail).not.toContain(piiLikeExtraValue);
    await expect(closeCase(t.env, counselor, legacyCase.id, 'program complete'))
      .resolves.toMatchObject({ id: legacyCase.id, status: 'closed', closedReason: 'program complete' });
    await expect(t.db.prepare(
      'UPDATE support_cases SET program_type = ? WHERE id = ?',
    ).bind('unsupported_program_v1', supportCase.id).run()).rejects.toThrow();
  });
  it('returns only preauthorized SupportCase briefing content with source provenance', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    const hidden = await createSupportCase(t.env, canonicalActors.admin, initial.beneficiaryId, {
      consentPrivacy: true,
      schemaVersion: 1,
      submissionId: '44444444-4444-4444-8444-444444444444',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-16T09:00:00.000Z',
      initialAssigneeUserId: canonicalActors.secondCounselor.userId,
    });
    await createCounselingRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      submissionId: '55555555-5555-4555-8555-555555555555',
      heldAt: '2026-07-15T10:00:00.000Z',
      channel: 'in_person',
      memo: 'VISIBLE_MANUAL_MEMO',
      gasScores: [],
      actionItems: [],
      flags: [],
    });
    await createCounselingRecord(t.env, canonicalActors.admin, hidden.supportCaseId, {
      submissionId: '66666666-6666-4666-8666-666666666666',
      heldAt: '2026-07-16T10:00:00.000Z',
      channel: 'in_person',
      memo: 'HIDDEN_MANUAL_MEMO',
      gasScores: [],
      actionItems: [],
      flags: [],
    });

    const briefing = await getParticipantBriefing(
      t.env,
      canonicalActors.counselor,
      initial.beneficiaryId,
      initial.supportCaseId,
    );
    expect(briefing.supportCases).toEqual([expect.objectContaining({ id: initial.supportCaseId })]);
    expect(briefing.summaries).toEqual([expect.objectContaining({
      sourceSupportCase: expect.objectContaining({ id: initial.supportCaseId }),
      text: 'VISIBLE_MANUAL_MEMO',
    })]);
    // D45 영역 ② — 회차 줄도 인가된 참여 사업 것만 실리고, 발췌는 수기 메모 첫 줄이다.
    expect(briefing.sessionRows).toEqual([expect.objectContaining({
      sourceSupportCase: expect.objectContaining({ id: initial.supportCaseId }),
      heldAt: '2026-07-15T10:00:00.000Z',
      kind: 'regular',
      // 승인된 AI 한 줄이 없는 회차는 null — 화면은 수기 발췌 + '수기' 배지로 폴백한다(CCC-38·D5).
      aiOneLiner: null,
      memoExcerpt: 'VISIBLE_MANUAL_MEMO',
    })]);
    expect(JSON.stringify(briefing)).not.toContain('HIDDEN_MANUAL_MEMO');
    expect(JSON.stringify(briefing)).not.toContain(hidden.supportCaseId);
    await expect(getParticipantBriefing(
      t.env,
      canonicalActors.counselor,
      initial.beneficiaryId,
      hidden.supportCaseId,
    )).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('briefing AI suggestions (D45 영역 ① · CCC-39)', () => {
  // 세션 하나에 provider_generated 초안을 SQL 로 시드한다(v2 구조화 questions_json).
  // 활성 프로바이더 설정·케이스 동의는 호출자가 먼저 마련한다(0026 가드가 검사).
  async function seedStructuredDraft(
    caseId: string,
    sessionId: string,
    seedKey: string,
    suggestions: Array<{ title: string; reason: string }>,
    configId: string,
    consentId: string,
  ): Promise<{ workItemId: string }> {
    const source = await seedMaskedSourceSnapshot(caseId, sessionId, `${seedKey}-source`, [
      { key: 'main', sourceRef: `memo:${seedKey}`, evidenceQuote: `MASKED_${seedKey}_EVIDENCE` },
    ]);
    const evidence = source.evidenceByKey.main;
    if (evidence === undefined) throw new Error('expected seeded suggestion evidence');
    const sessionScope = await t.db.prepare(
      'SELECT support_case_id FROM sessions WHERE id = ? AND org_id = ?',
    ).bind(sessionId, counselor.orgId).first<{ support_case_id: string }>();
    if (sessionScope === null) throw new Error('expected session scope');

    const workItemId = `${seedKey}-work`;
    const draftId = `${seedKey}-draft`;
    const createdAt = '2026-07-01T00:00:00.000Z';
    await t.db.prepare(
      'INSERT INTO ai_work_items (id, org_id, support_case_id, session_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(workItemId, counselor.orgId, sessionScope.support_case_id, sessionId, 'text_ai_briefing', createdAt).run();
    await t.db.prepare(
      `INSERT INTO ai_draft_versions (
        id, work_item_id, version, parent_version_id, summary_text, questions_json,
        source_snapshot_id, source_snapshot_hash, consent_evidence_id, provider_config_id, model_id, prompt_version, schema_version,
        origin, creation_mode, grounding_status, created_by, created_at
      ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', 'provider_generated', 'grounded', ?, ?)`,
    ).bind(
      draftId,
      workItemId,
      `${seedKey}_SUMMARY`,
      JSON.stringify(suggestions),
      source.snapshotId,
      source.snapshotHash,
      consentId,
      configId,
      'gpt-5-codex',
      'provider-prompt-v2',
      'provider-schema-v2',
      counselor.userId,
      createdAt,
    ).run();
    await t.db.prepare(
      `INSERT INTO ai_evidence_links (
        id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `${seedKey}-claim-link`, draftId, evidence.id, 'seed-claim',
      evidence.evidenceQuote, evidence.sourceRef, evidence.sourceStart, evidence.sourceEnd, createdAt,
    ).run();
    for (const [index] of suggestions.entries()) {
      await t.db.prepare(
        `INSERT INTO ai_evidence_links (
          id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `${seedKey}-question-${index + 1}`, draftId, evidence.id, `question_${index + 1}`,
        evidence.evidenceQuote, evidence.sourceRef, evidence.sourceStart, evidence.sourceEnd, createdAt,
      ).run();
    }
    return { workItemId };
  }

  it('serves structured suggestions from approved drafts only, capped at three, with the evidence session attached', async () => {
    await t.reset();
    t.env.TEXT_AI_PILOT_ENABLED = '1';
    const config = await registerAiProviderConfiguration(t.env, admin, {
      adapterId: 'codex',
      adapterVersion: 'v1',
      configHash: 'f'.repeat(64),
      approvalRefs: ['privacy-security-approval'],
    });
    await activateAiProviderConfiguration(t.env, admin, config.id);
    const caseRecord = await createCase(t.env, counselor, {});
    const consent = await recordPilotTextAiConsentEvidence(t.env, counselor, caseRecord.id, {
      noticeVersion: 'pilot-text-ai-v1',
      noticeSha256: SHA256,
      evidenceRef: 'r2://opaque-suggestion-consent',
      evidenceSha256: 'a'.repeat(64),
      effectiveAt: '2026-01-01T00:00:00.000Z',
    });
    await grantCurrentTextAiConsent(caseRecord.id);
    const olderSession = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: '01000000-0000-4000-8000-000000000011',
      heldAt: '2026-01-02T10:00:00.000Z',
      channel: 'in_person',
      memo: 'OLDER_SESSION_MEMO',
      gasScores: [],
    });
    const newerSession = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: '01000000-0000-4000-8000-000000000012',
      heldAt: '2026-01-10T10:00:00.000Z',
      channel: 'in_person',
      memo: 'NEWER_SESSION_MEMO',
      gasScores: [],
    });
    const olderDraft = await seedStructuredDraft(caseRecord.id, olderSession.id, 'sugg-older', [
      { title: 'OLDER_TITLE_1', reason: 'OLDER_REASON_1' },
      { title: 'OLDER_TITLE_2', reason: 'OLDER_REASON_2' },
    ], config.id, consent.id);
    const newerDraft = await seedStructuredDraft(caseRecord.id, newerSession.id, 'sugg-newer', [
      { title: 'NEWER_TITLE_1', reason: 'NEWER_REASON_1' },
      { title: 'NEWER_TITLE_2', reason: 'NEWER_REASON_2' },
      { title: 'NEWER_TITLE_3', reason: 'NEWER_REASON_3' },
    ], config.id, consent.id);
    const scope = await t.db.prepare(
      'SELECT id, beneficiary_id FROM support_cases WHERE legacy_case_id = ? AND org_id = ?',
    ).bind(caseRecord.id, counselor.orgId).first<{ id: string; beneficiary_id: string }>();
    if (scope === null) throw new Error('expected canonical support case scope');

    // R2 — 승인 전 초안은 어떤 제안도 브리핑에 내보내지 않는다(재료가 공식 기록만임을 고정).
    const pendingBriefing = await getParticipantBriefing(
      t.env, counselor, scope.beneficiary_id, scope.id,
    );
    expect(pendingBriefing.aiSuggestions).toEqual([]);
    expectNoCanaries(pendingBriefing, ['OLDER_TITLE_1', 'NEWER_TITLE_1', 'OLDER_REASON_1', 'NEWER_REASON_1']);

    await approveGeneratedAiDraft(t.env, counselor, olderDraft.workItemId, 1);
    // 승인 시각(ms)이 겹치면 최신순 정렬이 비결정적이 된다 — 두 승인 사이 간격을 강제한다.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await approveGeneratedAiDraft(t.env, counselor, newerDraft.workItemId, 1);

    // 최대 3개 — 최신 승인(3개짜리)이 상한을 채우고 이전 승인분은 밀려난다(D45).
    const briefing = await getParticipantBriefing(t.env, counselor, scope.beneficiary_id, scope.id);
    expect(briefing.aiSuggestions).toEqual([
      {
        sourceSupportCase: expect.objectContaining({ id: scope.id }),
        sessionId: newerSession.id,
        heldAt: '2026-01-10T10:00:00.000Z',
        title: 'NEWER_TITLE_1',
        reason: 'NEWER_REASON_1',
      },
      {
        sourceSupportCase: expect.objectContaining({ id: scope.id }),
        sessionId: newerSession.id,
        heldAt: '2026-01-10T10:00:00.000Z',
        title: 'NEWER_TITLE_2',
        reason: 'NEWER_REASON_2',
      },
      {
        sourceSupportCase: expect.objectContaining({ id: scope.id }),
        sessionId: newerSession.id,
        heldAt: '2026-01-10T10:00:00.000Z',
        title: 'NEWER_TITLE_3',
        reason: 'NEWER_REASON_3',
      },
    ]);
  });
});

describe('overall goal (D45 · CCC-41)', () => {
  it('lets only the assigned counselor set, edit, and clear it — trimmed, audited, briefing-visible', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });

    // 설정 전에는 null 로 온다 — 화면의 "설정 전" 폴백 재료.
    await expect(getParticipantBriefing(
      t.env, canonicalActors.counselor, created.beneficiaryId, created.supportCaseId,
    )).resolves.toMatchObject({ overallGoal: null, canEditOverallGoal: true });

    // 담당 실무자가 그 자리에서 입력한다. 앞뒤 공백은 저장 전에 정리된다.
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.counselor, created.supportCaseId, '  주거 안정과 채무 상환 계획 실행  ',
    )).resolves.toEqual({ supportCaseId: created.supportCaseId, overallGoal: '주거 안정과 채무 상환 계획 실행' });

    // 전체 목표는 수정 가능하다(D62 — 세부 목표도 이제 수정 가능, 두 층 다 이력 보존).
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.counselor, created.supportCaseId, '자립 기반 마련',
    )).resolves.toMatchObject({ overallGoal: '자립 기반 마련' });
    await expect(getParticipantBriefing(
      t.env, canonicalActors.counselor, created.beneficiaryId, created.supportCaseId,
    )).resolves.toMatchObject({ overallGoal: '자립 기반 마련' });

    // 기관 관리자도 수정한다(2026-07-30 Q 결정 — ADR-0018 개정, 구 '담당 실무자만' 대체).
    // 브리핑도 편집 가능으로 알린다.
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.admin, created.supportCaseId, '관리자가 고친 전체 목표',
    )).resolves.toMatchObject({ overallGoal: '관리자가 고친 전체 목표' });
    await expect(getParticipantBriefing(
      t.env, canonicalActors.admin, created.beneficiaryId, created.supportCaseId,
    )).resolves.toMatchObject({ overallGoal: '관리자가 고친 전체 목표', canEditOverallGoal: true });

    // 되돌려 놓는다 — 아래 단정들이 이 값을 이어서 쓴다.
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.counselor, created.supportCaseId, '자립 기반 마련',
    )).resolves.toMatchObject({ overallGoal: '자립 기반 마련' });

    // 같은 문구 재저장 — 감사는 남지만 이력은 늘지 않는다(D62 §4).
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.counselor, created.supportCaseId, '자립 기반 마련',
    )).resolves.toMatchObject({ overallGoal: '자립 기반 마련' });

    // 비담당 실무자는 접근 자체가 막힌다(D7).
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.secondCounselor, created.supportCaseId, 'NOT_ASSIGNED',
    )).rejects.toBeInstanceOf(ForbiddenError);

    // 빈 문자열 저장 = 설정 전으로 되돌림.
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.counselor, created.supportCaseId, '   ',
    )).resolves.toEqual({ supportCaseId: created.supportCaseId, overallGoal: null });

    // 길이 상한 200자(게이트웨이 검증).
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.counselor, created.supportCaseId, '가'.repeat(201),
    )).rejects.toBeInstanceOf(ValidationError);

    // 변경 전건 감사(D14) — 성공한 쓰기 6건(입력·수정·관리자 수정·원복·같은 문구 재저장·지움)이
    // 전부 남고, 목표 문장은 detail 에 없다.
    const audits = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE action = 'update' AND target_table = 'support_cases' AND target_id = ?`,
    ).bind(created.supportCaseId).all<{ detail: string }>();
    const goalAudits = audits.results.filter((row) => row.detail.includes('overall_goal'));
    expect(goalAudits).toHaveLength(6);
    for (const row of goalAudits) {
      expect(row.detail).not.toContain('자립 기반 마련');
      expect(row.detail).not.toContain('주거 안정');
      expect(row.detail).not.toContain('관리자가 고친');
    }

    // 이력(D62 §4) — 문구가 실제로 바뀐 5번(최초 작성·수정·관리자 수정·원복·지움)만
    // goal_revisions 에 남는다. goal_id NULL = 전체 목표, title NULL = 지움.
    const revisions = await t.db.prepare(
      'SELECT title, edited_by FROM goal_revisions WHERE support_case_id = ? AND goal_id IS NULL ORDER BY id',
    ).bind(created.supportCaseId).all<{ title: string | null; edited_by: string }>();
    expect(revisions.results.map((row) => row.title)).toEqual([
      '주거 안정과 채무 상환 계획 실행',
      '자립 기반 마련',
      '관리자가 고친 전체 목표',
      '자립 기반 마련',
      null,
    ]);
    expect(revisions.results[2]?.edited_by).toBe(canonicalActors.admin.userId);
  });

  it('rejects editing on a closed support case', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await closeSupportCase(t.env, canonicalActors.counselor, created.supportCaseId, 'program complete');
    await expect(setSupportCaseOverallGoal(
      t.env, canonicalActors.counselor, created.supportCaseId, '종결 후 수정 시도',
    )).rejects.toBeInstanceOf(ValidationError);
  });
});
