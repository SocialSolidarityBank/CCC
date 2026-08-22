import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  activateAiProviderConfiguration,
  createCase,
  createManualSession,
  registerAiProviderConfiguration,
  registerRecording,
  SESSION_GOAL_MATERIAL_LABEL,
} from '../../../db/gateway';
import {
  AI_DRAFT_PROMPT_VERSION,
  AI_DRAFT_SCHEMA_VERSION,
  AiProviderInputError,
  AiProviderProhibitedOutputError,
  CODEX_PROVIDER_ADAPTER_VERSION,
  CODEX_PROVIDER_ID,
  AI_PROVIDER_REGISTRY_VERSION,
  canonicalAiProviderConfigHash,
  generatePreviewFixtureAiDraft,
  validateAiProviderOutput,
  validateAiProviderRequest,
  type AiContrastAxisStates,
  type AiProviderConfig,
  type AiProviderMaterial,
  type AiProviderOutput,
  type AiProviderRequest,
  type AiProviderTestAdapter,
} from '../src/ai-provider';
import { contrastAxisStates } from '../src/request-handler';
import type { ApiEnv } from '../src/identity';
import { setupD1 } from './support/d1';

const t = setupD1();

const TRANSCRIPT_TEXT = '실무자는 이사 계획을 물었고 당사자는 다음 달 이사를 준비한다고 답했다.';
const TEXT_CONTEXT_TEXT = [
  '[전체 목표] 안정된 주거를 마련한다',
  `${SESSION_GOAL_MATERIAL_LABEL} 이사 일정 확인하기`,
  '수기 메모: 관리비 체납 이야기가 나왔다.',
].join('\n');
/** 회기 목표 구획이 없는 텍스트 재료. 미논의 축이 no_session_goal 이 되는 경우다. */
const TEXT_WITHOUT_SESSION_GOAL = [
  '[전체 목표] 안정된 주거를 마련한다',
  '수기 메모: 관리비 체납 이야기가 나왔다.',
].join('\n');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function material(
  kind: 'transcript' | 'text_context',
  sourceRef: string,
  maskedText: string,
  evidenceId: string,
  sourceSha256: string,
): AiProviderMaterial {
  return {
    kind,
    sourceRef,
    maskedText,
    evidence: [{
      evidenceId,
      sourceRef: `${kind}:span-1`,
      sourceSha256,
      evidenceQuote: maskedText,
      sourceStart: 0,
      sourceEnd: Array.from(maskedText).length,
    }],
  };
}

const transcriptMaterial = (): AiProviderMaterial => material(
  'transcript',
  'snapshot-transcript-1',
  TRANSCRIPT_TEXT,
  'evidence-transcript-1',
  HASH_A,
);
const textMaterial = (maskedText = TEXT_CONTEXT_TEXT): AiProviderMaterial => material(
  'text_context',
  'snapshot-text-1',
  maskedText,
  'evidence-text-1',
  HASH_B,
);

const ALL_APPLIED: AiContrastAxisStates = {
  missing_from_memo: 'applied',
  missing_from_transcript: 'applied',
  undiscussed_session_goal: 'applied',
};

function bothMaterialsRequest(axes: AiContrastAxisStates = ALL_APPLIED): AiProviderRequest {
  return validateAiProviderRequest({
    materials: [transcriptMaterial(), textMaterial()],
    contrastAxes: axes,
  });
}

function baseOutput(request: AiProviderRequest): AiProviderOutput {
  const evidence = request.materials.flatMap((item) => item.evidence.map((reference) => ({ ...reference })));
  return {
    claims: [{
      claimKey: 'move-plan',
      section: 'other_topics',
      text: '이사 준비 상황을 확인했다.',
      evidence,
    }],
    questions: [
      { title: '이사 일정 확인', reason: '다음 회차에 확정 일정을 물어야 합니다.', evidence: [{ ...evidence[0]! }] },
      { title: '관리비 체납 확인', reason: '체납 규모가 아직 확인되지 않았습니다.', evidence: [{ ...evidence[0]! }] },
    ],
    oneLiner: '이사 준비와 관리비 체납을 확인했다.',
    contrast: {
      missing_from_memo: [],
      missing_from_transcript: [],
      undiscussed_session_goal: [],
    },
    flagSuggestions: [],
  };
}

