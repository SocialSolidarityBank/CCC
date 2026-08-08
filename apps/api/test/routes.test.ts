import { describe, expect, it, vi } from 'vitest';
import worker from './support/local-worker';
import {
  activateAiProviderConfiguration,
  createCase,
  createCounselingSchedule,
  createGoal,
  createSupportCase,
  createManualSession,
  registerAiProviderConfiguration,
  registerRecording,
  updateParticipantPii,
  createParticipantInvite,
} from '../../../db/gateway';
import {
  AI_PROVIDER_REGISTRY_VERSION,
  CODEX_PROVIDER_ADAPTER_VERSION,
  CODEX_PROVIDER_ID,
  CodexProviderAdapter,
  canonicalAiProviderConfigHash,
  resolveAiProviderAdapter,
  type AiProviderConfig,
  type AiProviderOutput,
  type AiProviderRequest,
  type AiProviderTestAdapter,
} from '../src/ai-provider';
import type { ApiEnv } from '../src/identity';
import { setupD1 } from './support/d1';

const counselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'counselor.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'counselor',
};

const unassignedCounselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'unassigned.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'counselor',
};

const serviceHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'service.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'service',
};

const otherOrgServiceHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'service.other.routes@example.invalid',
  'X-CCC-Org-Id': 'org_other',
  'X-CCC-Role': 'service',
};

const otherOrgCounselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'counselor.other.routes@example.invalid',
  'X-CCC-Org-Id': 'org_other',
  'X-CCC-Role': 'counselor',
};

const adminHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'admin.routes@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'admin',
};

const accessAdminHeaders = {
  'content-type': 'application/json',
  'Cf-Access-Authenticated-User-Email': 'access-admin.routes@example.invalid',
  'Cf-Access-Organization-Id': 'org_demo',
  'Cf-Access-Actor-Role': 'admin',
};
const unauthenticatedHeaders = {
  'content-type': 'application/json',
};


const t = setupD1();
const MASKED_TEXT = 'A001 [person] discussed grocery expenses.';
const TEST_PROVIDER_CONFIG = {
  registryVersion: AI_PROVIDER_REGISTRY_VERSION,
  providerId: CODEX_PROVIDER_ID,
  adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
  configVersion: 'route-test-v1',
  model: 'gpt-5-codex-test',
} satisfies AiProviderConfig;

interface RouteAiDraft {
  version: number;
  summaryText: string;
  questions: Array<{ title: string; reason: string }>;
  reviewDecision: 'approved' | 'rejected' | 'superseded' | null;
  evidence: Array<{ id: string; claimKey: string; quote: string }>;
}

interface SourceReceipt {
  sourceSnapshotId: string;
  sha256: string;
  maskingPipelineVersion: string;
  evidenceIds: string[];
}

function firstEvidence(request: AiProviderRequest): AiProviderRequest['evidence'][number] {
  const evidence = request.evidence[0];
  if (evidence === undefined) throw new Error('test provider request is missing evidence');
  return evidence;
}
function validProviderQuestions(request: AiProviderRequest): AiProviderOutput['questions'] {
  const evidence = { ...firstEvidence(request) };
  return [
    { title: '상황 일정에 변동이 있었나요?', reason: '지난 회차에서 일정 변동 가능성이 언급되었습니다.', evidence: [{ ...evidence }] },
    { title: '주거비 변화가 있었나요?', reason: '지난 회차에서 주거비 부담이 화제였습니다.', evidence: [{ ...evidence }] },
  ];
}

function validProviderOutput(request: AiProviderRequest, text = 'A001 discussed grocery expenses.'): AiProviderOutput {
  return {
    claims: [{
      claimKey: 'grocery-expenses',
      text,
      evidence: [{ ...firstEvidence(request) }],
    }],
    questions: validProviderQuestions(request),
    oneLiner: '생활비 지출 상황을 확인했다.',
  };
}

class FakeAiProviderAdapter implements AiProviderTestAdapter {
  readonly providerId: typeof CODEX_PROVIDER_ID = CODEX_PROVIDER_ID;
  readonly adapterVersion: typeof CODEX_PROVIDER_ADAPTER_VERSION = CODEX_PROVIDER_ADAPTER_VERSION;
  readonly testOnly = true as const;
  readonly config: AiProviderConfig;
  calls = 0;
  readonly invocations: AiProviderRequest[] = [];
  failure: unknown = null;
  output: (request: AiProviderRequest) => unknown = validProviderOutput;
  beforeReturn: (() => Promise<void>) | null = null;

  constructor(config: AiProviderConfig = TEST_PROVIDER_CONFIG) {
    this.config = config;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderOutput> {
    this.calls += 1;
    this.invocations.push(request);
    if (this.failure !== null) throw this.failure;
    if (this.beforeReturn !== null) await this.beforeReturn();
    return this.output(request) as AiProviderOutput;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceBody(maskedText = MASKED_TEXT, evidenceId = 'source-evidence-1') {
  const sha256 = await sha256Hex(maskedText);
  return {
    maskedText,
    sha256,
    maskingPipelineVersion: 'local-ner-v1',
    evidence: [{
      id: evidenceId,
      sourceRef: 'memo:source-1',
      sourceSha256: sha256,
      evidenceQuote: maskedText,
      sourceStart: 0,
      sourceEnd: Array.from(maskedText).length,
    }],
  };
}

type SourceRequestBody = Awaited<ReturnType<typeof sourceBody>>;


interface FixtureOptions {
  activateProvider?: boolean;
  configHash?: string;
  injectAdapter?: boolean;
  textAiEnabled?: string;
}

async function setupPhase1AiFixture(
  adapter = new FakeAiProviderAdapter(),
  options: FixtureOptions = {},
) {
  await t.reset();
  const env: ApiEnv = {
    ...t.env,
    TEXT_AI_PILOT_ENABLED: options.textAiEnabled ?? '1',
    ...(options.injectAdapter === false ? {} : { AI_PROVIDER_ADAPTER: adapter }),
  };
  const counselor = {
    userId: counselorHeaders['X-CCC-User-Id'],
    orgId: counselorHeaders['X-CCC-Org-Id'],
    role: 'counselor' as const,
  };
  const admin = {
    userId: adminHeaders['X-CCC-User-Id'],
    orgId: adminHeaders['X-CCC-Org-Id'],
    role: 'admin' as const,
  };
  const caseRecord = await createCase(t.env, counselor, {});
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '02000000-0000-4000-8000-000000000001',
    heldAt: '2026-07-14T09:00:00.000Z',
    channel: 'in_person',
    memo: 'MANUAL_MEMO_PHASE1',
    gasScores: [],
  });
  if (options.activateProvider !== false) {
    const providerConfig = await registerAiProviderConfiguration(t.env, admin, {
      adapterId: CODEX_PROVIDER_ID,
      adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
      configHash: options.configHash ?? await canonicalAiProviderConfigHash(adapter.config),
      approvalRefs: ['privacy-security-approval-1'],
    });
    await activateAiProviderConfiguration(t.env, admin, providerConfig.id);
  }
  return { adapter, admin, caseRecord, counselor, env, session };
}

async function recordPilotConsent(env: ApiEnv, caseId: string): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/cases/${caseId}/pilot-text-ai-consent`, {
    method: 'POST',
    headers: counselorHeaders,
    body: JSON.stringify({
      noticeVersion: 'pilot-notice-v1',
      noticeHash: 'c'.repeat(64),
      evidenceRef: 'pilot-evidence-1',
      evidenceHash: 'd'.repeat(64),
      effectiveAt: '2020-01-01T09:00:00.000Z',
    }),
  }), env);
}

async function recordSource(
  env: ApiEnv,
  sessionId: string,
  body?: Record<string, unknown>,
  headers: HeadersInit = serviceHeaders,
): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai/source`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? await sourceBody()),
  }), env);
}

async function recordSourceSnapshot(
  env: ApiEnv,
  sessionId: string,
  body?: SourceRequestBody,
  headers: HeadersInit = serviceHeaders,
): Promise<SourceReceipt> {
  const response = await recordSource(env, sessionId, body ?? await sourceBody(), headers);
  expect(response.status).toBe(201);
  return response.json() as Promise<SourceReceipt>;
}

async function generateDraft(
  env: ApiEnv,
  sessionId: string,
  sourceSnapshotId: string,
  headers: HeadersInit = serviceHeaders,
  body: Record<string, unknown> = { sourceSnapshotId },
): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }), env);
}

async function currentDraft(env: ApiEnv, sessionId: string, headers: HeadersInit = counselorHeaders): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai`, { headers }), env);
}

async function editDraft(
  env: ApiEnv,
  sessionId: string,
  version: number,
  evidenceId: string,
  headers: HeadersInit = counselorHeaders,
): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai/drafts/${version}/edit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedVersion: version, evidenceIds: [evidenceId] }),
  }), env);
}

async function reviewDraft(
  env: ApiEnv,
  sessionId: string,
  version: number,
  decision: 'approved' | 'rejected',
  headers: HeadersInit = counselorHeaders,
): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai/drafts/${version}/review`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expectedVersion: version, decision }),
  }), env);
}

async function draftCount(): Promise<number> {
  const row = await t.db.prepare('SELECT COUNT(*) AS count FROM ai_draft_versions').first<{ count: number }>();
  if (row === null) throw new Error('draft count row is missing');
  return Number(row.count);
}

async function sourceSnapshotCount(): Promise<number> {
  const row = await t.db.prepare('SELECT COUNT(*) AS count FROM ai_masked_source_snapshots').first<{ count: number }>();
  if (row === null) throw new Error('source snapshot count row is missing');
  return Number(row.count);
}

type Phase1MutableTable =
  | 'ai_masked_source_snapshots'
  | 'ai_masked_source_evidence_items'
  | 'ai_work_items'
  | 'ai_draft_versions'
  | 'ai_evidence_links'
  | 'ai_review_events';

interface Phase1MutableRowCounts {
  sourceSnapshots: number;
  sourceEvidenceItems: number;
  workItems: number;
  draftVersions: number;
  evidenceLinks: number;
  reviewEvents: number;
}

interface SessionAiState {
  aiStatus: string;
  aiSummary: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  updatedAt: string;
}

interface AuditRow {
  action: string;
  targetTable: string;
  detail: string | null;
}

async function phase1RowCount(table: Phase1MutableTable): Promise<number> {
  const row = await t.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  if (row === null) throw new Error(`row count is missing for ${table}`);
  return Number(row.count);
}

async function phase1MutableRowCounts(): Promise<Phase1MutableRowCounts> {
  const [
    sourceSnapshots,
    sourceEvidenceItems,
    workItems,
    draftVersions,
    evidenceLinks,
    reviewEvents,
  ] = await Promise.all([
    phase1RowCount('ai_masked_source_snapshots'),
    phase1RowCount('ai_masked_source_evidence_items'),
    phase1RowCount('ai_work_items'),
    phase1RowCount('ai_draft_versions'),
    phase1RowCount('ai_evidence_links'),
    phase1RowCount('ai_review_events'),
  ]);
  return {
    sourceSnapshots,
    sourceEvidenceItems,
    workItems,
    draftVersions,
    evidenceLinks,
    reviewEvents,
  };
}

async function sessionAiState(sessionId: string): Promise<SessionAiState> {
  const row = await t.db.prepare(
    'SELECT ai_status AS aiStatus, ai_summary AS aiSummary, approved_at AS approvedAt, approved_by AS approvedBy, updated_at AS updatedAt FROM sessions WHERE id = ?',
  ).bind(sessionId).first<SessionAiState>();
  if (row === null) throw new Error('session AI state is missing');
  return row;
}

async function auditRowsForCase(caseId: string): Promise<AuditRow[]> {
  const result = await t.db.prepare(
    'SELECT action, target_table AS targetTable, detail FROM audit_log WHERE case_id = ? ORDER BY id',
  ).bind(caseId).all<AuditRow>();
  return result.results;
}

function expectContentFree(value: unknown, forbidden: readonly string[]): void {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('expected a serializable content-free surface');
  for (const excluded of forbidden) {
    expect(serialized).not.toContain(excluded);
  }
}

async function expectNoDraft(env: ApiEnv, sessionId: string): Promise<void> {
  const response = await currentDraft(env, sessionId);
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: 'not_found' });
  expect(await draftCount()).toBe(0);
}