describe('호출 ① 재료 다중화와 대조 3종 v4 (D69 · ADR-0036 · CCC-102)', () => {
  it('버전이 v4 로 올라간다', () => {
    expect(AI_DRAFT_PROMPT_VERSION).toBe('phase1.grounded.v4');
    expect(AI_DRAFT_SCHEMA_VERSION).toBe('phase1.grounded-draft.v4');
  });

  it('재료 두 개와 대조 3종을 담은 출력이 왕복한다', () => {
    const request = bothMaterialsRequest();
    expect(request.materials).toHaveLength(2);
    const output = validateAiProviderOutput({
      ...baseOutput(request),
      contrast: {
        missing_from_memo: [{
          description: '이사 준비 언급이 메모에 없다',
          materialKind: 'transcript',
          sourceRef: 'snapshot-transcript-1',
          quote: '다음 달 이사를 준비한다고',
        }],
        missing_from_transcript: [{
          description: '관리비 체납이 음성에 없다',
          materialKind: 'text_context',
          sourceRef: 'snapshot-text-1',
          quote: '관리비 체납 이야기가 나왔다.',
        }],
        undiscussed_session_goal: [{
          description: '이사 일정 확인을 다루지 않았다',
          materialKind: 'text_context',
          sourceRef: 'snapshot-text-1',
          quote: '이사 일정 확인하기',
        }],
      },
    }, request);
    expect(output.contrast.missing_from_memo).toHaveLength(1);
    expect(output.contrast.missing_from_transcript[0]?.materialKind).toBe('text_context');
    expect(output.contrast.undiscussed_session_goal[0]?.quote).toBe('이사 일정 확인하기');
  });

  it('재료 원문에 없는 인용은 거부한다', () => {
    const request = bothMaterialsRequest();
    expect(() => validateAiProviderOutput({
      ...baseOutput(request),
      contrast: {
        missing_from_memo: [{
          description: '지어낸 인용',
          materialKind: 'transcript',
          sourceRef: 'snapshot-transcript-1',
          quote: '전세 대출을 알아보기로 했다',
        }],
        missing_from_transcript: [],
        undiscussed_session_goal: [],
      },
    }, request)).toThrow(AiProviderProhibitedOutputError);
  });

  // 축 정의가 곧 인용 출처다. '메모에 없는 내용' 은 전사에서만 인용할 수 있다.
  // 모델이 재료를 바꿔 붙이면 여기서 닫힌다.
  it('축이 쓰지 않는 재료를 인용하면 거부한다', () => {
    const request = bothMaterialsRequest();
    expect(() => validateAiProviderOutput({
      ...baseOutput(request),
      contrast: {
        missing_from_memo: [{
          description: '메모에서 인용했다',
          materialKind: 'text_context',
          sourceRef: 'snapshot-text-1',
          quote: '관리비 체납 이야기가 나왔다.',
        }],
        missing_from_transcript: [],
        undiscussed_session_goal: [],
      },
    }, request)).toThrow(AiProviderProhibitedOutputError);
  });

  it('대조 설명의 금지 판단은 거부한다 (R5)', () => {
    const request = bothMaterialsRequest();
    expect(() => validateAiProviderOutput({
      ...baseOutput(request),
      contrast: {
        missing_from_memo: [{
          description: '지원 중단 판단이 필요하다',
          materialKind: 'transcript',
          sourceRef: 'snapshot-transcript-1',
          quote: '다음 달 이사를 준비한다고',
        }],
        missing_from_transcript: [],
        undiscussed_session_goal: [],
      },
    }, request)).toThrow(AiProviderProhibitedOutputError);
  });

  // 항목을 **실린 재료에서 올바른 종류로** 인용하게 두어야 한다. 없는 재료를 인용하면
  // 다른 검사가 먼저 걸려 이 테스트가 헛돈다(축 상태 검사가 사라져도 초록이 된다).
  it('적용되지 않은 축에 항목이 있으면 거부한다', () => {
    const request = validateAiProviderRequest({
      materials: [textMaterial()],
      contrastAxes: {
        missing_from_memo: 'no_transcript',
        missing_from_transcript: 'no_transcript',
        undiscussed_session_goal: 'applied',
      } satisfies AiContrastAxisStates,
    });
    const finding = {
      description: '있을 수 없는 항목',
      materialKind: 'text_context',
      sourceRef: 'snapshot-text-1',
      quote: '관리비 체납 이야기가 나왔다.',
    };
    // 대조군: 같은 항목이 applied 축(미논의)에 있으면 통과한다. 거부 사유가 축 상태임을
    // 못 박는다.
    expect(validateAiProviderOutput({
      ...baseOutput(request),
      contrast: {
        missing_from_memo: [],
        missing_from_transcript: [],
        undiscussed_session_goal: [finding],
      },
    }, request).contrast.undiscussed_session_goal).toHaveLength(1);

    expect(() => validateAiProviderOutput({
      ...baseOutput(request),
      contrast: {
        missing_from_memo: [],
        missing_from_transcript: [finding],
        undiscussed_session_goal: [],
      },
    }, request)).toThrow(AiProviderProhibitedOutputError);
  });

  it('재료가 하나뿐인데 대조 축을 applied 로 보내면 요청 단계에서 막힌다', () => {
    expect(() => validateAiProviderRequest({
      materials: [textMaterial()],
      contrastAxes: ALL_APPLIED,
    })).toThrow(AiProviderInputError);
  });

  it('축 상태는 재료 구성에서 서버가 판정한다', () => {
    const transcript = transcriptMaterial();
    const text = textMaterial();
    const textWithoutGoal = textMaterial(TEXT_WITHOUT_SESSION_GOAL);

    expect(contrastAxisStates([transcript, text])).toEqual(ALL_APPLIED);
    expect(contrastAxisStates([transcript, textWithoutGoal])).toEqual({
      missing_from_memo: 'applied',
      missing_from_transcript: 'applied',
      undiscussed_session_goal: 'no_session_goal',
    });
    // 전사만 있으면 없는 것은 텍스트다. 사유는 없는 쪽 이름으로 남는다.
    expect(contrastAxisStates([transcript])).toEqual({
      missing_from_memo: 'no_text',
      missing_from_transcript: 'no_text',
      undiscussed_session_goal: 'no_text',
    });
    expect(contrastAxisStates([text])).toEqual({
      missing_from_memo: 'no_transcript',
      missing_from_transcript: 'no_transcript',
      undiscussed_session_goal: 'applied',
    });
    expect(contrastAxisStates([textWithoutGoal])).toEqual({
      missing_from_memo: 'no_transcript',
      missing_from_transcript: 'no_transcript',
      undiscussed_session_goal: 'no_session_goal',
    });
    expect(contrastAxisStates([])).toEqual({
      missing_from_memo: 'no_transcript',
      missing_from_transcript: 'no_transcript',
      undiscussed_session_goal: 'no_text',
    });
  });

  it('프리뷰 픽스처는 축 상태를 따라 대조를 만든다', () => {
    const both = bothMaterialsRequest();
    const bothOutput = validateAiProviderOutput(generatePreviewFixtureAiDraft(both), both);
    expect(bothOutput.contrast.missing_from_memo).toHaveLength(1);
    expect(bothOutput.contrast.missing_from_memo[0]?.materialKind).toBe('transcript');
    expect(bothOutput.contrast.undiscussed_session_goal).toHaveLength(1);

    const textOnly = validateAiProviderRequest({
      materials: [textMaterial(TEXT_WITHOUT_SESSION_GOAL)],
      contrastAxes: {
        missing_from_memo: 'no_transcript',
        missing_from_transcript: 'no_transcript',
        undiscussed_session_goal: 'no_session_goal',
      } satisfies AiContrastAxisStates,
    });
    const textOnlyOutput = validateAiProviderOutput(generatePreviewFixtureAiDraft(textOnly), textOnly);
    expect(textOnlyOutput.contrast.missing_from_memo).toEqual([]);
    expect(textOnlyOutput.contrast.missing_from_transcript).toEqual([]);
    expect(textOnlyOutput.contrast.undiscussed_session_goal).toEqual([]);
  });
});