describe('API routes', () => {
  it('rejects case routes without a verified actor', async () => {
    await t.reset();
    const response = await worker.fetch(new Request('http://localhost/cases'), t.env);

    expect(response.status).toBe(401);
  });

  it('serves organization profile to every role and gates onboarding save to admins (CCC-32)', async () => {
    await t.reset();

    // 인증 없는 요청은 문 앞에서 거절 — 토큰 없는 새 경로를 만들지 않았다.
    const unauthenticated = await worker.fetch(new Request('http://localhost/organization/profile', {
      headers: unauthenticatedHeaders,
    }), t.env);
    expect(unauthenticated.status).toBe(401);

    // 온보딩 전에는 null — 화면이 하드코딩 라벨로 폴백한다.
    const before = await worker.fetch(new Request('http://localhost/organization/profile', {
      headers: counselorHeaders,
    }), t.env);
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toEqual({
      orgId: 'org_demo', orgName: null, programDisplayName: null,
    });

    // 실무자는 저장할 수 없다.
    const forbidden = await worker.fetch(new Request('http://localhost/organization/onboarding', {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ orgName: '연대은행', programDisplayName: '금융지원 사업' }),
    }), t.env);
    expect(forbidden.status).toBe(403);

    // 이름 누락은 400.
    const invalid = await worker.fetch(new Request('http://localhost/organization/onboarding', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ orgName: '연대은행' }),
    }), t.env);
    expect(invalid.status).toBe(400);

    const saved = await worker.fetch(new Request('http://localhost/organization/onboarding', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ orgName: '연대은행', programDisplayName: '금융지원 사업' }),
    }), t.env);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({
      orgId: 'org_demo', orgName: '연대은행', programDisplayName: '금융지원 사업',
    });

    // 저장한 이름이 실무자 조회에도 되비친다 — 사이드바는 모든 역할의 셸이다.
    const after = await worker.fetch(new Request('http://localhost/organization/profile', {
      headers: counselorHeaders,
    }), t.env);
    await expect(after.json()).resolves.toMatchObject({
      orgName: '연대은행', programDisplayName: '금융지원 사업',
    });

    // 다른 기관에는 보이지 않는다 — 프로필은 자기 기관 행만 읽는다.
    const otherOrg = await worker.fetch(new Request('http://localhost/organization/profile', {
      headers: otherOrgCounselorHeaders,
    }), t.env);
    await expect(otherOrg.json()).resolves.toEqual({
      orgId: 'org_other', orgName: null, programDisplayName: null,
    });
  });

  it('maps local headers to a counselor and routes through the case gateway', async () => {
    await t.reset();
    const env = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' };
    const createResponse = await worker.fetch(new Request('http://localhost/cases', {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ programType: 'financial_support_v1' }),
    }), env);

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { id: string };
    const listResponse = await worker.fetch(new Request('http://localhost/cases', { headers: counselorHeaders }), env);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([expect.objectContaining({ id: created.id })]);
  });
  it('requires an idempotency key and canonical record semantics on the legacy session write route', async () => {
    await t.reset();
    const caseResponse = await worker.fetch(new Request('http://localhost/cases', {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ programType: 'financial_support_v1' }),
    }), t.env);
    expect(caseResponse.status).toBe(201);
    const caseRecord = await caseResponse.json() as { id: string };
    const record = {
      submissionId: '11111111-1111-4111-8111-111111111111',
      heldAt: '2026-07-15T09:30:00.000Z',
      channel: 'in_person',
      memo: 'LEGACY_ROUTE_CANONICAL_RECORD',
      gasScores: [],
      actions: [],
      flags: [],
    };

    const missingSubmissionId = await worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/sessions`, {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ ...record, submissionId: undefined }),
    }), t.env);
    expect(missingSubmissionId.status).toBe(400);
    await expect(missingSubmissionId.json()).resolves.toEqual({ error: 'invalid_request' });

    const createdResponse = await worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/sessions`, {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify(record),
    }), t.env);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as {
      id: string;
      heldAt: string;
      memo: string;
      replayed: boolean;
    };
    expect(created).toEqual(expect.objectContaining({
      id: expect.any(String),
      heldAt: record.heldAt,
      memo: record.memo,
      replayed: false,
    }));

    const replayResponse = await worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/sessions`, {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify(record),
    }), t.env);
    expect(replayResponse.status).toBe(200);
    await expect(replayResponse.json()).resolves.toEqual({
      ...created,
      replayed: true,
    });
  });

  it('creates, lists, and closes goals with a D62 reason pick through the canonical routes', async () => {
    await t.reset();
    const env = t.env;
    const caseResponse = await worker.fetch(new Request('http://localhost/cases', {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ programType: 'financial_support_v1' }),
    }), env);
    const caseRecord = await caseResponse.json() as { id: string };

    const createResponse = await worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/goals`, {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ title: 'Maintain a three-month living-cost plan' }),
    }), env);
    expect(createResponse.status).toBe(201);
    const goal = await createResponse.json() as { id: string; status: string };

    const listResponse = await worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/goals`, {
      headers: counselorHeaders,
    }), env);
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual([
      expect.objectContaining({ id: goal.id, status: 'active' }),
    ]);

    // D62 §4: 문구 수정 라우트(CCC-68) — 수정 금지(D12) 폐지. 이력 보존은 게이트웨이 몫.
    const renameResponse = await worker.fetch(new Request(`http://localhost/goals/${goal.id}/title`, {
      method: 'PUT',
      headers: counselorHeaders,
      body: JSON.stringify({ title: 'Keep a three-month living-cost plan current' }),
    }), env);
    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toEqual(expect.objectContaining({
      id: goal.id,
      title: 'Keep a three-month living-cost plan current',
      status: 'active',
    }));

    // D62 §5: 사유는 선택값 3종만, 자유 텍스트는 거부한다. 구 종료+신설 승계는 없다.
    const freeTextClose = await worker.fetch(new Request(`http://localhost/goals/${goal.id}/close`, {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ reason: 'The measurable target changed' }),
    }), env);
    expect(freeTextClose.status).toBe(400);

    const closeResponse = await worker.fetch(new Request(`http://localhost/goals/${goal.id}/close`, {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify({ reason: 'reset' }),
    }), env);
    expect(closeResponse.status).toBe(200);
    await expect(closeResponse.json()).resolves.toEqual(expect.objectContaining({
      id: goal.id,
      status: 'closed',
      closedReason: 'reset',
      replacedByGoalId: null,
    }));

    // 닫힌 목표는 기록이라 문구를 고칠 수 없다(D62 §4 — 활성만 수정).
    const renameClosed = await worker.fetch(new Request(`http://localhost/goals/${goal.id}/title`, {
      method: 'PUT',
      headers: counselorHeaders,
      body: JSON.stringify({ title: 'Should be rejected' }),
    }), env);
    expect(renameClosed.status).toBe(400);
  });

  it('maps local admin headers to an admin but fails closed on unsigned Cloudflare Access headers', async () => {
    await t.reset();
    const localEnv = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' };
    const localAdminResponse = await worker.fetch(new Request('http://localhost/cases', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ programType: 'financial_support_v1' }),
    }), localEnv);
    expect(localAdminResponse.status).toBe(201);

    const accessAdminResponse = await worker.fetch(new Request('http://localhost/cases', {
      method: 'POST',
      headers: accessAdminHeaders,
      body: JSON.stringify({ programType: 'financial_support_v1' }),
    }), t.env);
    expect(accessAdminResponse.status).toBe(401);
    await expect(accessAdminResponse.json()).resolves.toEqual({ error: 'actor_authentication_required' });
  });

  it('keeps R2 keys out of session responses and limits pipeline work to the service actor', async () => {
    await t.reset();
    const env = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true', TEXT_AI_PILOT_ENABLED: '1' };
    const counselor = {
      userId: counselorHeaders['X-CCC-User-Id'],
      orgId: counselorHeaders['X-CCC-Org-Id'],
      role: 'counselor' as const,
    };
    const caseRecord = await createCase(t.env, counselor, { consentRecordingAt: '2026-01-01T00:00:00.000Z' });
    const session = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: '02000000-0000-4000-8000-000000000002',
      heldAt: '2026-01-02T10:00:00.000Z',
      channel: 'in_person',
      memo: 'MANUAL_MEMO_DEMO',
      gasScores: [],
    });
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    await registerRecording(t.env, counselor, session.id, 'audio/demo/route-session');

    const sessionResponse = await worker.fetch(new Request(`http://localhost/sessions/${session.id}`, { headers: counselorHeaders }), env);
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).not.toHaveProperty('audioR2Key');

    const sessionsResponse = await worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/sessions`, { headers: counselorHeaders }), env);
    expect(sessionsResponse.status).toBe(200);
    const sessions = await sessionsResponse.json() as Array<Record<string, unknown>>;
    expect(sessions[0]).not.toHaveProperty('audioR2Key');

    const jobsResponse = await worker.fetch(new Request('http://localhost/pipeline/jobs', { headers: serviceHeaders }), env);
    expect(jobsResponse.status).toBe(200);
    await expect(jobsResponse.json()).resolves.toEqual({ jobs: [expect.objectContaining({ id: session.id })] });

    const audioResponse = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${session.id}/audio`, { headers: serviceHeaders }), env);
    expect(audioResponse.status).toBe(404);
    await expect(audioResponse.json()).resolves.toEqual({ error: 'audio_object_missing', jobId: session.id });

  });

  it('records a service-only immutable source snapshot and generates only from its reloaded evidence', async () => {
    const { adapter, caseRecord, env, session } = await setupPhase1AiFixture();
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);

    const sourceResponse = await recordSource(env, session.id);
    expect(sourceResponse.status).toBe(201);
    const receipt = await sourceResponse.json() as SourceReceipt;
    expect(receipt).toEqual({
      sourceSnapshotId: expect.any(String),
      sha256: await sha256Hex(MASKED_TEXT),
      maskingPipelineVersion: 'local-ner-v1',
      evidenceIds: ['source-evidence-1'],
    });
    const sourceResponseText = JSON.stringify(receipt);
    expect(sourceResponseText).not.toContain(MASKED_TEXT);
    expect(sourceResponseText).not.toContain('memo:source-1');

    const generatedResponse = await generateDraft(env, session.id, receipt.sourceSnapshotId);
    expect(generatedResponse.status).toBe(201);
    const draft = await generatedResponse.json() as RouteAiDraft;
    expect(draft).toEqual(expect.objectContaining({
      version: 1,
      summaryText: 'A001 discussed grocery expenses.',
      questions: [
        { title: '상황 일정에 변동이 있었나요?', reason: '지난 회차에서 일정 변동 가능성이 언급되었습니다.' },
        { title: '주거비 변화가 있었나요?', reason: '지난 회차에서 주거비 부담이 화제였습니다.' },
      ],
      reviewDecision: null,
      evidence: expect.arrayContaining([
        expect.objectContaining({ claimKey: 'grocery-expenses', quote: MASKED_TEXT }),
        expect.objectContaining({ claimKey: 'question_1', quote: MASKED_TEXT }),
        expect.objectContaining({ claimKey: 'question_2', quote: MASKED_TEXT }),
      ]),
    }));
    expect(adapter.calls).toBe(1);
    expect(adapter.invocations).toEqual([{
      maskedText: MASKED_TEXT,
      evidence: [{
        evidenceId: 'source-evidence-1',
        sourceRef: 'memo:source-1',
        sourceSha256: receipt.sha256,
        evidenceQuote: MASKED_TEXT,
        sourceStart: 0,
        sourceEnd: Array.from(MASKED_TEXT).length,
      }],
    }]);
    expect(JSON.stringify(adapter.invocations[0])).not.toContain('MANUAL_MEMO_PHASE1');
  });

  it('accepts legitimate source mentions of prohibited concepts but rejects prohibited generated output without a draft', async () => {
    const safeAdapter = new FakeAiProviderAdapter();
    const { caseRecord, env, session } = await setupPhase1AiFixture(safeAdapter);
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(env, session.id, await sourceBody('A001 mentioned GAS score: 2 during the session.'));
    expect((await generateDraft(env, session.id, source.sourceSnapshotId)).status).toBe(201);
    expect(safeAdapter.calls).toBe(1);

    const prohibitedAdapter = new FakeAiProviderAdapter();
    prohibitedAdapter.output = (request) => validProviderOutput(request, 'GAS score: 2');
    const prohibitedFixture = await setupPhase1AiFixture(prohibitedAdapter);
    expect((await recordPilotConsent(prohibitedFixture.env, prohibitedFixture.caseRecord.id)).status).toBe(201);
    const prohibitedSource = await recordSourceSnapshot(prohibitedFixture.env, prohibitedFixture.session.id);
    const response = await generateDraft(prohibitedFixture.env, prohibitedFixture.session.id, prohibitedSource.sourceSnapshotId);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'ai_prohibited_output' });
    expect(prohibitedAdapter.calls).toBe(1);
    await expectNoDraft(prohibitedFixture.env, prohibitedFixture.session.id);
  });

  it('rejects future and noncanonical pilot consent effective times without recording evidence', async () => {
    const fixture = await setupPhase1AiFixture();
    const invalidEffectiveTimes = [
      '2020-01-01T09:00:00+09:00',
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ];

    for (const effectiveAt of invalidEffectiveTimes) {
      const response = await worker.fetch(new Request(
        `http://localhost/cases/${fixture.caseRecord.id}/pilot-text-ai-consent`,
        {
          method: 'POST',
          headers: counselorHeaders,
          body: JSON.stringify({
            noticeVersion: 'pilot-notice-v1',
            noticeHash: 'c'.repeat(64),
            evidenceRef: 'pilot-evidence-invalid-time',
            evidenceHash: 'd'.repeat(64),
            effectiveAt,
          }),
        },
      ), fixture.env);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    }

    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count
       FROM pilot_text_ai_consent_evidence AS evidence
       JOIN support_cases AS support_case ON support_case.id = evidence.support_case_id
       WHERE support_case.legacy_case_id = ?`,
    ).bind(fixture.caseRecord.id).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });
  it('has zero provider calls for missing, disabled, and cross-case pilot consent', async () => {
    const missing = await setupPhase1AiFixture();
    const missingResponse = await generateDraft(missing.env, missing.session.id, 'missing-source-snapshot');
    expect(missingResponse.status).toBe(409);
    await expect(missingResponse.json()).resolves.toEqual({ error: 'pilot_text_ai_consent_required' });
    expect(missing.adapter.calls).toBe(0);
    await expectNoDraft(missing.env, missing.session.id);

    const disabled = await setupPhase1AiFixture(new FakeAiProviderAdapter(), { textAiEnabled: '0' });
    const disabledResponse = await generateDraft(disabled.env, disabled.session.id, 'disabled-source-snapshot');
    expect(disabledResponse.status).toBe(409);
    await expect(disabledResponse.json()).resolves.toEqual({ error: 'text_ai_pilot_disabled' });
    expect(disabled.adapter.calls).toBe(0);
    await expectNoDraft(disabled.env, disabled.session.id);

    const isolated = await setupPhase1AiFixture();
    expect((await recordPilotConsent(isolated.env, isolated.caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(isolated.env, isolated.session.id);
    const secondCase = await createCase(t.env, isolated.counselor, {});
    const secondSession = await createManualSession(t.env, isolated.counselor, secondCase.id, {
      submissionId: '02000000-0000-4000-8000-000000000003',
      heldAt: '2026-07-14T10:00:00.000Z',
      channel: 'in_person',
      memo: 'SECOND_CASE_MANUAL_MEMO',
      gasScores: [],
    });
    const isolatedResponse = await generateDraft(isolated.env, secondSession.id, source.sourceSnapshotId);
    expect(isolatedResponse.status).toBe(409);
    await expect(isolatedResponse.json()).resolves.toEqual({ error: 'pilot_text_ai_consent_required' });
    expect(isolated.adapter.calls).toBe(0);
    await expectNoDraft(isolated.env, secondSession.id);
  });

  it('isolates source snapshots to their recorded case and session before outbound work', async () => {
    const { adapter, caseRecord, counselor, env, session } = await setupPhase1AiFixture();
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(env, session.id);
    const secondSession = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: '02000000-0000-4000-8000-000000000004',
      heldAt: '2026-07-14T10:00:00.000Z',
      channel: 'in_person',
      memo: 'SECOND_SESSION_MANUAL_MEMO',
      gasScores: [],
    });
    const secondCase = await createCase(t.env, counselor, {});
    expect((await recordPilotConsent(env, secondCase.id)).status).toBe(201);
    const crossCaseSession = await createManualSession(t.env, counselor, secondCase.id, {
      submissionId: '02000000-0000-4000-8000-000000000005',
      heldAt: '2026-07-14T11:00:00.000Z',
      channel: 'in_person',
      memo: 'CROSS_CASE_MANUAL_MEMO',
      gasScores: [],
    });

    for (const isolatedSession of [secondSession, crossCaseSession]) {
      const response = await generateDraft(env, isolatedSession.id, source.sourceSnapshotId);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
      await expectNoDraft(env, isolatedSession.id);
    }
    expect(adapter.calls).toBe(0);
  });

  it('fails closed for unavailable, missing, and hash-mismatched provider runtime configuration', async () => {
    const unavailable = await setupPhase1AiFixture(new FakeAiProviderAdapter(), { activateProvider: false });
    expect((await recordPilotConsent(unavailable.env, unavailable.caseRecord.id)).status).toBe(201);
    const unavailableSource = await recordSourceSnapshot(unavailable.env, unavailable.session.id);
    const unavailableResponse = await generateDraft(unavailable.env, unavailable.session.id, unavailableSource.sourceSnapshotId);
    expect(unavailableResponse.status).toBe(409);
    await expect(unavailableResponse.json()).resolves.toEqual({ error: 'ai_provider_not_configured' });
    expect(unavailable.adapter.calls).toBe(0);
    await expectNoDraft(unavailable.env, unavailable.session.id);

    const noRuntimeConfigAdapter = new FakeAiProviderAdapter();
    const noRuntimeConfig = await setupPhase1AiFixture(noRuntimeConfigAdapter, { injectAdapter: false });
    expect((await recordPilotConsent(noRuntimeConfig.env, noRuntimeConfig.caseRecord.id)).status).toBe(201);
    const noRuntimeConfigSource = await recordSourceSnapshot(noRuntimeConfig.env, noRuntimeConfig.session.id);
    const noRuntimeConfigResponse = await generateDraft(
      noRuntimeConfig.env,
      noRuntimeConfig.session.id,
      noRuntimeConfigSource.sourceSnapshotId,
    );
    expect(noRuntimeConfigResponse.status).toBe(503);
    await expect(noRuntimeConfigResponse.json()).resolves.toEqual({ error: 'ai_provider_unavailable' });
    expect(noRuntimeConfigAdapter.calls).toBe(0);
    await expectNoDraft(noRuntimeConfig.env, noRuntimeConfig.session.id);

    const mismatchedConfig: AiProviderConfig = { ...TEST_PROVIDER_CONFIG, model: 'gpt-5-codex-other' };
    const mismatchedAdapter = new FakeAiProviderAdapter(mismatchedConfig);
    const mismatched = await setupPhase1AiFixture(mismatchedAdapter, {
      configHash: await canonicalAiProviderConfigHash(TEST_PROVIDER_CONFIG),
    });
    expect((await recordPilotConsent(mismatched.env, mismatched.caseRecord.id)).status).toBe(201);
    const mismatchedSource = await recordSourceSnapshot(mismatched.env, mismatched.session.id);
    const mismatchedResponse = await generateDraft(mismatched.env, mismatched.session.id, mismatchedSource.sourceSnapshotId);
    expect(mismatchedResponse.status).toBe(503);
    await expect(mismatchedResponse.json()).resolves.toEqual({ error: 'ai_provider_unavailable' });
    expect(mismatchedAdapter.calls).toBe(0);
    await expectNoDraft(mismatched.env, mismatched.session.id);
  });

  it('rejects provider output when activation changes during the outbound call', async () => {
    const adapter = new FakeAiProviderAdapter();
    const fixture = await setupPhase1AiFixture(adapter);
    expect((await recordPilotConsent(fixture.env, fixture.caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(fixture.env, fixture.session.id);
    const replacement = await registerAiProviderConfiguration(t.env, fixture.admin, {
      adapterId: CODEX_PROVIDER_ID,
      adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
      configHash: 'f'.repeat(64),
      approvalRefs: ['privacy-security-approval-2'],
    });
    const baselineRows = await phase1MutableRowCounts();
    const baselineSession = await sessionAiState(fixture.session.id);
    adapter.beforeReturn = async () => {
      await activateAiProviderConfiguration(t.env, fixture.admin, replacement.id);
    };

    const response = await generateDraft(fixture.env, fixture.session.id, source.sourceSnapshotId);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'stale_draft_version' });
    expect(adapter.calls).toBe(1);
    await expectNoDraft(fixture.env, fixture.session.id);
    expect(await phase1MutableRowCounts()).toEqual(baselineRows);
    expect(await sessionAiState(fixture.session.id)).toEqual(baselineSession);
  });

  it('rejects provider output when consent evidence changes during the outbound call', async () => {
    const adapter = new FakeAiProviderAdapter();
    const fixture = await setupPhase1AiFixture(adapter);
    expect((await recordPilotConsent(fixture.env, fixture.caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(fixture.env, fixture.session.id);
    const baselineRows = await phase1MutableRowCounts();
    const baselineSession = await sessionAiState(fixture.session.id);
    adapter.beforeReturn = async () => {
      await t.db.prepare(
        `INSERT INTO pilot_text_ai_consent_evidence (
          id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
          evidence_sha256, captured_by, effective_at, created_at
        )
        SELECT ?, ?, session.support_case_id, ?, ?, ?, ?, ?, ?, ?
        FROM sessions AS session
        WHERE session.id = ? AND session.org_id = ?`,
      ).bind(
        'pilot-evidence-race',
        fixture.counselor.orgId,
        'pilot-notice-v2',
        'e'.repeat(64),
        'pilot-evidence-2',
        'f'.repeat(64),
        fixture.counselor.userId,
        '2020-01-02T09:00:00.000Z',
        '2020-01-02T09:00:00.000Z',
        fixture.session.id,
        fixture.counselor.orgId,
      ).run();
    };

    const response = await generateDraft(fixture.env, fixture.session.id, source.sourceSnapshotId);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'stale_draft_version' });
    expect(adapter.calls).toBe(1);
    await expectNoDraft(fixture.env, fixture.session.id);
    expect(await phase1MutableRowCounts()).toEqual(baselineRows);
    expect(await sessionAiState(fixture.session.id)).toEqual(baselineSession);
  });

  it('rejects malformed source integrity before provider work and row insertion', async () => {
    const malformedSources: Array<{
      name: string;
      makeBody: (source: SourceRequestBody) => Record<string, unknown>;
    }> = [
      {
        name: 'snapshot hash mismatch',
        makeBody: (source) => ({ ...source, sha256: '0'.repeat(64) }),
      },
      {
        name: 'evidence hash mismatch',
        makeBody: (source) => ({
          ...source,
          evidence: [{ ...source.evidence[0]!, sourceSha256: 'f'.repeat(64) }],
        }),
      },
      {
        name: 'evidence quote mismatch',
        makeBody: (source) => ({
          ...source,
          evidence: [{ ...source.evidence[0]!, evidenceQuote: 'different masked quote' }],
        }),
      },
      {
        name: 'negative evidence span',
        makeBody: (source) => ({
          ...source,
          evidence: [{ ...source.evidence[0]!, sourceStart: -1 }],
        }),
      },
      {
        name: 'out-of-bounds evidence span',
        makeBody: (source) => ({
          ...source,
          evidence: [{
            ...source.evidence[0]!,
            sourceStart: source.evidence[0]!.sourceEnd + 1,
            sourceEnd: source.evidence[0]!.sourceEnd + 2,
          }],
        }),
      },
      {
        name: 'missing masking pipeline version',
        makeBody: ({ maskingPipelineVersion: _maskingPipelineVersion, ...source }) => source,
      },
      {
        name: 'unsupported masking pipeline field',
        makeBody: (source) => ({ ...source, maskingPipeline: 'local-ner-v1' }),
      },
      {
        name: 'unsupported masking pipeline version',
        makeBody: (source) => ({ ...source, maskingPipelineVersion: 'local/ner-v1' }),
      },
    ];

    for (const malformed of malformedSources) {
      const { adapter, caseRecord, env, session } = await setupPhase1AiFixture();
      expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);

      const response = await recordSource(env, session.id, malformed.makeBody(await sourceBody()));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
      expect(adapter.calls).toBe(0);
      expect(await phase1MutableRowCounts()).toEqual({
        sourceSnapshots: 0,
        sourceEvidenceItems: 0,
        workItems: 0,
        draftVersions: 0,
        evidenceLinks: 0,
        reviewEvents: 0,
      });
    }
  });
  it('rejects duplicate snapshot spans and unsupported browser generation fields without mutation', async () => {
    const { adapter, caseRecord, env, session } = await setupPhase1AiFixture();
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const duplicateSpanBody = await sourceBody();
    duplicateSpanBody.evidence.push({ ...duplicateSpanBody.evidence[0]!, id: 'source-evidence-2' });
    const duplicateSpanResponse = await recordSource(env, session.id, duplicateSpanBody);
    expect(duplicateSpanResponse.status).toBe(400);
    await expect(duplicateSpanResponse.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(await sourceSnapshotCount()).toBe(0);
    expect(adapter.calls).toBe(0);

    const generateResponse = await generateDraft(
      env,
      session.id,
      'opaque-source-snapshot',
      serviceHeaders,
      { sourceSnapshotId: 'opaque-source-snapshot', maskedText: MASKED_TEXT },
    );
    expect(generateResponse.status).toBe(400);
    await expect(generateResponse.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(adapter.calls).toBe(0);
    await expectNoDraft(env, session.id);
  });

  it('rejects duplicate, unknown, mismatched, and extra provider evidence references without drafts', async () => {
    const invalidOutputs: Array<(request: AiProviderRequest) => unknown> = [
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'duplicate-reference',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence }, { ...evidence }],
          }],
        };
      },
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'unknown-reference',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence, evidenceId: 'unknown-evidence-id' }],
          }],
        };
      },
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'mismatched-reference',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence, sourceEnd: evidence.sourceEnd + 1 }],
          }],
        };
      },
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'mismatched-source-ref',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence, sourceRef: 'memo:other-source' }],
          }],
        };
      },
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'mismatched-source-hash',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence, sourceSha256: '0'.repeat(64) }],
          }],
        };
      },
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'mismatched-quote',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence, evidenceQuote: `${evidence.evidenceQuote} changed` }],
          }],
        };
      },
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'mismatched-start',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence, sourceStart: evidence.sourceStart + 1 }],
          }],
        };
      },
      (request) => {
        const evidence = firstEvidence(request);
        return {
          claims: [{
            claimKey: 'extra-reference',
            text: 'A001 discussed grocery expenses.',
            evidence: [{ ...evidence, unsupported: 'field' } as unknown as AiProviderRequest['evidence'][number]],
          }],
        };
      },
    ];

    for (const output of invalidOutputs) {
      const adapter = new FakeAiProviderAdapter();
      adapter.output = (request) => ({
        questions: validProviderQuestions(request),
        ...(output(request) as Record<string, unknown>),
      });
      const { caseRecord, env, session } = await setupPhase1AiFixture(adapter);
      expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
      const source = await recordSourceSnapshot(env, session.id);
      const response = await generateDraft(env, session.id, source.sourceSnapshotId);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: 'ai_prohibited_output' });
      expect(adapter.calls).toBe(1);
      await expectNoDraft(env, session.id);
    }
  });

  it('rejects ungrounded, duplicate, unsafe, and malformed briefing questions without drafts', async () => {
    const invalidOutputs: Array<(request: AiProviderRequest) => unknown> = [
      (request) => ({ ...validProviderOutput(request), questions: [] }),
      (request) => ({ ...validProviderOutput(request), questions: validProviderQuestions(request).slice(0, 1) }),
      (request) => ({
        ...validProviderOutput(request),
        questions: [...validProviderQuestions(request), ...validProviderQuestions(request)],
      }),
      (request) => {
        const question = validProviderQuestions(request)[0]!;
        return { ...validProviderOutput(request), questions: [question, { ...question }] };
      },
      (request) => {
        const evidence = { ...firstEvidence(request) };
        return {
          ...validProviderOutput(request),
          questions: [
            ...validProviderQuestions(request),
            { title: '공과금 납부 계획을 확인할까요?', reason: '납부 계획 확인이 필요합니다.', evidence: [{ ...evidence }] },
            { title: '다음 지원 일정을 확인할까요?', reason: '지원 일정 확인이 필요합니다.', evidence: [{ ...evidence }] },
          ],
        };
      },
      (request) => ({
        ...validProviderOutput(request),
        questions: validProviderQuestions(request).map((question) => ({ ...question, evidence: [] })),
      }),
      (request) => ({
        ...validProviderOutput(request),
        questions: [
          ...validProviderQuestions(request).slice(0, 1),
          { title: '연락처: 010-1234-5678을 확인할까요?', reason: '연락 수단 확인이 필요합니다.', evidence: [{ ...firstEvidence(request) }] },
        ],
      }),
      (request) => ({
        ...validProviderOutput(request),
        questions: validProviderQuestions(request).map((question) => ({ ...question, unsupported: true })),
      }),
      (request) => ({
        ...validProviderOutput(request),
        claims: validProviderOutput(request).claims.map((claim) => ({ ...claim, claimKey: 'question_9' })),
      }),
      (request) => ({
        ...validProviderOutput(request),
        claims: validProviderOutput(request).claims.map((claim) => ({ ...claim, claimKey: 'question_0' })),
      }),
      (request) => ({
        ...validProviderOutput(request),
        claims: validProviderOutput(request).claims.map((claim) => ({ ...claim, claimKey: 'question_1suffix' })),
      }),
    ];

    for (const output of invalidOutputs) {
      const adapter = new FakeAiProviderAdapter();
      adapter.output = output;
      const { caseRecord, env, session } = await setupPhase1AiFixture(adapter);
      expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
      const source = await recordSourceSnapshot(env, session.id);
      const response = await generateDraft(env, session.id, source.sourceSnapshotId);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: 'ai_prohibited_output' });
      await expectNoDraft(env, session.id);
    }
  });
  it('accepts exactly three unique grounded briefing questions', async () => {
    const adapter = new FakeAiProviderAdapter();
    adapter.output = (request) => ({
      ...validProviderOutput(request),
      questions: [
        ...validProviderQuestions(request),
        { title: '공과금 납부 계획을 확인할까요?', reason: '납부 계획 확인이 필요합니다.', evidence: [{ ...firstEvidence(request) }] },
      ],
    });
    const { caseRecord, env, session } = await setupPhase1AiFixture(adapter);
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(env, session.id);

    const response = await generateDraft(env, session.id, source.sourceSnapshotId);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      questions: [
        { title: '상황 일정에 변동이 있었나요?', reason: '지난 회차에서 일정 변동 가능성이 언급되었습니다.' },
        { title: '주거비 변화가 있었나요?', reason: '지난 회차에서 주거비 부담이 화제였습니다.' },
        { title: '공과금 납부 계획을 확인할까요?', reason: '납부 계획 확인이 필요합니다.' },
      ],
    }));
  });
  it('rejects empty claims and evidence-free provider output before draft insertion', async () => {
    const invalidOutputs: Array<{
      name: string;
      output: (request: AiProviderRequest) => unknown;
    }> = [
      {
        name: 'empty claims',
        output: () => ({ claims: [] }),
      },
      {
        name: 'claim without evidence',
        output: () => ({
          claims: [{
            claimKey: 'ungrounded-claim',
            text: 'A001 discussed grocery expenses.',
            evidence: [],
          }],
        }),
      },
    ];

    for (const invalid of invalidOutputs) {
      const adapter = new FakeAiProviderAdapter();
      adapter.output = (request) => ({
        questions: validProviderQuestions(request),
        ...(invalid.output(request) as Record<string, unknown>),
      });
      const { caseRecord, env, session } = await setupPhase1AiFixture(adapter);
      expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
      const source = await recordSourceSnapshot(env, session.id);
      const before = await phase1MutableRowCounts();
      expect(before).toEqual({
        sourceSnapshots: 1,
        sourceEvidenceItems: 1,
        workItems: 0,
        draftVersions: 0,
        evidenceLinks: 0,
        reviewEvents: 0,
      });

      const response = await generateDraft(env, session.id, source.sourceSnapshotId);

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: 'ai_prohibited_output' });
      expect(adapter.calls).toBe(1);
      expect(await phase1MutableRowCounts()).toEqual(before);
      await expectNoDraft(env, session.id);
    }
  });
  it('keeps unexpected adapter failures content-free with a manual official fallback', async () => {
    const providerFailure = `provider failure: ${MASKED_TEXT}`;
    const adapter = new FakeAiProviderAdapter();
    adapter.failure = new Error(providerFailure);
    const { caseRecord, env, session } = await setupPhase1AiFixture(adapter);
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(env, session.id);
    const before = await phase1MutableRowCounts();

    const response = await generateDraft(env, session.id, source.sourceSnapshotId);

    expect(response.status).toBe(500);
    const payload = await response.json() as Record<string, unknown>;
    expect(payload).toEqual({ error: 'internal_error' });
    expect(adapter.calls).toBe(1);
    expect(await phase1MutableRowCounts()).toEqual(before);
    await expectNoDraft(env, session.id);

    const [briefingResponse, sessionsResponse, sessionResponse] = await Promise.all([
      worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/briefing`, { headers: counselorHeaders }), env),
      worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/sessions`, { headers: counselorHeaders }), env),
      worker.fetch(new Request(`http://localhost/sessions/${session.id}`, { headers: counselorHeaders }), env),
    ]);
    expect(briefingResponse.status).toBe(200);
    expect(sessionsResponse.status).toBe(200);
    expect(sessionResponse.status).toBe(200);
    const briefing = await briefingResponse.json() as {
      lastSessionSummary: { source: 'ai' | 'memo'; text: string; pendingApprovalCount: number } | null;
    };
    const sessions = await sessionsResponse.json() as Array<Record<string, unknown>>;
    const sessionPayload = await sessionResponse.json() as Record<string, unknown>;
    expect(briefing.lastSessionSummary).toEqual({
      source: 'memo',
      text: 'MANUAL_MEMO_PHASE1',
      pendingApprovalCount: 0,
    });
    expect(sessions).toEqual([expect.objectContaining({
      id: session.id,
      memo: 'MANUAL_MEMO_PHASE1',
      aiSummary: null,
      approvedAt: null,
      approvedBy: null,
    })]);
    expect(sessionPayload).toEqual(expect.objectContaining({
      memo: 'MANUAL_MEMO_PHASE1',
      aiSummary: null,
      approvedAt: null,
      approvedBy: null,
    }));

    const auditRows = await auditRowsForCase(caseRecord.id);
    expect(auditRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'read', targetTable: 'ai_masked_source_snapshots' }),
      expect.objectContaining({ action: 'read', targetTable: 'ai_provider_configs' }),
    ]));
    expectContentFree(
      { payload, auditRows, briefing, sessions, sessionPayload },
      [providerFailure, MASKED_TEXT],
    );
  });

  it('enforces service-only generation and assigned-counselor-only draft access without mutation', async () => {
    const { adapter, caseRecord, env, session } = await setupPhase1AiFixture();
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(env, session.id);
    const generatedResponse = await generateDraft(env, session.id, source.sourceSnapshotId);
    expect(generatedResponse.status).toBe(201);
    const draft = await generatedResponse.json() as RouteAiDraft;
    expect(draft.version).toBe(1);

    const unauthenticated = await worker.fetch(new Request(`http://localhost/sessions/${session.id}/ai`), env);
    expect(unauthenticated.status).toBe(401);

    const sourceAsCounselor = await recordSource(env, session.id, await sourceBody(), counselorHeaders);
    expect(sourceAsCounselor.status).toBe(403);
    const generateAsCounselor = await generateDraft(env, session.id, source.sourceSnapshotId, counselorHeaders);
    expect(generateAsCounselor.status).toBe(403);
    const generateOtherOrg = await generateDraft(env, session.id, source.sourceSnapshotId, otherOrgServiceHeaders);
    expect(generateOtherOrg.status).toBe(403);
    expect(adapter.calls).toBe(1);

    for (const headers of [adminHeaders, serviceHeaders, unassignedCounselorHeaders, otherOrgCounselorHeaders]) {
      const response = await currentDraft(env, session.id, headers);
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
    }

    const editAsUnassigned = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${draft.version}/edit`,
      {
        method: 'POST',
        headers: unassignedCounselorHeaders,
        body: JSON.stringify({ expectedVersion: draft.version, evidenceIds: [draft.evidence[0]!.id] }),
      },
    ), env);
    expect(editAsUnassigned.status).toBe(403);

    const reviewAsAdmin = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${draft.version}/review`,
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ expectedVersion: draft.version, decision: 'approved' }),
      },
    ), env);
    expect(reviewAsAdmin.status).toBe(403);

    const current = await currentDraft(env, session.id);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual(expect.objectContaining({ version: 1, reviewDecision: null }));
  });

  it('table-denies inapplicable actors across source, generate, read, edit, and review without mutation', async () => {
    const { adapter, caseRecord, env, session } = await setupPhase1AiFixture();
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(env, session.id);
    const generatedResponse = await generateDraft(env, session.id, source.sourceSnapshotId);
    expect(generatedResponse.status).toBe(201);
    const draft = await generatedResponse.json() as RouteAiDraft;
    const evidenceId = draft.evidence[0]?.id;
    if (evidenceId === undefined) throw new Error('generated draft evidence is missing');

    const baselineRows = await phase1MutableRowCounts();
    expect(baselineRows).toEqual({
      sourceSnapshots: 1,
      sourceEvidenceItems: 1,
      workItems: 1,
      draftVersions: 1,
      evidenceLinks: 3,
      reviewEvents: 0,
    });
    const baselineSessionState = await sessionAiState(session.id);
    const denials: Array<{
      name: string;
      expectedStatus: number;
      expectedError: string;
      request: () => Promise<Response>;
    }> = [
      {
        name: 'source unauthenticated',
        expectedStatus: 401,
        expectedError: 'actor_authentication_required',
        request: async () => recordSource(env, session.id, await sourceBody(), unauthenticatedHeaders),
      },
      {
        name: 'source admin',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: async () => recordSource(env, session.id, await sourceBody(), adminHeaders),
      },
      {
        name: 'source assigned counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: async () => recordSource(env, session.id, await sourceBody(), counselorHeaders),
      },
      {
        name: 'source unassigned counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: async () => recordSource(env, session.id, await sourceBody(), unassignedCounselorHeaders),
      },
      {
        name: 'source cross-org service',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: async () => recordSource(env, session.id, await sourceBody(), otherOrgServiceHeaders),
      },
      {
        name: 'generate unauthenticated',
        expectedStatus: 401,
        expectedError: 'actor_authentication_required',
        request: () => generateDraft(env, session.id, source.sourceSnapshotId, unauthenticatedHeaders),
      },
      {
        name: 'generate admin',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => generateDraft(env, session.id, source.sourceSnapshotId, adminHeaders),
      },
      {
        name: 'generate assigned counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => generateDraft(env, session.id, source.sourceSnapshotId, counselorHeaders),
      },
      {
        name: 'generate unassigned counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => generateDraft(env, session.id, source.sourceSnapshotId, unassignedCounselorHeaders),
      },
      {
        name: 'generate cross-org service',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => generateDraft(env, session.id, source.sourceSnapshotId, otherOrgServiceHeaders),
      },
      {
        name: 'read unauthenticated',
        expectedStatus: 401,
        expectedError: 'actor_authentication_required',
        request: () => currentDraft(env, session.id, unauthenticatedHeaders),
      },
      {
        name: 'read admin',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => currentDraft(env, session.id, adminHeaders),
      },
      {
        name: 'read service',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => currentDraft(env, session.id, serviceHeaders),
      },
      {
        name: 'read unassigned counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => currentDraft(env, session.id, unassignedCounselorHeaders),
      },
      {
        name: 'read cross-org counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => currentDraft(env, session.id, otherOrgCounselorHeaders),
      },
      {
        name: 'edit unauthenticated',
        expectedStatus: 401,
        expectedError: 'actor_authentication_required',
        request: () => editDraft(env, session.id, draft.version, evidenceId, unauthenticatedHeaders),
      },
      {
        name: 'edit admin',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => editDraft(env, session.id, draft.version, evidenceId, adminHeaders),
      },
      {
        name: 'edit service',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => editDraft(env, session.id, draft.version, evidenceId, serviceHeaders),
      },
      {
        name: 'edit unassigned counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => editDraft(env, session.id, draft.version, evidenceId, unassignedCounselorHeaders),
      },
      {
        name: 'edit cross-org counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => editDraft(env, session.id, draft.version, evidenceId, otherOrgCounselorHeaders),
      },
      {
        name: 'review unauthenticated',
        expectedStatus: 401,
        expectedError: 'actor_authentication_required',
        request: () => reviewDraft(env, session.id, draft.version, 'approved', unauthenticatedHeaders),
      },
      {
        name: 'review admin',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => reviewDraft(env, session.id, draft.version, 'approved', adminHeaders),
      },
      {
        name: 'review service',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => reviewDraft(env, session.id, draft.version, 'approved', serviceHeaders),
      },
      {
        name: 'review unassigned counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => reviewDraft(env, session.id, draft.version, 'approved', unassignedCounselorHeaders),
      },
      {
        name: 'review cross-org counselor',
        expectedStatus: 403,
        expectedError: 'forbidden',
        request: () => reviewDraft(env, session.id, draft.version, 'approved', otherOrgCounselorHeaders),
      },
    ];

    for (const denial of denials) {
      const callsBefore = adapter.calls;
      const response = await denial.request();

      // #47 flake 진단: 상태코드가 어긋나면 어느 검증기가 거부했는지 응답 본문으로 드러낸다.
      // edit 행은 draft.version·evidenceId를 요청에 실으므로 그 두 값도 함께 남긴다.
      const mismatchBody = response.status === denial.expectedStatus ? '' : await response.clone().text();
      expect(
        response.status,
        `${denial.name} (body=${mismatchBody} draftVersion=${draft.version} evidenceId=${evidenceId})`,
      ).toBe(denial.expectedStatus);
      await expect(response.json()).resolves.toEqual({ error: denial.expectedError });
      expect(adapter.calls).toBe(callsBefore);
      expect(await phase1MutableRowCounts()).toEqual(baselineRows);
      expect(await sessionAiState(session.id)).toEqual(baselineSessionState);
    }
  });
  it('requires canonical draft versions and leaves terminal or stale paths unchanged', async () => {
    const { adapter, caseRecord, env, session } = await setupPhase1AiFixture();
    expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
    const source = await recordSourceSnapshot(env, session.id);
    const generatedResponse = await generateDraft(env, session.id, source.sourceSnapshotId);
    expect(generatedResponse.status).toBe(201);
    const generated = await generatedResponse.json() as RouteAiDraft;
    // #47 flake 진단: 후속 URL이 generated.version을 그대로 문자열 보간한다. 버전이 양의 정수가
    // 아니면 이후 단계(missingVersion/pathMismatch 등)가 엉뚱한 경로를 때려 원인 불명 실패로
    // 보인다 — 여기서 먼저 끊어서 다음 CI 실패가 원본 응답을 그대로 보여주게 한다.
    expect(
      Number.isInteger(generated.version) && generated.version > 0,
      `generated.version was not a positive integer: ${JSON.stringify(generated)}`,
    ).toBe(true);
    const evidenceId = generated.evidence[0]?.id;
    if (evidenceId === undefined) throw new Error('generated draft evidence is missing');

    const unsupportedFreeTextEdit = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${generated.version}/edit`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({
          expectedVersion: generated.version,
          summaryText: 'unsupported counselor claim',
          evidenceIds: [evidenceId],
        }),
      },
    ), env);
    expect(unsupportedFreeTextEdit.status).toBe(400);
    await expect(unsupportedFreeTextEdit.json()).resolves.toEqual({ error: 'invalid_request' });
    const missingVersion = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${generated.version}/edit`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ evidenceIds: [evidenceId] }),
      },
    ), env);
    expect(missingVersion.status).toBe(409);
    await expect(missingVersion.json()).resolves.toEqual({ error: 'draft_version_required' });

    const pathMismatch = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${generated.version}/edit`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ expectedVersion: generated.version + 1, evidenceIds: [evidenceId] }),
      },
    ), env);
    expect(pathMismatch.status).toBe(409);
    await expect(pathMismatch.json()).resolves.toEqual({ error: 'stale_draft_version' });

    const editResponse = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${generated.version}/edit`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ expectedVersion: generated.version, evidenceIds: [evidenceId] }),
      },
    ), env);
    expect(editResponse.status).toBe(200);
    const edited = await editResponse.json() as RouteAiDraft;
    expect(edited.version).toBe(generated.version + 1);

    const staleEdit = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${generated.version}/edit`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ expectedVersion: generated.version, evidenceIds: [evidenceId] }),
      },
    ), env);
    expect(staleEdit.status).toBe(409);
    await expect(staleEdit.json()).resolves.toEqual({ error: 'stale_draft_version' });

    const missingReviewVersion = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${edited.version}/review`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ decision: 'approved' }),
      },
    ), env);
    expect(missingReviewVersion.status).toBe(409);
    await expect(missingReviewVersion.json()).resolves.toEqual({ error: 'draft_version_required' });

    const approvalResponse = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${edited.version}/review`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ expectedVersion: edited.version, decision: 'approved' }),
      },
    ), env);
    expect(approvalResponse.status).toBe(200);

    const terminalReplay = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${edited.version}/review`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ expectedVersion: edited.version, decision: 'rejected' }),
      },
    ), env);
    expect(terminalReplay.status).toBe(409);
    await expect(terminalReplay.json()).resolves.toEqual({ error: 'stale_draft_version' });

    const editAfterTerminal = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${edited.version}/edit`,
      {
        method: 'POST',
        headers: counselorHeaders,
        body: JSON.stringify({ expectedVersion: edited.version, evidenceIds: [generated.evidence[0]!.id] }),
      },
    ), env);
    expect(editAfterTerminal.status).toBe(409);
    await expect(editAfterTerminal.json()).resolves.toEqual({ error: 'stale_draft_version' });

    const current = await currentDraft(env, session.id);
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toEqual(expect.objectContaining({
      version: edited.version,
      reviewDecision: 'approved',
      summaryText: MASKED_TEXT,
    }));
    expect(adapter.calls).toBe(1);
  });

  it('keeps pending and rejected AI off official projections with a manual memo fallback', async () => {
    const scenarios: Array<{
      name: string;
      canary: string;
      decision: 'rejected' | null;
      pendingApprovalCount: number;
    }> = [
      {
        name: 'pending',
        canary: 'PENDING_DRAFT_CANARY',
        decision: null,
        pendingApprovalCount: 1,
      },
      {
        name: 'rejected',
        canary: 'REJECTED_DRAFT_CANARY',
        decision: 'rejected',
        pendingApprovalCount: 0,
      },
    ];

    for (const scenario of scenarios) {
      const adapter = new FakeAiProviderAdapter();
      adapter.output = (request) => validProviderOutput(request, scenario.canary);
      const { caseRecord, env, session } = await setupPhase1AiFixture(adapter);
      expect((await recordPilotConsent(env, caseRecord.id)).status).toBe(201);
      const source = await recordSourceSnapshot(env, session.id);
      const generatedResponse = await generateDraft(env, session.id, source.sourceSnapshotId);
      expect(generatedResponse.status).toBe(201);
      const generated = await generatedResponse.json() as RouteAiDraft;
      if (scenario.decision !== null) {
        const reviewResponse = await reviewDraft(env, session.id, generated.version, scenario.decision);
        expect(reviewResponse.status).toBe(200);
      }

      const [briefingResponse, sessionsResponse, sessionResponse] = await Promise.all([
        worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/briefing`, { headers: counselorHeaders }), env),
        worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/sessions`, { headers: counselorHeaders }), env),
        worker.fetch(new Request(`http://localhost/sessions/${session.id}`, { headers: counselorHeaders }), env),
      ]);
      expect(briefingResponse.status).toBe(200);
      expect(sessionsResponse.status).toBe(200);
      expect(sessionResponse.status).toBe(200);
      const briefing = await briefingResponse.json() as {
        lastSessionSummary: { source: 'ai' | 'memo'; text: string; pendingApprovalCount: number } | null;
      };
      const sessions = await sessionsResponse.json() as Array<Record<string, unknown>>;
      const sessionPayload = await sessionResponse.json() as Record<string, unknown>;
      expect(briefing.lastSessionSummary).toEqual({
        source: 'memo',
        text: 'MANUAL_MEMO_PHASE1',
        pendingApprovalCount: scenario.pendingApprovalCount,
      });
      expect(sessions).toEqual([expect.objectContaining({
        id: session.id,
        memo: 'MANUAL_MEMO_PHASE1',
        aiSummary: null,
        approvedAt: null,
        approvedBy: null,
      })]);
      expect(sessionPayload).toEqual(expect.objectContaining({
        memo: 'MANUAL_MEMO_PHASE1',
        aiSummary: null,
        approvedAt: null,
        approvedBy: null,
      }));
      expectContentFree({ briefing, sessions, sessionPayload }, [scenario.canary]);
    }
  });

  it('returns only safe active provider metadata to an admin', async () => {
    const { adapter, env } = await setupPhase1AiFixture();
    const response = await worker.fetch(new Request('http://localhost/ai/provider/status', { headers: adminHeaders }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      enabled: true,
      adapterId: CODEX_PROVIDER_ID,
      adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
      configHash: await canonicalAiProviderConfigHash(adapter.config),
    });

    for (const headers of [counselorHeaders, serviceHeaders]) {
      const denied = await worker.fetch(new Request('http://localhost/ai/provider/status', { headers }), env);
      expect(denied.status).toBe(403);
      await expect(denied.json()).resolves.toEqual({ error: 'forbidden' });
    }
  });

  it('selects the default Codex adapter with an authenticated JSON POST and rejects incompatible registry tuples', async () => {
    const request: AiProviderRequest = {
      maskedText: MASKED_TEXT,
      evidence: [{
        evidenceId: 'default-evidence-1',
        sourceRef: 'memo:default-source',
        sourceSha256: await sha256Hex(MASKED_TEXT),
        evidenceQuote: MASKED_TEXT,
        sourceStart: 0,
        sourceEnd: Array.from(MASKED_TEXT).length,
      }],
    };
    const calls: Array<{ input: unknown; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      if (init === undefined) calls.push({ input });
      else calls.push({ input, init });
      return new Response(JSON.stringify({ output_text: JSON.stringify(validProviderOutput(request)) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    try {
      expect(() => resolveAiProviderAdapter({
        AI_PROVIDER_CONFIG: JSON.stringify({ ...TEST_PROVIDER_CONFIG, unsupported: true }),
        CODEX_API_KEY: 'test-codex-key',
      })).toThrow('ai_provider_unavailable');
      for (const incompatibleConfig of [
        { registryVersion: 'phase1.v2' },
        { providerId: 'other-provider' },
        { adapterVersion: 'v2' },
      ]) {
        expect(() => resolveAiProviderAdapter({
          AI_PROVIDER_CONFIG: JSON.stringify({ ...TEST_PROVIDER_CONFIG, ...incompatibleConfig }),
          CODEX_API_KEY: 'test-codex-key',
        })).toThrow('ai_provider_unavailable');
      }

      const { adapter, config } = resolveAiProviderAdapter({
        AI_PROVIDER_CONFIG: JSON.stringify(TEST_PROVIDER_CONFIG),
        CODEX_API_KEY: 'test-codex-key',
      });
      expect(adapter).toBeInstanceOf(CodexProviderAdapter);
      expect(config).toEqual(TEST_PROVIDER_CONFIG);
      await expect(adapter.generate(request)).resolves.toEqual(validProviderOutput(request));
      expect(calls).toHaveLength(1);
      expect(String(calls[0]!.input)).toBe('https://api.openai.com/v1/responses');
      expect(calls[0]!.init).toEqual(expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer test-codex-key',
          'content-type': 'application/json',
        }),
      }));
      const body = calls[0]!.init?.body;
      if (typeof body !== 'string') throw new Error('Codex request body is not a string');
      const mapped = JSON.parse(body) as { model: string; input: string; text: { format: { schema: unknown } } };
      expect(mapped.model).toBe(TEST_PROVIDER_CONFIG.model);
      expect(JSON.parse(mapped.input)).toEqual(request);
      expect(mapped.text.format.schema).toEqual(expect.objectContaining({ additionalProperties: false }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
const canonicalIds = {
  counselor: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  hiddenCounselor: '33333333-3333-4333-8333-333333333333',
} as const;

const canonicalCounselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': canonicalIds.counselor,
  'X-CCC-Org-Id': 'org_canonical',
  'X-CCC-Role': 'counselor',
};

const canonicalAdminHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': canonicalIds.admin,
  'X-CCC-Org-Id': 'org_canonical',
  'X-CCC-Role': 'admin',
};

const canonicalUnassignedHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': canonicalIds.hiddenCounselor,
  'X-CCC-Org-Id': 'org_canonical',
  'X-CCC-Role': 'counselor',
};
const canonicalServiceHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'service.canonical@example.invalid',
  'X-CCC-Org-Id': 'org_canonical',
  'X-CCC-Role': 'service',
};

const canonicalCounselor = {
  userId: canonicalIds.counselor,
  orgId: 'org_canonical',
  role: 'counselor' as const,
};

const canonicalAdmin = {
  userId: canonicalIds.admin,
  orgId: 'org_canonical',
  role: 'admin' as const,
};

interface ParticipantCreation {
  beneficiaryId: string;
  supportCaseId: string;
  assignmentRole: 'primary';
  replayed: boolean;
}

async function setupCanonicalParticipant(): Promise<ParticipantCreation> {
  await t.reset();
  await t.db.batch([
    t.db.prepare(
      "INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days) VALUES ('org_canonical', 'UTC', 180)",
    ),
    t.db.prepare(
      'INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, ?, ?, 1, ?)',
    ).bind(canonicalIds.counselor, 'org_canonical', 'canonical.counselor@example.invalid', 'counselor', 'UTC'),
    t.db.prepare(
      'INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, ?, ?, 1, ?)',
    ).bind(canonicalIds.admin, 'org_canonical', 'canonical.admin@example.invalid', 'admin', 'UTC'),
    t.db.prepare(
      'INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, ?, ?, 1, ?)',
    ).bind(canonicalIds.hiddenCounselor, 'org_canonical', 'canonical.hidden@example.invalid', 'counselor', 'UTC'),
  ]);
  const response = await worker.fetch(new Request('http://localhost/beneficiaries', {
    method: 'POST',
    headers: canonicalCounselorHeaders,
    body: JSON.stringify({
      programType: 'financial_support_v1',
      // G1: ① 은 등록의 하드 게이트라 등록 요청에는 언제나 실린다.
      consentPrivacy: true,
    }),
  }), t.env);
  expect(response.status).toBe(201);
  return response.json() as Promise<ParticipantCreation>;
}

describe('canonical participant API routes', () => {
  it('serves the web participant, focused-briefing, today-schedule, and bounded record contracts', async () => {
    const creation = await setupCanonicalParticipant();

    const programs = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(programs.status).toBe(200);
    // 등록만 하고 PII 미기입이면 실명·연락처는 null (D24: 값이 있을 때만 실린다).
    await expect(programs.json()).resolves.toEqual([{
      id: creation.supportCaseId,
      beneficiaryId: creation.beneficiaryId,
      programType: 'financial_support_v1',
      status: 'active',
      // CCC-56: 등록만으로는 인테이크 전 — intake_at 은 인테이크 기록 저장이 채운다.
      intakeAt: null,
      creationKind: 'initial',
      sourceSupportCase: null,
      participantName: null,
      participantPhone: null,
      // D36: 당사자 허브가 담당 여부로 링크를 잠그기 위해 쓰는 필드. 담당 사업이라 true 이고,
      // 담당 실무자 표시 이름은 이 픽스처에서 users.name 이 없어 비어 있다(이메일 폴백 없음).
      authorized: true,
      assigneeNames: [],
      // D44: 동의 3종의 현재 상태. G1 이후 등록은 ① 없이는 성립하지 않으므로(픽스처가 ① 을
      // 보낸다) privacy 만 true 이고, 기록 시각은 그 등록 시점이다.
      consent: { privacy: true, recordingAi: false },
      consentRecordedAt: expect.any(String),
      // 허브 '최신 일정' 카드(2026-08-06 Q). 이 픽스처에는 예정 일정이 없어 null 이다.
      upcomingSchedule: null,
    }]);

    const briefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(briefing.status).toBe(200);
    const briefingBody = await briefing.json() as {
      beneficiaryId: string;
      focusSupportCaseId: string;
      sections: Array<Record<string, unknown>>;
      supportCases?: unknown;
    };
    expect(briefingBody.beneficiaryId).toBe(creation.beneficiaryId);
    expect(briefingBody.focusSupportCaseId).toBe(creation.supportCaseId);
    // D24: PII 미기입 당사자는 실명·연락처 null.
    expect((briefingBody as { participant?: unknown }).participant).toEqual({ name: null, phone: null });
    expect(briefingBody.sections).toHaveLength(1);
    expect(briefingBody.sections[0]).toEqual({
      sourceSupportCase: {
        id: creation.supportCaseId,
        programType: 'financial_support_v1',
        status: 'active',
      },
      gasTrend: [],
      lastSessionSummary: null,
      openActionItems: [],
      flags: [],
      aiSuggestions: [],
      // D45 영역 ② 회차별 정리 — 이 픽스처는 상담 기록이 없어 빈 배열이다.
      sessionRows: [],
      // D45 영역 ③ 내용 불일치(CCC-43) — 저장된 검출 결과가 없어 빈 배열이다.
      discrepancies: [],
    });
    expect(briefingBody).not.toHaveProperty('supportCases');
    const queryFocusedBriefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/briefing?focusSupportCaseId=${creation.supportCaseId}`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(queryFocusedBriefing.status).toBe(200);
    await expect(queryFocusedBriefing.json()).resolves.toEqual(briefingBody);
    const unexpectedProgramQuery = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs?unexpected=1`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(unexpectedProgramQuery.status).toBe(400);
    await expect(unexpectedProgramQuery.json()).resolves.toEqual({ error: 'invalid_request' });

    const schedule = await createCounselingSchedule(t.env, canonicalCounselor, {
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-15T10:00:00.000Z',
    });
    const goal = await createGoal(t.env, canonicalCounselor, creation.supportCaseId, {
      title: 'CANONICAL_RECORD_GOAL',
    });
    const today = await worker.fetch(new Request('http://localhost/schedules/today?date=2026-07-15', {
      headers: canonicalCounselorHeaders,
    }), t.env);
    expect(today.status).toBe(200);
    await expect(today.json()).resolves.toEqual({
      date: '2026-07-15',
      timeZone: 'UTC',
      startUtc: '2026-07-15T00:00:00.000Z',
      endUtc: '2026-07-16T00:00:00.000Z',
      schedules: [{
        id: schedule.id,
        supportCaseId: creation.supportCaseId,
        beneficiaryId: creation.beneficiaryId,
        scheduledAt: '2026-07-15T10:00:00.000Z',
        programType: 'financial_support_v1',
        status: 'scheduled',
        sessionKind: 'regular',
        channel: 'in_person',
        // D24: PII 미기입 당사자는 실명·연락처 null.
        participantName: null,
        participantPhone: null,
        // CCC-19: 완료 회차의 세션 id. 예정이면 null(스키마 CHECK 가 보장한다).
        completedSessionId: null,
      }],
    });
    await createCounselingSchedule(t.env, canonicalCounselor, {
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-15T11:00:00.000Z',
    });

    const recordBody = {
      submissionId: '44444444-4444-4444-8444-444444444444',
      heldAt: '2026-07-15T09:30:00.000Z',
      channel: 'in_person',
      memo: 'CANONICAL_RECORD_MEMO',
      gasScores: [{ goalId: goal.id, score: 1 }],
      actions: [{
        description: 'CANONICAL_ACTION_ITEM',
        owner: 'beneficiary',
        dueDate: '2026-07-16',
      }],
      flags: [{ flagType: 'contact_loss_risk' }],
      lifeAreas: [
        { areaKey: 'economy', changed: true, status: 'crisis', note: 'CANONICAL_ECONOMY' },
        { areaKey: 'housing', changed: false },
        { areaKey: 'employment', changed: false },
        { areaKey: 'health', changed: false },
        { areaKey: 'mental_health', changed: false },
        { areaKey: 'family', changed: false },
      ],
    };
    const record = await worker.fetch(new Request(`http://localhost/support-cases/${creation.supportCaseId}/records`, {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify(recordBody),
    }), t.env);
    expect(record.status).toBe(201);
    const createdRecord = await record.json() as { record: { id: string; counselorId?: string }; replayed: boolean };
    expect(createdRecord.replayed).toBe(false);
    expect(createdRecord.record).toEqual(expect.objectContaining({
      heldAt: recordBody.heldAt,
      channel: recordBody.channel,
      memo: recordBody.memo,
    }));
    expect(createdRecord.record).not.toHaveProperty('counselorId');

    const replay = await worker.fetch(new Request(`http://localhost/support-cases/${creation.supportCaseId}/records`, {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify(recordBody),
    }), t.env);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      record: createdRecord.record,
      replayed: true,
    });
    const sibling = await createSupportCase(t.env, canonicalCounselor, creation.beneficiaryId, {
      consentPrivacy: true,
      schemaVersion: 1,
      submissionId: '77777777-7777-4777-8777-777777777777',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-16T09:00:00.000Z',
      sourceSupportCaseId: creation.supportCaseId,
    });
    const siblingRecord = await worker.fetch(new Request(`http://localhost/support-cases/${sibling.supportCaseId}/records`, {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({
        submissionId: '88888888-8888-4888-8888-888888888888',
        heldAt: '2026-07-16T09:30:00.000Z',
        channel: 'in_person',
        memo: 'SIBLING_RECORD_CANARY',
        gasScores: [],
        actions: [{ description: 'SIBLING_ACTION_CANARY', owner: 'org' }],
        flags: [{ flagType: 'debt_deterioration' }],
      }),
    }), t.env);
    expect(siblingRecord.status).toBe(201);

    // The POST /records route threads actionResolutions through to the gateway (CCC-5).
    const siblingBefore = await worker.fetch(new Request(
      `http://localhost/support-cases/${sibling.supportCaseId}/records?official=true`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    const siblingBeforeBody = await siblingBefore.json() as { records: Array<{ actionItems: Array<{ id: string; resolved: boolean }> }> };
    const openSiblingAction = siblingBeforeBody.records[0]?.actionItems[0];
    if (openSiblingAction === undefined || openSiblingAction.resolved) throw new Error('expected an open sibling action');
    const siblingResolution = await worker.fetch(new Request(`http://localhost/support-cases/${sibling.supportCaseId}/records`, {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({
        submissionId: '12121212-1212-4121-8121-121212121212',
        heldAt: '2026-07-16T10:00:00.000Z',
        channel: 'in_person',
        memo: 'SIBLING_RESOLUTION_CANARY',
        gasScores: [],
        actions: [],
        flags: [],
        actionResolutions: [{ actionItemId: openSiblingAction.id, status: 'done', note: 'ROUTE_RESOLUTION_CANARY' }],
      }),
    }), t.env);
    expect(siblingResolution.status).toBe(201);
    const siblingAfter = await worker.fetch(new Request(
      `http://localhost/support-cases/${sibling.supportCaseId}/records?official=true`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    const siblingAfterBody = await siblingAfter.json() as { records: Array<{ actionItems: Array<{ id: string; resolved: boolean }> }> };
    const resolvedSiblingAction = siblingAfterBody.records
      .flatMap((entry) => entry.actionItems)
      .find((item) => item.id === openSiblingAction.id);
    expect(resolvedSiblingAction).toEqual(expect.objectContaining({ resolved: true }));

    const records = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records?official=true`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(records.status).toBe(200);
    await expect(records.json()).resolves.toEqual({
      records: [{
        id: createdRecord.record.id,
        supportCaseId: creation.supportCaseId,
        heldAt: recordBody.heldAt,
        channel: recordBody.channel,
        memo: recordBody.memo,
        createdAt: expect.any(String),
        gasScores: [{
          goalId: goal.id,
          goalTitle: goal.title,
          score: 1,
        }],
        actionItems: [{
          id: expect.any(String),
          description: 'CANONICAL_ACTION_ITEM',
          owner: 'beneficiary',
          dueDate: '2026-07-16',
          resolved: false,
        }],
        flags: [{
          id: expect.any(String),
          flagType: 'contact_loss_risk',
          source: 'counselor',
          reviewStatus: 'confirmed',
        }],
        lifeAreaSnapshot: [
          { areaKey: 'economy', status: 'crisis', note: 'CANONICAL_ECONOMY' },
        ],
        kind: 'regular',
        // D47 접힌 줄 3종. 이 회차는 승인된 AI 초안이 없어 핵심 한 줄이 null 이고 화면은
        // memoExcerpt 로 낮춘다(D5). 일정이 아직 완료 처리 전이고 기록지 메모도 없어
        // sessionGoals 는 빈 배열 — 그때 화면은 '이번 상담의 목표' 블록을 안 그린다.
        aiOneLiner: null,
        memoExcerpt: recordBody.memo,
        sessionGoals: [],
      }],
      // closedReason 은 세부 목표 구획(D62 · CCC-68)의 닫힘 사유 배지 재료다. 활성은 null.
      goals: [{ id: goal.id, title: goal.title, status: 'active', closedReason: null }],
      schedule: {
        id: schedule.id,
        beneficiaryId: creation.beneficiaryId,
        supportCaseId: creation.supportCaseId,
        scheduledAt: '2026-07-15T10:00:00.000Z',
        status: 'scheduled',
        version: 1,
        completedSessionId: null,
      },
      // CCC-42: '기록 오류'로 처리된 불일치가 가리키는 회차. 여기서는 처리 이력이 없어 빈 배열.
      recordErrorSessionIds: [],
      // D47: HERO 상태 태그와 전체 목표 한 줄의 재료. 전체 목표는 아직 설정 전이라 null 이고
      // 화면은 "상담 준비 화면에서 설정" 안내로 낮춘다 — 이 화면에서는 수정하지 않는다.
      overallGoal: null,
      caseStatus: 'active',
      programType: 'financial_support_v1',
    });
  });
  // D62 · CCC-68: 인테이크 화면의 전체 목표 칸과 15초 페이지 카드는 같은 값을 읽고 쓴다.
  // 쓰기(PUT overall-goal, 인테이크 액션이 부르는 경로)가 인테이크 컨텍스트(프리필)와
  // 15초 페이지 브리핑에 같은 값으로 보이는지 HTTP 경계에서 확인한다 — 완료 기준 그 자체다.
  it('shows one overall goal to both the intake context and the 15-second page (D62 · CCC-68)', async () => {
    const creation = await setupCanonicalParticipant();
    const put = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/overall-goal`,
      {
        method: 'PUT',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({ overallGoal: '3개월 안에 채무조정 신청을 마친다' }),
      },
    ), t.env);
    expect(put.status).toBe(200);

    const context = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    await expect(context.json()).resolves.toMatchObject({
      overallGoal: '3개월 안에 채무조정 신청을 마친다',
    });

    const briefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    await expect(briefing.json()).resolves.toMatchObject({
      overallGoal: '3개월 안에 채무조정 신청을 마친다',
    });
  });

  // CCC-57: 인테이크 위저드가 연결 일정을 완료로 넘기는 경로는 HTTP 경계를 지난다.
  // parseIntakeCreation 의 허용 키에서 두 필드가 빠지면 위저드가 400 으로 죽는데,
  // 게이트웨이 테스트는 그 경계를 지나지 않아 전부 통과한다. 그 구멍을 여기서 막는다.
  it('carries the linked appointment on the intake context and completes it on POST (CCC-57)', async () => {
    const creation = await setupCanonicalParticipant();
    const schedule = await createCounselingSchedule(t.env, canonicalCounselor, {
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-15T10:00:00.000Z',
    });

    const context = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(context.status).toBe(200);
    await expect(context.json()).resolves.toMatchObject({
      hasIntake: false,
      schedule: { id: schedule.id, version: schedule.version, status: 'scheduled', completedSessionId: null },
    });

    const created = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({
          submissionId: 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
          heldAt: '2026-07-15T09:30:00.000Z',
          channel: 'in_person',
          scheduleId: schedule.id,
          expectedScheduleVersion: schedule.version,
        }),
      },
    ), t.env);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { record: { id: string } };

    // 일정이 완료로 넘어가고 그 회차를 가리킨다. 예정으로 남으면 '유령 예정 일정'이다.
    const after = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records?official=true`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    await expect(after.json()).resolves.toMatchObject({ schedule: null });
    await expect(t.env.DB.prepare(
      'SELECT status, completed_session_id FROM counseling_schedules WHERE id = ?',
    ).bind(schedule.id).first()).resolves.toMatchObject({
      status: 'completed',
      completed_session_id: createdBody.record.id,
    });
  });

  it('serves the intake context and stores an intake record once, replaying identical resubmissions (CCC-7)', async () => {
    const creation = await setupCanonicalParticipant();

    const contextBefore = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(contextBefore.status).toBe(200);
    await expect(contextBefore.json()).resolves.toMatchObject({
      supportCaseId: creation.supportCaseId,
      sessionSequence: 1,
      hasIntake: false,
    });

    const intakeBody = {
      submissionId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
      heldAt: '2026-07-15T09:30:00.000Z',
      channel: 'in_person',
      consent: { privacy: true, recordingAi: true },
      helpNarrative: {
        todayHelp: 'INTAKE_TODAY_HELP',
        hardestPoint: 'INTAKE_HARDEST',
        desiredChange: 'INTAKE_DESIRED',
      },
      lifeAreas: [
        { areaKey: 'economy', status: 'crisis', note: 'INTAKE_ECONOMY' },
        { areaKey: 'housing', status: 'okay' },
        { areaKey: 'employment', status: 'strained' },
        { areaKey: 'health', status: 'okay' },
        { areaKey: 'mental_health', status: 'declined' },
        { areaKey: 'family', status: 'not_applicable' },
      ],
      goals: [{ title: 'INTAKE_GOAL', scaleCriteria: { plus2: '완납' } }],
      actions: [{ description: 'INTAKE_ACTION', owner: 'beneficiary' }],
    };
    const created = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { method: 'POST', headers: canonicalCounselorHeaders, body: JSON.stringify(intakeBody) },
    ), t.env);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { record: { id: string; kind: string }; replayed: boolean };
    expect(createdBody.replayed).toBe(false);
    expect(createdBody.record.kind).toBe('intake');

    // Identical resubmission replays (200) with the same record — no duplicate.
    const replay = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { method: 'POST', headers: canonicalCounselorHeaders, body: JSON.stringify(intakeBody) },
    ), t.env);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true, record: { id: createdBody.record.id } });

    // Context now reports the intake, and the records list marks it kind=intake.
    const contextAfter = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    await expect(contextAfter.json()).resolves.toMatchObject({ hasIntake: true, sessionSequence: 2 });

    const records = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records?official=true`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    const recordsBody = await records.json() as { records: Array<{ id: string; kind: string }> };
    expect(recordsBody.records.find((record) => record.id === createdBody.record.id)?.kind).toBe('intake');

    // A second intake with a fresh submission id is rejected (one intake per case → 409).
    const second = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { method: 'POST', headers: canonicalCounselorHeaders, body: JSON.stringify({ ...intakeBody, submissionId: 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2' }) },
    ), t.env);
    expect(second.status).toBe(409);

    // Unassigned counselor cannot read the intake context (403).
    const denied = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { headers: canonicalUnassignedHeaders },
    ), t.env);
    expect(denied.status).toBe(403);
  });
  it('serves the saved intake in the context and updates it in place (2026-08-08 확인·수정)', async () => {
    const creation = await setupCanonicalParticipant();

    // 인테이크가 없으면 수정은 409 — 만들기 1회 규칙의 짝(수정은 있는 것만).
    const beforeCreate = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      {
        method: 'PUT',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({ heldAt: '2026-07-15T09:30:00.000Z', channel: 'in_person' }),
      },
    ), t.env);
    expect(beforeCreate.status).toBe(409);

    const created = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({
          submissionId: 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3',
          heldAt: '2026-07-15T09:30:00.000Z',
          channel: 'in_person',
          answers: [{ key: 'counsel_method', response: 'answered', text: '대면 상담(내방)' }],
          debts: [{ creditor: '해당 없음' }],
          managerOpinion: 'INTAKE_OPINION_V1',
        }),
      },
    ), t.env);
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { record: { id: string } };

    // 컨텍스트가 저장분을 싣는다 — 확인 화면의 재료(감사는 화면 조회 1건에 합산).
    const context = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    await expect(context.json()).resolves.toMatchObject({
      hasIntake: true,
      saved: {
        sessionId: createdBody.record.id,
        heldAt: '2026-07-15T09:30:00.000Z',
        channel: 'in_person',
        answers: [{ key: 'counsel_method', response: 'answered', text: '대면 상담(내방)' }],
        debts: [{ creditor: '해당 없음' }],
        managerOpinion: 'INTAKE_OPINION_V1',
      },
    });

    // 수정: 상담일·답변·의견을 덮어쓴다. 같은 세션 행이 그대로 남는다(새 회차 아님).
    const updated = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      {
        method: 'PUT',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({
          heldAt: '2026-07-16T10:00:00.000Z',
          channel: 'phone',
          answers: [{ key: 'counsel_method', response: 'answered', text: '전화 상담' }],
          debts: [{ creditor: 'OO은행', kind: '신용대출' }],
          managerOpinion: 'INTAKE_OPINION_V2',
        }),
      },
    ), t.env);
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      record: { id: createdBody.record.id, heldAt: '2026-07-16T10:00:00.000Z', channel: 'phone', kind: 'intake' },
    });

    const contextAfter = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    await expect(contextAfter.json()).resolves.toMatchObject({
      // 회차가 늘지 않았다(수정은 덮어쓰기) — sessionSequence = 기존 1 + 1.
      sessionSequence: 2,
      saved: {
        sessionId: createdBody.record.id,
        heldAt: '2026-07-16T10:00:00.000Z',
        channel: 'phone',
        answers: [{ key: 'counsel_method', response: 'answered', text: '전화 상담' }],
        debts: [{ creditor: 'OO은행', kind: '신용대출' }],
        managerOpinion: 'INTAKE_OPINION_V2',
      },
    });

    // 담당 아닌 실무자는 수정할 수 없다(403) — 읽기와 같은 경계다(D7).
    const denied = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records/intake`,
      {
        method: 'PUT',
        headers: canonicalUnassignedHeaders,
        body: JSON.stringify({ heldAt: '2026-07-17T10:00:00.000Z', channel: 'in_person' }),
      },
    ), t.env);
    expect(denied.status).toBe(403);
  });
  it('returns 409 for a conflicting canonical SupportCase receipt without state mutation', async () => {
    const creation = await setupCanonicalParticipant();
    const requestBody = {
      schemaVersion: 1,
      submissionId: '99999999-9999-4999-8999-999999999999',
      // G1: 추가 참여 사업도 ① 을 다시 받는다(D44 — 두 번째 사업은 미체크로 시작).
      consentPrivacy: true,
      programType: 'financial_support_v1',
      sourceSupportCaseId: creation.supportCaseId,
    };
    const createdResponse = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify(requestBody),
      },
    ), t.env);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as ParticipantCreation;
    expect(created).toEqual({
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: expect.any(String),
      assignmentRole: 'primary',
      replayed: false,
    });

    const stateBeforeConflict = await t.db.prepare(
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
      canonicalCounselor.orgId,
      creation.beneficiaryId,
      canonicalCounselor.orgId,
      creation.beneficiaryId,
      canonicalCounselor.orgId,
    ).first();
    const participantBeforeConflict = await t.db.prepare(
      `SELECT initialization_state AS initializationState, updated_at AS updatedAt
       FROM beneficiaries WHERE id = ? AND org_id = ?`,
    ).bind(creation.beneficiaryId, canonicalCounselor.orgId).first();
    const vaultBeforeConflict = await t.db.prepare(
      `SELECT enc_name AS encName, enc_phone AS encPhone, enc_account AS encAccount,
              version, purge_due AS purgeDue, purged_at AS purgedAt, updated_at AS updatedAt
       FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?`,
    ).bind(creation.beneficiaryId, canonicalCounselor.orgId).first();
    // 감사 7건: 등록 4건(create·create·assign·record_consent) + 추가 사업 3건(create·assign·
    // record_consent). G1 로 등록·추가 양쪽에 동의 기록 감사가 1건씩 붙었다.
    expect(stateBeforeConflict).toEqual({ supportCaseCount: 2, assignmentCount: 2, auditCount: 7 });

    const conflict = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({
          // 같은 제출 id 로 내용만 다른 재시도 — ② 동의를 바꿔 영수증 해시를 어긋나게 한다.
          ...requestBody,
          consentRecordingAi: true,
        }),
      },
    ), t.env);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: 'conflict' });

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
      canonicalCounselor.orgId,
      creation.beneficiaryId,
      canonicalCounselor.orgId,
      creation.beneficiaryId,
      canonicalCounselor.orgId,
    ).first()).resolves.toEqual(stateBeforeConflict);
    await expect(t.db.prepare(
      `SELECT initialization_state AS initializationState, updated_at AS updatedAt
       FROM beneficiaries WHERE id = ? AND org_id = ?`,
    ).bind(creation.beneficiaryId, canonicalCounselor.orgId).first())
      .resolves.toEqual(participantBeforeConflict);
    await expect(t.db.prepare(
      `SELECT enc_name AS encName, enc_phone AS encPhone, enc_account AS encAccount,
              version, purge_due AS purgeDue, purged_at AS purgedAt, updated_at AS updatedAt
       FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?`,
    ).bind(creation.beneficiaryId, canonicalCounselor.orgId).first())
      .resolves.toEqual(vaultBeforeConflict);
  });
  it('keeps pending and rejected canonical AI drafts out of participant briefing and official records until approval', async () => {
    const creation = await setupCanonicalParticipant();
    const adapter = new FakeAiProviderAdapter();
    const env: ApiEnv = {
      ...t.env,
      TEXT_AI_PILOT_ENABLED: '1',
      AI_PROVIDER_ADAPTER: adapter,
    };
    const providerConfig = await registerAiProviderConfiguration(env, canonicalAdmin, {
      adapterId: CODEX_PROVIDER_ID,
      adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
      configHash: await canonicalAiProviderConfigHash(adapter.config),
      approvalRefs: ['canonical-ai-route-approval'],
    });
    await activateAiProviderConfiguration(env, canonicalAdmin, providerConfig.id);

    const consent = await worker.fetch(new Request(
      `http://localhost/cases/${creation.supportCaseId}/pilot-text-ai-consent`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({
          noticeVersion: 'canonical-pilot-notice-v1',
          noticeHash: 'c'.repeat(64),
          evidenceRef: 'canonical-pilot-evidence',
          evidenceHash: 'd'.repeat(64),
          effectiveAt: '2020-01-01T09:00:00.000Z',
        }),
      },
    ), env);
    expect(consent.status).toBe(201);

    const submitManualRecord = async (
      submissionId: string,
      heldAt: string,
      memo: string,
    ): Promise<string> => {
      const response = await worker.fetch(new Request(
        `http://localhost/support-cases/${creation.supportCaseId}/records`,
        {
          method: 'POST',
          headers: canonicalCounselorHeaders,
          body: JSON.stringify({
            submissionId,
            heldAt,
            channel: 'in_person',
            memo,
            gasScores: [],
            actions: [],
            flags: [],
          }),
        },
      ), env);
      expect(response.status).toBe(201);
      const result = await response.json() as { record: { id: string }; replayed: boolean };
      expect(result.replayed).toBe(false);
      return result.record.id;
    };
    const generateCanaryDraft = async (
      sessionId: string,
      maskedText: string,
      evidenceId: string,
      canary: string,
    ): Promise<RouteAiDraft> => {
      adapter.output = (request) => validProviderOutput(request, canary);
      const source = await recordSourceSnapshot(
        env,
        sessionId,
        await sourceBody(maskedText, evidenceId),
        canonicalServiceHeaders,
      );
      const response = await generateDraft(env, sessionId, source.sourceSnapshotId, canonicalServiceHeaders);
      expect(response.status).toBe(201);
      const draft = await response.json() as RouteAiDraft;
      expect(draft.summaryText).toBe(canary);
      return draft;
    };

    const pendingCanary = 'CANONICAL_PENDING_AI_CANARY';
    const rejectedCanary = 'CANONICAL_REJECTED_AI_CANARY';
    const approvedCanary = 'CANONICAL_APPROVED_AI_CANARY';
    const pendingSessionId = await submitManualRecord(
      '10111111-1111-4111-8111-111111111111',
      '2026-07-15T10:00:00.000Z',
      'CANONICAL_PENDING_MANUAL_FALLBACK',
    );
    await generateCanaryDraft(
      pendingSessionId,
      'MASKED_CANONICAL_PENDING_SOURCE',
      'canonical-pending-evidence',
      pendingCanary,
    );
    const rejectedSessionId = await submitManualRecord(
      '20222222-2222-4222-8222-222222222222',
      '2026-07-15T11:00:00.000Z',
      'CANONICAL_REJECTED_MANUAL_FALLBACK',
    );
    const rejectedDraft = await generateCanaryDraft(
      rejectedSessionId,
      'MASKED_CANONICAL_REJECTED_SOURCE',
      'canonical-rejected-evidence',
      rejectedCanary,
    );
    const rejectedReview = await reviewDraft(
      env,
      rejectedSessionId,
      rejectedDraft.version,
      'rejected',
      canonicalCounselorHeaders,
    );
    expect(rejectedReview.status).toBe(200);

    const focusedBeforeApprovalResponse = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalCounselorHeaders },
    ), env);
    const officialBeforeApprovalResponse = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records?official=true`,
      { headers: canonicalCounselorHeaders },
    ), env);
    expect(focusedBeforeApprovalResponse.status).toBe(200);
    expect(officialBeforeApprovalResponse.status).toBe(200);
    const focusedBeforeApproval = await focusedBeforeApprovalResponse.json() as {
      sections: Array<{
        lastSessionSummary: {
          source: 'ai' | 'memo';
          text: string;
          pendingApprovalCount: number;
        } | null;
        aiSuggestions: Array<{ title: string; reason: string | null; sessionId: string; heldAt: string | null }>;
      }>;
    };
    const officialBeforeApproval = await officialBeforeApprovalResponse.json() as {
      records: Array<{ id: string; memo: string }>;
    };
    expect(focusedBeforeApproval.sections).toEqual([expect.objectContaining({
      lastSessionSummary: {
        source: 'memo',
        text: 'CANONICAL_REJECTED_MANUAL_FALLBACK',
        pendingApprovalCount: 1,
      },
      aiSuggestions: [],
    })]);
    expect(officialBeforeApproval.records.map(({ id, memo }) => ({ id, memo }))).toEqual([
      { id: rejectedSessionId, memo: 'CANONICAL_REJECTED_MANUAL_FALLBACK' },
      { id: pendingSessionId, memo: 'CANONICAL_PENDING_MANUAL_FALLBACK' },
    ]);
    expectContentFree(
      { focusedBeforeApproval, officialBeforeApproval },
      [pendingCanary, rejectedCanary],
    );

    const approvedSessionId = await submitManualRecord(
      '30333333-3333-4333-8333-333333333333',
      '2026-07-15T12:00:00.000Z',
      'CANONICAL_APPROVED_MANUAL_FALLBACK',
    );
    const approvedDraft = await generateCanaryDraft(
      approvedSessionId,
      'MASKED_CANONICAL_APPROVED_SOURCE',
      'canonical-approved-evidence',
      approvedCanary,
    );
    const approvedReview = await reviewDraft(
      env,
      approvedSessionId,
      approvedDraft.version,
      'approved',
      canonicalCounselorHeaders,
    );
    expect(approvedReview.status).toBe(200);

    const focusedAfterApprovalResponse = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalCounselorHeaders },
    ), env);
    const officialAfterApprovalResponse = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records?official=true`,
      { headers: canonicalCounselorHeaders },
    ), env);
    expect(focusedAfterApprovalResponse.status).toBe(200);
    expect(officialAfterApprovalResponse.status).toBe(200);
    const focusedAfterApproval = await focusedAfterApprovalResponse.json() as {
      sections: Array<{
        lastSessionSummary: {
          source: 'ai' | 'memo';
          text: string;
          pendingApprovalCount: number;
        } | null;
        aiSuggestions: Array<{ title: string; reason: string | null; sessionId: string; heldAt: string | null }>;
      }>;
    };
    const officialAfterApproval = await officialAfterApprovalResponse.json() as {
      records: Array<{ id: string; memo: string }>;
    };
    expect(focusedAfterApproval.sections).toEqual([expect.objectContaining({
      lastSessionSummary: {
        source: 'ai',
        text: approvedCanary,
        pendingApprovalCount: 1,
      },
      aiSuggestions: [
        { title: '상황 일정에 변동이 있었나요?', reason: '지난 회차에서 일정 변동 가능성이 언급되었습니다.', sessionId: approvedSessionId, heldAt: '2026-07-15T12:00:00.000Z' },
        { title: '주거비 변화가 있었나요?', reason: '지난 회차에서 주거비 부담이 화제였습니다.', sessionId: approvedSessionId, heldAt: '2026-07-15T12:00:00.000Z' },
      ],
    })]);
    expectContentFree(focusedAfterApproval, [pendingCanary, rejectedCanary]);
    expect(officialAfterApproval.records.map(({ id, memo }) => ({ id, memo }))).toEqual([
      { id: approvedSessionId, memo: 'CANONICAL_APPROVED_MANUAL_FALLBACK' },
      { id: rejectedSessionId, memo: 'CANONICAL_REJECTED_MANUAL_FALLBACK' },
      { id: pendingSessionId, memo: 'CANONICAL_PENDING_MANUAL_FALLBACK' },
    ]);
    expectContentFree(
      officialAfterApproval,
      [pendingCanary, rejectedCanary, approvedCanary],
    );
  });

  it('rejects role-confused, malformed, unknown-field, and hidden-case participant requests without disclosure', async () => {
    const creation = await setupCanonicalParticipant();

    const roleConfused = await worker.fetch(new Request('http://localhost/participants', {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({
        programType: 'financial_support_v1',
        initialAssigneeUserId: canonicalIds.hiddenCounselor,
      }),
    }), t.env);
    expect(roleConfused.status).toBe(400);
    await expect(roleConfused.json()).resolves.toEqual({ error: 'invalid_request' });

    const malformed = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({
          schemaVersion: 1,
          submissionId: 'not-a-uuid',
          programType: 'financial_support_v1',
          sourceSupportCaseId: creation.supportCaseId,
          ignored: true,
        }),
      },
    ), t.env);
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'invalid_request' });
    const malformedRecord = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({
          submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          heldAt: '2026-07-15T09:30:00.000Z',
          channel: 'in_person',
          memo: 'INVALID_ARRAYS',
          gasScores: [],
          actions: {},
          flags: [],
        }),
      },
    ), t.env);
    expect(malformedRecord.status).toBe(400);
    await expect(malformedRecord.json()).resolves.toEqual({ error: 'invalid_request' });

    const hiddenPayload = {
      schemaVersion: 1,
      submissionId: '55555555-5555-4555-8555-555555555555',
      consentPrivacy: true,
      programType: 'financial_support_v1',
      initialAssigneeUserId: canonicalIds.hiddenCounselor,
    };
    const hidden = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      {
        method: 'POST',
        headers: canonicalAdminHeaders,
        body: JSON.stringify(hiddenPayload),
      },
    ), t.env);
    expect(hidden.status).toBe(201);
    const hiddenCase = await hidden.json() as ParticipantCreation;
    const hiddenReplay = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      {
        method: 'POST',
        headers: canonicalAdminHeaders,
        body: JSON.stringify(hiddenPayload),
      },
    ), t.env);
    expect(hiddenReplay.status).toBe(200);
    await expect(hiddenReplay.json()).resolves.toEqual({
      ...hiddenCase,
      replayed: true,
    });

    const visiblePrograms = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/support-cases`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(visiblePrograms.status).toBe(200);
    // D36(2026-07-26): 당사자 허브는 **기관 내 전 참여 사업**을 보여준다. 그래서 담당하지
    // 않는 사업도 목록에 나오되 `authorized: false` 로 와서 상담 내용이 잠긴다 — 바로
    // 아래에서 그 사업의 브리핑이 여전히 403 인 것을 확인한다. 목록에 나오는 것과 열리는
    // 것은 다른 문제다.
    const visibleBody = await visiblePrograms.json() as Array<{
      id: string; authorized: boolean; assigneeNames: string[];
    }>;
    expect(visibleBody.map((entry) => [entry.id, entry.authorized])).toEqual(
      expect.arrayContaining([
        [creation.supportCaseId, true],
        [hiddenCase.supportCaseId, false],
      ]),
    );
    expect(visibleBody).toHaveLength(2);
    // 담당 실무자 표시 이름은 이메일로 폴백하지 않는다 — 담당 밖 사업까지 내려가는 목록이라
    // 이메일 폴백은 admin 전용 디렉터리로 막아 둔 직원 이메일을 실무자에게 새게 한다.
    expect(JSON.stringify(visibleBody)).not.toContain('@example.invalid');

    const hiddenBriefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${hiddenCase.supportCaseId}/briefing`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(hiddenBriefing.status).toBe(403);
    await expect(hiddenBriefing.json()).resolves.toEqual({ error: 'forbidden' });

    const deniedRecord = await worker.fetch(new Request(`http://localhost/support-cases/${creation.supportCaseId}/records`, {
      method: 'POST',
      headers: canonicalUnassignedHeaders,
      body: JSON.stringify({
        submissionId: '66666666-6666-4666-8666-666666666666',
        heldAt: '2026-07-15T09:30:00.000Z',
        channel: 'in_person',
        memo: 'DENIED_RECORD_CANARY',
        gasScores: [],
        actions: [],
        flags: [],
      }),
    }), t.env);
    expect(deniedRecord.status).toBe(403);
    await expect(deniedRecord.json()).resolves.toEqual({ error: 'forbidden' });
    const deniedRecords = await worker.fetch(new Request(
      `http://localhost/support-cases/${creation.supportCaseId}/records?official=true`,
      { headers: canonicalUnassignedHeaders },
    ), t.env);
    expect(deniedRecords.status).toBe(403);
    await expect(deniedRecords.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('enforces schedule versions and exposes no-show through the canonical transition route', async () => {
    const creation = await setupCanonicalParticipant();
    const schedule = await createCounselingSchedule(t.env, canonicalCounselor, {
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-16T10:00:00.000Z',
    });
    const deniedTransition = await worker.fetch(new Request(`http://localhost/schedules/${schedule.id}/cancel`, {
      method: 'POST',
      headers: canonicalUnassignedHeaders,
      body: JSON.stringify({ expectedVersion: 1 }),
    }), t.env);
    expect(deniedTransition.status).toBe(403);
    await expect(deniedTransition.json()).resolves.toEqual({ error: 'forbidden' });

    const rescheduled = await worker.fetch(new Request(`http://localhost/schedules/${schedule.id}/reschedule`, {
      method: 'PATCH',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({
        expectedVersion: 1,
        scheduledAt: '2026-07-16T11:00:00.000Z',
      }),
    }), t.env);
    expect(rescheduled.status).toBe(200);
    await expect(rescheduled.json()).resolves.toEqual({
      id: schedule.id,
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-16T11:00:00.000Z',
      status: 'scheduled',
      version: 2,
    });

    const stale = await worker.fetch(new Request(`http://localhost/schedules/${schedule.id}/cancel`, {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({ expectedVersion: 1 }),
    }), t.env);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: 'conflict' });
    const cancellableSchedule = await createCounselingSchedule(t.env, canonicalCounselor, {
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-16T12:00:00.000Z',
    });
    const cancelled = await worker.fetch(new Request(`http://localhost/schedules/${cancellableSchedule.id}/cancel`, {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({ expectedVersion: 1 }),
    }), t.env);
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toEqual({
      id: cancellableSchedule.id,
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: cancellableSchedule.scheduledAt,
      status: 'cancelled',
      version: 2,
    });

    const noShowSchedule = await createCounselingSchedule(t.env, canonicalCounselor, {
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-17T10:00:00.000Z',
    });
    const noShow = await worker.fetch(new Request(`http://localhost/schedules/${noShowSchedule.id}/no-show`, {
      method: 'POST',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({ expectedVersion: 1 }),
    }), t.env);
    expect(noShow.status).toBe(200);
    await expect(noShow.json()).resolves.toEqual({
      id: noShowSchedule.id,
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: noShowSchedule.scheduledAt,
      status: 'no_show',
      version: 2,
    });
  });

  it('serves the participant realname in the briefing for the assignee, denies non-owners, and never leaks the account', async () => {
    const creation = await setupCanonicalParticipant();
    const pii = {
      name: 'PII_NAME_CANARY',
      phone: 'PII_PHONE_CANARY',
      account: 'PII_ACCOUNT_CANARY',
    };
    await updateParticipantPii(t.env, canonicalAdmin, creation.beneficiaryId, {
      supportCaseContextId: creation.supportCaseId,
      expectedVersion: 1,
      ...pii,
    });
    const vault = await t.db.prepare(
      `SELECT enc_name AS encName, enc_phone AS encPhone, enc_account AS encAccount
       FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?`,
    ).bind(creation.beneficiaryId, canonicalCounselor.orgId).first<{
      encName: string | null;
      encPhone: string | null;
      encAccount: string | null;
    }>();
    expect(vault?.encName).not.toBe(pii.name);
    expect(vault?.encPhone).not.toBe(pii.phone);
    expect(vault?.encAccount).not.toBe(pii.account);

    // 담당 실무자: 브리핑 응답에 실명·연락처가 실리고, 계좌는 어떤 경로로도 실리지 않는다 (D24).
    const briefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(briefing.status).toBe(200);
    const briefingBody = await briefing.text();
    expect((JSON.parse(briefingBody) as { participant: unknown }).participant)
      .toEqual({ name: pii.name, phone: pii.phone });
    expectContentFree(briefingBody, [pii.account]);

    // 화면 조회당 read_participant_pii 감사 1건.
    const piiReadAudit = await t.db.prepare(
      `SELECT actor_id AS actorId, actor_role AS actorRole, action, target_table AS targetTable,
              target_id AS targetId, beneficiary_id AS beneficiaryId, support_case_id AS supportCaseId, detail
       FROM audit_log
       WHERE action = 'read_participant_pii' AND beneficiary_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(creation.beneficiaryId).first();
    expect(piiReadAudit).toEqual({
      actorId: canonicalCounselor.userId,
      actorRole: 'counselor',
      action: 'read_participant_pii',
      targetTable: 'participant_pii_vault',
      targetId: creation.beneficiaryId,
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      detail: `{"fields":["name","phone"],"beneficiaryIds":["${creation.beneficiaryId}"],"count":1}`,
    });
    const participantAuditLog = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE org_id = ? AND beneficiary_id = ? ORDER BY id`,
    ).bind(canonicalCounselor.orgId, creation.beneficiaryId).all<{ detail: string | null }>();
    expectContentFree({ vault, auditLog: participantAuditLog.results }, Object.values(pii));

    // admin 도 실명 열람 권한을 갖는다.
    const adminBriefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalAdminHeaders },
    ), t.env);
    expect(adminBriefing.status).toBe(200);
    expect((await adminBriefing.json() as { participant: { name: string | null } }).participant.name).toBe(pii.name);

    // 비담당 실무자는 브리핑(실명 포함) 접근이 막힌다 — 실명이 전혀 새지 않는다.
    const denied = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalUnassignedHeaders },
    ), t.env);
    expect(denied.status).toBe(403);
    const deniedBody = await denied.text();
    expectContentFree(deniedBody, Object.values(pii));

    const unauthenticated = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: unauthenticatedHeaders },
    ), t.env);
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'actor_authentication_required' });
  });

  // 티켓 #32 · D24 · ADR-0005: 마스킹·전체 보기 클릭 흐름은 폐기됐다. 실명은 목록·브리핑
  // 응답에 역할 기준으로 직접 실리고, 감사는 화면 조회당 1건(read_participant_pii)이다.
  it('serves the participant realname in the schedule list for the assignee and admin, null for others', async () => {
    const creation = await setupCanonicalParticipant();
    const pii = { name: '김한나', phone: '010-1234-5678', account: '110-123-456789' };
    await updateParticipantPii(t.env, canonicalAdmin, creation.beneficiaryId, {
      supportCaseContextId: creation.supportCaseId,
      expectedVersion: 1,
      ...pii,
    });
    await createCounselingSchedule(t.env, canonicalCounselor, {
      beneficiaryId: creation.beneficiaryId,
      supportCaseId: creation.supportCaseId,
      scheduledAt: '2026-07-15T10:00:00.000Z',
    });

    // 담당 실무자: 카드에 실명·연락처가 실리고, 계좌는 어떤 경로로도 실리지 않는다.
    const counselorToday = await worker.fetch(new Request(
      'http://localhost/schedules/today?date=2026-07-15',
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(counselorToday.status).toBe(200);
    const counselorBody = await counselorToday.text();
    expect(JSON.parse(counselorBody).schedules[0]).toMatchObject({
      participantName: pii.name,
      participantPhone: pii.phone,
    });
    expectContentFree(counselorBody, [pii.account]);

    // 화면 조회당 read_participant_pii 감사 1건(케이스 대상 목록을 detail 에 담는다).
    const piiReadAudit = await t.db.prepare(
      `SELECT actor_id AS actorId, actor_role AS actorRole, action, target_table AS targetTable, detail
       FROM audit_log WHERE action = 'read_participant_pii' AND actor_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(canonicalCounselor.userId).first();
    expect(piiReadAudit).toEqual({
      actorId: canonicalCounselor.userId,
      actorRole: 'counselor',
      action: 'read_participant_pii',
      targetTable: 'participant_pii_vault',
      detail: `{"fields":["name","phone"],"beneficiaryIds":["${creation.beneficiaryId}"],"count":1}`,
    });
    expectContentFree({ piiReadAudit }, Object.values(pii));

    // admin 도 기관 전체 카드에서 실명을 본다.
    const adminToday = await worker.fetch(new Request(
      'http://localhost/schedules/today?date=2026-07-15',
      { headers: canonicalAdminHeaders },
    ), t.env);
    expect(adminToday.status).toBe(200);
    expect((await adminToday.json() as { schedules: Array<{ participantName: string | null }> }).schedules[0]?.participantName)
      .toBe(pii.name);

    // service(파이프라인)는 상담 일정을 읽을 권한 자체가 없다 — 실명은 물론 어떤 카드도 못 본다.
    const serviceToday = await worker.fetch(new Request(
      'http://localhost/schedules/today?date=2026-07-15',
      { headers: canonicalServiceHeaders },
    ), t.env);
    expect(serviceToday.status).toBe(403);
    const serviceBody = await serviceToday.text();
    expectContentFree(serviceBody, Object.values(pii));
    const serviceAuditCount = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'read_participant_pii' AND actor_id = ?",
    ).bind('service.canonical@example.invalid').first<{ count: number }>();
    expect(serviceAuditCount?.count).toBe(0);
  });

  it('no longer exposes the removed masked and reveal PII routes', async () => {
    const creation = await setupCanonicalParticipant();
    const masked = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/pii/masked?supportCaseContextId=${creation.supportCaseId}`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(masked.status).toBe(404);
    const reveal = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/pii/reveal`,
      {
        method: 'POST',
        headers: canonicalCounselorHeaders,
        body: JSON.stringify({ supportCaseContextId: creation.supportCaseId, purpose: 'active_support_case_counseling' }),
      },
    ), t.env);
    expect(reveal.status).toBe(404);
    const revealActionCount = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action IN ('reveal_participant_pii', 'read_participant_pii_masked')",
    ).first<{ count: number }>();
    expect(revealActionCount?.count).toBe(0);
  });
});

describe('support case overall goal route (D45 · CCC-41)', () => {
  it('gates PUT /support-cases/:id/overall-goal to the assigned counselor and reflects it in the briefing', async () => {
    const creation = await setupCanonicalParticipant();
    const url = `http://localhost/support-cases/${creation.supportCaseId}/overall-goal`;

    // 담당 실무자 저장 — 공백은 정리돼 돌아온다.
    const saved = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({ overallGoal: '  자립 기반 마련  ' }),
    }), t.env);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({
      supportCaseId: creation.supportCaseId,
      overallGoal: '자립 기반 마련',
    });

    // 브리핑에 실리고, 담당 실무자에게는 편집 가능으로 온다.
    const briefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalCounselorHeaders },
    ), t.env);
    expect(briefing.status).toBe(200);
    await expect(briefing.json()).resolves.toMatchObject({
      overallGoal: '자립 기반 마련',
      canEditOverallGoal: true,
    });

    // 기관 관리자도 수정한다(2026-07-30 Q 결정 — ADR-0018 개정, 구 '담당 실무자만' 대체).
    const adminBriefing = await worker.fetch(new Request(
      `http://localhost/participants/${creation.beneficiaryId}/programs/${creation.supportCaseId}/briefing`,
      { headers: canonicalAdminHeaders },
    ), t.env);
    await expect(adminBriefing.json()).resolves.toMatchObject({ canEditOverallGoal: true });
    const adminPut = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers: canonicalAdminHeaders,
      body: JSON.stringify({ overallGoal: '관리자가 고친 전체 목표' }),
    }), t.env);
    expect(adminPut.status).toBe(200);
    // 되돌려 놓는다 — 아래 단정들이 앞의 값을 이어서 쓴다.
    const restorePut = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({ overallGoal: '자립 기반 마련' }),
    }), t.env);
    expect(restorePut.status).toBe(200);

    // 비담당 실무자는 접근 자체가 403(D7). 알 수 없는 키는 400.
    const unassignedPut = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers: canonicalUnassignedHeaders,
      body: JSON.stringify({ overallGoal: 'NOT_ASSIGNED' }),
    }), t.env);
    expect(unassignedPut.status).toBe(403);
    const badBody = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({ overallGoal: 'x', unexpected: true }),
    }), t.env);
    expect(badBody.status).toBe(400);

    // null 저장 = 설정 전으로 되돌림.
    const cleared = await worker.fetch(new Request(url, {
      method: 'PUT',
      headers: canonicalCounselorHeaders,
      body: JSON.stringify({ overallGoal: null }),
    }), t.env);
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toEqual({
      supportCaseId: creation.supportCaseId,
      overallGoal: null,
    });
  });
});