// ── 라우트 경로 ────────────────────────────────────────────────────────────────

const counselor = { userId: 'counselor@example.invalid', orgId: 'org_demo', role: 'counselor' as const };
const admin = { userId: 'admin@example.invalid', orgId: 'org_demo', role: 'admin' as const };
const serviceHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'service@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'service',
};
const counselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': counselor.userId,
  'X-CCC-Org-Id': counselor.orgId,
  'X-CCC-Role': 'counselor',
};

const ROUTE_PROVIDER_CONFIG = {
  registryVersion: AI_PROVIDER_REGISTRY_VERSION,
  providerId: CODEX_PROVIDER_ID,
  adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
  configVersion: 'contrast-test-v1',
  model: 'gpt-5-codex-test',
} satisfies AiProviderConfig;

/** 재료 전부를 인용하고 적용된 축마다 항목 하나를 내는 어댑터. */
class ContrastAdapter implements AiProviderTestAdapter {
  readonly providerId = CODEX_PROVIDER_ID;
  readonly adapterVersion = CODEX_PROVIDER_ADAPTER_VERSION;
  readonly testOnly = true as const;
  readonly config = ROUTE_PROVIDER_CONFIG;
  readonly invocations: AiProviderRequest[] = [];

  async generate(request: AiProviderRequest): Promise<AiProviderOutput> {
    this.invocations.push(request);
    const evidence = request.materials.flatMap((item) => item.evidence.map((reference) => ({ ...reference })));
    const finding = (axis: 'missing_from_memo' | 'missing_from_transcript' | 'undiscussed_session_goal') => {
      if (request.contrastAxes[axis] !== 'applied') return [];
      const kind = axis === 'missing_from_memo' ? 'transcript' : 'text_context';
      const source = request.materials.find((item) => item.kind === kind);
      const quote = source?.evidence[0]?.evidenceQuote;
      if (source === undefined || quote === undefined) return [];
      return [{ description: `${axis} 항목`, materialKind: source.kind, sourceRef: source.sourceRef, quote }];
    };
    return {
      claims: [{
        claimKey: 'contrast-claim',
        section: 'other_topics',
        text: '회차 내용을 정리했다.',
        evidence,
      }],
      questions: [
        { title: '이사 일정 확인', reason: '확정 일정을 물어야 합니다.', evidence: [{ ...evidence[0]! }] },
        { title: '관리비 확인', reason: '체납 규모가 확인되지 않았습니다.', evidence: [{ ...evidence[0]! }] },
      ],
      oneLiner: '이사와 관리비를 확인했다.',
      contrast: {
        missing_from_memo: finding('missing_from_memo'),
        missing_from_transcript: finding('missing_from_transcript'),
        undiscussed_session_goal: finding('undiscussed_session_goal'),
      },
      flagSuggestions: request.materials
        .filter((material) => material.kind === 'transcript')
        .slice(0, 1)
        .map((material) => ({
          type: 'violence_exploitation',
          sourceRef: material.sourceRef,
          quote: material.evidence[0]!.evidenceQuote,
        })),
    };
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function snapshotBody(maskedText: string, sourceRef: string) {
  const sha256 = await sha256Hex(maskedText);
  return {
    maskedText,
    sha256,
    maskingPipelineVersion: 'local-ner-v1',
    evidence: [{
      id: crypto.randomUUID(),
      sourceRef,
      sourceSha256: sha256,
      evidenceQuote: maskedText,
      sourceStart: 0,
      sourceEnd: Array.from(maskedText).length,
    }],
  };
}

interface RouteFixtureOptions {
  configHash?: string;
  adapter?: ContrastAdapter;
}

async function setupRouteFixture(options: RouteFixtureOptions = {}) {
  await t.reset();
  const adapter = options.adapter ?? new ContrastAdapter();
  const env: ApiEnv = {
    ...t.env,
    TEXT_AI_PILOT_ENABLED: '1',
    AI_PROVIDER_ADAPTER: adapter,
  };
  const caseRecord = await createCase(t.env, counselor, {
    consentRecordingAt: '2026-08-01T00:00:00.000Z',
    consentTextAiAt: '2026-08-01T00:00:00.000Z',
  });
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: crypto.randomUUID(),
    heldAt: '2026-08-01T09:00:00.000Z',
    channel: 'in_person',
    memo: '수기 메모: 관리비 체납 이야기가 나왔다.',
    gasScores: [],
  });
  await registerRecording(t.env, counselor, session.id, `audio/${session.id}/fixture`);

  const consent = await worker.fetch(new Request(
    `http://localhost/cases/${caseRecord.id}/pilot-text-ai-consent`,
    {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({
        noticeVersion: 'contrast-notice-v1',
        noticeHash: 'c'.repeat(64),
        evidenceRef: 'contrast-evidence-1',
        evidenceHash: 'd'.repeat(64),
        effectiveAt: '2020-01-01T09:00:00.000Z',
      }),
    },
  ), env);
  expect(consent.status).toBe(201);

  const providerConfig = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: CODEX_PROVIDER_ID,
    adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
    configHash: options.configHash ?? await canonicalAiProviderConfigHash(ROUTE_PROVIDER_CONFIG),
    approvalRefs: ['contrast-approval-1'],
  });
  await activateAiProviderConfiguration(t.env, admin, providerConfig.id);
  return { adapter, caseRecord, env, session };
}

async function postTextSnapshot(env: ApiEnv, sessionId: string, maskedText = TEXT_CONTEXT_TEXT) {
  const response = await worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai/source`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(await snapshotBody(maskedText, 'memo:text-1')),
  }), env);
  expect(response.status).toBe(201);
  return response.json() as Promise<{ sourceSnapshotId: string; sha256: string }>;
}

async function postRecordingResult(env: ApiEnv, sessionId: string) {
  return worker.fetch(new Request(`http://localhost/pipeline/jobs/${sessionId}/result`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      ...await snapshotBody(TRANSCRIPT_TEXT, 'recording-transcript'),
      emotionScores: {},
    }),
  }), env);
}