describe('public participant signup routes (CCC-28)', () => {
  const counselor = {
    userId: counselorHeaders['X-CCC-User-Id'],
    orgId: counselorHeaders['X-CCC-Org-Id'],
    role: 'counselor' as const,
  };

  async function issueToken(): Promise<string> {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    return invite.token;
  }

  it('GET /invites/participant/:token returns programType for a valid token', async () => {
    const token = await issueToken();
    const res = await worker.fetch(
      new Request(`http://localhost/invites/participant/${token}`),
      t.env,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ programType: 'financial_support_v1' });
  });

  it('GET /invites/participant/:token returns 404 for unknown token', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request('http://localhost/invites/participant/0000000000000000000000000000000000000000000000000000000000000000'),
      t.env,
    );
    expect(res.status).toBe(404);
  });

  it('POST /signup/participant creates beneficiary + case and returns 201', async () => {
    const token = await issueToken();
    const res = await worker.fetch(
      new Request('http://localhost/signup/participant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          name: '테스트 당사자',
          phone: '010-1234-5678',
          consent: { privacy: true, recordingAi: true },
        }),
      }),
      t.env,
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { beneficiaryId: string; supportCaseId: string };
    expect(body.beneficiaryId).toBeTruthy();
    expect(body.supportCaseId).toBeTruthy();
  });

  it('POST /signup/participant returns 404 for already-used token', async () => {
    const token = await issueToken();
    const body = {
      token,
      name: '첫 가입',
      consent: { privacy: true, recordingAi: true },
    };
    const first = await worker.fetch(
      new Request('http://localhost/signup/participant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      t.env,
    );
    expect(first.status).toBe(201);
    const second = await worker.fetch(
      new Request('http://localhost/signup/participant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      t.env,
    );
    expect(second.status).toBe(404);
  });

  it('POST /signup/participant returns 400 when consent is missing', async () => {
    const token = await issueToken();
    const res = await worker.fetch(
      new Request('http://localhost/signup/participant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, name: '이름만' }),
      }),
      t.env,
    );
    expect(res.status).toBe(400);
  });
});