async function generateFromSnapshot(env: ApiEnv, sessionId: string, sourceSnapshotId: string) {
  return worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai/generate`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ sourceSnapshotId }),
  }), env);
}

interface RouteDraft {
  version: number;
  claims: Array<{ claimKey: string; section: string; text: string }>;
  evidence: Array<{ id: string; claimKey: string; quote: string }>;
  contrast: Array<{ axis: string; status: string; findings: Array<{ materialKind: string; quote: string }> }>;
}

async function readDraft(env: ApiEnv, sessionId: string): Promise<RouteDraft> {
  const response = await worker.fetch(
    new Request(`http://localhost/sessions/${sessionId}/ai`, { headers: counselorHeaders }),
    env,
  );
  expect(response.status).toBe(200);
  const body = await response.json() as { draft: RouteDraft } | RouteDraft;
  return 'draft' in body ? body.draft : body;
}

describe('generateAiDraft 재료 조립 (CCC-102)', () => {
  it('전사와 텍스트 두 재료를 함께 싣고 증빙·대조를 저장한다', async () => {
    const { adapter, env, session } = await setupRouteFixture();
    const text = await postTextSnapshot(env, session.id);
    // 녹음 결과 커밋은 본문 없는 204 다. 이 안에서 호출 ① 이 함께 돈다.
    const result = await postRecordingResult(env, session.id);
    expect(result.status).toBe(204);

    const request = adapter.invocations[0];
    expect(request?.materials.map((item) => item.kind)).toEqual(['transcript', 'text_context']);
    expect(request?.contrastAxes).toEqual({
      missing_from_memo: 'applied',
      missing_from_transcript: 'applied',
      undiscussed_session_goal: 'applied',
    });

    // 재료 증빙: 초안이 쓴 스냅샷 전부의 id 와 해시가 남는다.
    const materials = await t.db.prepare(
      `SELECT kind, snapshot_id, snapshot_sha256 FROM ai_draft_source_materials ORDER BY kind`,
    ).all<{ kind: string; snapshot_id: string; snapshot_sha256: string }>();
    expect(materials.results).toHaveLength(2);
    expect(materials.results.map((row) => row.kind)).toEqual(['text_context', 'transcript']);
    const textRow = materials.results.find((row) => row.kind === 'text_context');
    expect(textRow?.snapshot_id).toBe(text.sourceSnapshotId);
    expect(textRow?.snapshot_sha256).toBe(text.sha256);
    const transcriptRow = materials.results.find((row) => row.kind === 'transcript');
    expect(transcriptRow?.snapshot_sha256).toBe(await sha256Hex(TRANSCRIPT_TEXT));

    const draft = await readDraft(env, session.id);
    expect(draft.claims).toEqual([{
      claimKey: 'contrast-claim',
      section: 'other_topics',
      text: '회차 내용을 정리했다.',
    }]);
    expect(draft.contrast.map((axis) => axis.axis)).toEqual([
      'missing_from_memo',
      'missing_from_transcript',
      'undiscussed_session_goal',
    ]);
    expect(draft.contrast.every((axis) => axis.status === 'applied')).toBe(true);
    expect(draft.contrast.find((axis) => axis.axis === 'missing_from_memo')?.findings[0]?.materialKind)
      .toBe('transcript');
    expect(draft.contrast.find((axis) => axis.axis === 'undiscussed_session_goal')?.findings[0]?.quote)
      .toBe(TEXT_CONTEXT_TEXT);

    const flags = await t.db.prepare(
      `SELECT id, flag_type, quote, source, review_status
       FROM flags WHERE session_id = ? ORDER BY created_at, id`,
    ).bind(session.id).all<{
      id: string;
      flag_type: string;
      quote: string;
      source: string;
      review_status: string;
    }>();
    expect(flags.results).toEqual([expect.objectContaining({
      flag_type: 'violence_exploitation',
      quote: TRANSCRIPT_TEXT,
      source: 'ai',
      review_status: 'pending',
    })]);
    const firstFlagId = flags.results[0]?.id;
    if (firstFlagId === undefined) throw new Error('initial pending flag is missing');

    expect((await generateFromSnapshot(env, session.id, text.sourceSnapshotId)).status).toBe(201);
    const replacementFlags = await t.db.prepare(
      `SELECT id, flag_type, quote, source, review_status
       FROM flags WHERE session_id = ? ORDER BY created_at, id`,
    ).bind(session.id).all<{
      id: string;
      flag_type: string;
      quote: string;
      source: string;
      review_status: string;
    }>();
    expect(replacementFlags.results).toHaveLength(1);
    expect(replacementFlags.results[0]?.id).not.toBe(firstFlagId);
    const flagAudits = await t.db.prepare(
      `SELECT action, target_id FROM audit_log
       WHERE target_table = 'flags' ORDER BY id`,
    ).all<{ action: string; target_id: string }>();
    expect(flagAudits.results).toEqual([
      { action: 'create', target_id: firstFlagId },
      { action: 'delete', target_id: firstFlagId },
      { action: 'create', target_id: replacementFlags.results[0]?.id },
    ]);
  });

  it('반대편 재료가 없으면 재료 하나로 돌고 축은 재료 없음으로 기록된다', async () => {
    const { adapter, env, session } = await setupRouteFixture();
    const text = await postTextSnapshot(env, session.id, TEXT_WITHOUT_SESSION_GOAL);
    expect((await generateFromSnapshot(env, session.id, text.sourceSnapshotId)).status).toBe(201);

    expect(adapter.invocations[0]?.materials).toHaveLength(1);
    expect(adapter.invocations[0]?.materials[0]?.kind).toBe('text_context');

    const materials = await t.db.prepare('SELECT kind FROM ai_draft_source_materials').all<{ kind: string }>();
    expect(materials.results.map((row) => row.kind)).toEqual(['text_context']);

    const draft = await readDraft(env, session.id);
    expect(draft.contrast.map((axis) => axis.status)).toEqual([
      'no_transcript',
      'no_transcript',
      'no_session_goal',
    ]);
    expect(draft.contrast.every((axis) => axis.findings.length === 0)).toBe(true);
  });

  it('회기 목표 구획이 없으면 미논의 축만 재료 없음이 된다', async () => {
    const { env, session } = await setupRouteFixture();
    await postTextSnapshot(env, session.id, TEXT_WITHOUT_SESSION_GOAL);
    expect((await postRecordingResult(env, session.id)).status).toBe(204);

    const draft = await readDraft(env, session.id);
    const statusByAxis = new Map(draft.contrast.map((axis) => [axis.axis, axis.status] as const));
    expect(statusByAxis.get('missing_from_memo')).toBe('applied');
    expect(statusByAxis.get('missing_from_transcript')).toBe('applied');
    expect(statusByAxis.get('undiscussed_session_goal')).toBe('no_session_goal');
  });

  // 편집은 근거 재선택이다. 재료가 둘이면 근거도 양쪽 스냅샷에 걸쳐 있으므로, 편집이
  // 재료 전부를 상대로 대조하지 않으면 v3 초안은 한 번 고치는 순간 400 으로 막힌다.
  // 그리고 대조·재료 증빙을 새 버전으로 옮기지 않으면 승인 대상(R2)이 사라진다.
  it('재료가 둘인 초안을 편집해도 근거가 통과하고 대조·증빙이 새 버전으로 넘어간다', async () => {
    const { env, session } = await setupRouteFixture();
    await postTextSnapshot(env, session.id);
    expect((await postRecordingResult(env, session.id)).status).toBe(204);
    const first = await readDraft(env, session.id);
    expect(first.version).toBe(1);

    // 근거가 두 스냅샷에 걸쳐 있어야 이 테스트가 뜻을 갖는다.
    const attestedSnapshots = await t.db.prepare(
      `SELECT COUNT(DISTINCT item.snapshot_id) AS snapshots
       FROM ai_evidence_links AS link
       JOIN ai_masked_source_evidence_items AS item ON item.id = link.source_evidence_item_id`,
    ).first<{ snapshots: number }>();
    expect(attestedSnapshots?.snapshots).toBe(2);

    const edited = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${first.version}/edit`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({
          expectedVersion: first.version,
          evidenceIds: first.evidence.map((evidence) => evidence.id),
        }),
      },
    ), env);
    expect(edited.status).toBe(200);
    const next = await edited.json() as RouteDraft;
    expect(next.version).toBe(2);
    expect(next.contrast).toHaveLength(3);
    expect(next.contrast.every((axis) => axis.status === 'applied')).toBe(true);

    const secondId = await t.db.prepare('SELECT id FROM ai_draft_versions WHERE version = 2')
      .first<{ id: string }>();
    if (secondId === null) throw new Error('expected the edited draft version');
    const materials = await t.db.prepare(
      'SELECT kind FROM ai_draft_source_materials WHERE draft_version_id = ? ORDER BY kind',
    ).bind(secondId.id).all<{ kind: string }>();
    expect(materials.results.map((row) => row.kind)).toEqual(['text_context', 'transcript']);
    const axes = await t.db.prepare(
      'SELECT status FROM ai_draft_contrast_axes WHERE draft_version_id = ?',
    ).bind(secondId.id).all<{ status: string }>();
    expect(axes.results.map((row) => row.status)).toEqual(['applied', 'applied', 'applied']);
  });

  it('대조는 읽기 전용이며 화자 확인 뒤 통째 승인된다 (R2 · D71)', async () => {
    const { env, session } = await setupRouteFixture();
    await postTextSnapshot(env, session.id);
    expect((await postRecordingResult(env, session.id)).status).toBe(204);
    const draft = await readDraft(env, session.id);

    const reviewRequest = (body: Record<string, unknown>) => worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${draft.version}/review`,
      { method: 'POST', headers: counselorHeaders, body: JSON.stringify(body) },
    ), env);

    // CCC-114 회귀: 결정만 실은 승인은 막힌다 — 녹음 재료가 있으니 화자 확인부터 걸린다.
    const decisionOnly = await reviewRequest({ expectedVersion: draft.version, decision: 'approved' });
    expect(decisionOnly.status).toBe(409);
    expect(await decisionOnly.json()).toEqual({ error: 'speaker_confirmation_required' });

    // D71: 대조 항목은 읽기 전용이다. 구 항목별 처리 필드는 API 경계에서 받지 않는다.
    const legacyResolution = await reviewRequest({
      expectedVersion: draft.version,
      decision: 'approved',
      speakerMappingConfirmed: true,
      contrastResolutions: [],
    });
    expect(legacyResolution.status).toBe(400);
    expect(await legacyResolution.json()).toEqual({ error: 'invalid_request' });

    // 화자 확인이 있으면 대조 항목별 처리 없이 통째 승인된다.
    const review = await reviewRequest({
      expectedVersion: draft.version,
      decision: 'approved',
      speakerMappingConfirmed: true,
    });
    expect(review.status).toBe(200);
    const approved = await review.json() as RouteDraft;
    expect(approved.contrast).toHaveLength(3);
    expect(approved.contrast.every((axis) => axis.status === 'applied')).toBe(true);

    // 승인 요청의 확언으로 화자 확인 시각이 함께 기록된다(D11).
    const sessionRow = await t.db.prepare(
      'SELECT approved_at, speaker_mapping_confirmed_at FROM sessions WHERE id = ?',
    ).bind(session.id).first<{ approved_at: string | null; speaker_mapping_confirmed_at: string | null }>();
    expect(sessionRow?.approved_at).not.toBeNull();
    expect(sessionRow?.speaker_mapping_confirmed_at).toBe(sessionRow?.approved_at);
  });

  it('v2 해시가 활성이면 fail-closed 이고 재활성화하면 통과한다', async () => {
    // 프롬프트·스키마 버전이 오르면 활성 설정 해시가 어긋난다. D57 의 의도된 동작.
    const staleHash = await canonicalAiProviderConfigHash({
      ...ROUTE_PROVIDER_CONFIG,
      configVersion: 'contrast-test-stale',
    });
    const { env, session } = await setupRouteFixture({ configHash: staleHash });
    const text = await postTextSnapshot(env, session.id);

    const blocked = await generateFromSnapshot(env, session.id, text.sourceSnapshotId);
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: 'ai_provider_unavailable' });
    expect(await t.db.prepare('SELECT COUNT(*) AS count FROM ai_draft_versions')
      .first<{ count: number }>()).toMatchObject({ count: 0 });

    const reactivated = await registerAiProviderConfiguration(t.env, admin, {
      adapterId: CODEX_PROVIDER_ID,
      adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
      configHash: await canonicalAiProviderConfigHash(ROUTE_PROVIDER_CONFIG),
      approvalRefs: ['contrast-approval-2'],
    });
    await activateAiProviderConfiguration(t.env, admin, reactivated.id);
    expect((await generateFromSnapshot(env, session.id, text.sourceSnapshotId)).status).toBe(201);
  });

  // 0035 는 ai_evidence_links_insert_guard 의 가운데 절만 넓히고 나머지 두 절은 글자
  // 그대로 되살린다. 되살리다 한 절을 흘리면 아무 테스트도 빨개지지 않으므로 여기서 못 박는다.
  it('근거 링크 가드의 나머지 두 절은 0035 뒤에도 그대로 막는다', async () => {
    const { env, session } = await setupRouteFixture();
    await postTextSnapshot(env, session.id);
    expect((await postRecordingResult(env, session.id)).status).toBe(204);

    const draft = await t.db.prepare('SELECT id FROM ai_draft_versions LIMIT 1')
      .first<{ id: string }>();
    const item = await t.db.prepare('SELECT id, source_ref, evidence_quote, source_start, source_end FROM ai_masked_source_evidence_items LIMIT 1')
      .first<{ id: string; source_ref: string; evidence_quote: string; source_start: number; source_end: number }>();
    if (draft === null || item === null) throw new Error('expected a seeded draft and evidence item');

    const insertLink = (draftVersionId: string, id: string) => t.db.prepare(
      `INSERT INTO ai_evidence_links (
         id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote,
         source_ref, source_start, source_end, created_at
       ) VALUES (?, ?, ?, 'guard-probe', ?, ?, ?, ?, '2026-08-01 00:00:00')`,
    ).bind(
      id,
      draftVersionId,
      item.id,
      item.evidence_quote,
      item.source_ref,
      item.source_start,
      item.source_end,
    ).run();

    // 첫째 절: grounded 생성 초안이 아니면 링크를 달 수 없다.
    await expect(insertLink('no-such-draft', 'guard-probe-1'))
      .rejects.toThrow('evidence links require a generated grounded draft');

    // 셋째 절: 이미 검토가 끝난 초안에는 링크를 더 달 수 없다.
    const current = await readDraft(env, session.id);
    // D71 승인 계약: 대조는 읽기 전용이고 화자 확인 뒤 통째 승인한다.
    const review = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${current.version}/review`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({
          expectedVersion: current.version,
          decision: 'approved',
          speakerMappingConfirmed: true,
        }),
      },
    ), env);
    expect(review.status).toBe(200);
    await expect(insertLink(draft.id, 'guard-probe-2')).rejects.toThrow('stale_draft_version');
  });

  it('프리뷰 경로도 v4 구획과 대조를 저장한다', async () => {
    const { env, session } = await setupRouteFixture();
    // 프리뷰 내장 픽스처 갈래를 타려면 주입 어댑터가 없어야 한다.
    const { AI_PROVIDER_ADAPTER: _injected, ...withoutAdapter } = env;
    const previewEnv: ApiEnv = {
      ...withoutAdapter,
      PREVIEW_MODE: 'true',
      PREVIEW_ACCESS_CODE: 'contrast-preview-code',
    };
    const text = await postTextSnapshot(previewEnv, session.id);
    expect((await generateFromSnapshot(previewEnv, session.id, text.sourceSnapshotId)).status).toBe(201);

    const draft = await readDraft(previewEnv, session.id);
    expect(draft.contrast).toHaveLength(3);
    expect(draft.contrast.find((axis) => axis.axis === 'undiscussed_session_goal')?.status).toBe('applied');
    expect(draft.contrast.find((axis) => axis.axis === 'missing_from_memo')?.status).toBe('no_transcript');
  });
});
