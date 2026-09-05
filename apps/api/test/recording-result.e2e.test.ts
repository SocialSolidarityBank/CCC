import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Bindable } from '@ccc/contracts/database';
import worker from './support/local-worker';
import {
  activateAiProviderConfiguration,
  claimRecordingResultDownstream,
  commitRecordingResult,
  createCase,
  createManualSession,
  listSupportCasesForBeneficiary,
  recordPilotTextAiConsentEvidence,
  registerAiProviderConfiguration,
  registerRecording,
  releaseRecordingResultDownstream,
  type Actor,
} from '@ccc/core/gateway';
import {
  AI_PROVIDER_REGISTRY_VERSION,
  CODEX_PROVIDER_ADAPTER_VERSION,
  CODEX_PROVIDER_ID,
  canonicalAiProviderConfigHash,
  type AiProviderConfig,
  type AiProviderOutput,
  type AiProviderRequest,
  type AiProviderTestAdapter,
} from '@ccc/ai-runtime';
import { setupD1, testActors } from './support/d1';
import {
  agentManifestEnv,
  AGENT_SERVICE_HEADERS,
  claimOverHttp,
  seedNerQualification,
  type NerQualification,
} from './support/agent-jobs';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import type { ApiEnv } from '@ccc/http-api/identity';

const t = setupD1();
const counselor: Actor = testActors.counselor;

/**
 * 결과 payload hash 는 NER attestation 값까지 덮으므로 한 테스트 안에서는 같은 자격을 쓴다 —
 * 매번 새 영수증을 심으면 재전송 payload 가 달라져 멱등 경로가 성립하지 않는다.
 */
let qualificationCache: { db: D1Database; value: NerQualification } | null = null;

async function sessionQualification(): Promise<NerQualification> {
  if (qualificationCache?.db === t.db) return qualificationCache.value;
  const value = await seedNerQualification(t.db);
  qualificationCache = { db: t.db, value };
  return value;
}
const service: Actor = testActors.service;
const MASKED_FIXTURE = '[상담자] 합성 녹음의 마스킹 완료 문장입니다.';
const TEST_PROVIDER_CONFIG = {
  registryVersion: AI_PROVIDER_REGISTRY_VERSION,
  providerId: CODEX_PROVIDER_ID,
  adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
  configVersion: 'recording-result-e2e-v1',
  model: 'gpt-5-codex-test',
} satisfies AiProviderConfig;

class FixtureAiProvider implements AiProviderTestAdapter {
  readonly providerId = CODEX_PROVIDER_ID;
  readonly adapterVersion = CODEX_PROVIDER_ADAPTER_VERSION;
  readonly testOnly = true as const;
  readonly config = TEST_PROVIDER_CONFIG;
  calls = 0;
  failure: unknown = null;

  async generate(request: AiProviderRequest): Promise<AiProviderOutput> {
    this.calls += 1;
    if (this.failure !== null) throw this.failure;
    const evidence = request.materials[0]?.evidence[0];
    if (evidence === undefined) throw new Error('fixture evidence is missing');
    return {
      claims: [{
        claimKey: 'fixture-claim',
        section: 'other_topics',
        text: '합성 녹음 처리가 완료되었습니다.',
        evidence: [{ ...evidence }],
      }],
      questions: [
        { title: '합성 일정 확인', reason: '가상 일정의 확인이 필요합니다.', evidence: [{ ...evidence }] },
        { title: '합성 비용 확인', reason: '가상 비용의 확인이 필요합니다.', evidence: [{ ...evidence }] },
      ],
      oneLiner: '합성 녹음 처리 결과입니다.',
      // 재료 구성과 무관하게 빈 대조는 언제나 합법이다(항목이 없는 것은 정상 결과).
      contrast: {
        missing_from_memo: [],
        missing_from_transcript: [],
        undiscussed_session_goal: [],
      },
      flagSuggestions: [],
    };
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** v2 `AudioResult` (S5 §2.1). S6 metadata 와 hash 3종을 계약대로 채운다. */
async function recordingResultBody(maskedText = MASKED_FIXTURE) {
  const sha256 = await sha256Hex(maskedText);
  const evidence = [{
    id: crypto.randomUUID(),
    sourceRef: 'recording-transcript',
    sourceSha256: sha256,
    evidenceQuote: maskedText,
    sourceStart: 0,
    sourceEnd: [...maskedText].length,
  }];
  return {
    kind: 'audio',
    maskedText,
    sha256,
    maskingPipelineVersion: 'fixture-mask-v1',
    maskingPipelineHash: 'd'.repeat(64),
    nerAvailable: true,
    nerAttestationId: 'attestation-placeholder',
    nerAttestationResultHash: 'c'.repeat(64),
    releaseQualificationReceiptId: 'receipt-placeholder',
    evidenceHash: await sha256Hex(canonicalizeJcs(evidence)),
    evidence,
    // D64 보류 중 장비는 빈 감정만 보낸다 (worker.py EMOTION_DEFERRED)
    emotionScores: {},
    transcriptReliable: true,
    transcriptWarnings: [],
  };
}

async function createUploadedRecording(submissionId = crypto.randomUUID()) {
  const caseRecord = await createCase(t.env, counselor, {
    consentRecordingAt: '2026-08-01T00:00:00.000Z',
    consentTextAiAt: '2026-08-01T00:00:00.000Z',
  });
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId,
    heldAt: '2026-08-01T09:00:00.000Z',
    channel: 'in_person',
    memo: '합성 테스트용 수기 기록',
    gasScores: [],
  });
  await registerRecording(t.env, counselor, session.id, `audio/${session.id}/fixture`);
  return { caseRecord, session };
}

async function configureProvider(env: ApiEnv, provider: FixtureAiProvider, caseId: string): Promise<void> {
  await recordPilotTextAiConsentEvidence(env, counselor, caseId, {
    noticeVersion: 'recording-result-e2e-v1',
    noticeSha256: 'a'.repeat(64),
    evidenceRef: 'fixture:recording-consent',
    evidenceSha256: 'b'.repeat(64),
    effectiveAt: '2020-01-01T00:00:00.000Z',
  });
  const providerConfig = await registerAiProviderConfiguration(env, testActors.admin, {
    adapterId: CODEX_PROVIDER_ID,
    adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
    configHash: await canonicalAiProviderConfigHash(TEST_PROVIDER_CONFIG),
    approvalRefs: ['fixture-privacy-approval'],
  });
  await activateAiProviderConfiguration(env, testActors.admin, providerConfig.id);
}

/**
 * 결과는 claim 한 오디오 작업으로만 들어온다 (S5). 호출자가 준 `result` 를 그대로 싣고
 * payload hash 만 계약대로 계산한다 — 잘못된 본문도 서버 검증까지 그대로 도달한다.
 */
async function postResult(
  env: ApiEnv,
  sessionId: string,
  body: Record<string, unknown>,
  headers: HeadersInit = {
    'content-type': 'application/json',
    'X-CCC-User-Id': service.userId,
    'X-CCC-Org-Id': service.orgId,
    'X-CCC-Role': service.role,
  },
): Promise<Response> {
  const agentEnv = await agentManifestEnv(env, { stt: 'local' });
  // 이 헬퍼는 한 테스트에서 여러 번 불린다. 앞선 호출의 임대를 되돌려 매 호출이 스스로
  // claim 하게 한다(테스트 셋업 직접 DB 허용 — 서버 경로는 그대로 v2 계약을 지난다).
  await t.db.prepare(
    `UPDATE agent_jobs SET state = 'pending', lease_owner = NULL, claim_token_hash = NULL,
       claimed_at = NULL, lease_expires_at = NULL, attempt = 0
     WHERE session_id = ? AND kind = 'audio' AND state = 'leased'`,
  ).bind(sessionId).run();
  const terminal = await t.db.prepare(
    "SELECT id FROM agent_jobs WHERE session_id = ? AND kind = 'audio' AND state = 'succeeded'",
  ).bind(sessionId).first<{ id: string }>();
  const { jobs, qualification } = await claimOverHttp(agentEnv, t.db, {
    ...AGENT_SERVICE_HEADERS,
  }, await sessionQualification());
  // 이미 수락된 작업은 claim 없이 같은 payload hash 로만 다시 온다(멱등 경로, S5 §2.2).
  const job = terminal === null
    ? jobs.find((candidate) => candidate.kind === 'audio' && candidate.sessionId === sessionId)
    : { jobId: terminal.id, claimToken: '0'.repeat(64), attempt: 1 };
  if (job === undefined) throw new Error('expected a claimable audio job');
  const result = {
    ...body,
    ...(Object.hasOwn(body, 'nerAttestationId') ? { nerAttestationId: qualification.attestation.id } : {}),
    ...(Object.hasOwn(body, 'nerAttestationResultHash')
      ? { nerAttestationResultHash: qualification.attestation.resultHash }
      : {}),
    ...(Object.hasOwn(body, 'releaseQualificationReceiptId')
      ? { releaseQualificationReceiptId: qualification.receiptId }
      : {}),
  };
  const attempt = job.attempt;
  return worker.fetch(new Request(`http://localhost/pipeline/jobs/${job.jobId}/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      schemaVersion: 2,
      claimToken: job.claimToken,
      attempt,
      resultId: crypto.randomUUID(),
      payloadSha256: await sha256Hex(canonicalizeJcs({ schemaVersion: 2, attempt, result })),
      result,
    }),
  }), agentEnv);
}

const counselorHeaders = {
  'X-CCC-User-Id': counselor.userId,
  'X-CCC-Org-Id': counselor.orgId,
  'X-CCC-Role': counselor.role,
};


function isBindable(value: unknown): value is Bindable {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || value instanceof Uint8Array;
}
function hideCommittedResultFromPreflight(db: ApiEnv['DB']): ApiEnv['DB'] {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== 'prepare') {
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (query: string) => {
        const statement = target.prepare(query);
        if (!query.includes('SELECT 1 AS present') || !query.includes('recording_result_commits')) {
          return statement;
        }
        return new Proxy(statement, {
          get(statementTarget, statementProperty, statementReceiver) {
            if (statementProperty !== 'bind') {
              const value = Reflect.get(statementTarget, statementProperty, statementReceiver);
              return typeof value === 'function' ? value.bind(statementTarget) : value;
            }
            return (...values: unknown[]) => {
              if (!values.every(isBindable)) throw new Error('unexpected non-bindable test value');
              const bound = statementTarget.bind(...values);
              return new Proxy(bound, {
                get(boundTarget, boundProperty, boundReceiver) {
                  if (boundProperty === 'first') return async () => null;
                  const value = Reflect.get(boundTarget, boundProperty, boundReceiver);
                  return typeof value === 'function' ? value.bind(boundTarget) : value;
                },
              });
            };
          },
        });
      };
    },
  });
}

function bodyBytes(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function relayToWorker(
  request: IncomingMessage,
  response: ServerResponse,
  env: ApiEnv,
): Promise<void> {
  const body = await bodyBytes(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  // 로컬 다리는 Cloudflare Access가 검증한 서비스 신원만 테스트용 actor 헤더로 바꾼다.
  headers.set('X-CCC-User-Id', service.userId);
  headers.set('X-CCC-Org-Id', service.orgId);
  headers.set('X-CCC-Role', service.role);
  const init: RequestInit = {
    method: request.method ?? 'GET',
    headers,
  };
  if (body.byteLength > 0) init.body = new Uint8Array(body);
  const workerResponse = await worker.fetch(new Request(`http://localhost${request.url ?? '/'}`, init), env);
  response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
  response.end(Buffer.from(await workerResponse.arrayBuffer()));
}

function runDeviceClient(
  baseUrl: string,
  sessionId: string,
  qualification: { receiptId: string; attestation: Record<string, unknown> },
): Promise<{ code: number | null; stderr: string }> {
  // 실제 Python 클라이언트로 v2 계약을 왕복한다: claim → result → 같은 payload 재전송(멱등).
  const script = [
    'import json, sys',
    'from ccc_pipeline.api_client import ApiClient',
    'from ccc_pipeline.results import build_result, build_result_request',
    'client = ApiClient(sys.argv[1], "fixture-client", "fixture-secret", runtime_environment="production")',
    'attestation = json.loads(sys.argv[3])',
    'receipt_id = sys.argv[4]',
    'jobs = client.claim_jobs({"nerAttestation": attestation, "releaseQualificationReceiptId": receipt_id})',
    'job = next(j for j in jobs if j["kind"] == "audio" and j["sessionId"] == sys.argv[2])',
    'result = build_result(',
    '    "audio",',
    `    ${JSON.stringify(MASKED_FIXTURE)},`,
    '    masking_pipeline_version="fixture-mask-v1",',
    '    masking_pipeline_hash="d" * 64,',
    '    ner_attestation=attestation,',
    '    release_qualification_receipt_id=receipt_id,',
    '    source_ref="audio:fixture",',
    '    emotion_scores={},',
    '    transcript_reliable=True,',
    '    transcript_warnings=[],',
    ')',
    'request = build_result_request(job["claimToken"], job["attempt"], result)',
    'client.post_result(job["jobId"], request)',
    'client.post_result(job["jobId"], request)',
  ].join('\n');
  return new Promise((resolveProcess, reject) => {
    const child = spawn(
      'python3',
      ['-c', script, baseUrl, sessionId, JSON.stringify(qualification.attestation), qualification.receiptId],
      {
        cwd: resolve('apps/pipeline'),
        env: { ...process.env, PYTHONPATH: '.' },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolveProcess({ code, stderr }));
  });
}

describe('recording result end-to-end contract (CCC-95)', () => {
  it('commits a Preview fixture result through the real Worker route exactly once and keeps it unofficial', async () => {
    await t.reset();
    const env = await agentManifestEnv({
      ...t.env,
      PREVIEW_MODE: 'true',
      PREVIEW_ACCESS_CODE: 'fixture-preview-code',
      TEXT_AI_PILOT_ENABLED: '1',
      EXTERNAL_AI_CALLS_ENABLED: '0',
    }, { stt: 'local' });
    const { caseRecord, session } = await createUploadedRecording('95000000-0000-4000-8000-000000000001');
    await recordPilotTextAiConsentEvidence(env, counselor, caseRecord.id, {
      noticeVersion: 'recording-result-e2e-v1',
      noticeSha256: 'a'.repeat(64),
      evidenceRef: 'fixture:recording-consent',
      evidenceSha256: 'b'.repeat(64),
      effectiveAt: '2020-01-01T00:00:00.000Z',
    });

    const server = createServer((request, response) => {
      void relayToWorker(request, response, env).catch(() => {
        response.writeHead(500).end();
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    try {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('test server address is unavailable');
      const qualification = await seedNerQualification(t.db);
      const processResult = await runDeviceClient(
        `http://127.0.0.1:${address.port}`,
        session.id,
        qualification as unknown as { receiptId: string; attestation: Record<string, unknown> },
      );
      expect(processResult, processResult.stderr).toEqual({ code: 0, stderr: '' });
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }

    const state = await t.db.prepare(
      'SELECT ai_status, transcript, emotion_scores, ai_schema FROM sessions WHERE id = ?',
    ).bind(session.id).first<{
      ai_status: string;
      transcript: string | null;
      emotion_scores: string | null;
      ai_schema: string | null;
    }>();
    expect(state).toEqual({
      ai_status: 'review_ready',
      transcript: MASKED_FIXTURE,
      emotion_scores: JSON.stringify({}),
      ai_schema: null,
    });

    const counts = await t.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM ai_masked_source_snapshots WHERE session_id = ?) AS snapshots,
         (SELECT COUNT(*) FROM ai_work_items WHERE session_id = ?) AS downstream_work,
         (SELECT COUNT(*) FROM ai_provider_configs) AS provider_configs,
         (SELECT COUNT(*) FROM ai_provider_activations) AS provider_activations,
         (SELECT COUNT(*) FROM audit_log WHERE target_table = 'recording_results' AND target_id = ?) AS commits,
         (SELECT COUNT(*) FROM audit_log
          WHERE target_table = 'sessions' AND target_id = ?
            AND detail LIKE '%recording_result%') AS transitions`,
    ).bind(session.id, session.id, session.id, session.id).first<{
      snapshots: number;
      downstream_work: number;
      provider_configs: number;
      provider_activations: number;
      commits: number;
      transitions: number;
    }>();
    expect(counts).toEqual({
      snapshots: 1,
      downstream_work: 1,
      provider_configs: 0,
      provider_activations: 0,
      commits: 1,
      transitions: 1,
    });

    const currentDraft = await t.db.prepare(
      `SELECT draft.id, draft.version, draft.origin, draft.creation_mode
       FROM ai_draft_versions AS draft
       JOIN ai_work_items AS work ON work.id = draft.work_item_id
       WHERE work.session_id = ?
       ORDER BY draft.version DESC
       LIMIT 1`,
    ).bind(session.id).first<{
      id: string;
      version: number;
      origin: string;
      creation_mode: string;
    }>();
    expect(currentDraft).toEqual({
      id: expect.any(String),
      version: 1,
      origin: 'fixture_generated',
      creation_mode: 'fixture_generated',
    });

    const draftResponse = await worker.fetch(
      new Request(`http://localhost/sessions/${session.id}/ai`, { headers: counselorHeaders }),
      env,
    );
    expect(draftResponse.status).toBe(200);
    expect(await draftResponse.json()).toMatchObject({
      version: 1,
      origin: 'fixture_generated',
      creationMode: 'fixture_generated',
    });

    const approval = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai/drafts/${currentDraft?.version ?? 0}/review`,
      {
        method: 'POST',
        headers: { ...counselorHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedVersion: currentDraft?.version, decision: 'approved' }),
      },
    ), env);
    expect(approval.status).toBe(409);
    expect(await approval.json()).toEqual({ error: 'fixture_draft_approval_forbidden' });

    const approvalBoundary = await t.db.prepare(
      `SELECT
         session.ai_status,
         session.ai_summary,
         session.approved_at,
         session.approved_by,
         (SELECT COUNT(*) FROM ai_review_events WHERE draft_version_id = ?) AS review_events,
         (SELECT COUNT(*) FROM approved_ai_briefing_v1 WHERE session_id = ?) AS approved_rows,
         (SELECT COUNT(*) FROM audit_log
          WHERE target_table = 'ai_review_events'
            AND target_id = ?
            AND detail LIKE '%fixture_draft_approval_forbidden%') AS denials
       FROM sessions AS session
       WHERE session.id = ?`,
    ).bind(currentDraft?.id, session.id, currentDraft?.id, session.id).first<{
      ai_status: string;
      ai_summary: string | null;
      approved_at: string | null;
      approved_by: string | null;
      review_events: number;
      approved_rows: number;
      denials: number;
    }>();
    expect(approvalBoundary).toEqual({
      ai_status: 'review_ready',
      ai_summary: null,
      approved_at: null,
      approved_by: null,
      review_events: 0,
      approved_rows: 0,
      denials: 1,
    });

    const official = await worker.fetch(new Request(`http://localhost/cases/${caseRecord.id}/sessions`, {
      headers: counselorHeaders,
    }), env);
    expect(official.status).toBe(200);
    const officialText = JSON.stringify(await official.json());
    expect(officialText).not.toContain(MASKED_FIXTURE);
    expect(officialText).not.toContain('combined');

    const { programs } = await listSupportCasesForBeneficiary(env, counselor, caseRecord.id);
    const supportCaseId = programs[0]?.supportCase.id;
    if (supportCaseId === undefined) throw new Error('support case is missing');
    const briefing = await worker.fetch(new Request(
      `http://localhost/participants/${caseRecord.id}/programs/${supportCaseId}/briefing`,
      { headers: counselorHeaders },
    ), env);
    expect(briefing.status).toBe(200);
    const briefingBody = await briefing.json<{
      sections: Array<{
        sourceSupportCase: { id: string };
        lastSessionSummary: { pendingApprovalCount: number } | null;
        pendingReviewSessionIds: string[];
      }>;
    }>();
    const briefingText = JSON.stringify(briefingBody);
    expect(briefingText).not.toContain(MASKED_FIXTURE);
    expect(briefingText).not.toContain('합성 녹음 처리가 완료되었습니다.');
    const briefingSection = briefingBody.sections.find(
      (section) => section.sourceSupportCase.id === supportCaseId,
    );
    expect(briefingSection?.lastSessionSummary?.pendingApprovalCount).toBe(0);
    expect(briefingSection?.pendingReviewSessionIds).toEqual([session.id]);
  });

  it('rejects recording re-registration after an immutable result commit', async () => {
    await t.reset();
    const env = await agentManifestEnv({
      ...t.env,
      PREVIEW_MODE: 'true',
      PREVIEW_ACCESS_CODE: 'fixture-preview-code',
      TEXT_AI_PILOT_ENABLED: '1',
      EXTERNAL_AI_CALLS_ENABLED: '0',
    }, { stt: 'local' });
    const { caseRecord, session } = await createUploadedRecording('95000000-0000-4000-8000-000000000005');
    await recordPilotTextAiConsentEvidence(env, counselor, caseRecord.id, {
      noticeVersion: 'recording-result-e2e-v1',
      noticeSha256: 'a'.repeat(64),
      evidenceRef: 'fixture:recording-consent',
      evidenceSha256: 'b'.repeat(64),
      effectiveAt: '2020-01-01T00:00:00.000Z',
    });
    const resultResponse = await postResult(env, session.id, await recordingResultBody());
    expect(resultResponse.status, await resultResponse.text()).toBe(204);

    await expect(registerRecording(
      env,
      counselor,
      session.id,
      `audio/${session.id}/replacement`,
    )).rejects.toThrow('recording result is already committed');
    await expect(registerRecording(
      { ...env, DB: hideCommittedResultFromPreflight(env.DB) },
      counselor,
      session.id,
      `audio/${session.id}/raced-replacement`,
    )).rejects.toThrow('recording upload is no longer allowed');

    const state = await t.db.prepare(
      `SELECT session.ai_status, session.audio_r2_key,
              (SELECT COUNT(*) FROM recording_result_commits WHERE session_id = session.id) AS commits
       FROM sessions AS session
       WHERE session.id = ?`,
    ).bind(session.id).first<{ ai_status: string; audio_r2_key: string; commits: number }>();
    expect(state).toEqual({
      ai_status: 'review_ready',
      audio_r2_key: `audio/${session.id}/fixture`,
      commits: 1,
    });
  });

  it('keeps a fixture review link when the latest session has no memo text', async () => {
    await t.reset();
    const env = await agentManifestEnv({
      ...t.env,
      PREVIEW_MODE: 'true',
      PREVIEW_ACCESS_CODE: 'fixture-preview-code',
      TEXT_AI_PILOT_ENABLED: '1',
      EXTERNAL_AI_CALLS_ENABLED: '0',
    }, { stt: 'local' });
    const { caseRecord, session } = await createUploadedRecording('95000000-0000-4000-8000-000000000007');
    await t.db.prepare("UPDATE sessions SET memo = '' WHERE id = ?").bind(session.id).run();
    await recordPilotTextAiConsentEvidence(env, counselor, caseRecord.id, {
      noticeVersion: 'recording-result-e2e-v1',
      noticeSha256: 'a'.repeat(64),
      evidenceRef: 'fixture:recording-consent',
      evidenceSha256: 'b'.repeat(64),
      effectiveAt: '2020-01-01T00:00:00.000Z',
    });
    const resultResponse = await postResult(env, session.id, await recordingResultBody());
    expect(resultResponse.status, await resultResponse.text()).toBe(204);
    const { programs } = await listSupportCasesForBeneficiary(env, counselor, caseRecord.id);
    const supportCaseId = programs[0]?.supportCase.id;
    if (supportCaseId === undefined) throw new Error('support case is missing');

    const response = await worker.fetch(new Request(
      `http://localhost/participants/${caseRecord.id}/programs/${supportCaseId}/briefing`,
      { headers: counselorHeaders },
    ), env);
    expect(response.status).toBe(200);
    const body = await response.json<{
      sections: Array<{
        sourceSupportCase: { id: string };
        lastSessionSummary: { text: string } | null;
        pendingReviewSessionIds: string[];
      }>;
    }>();
    const section = body.sections.find((candidate) => candidate.sourceSupportCase.id === supportCaseId);
    expect(section?.lastSessionSummary).toBeNull();
    expect(section?.pendingReviewSessionIds).toEqual([session.id]);
  });

  it('reclaims an expired downstream claim after an interrupted Worker request', async () => {
    await t.reset();
    const env = await agentManifestEnv({
      ...t.env,
      PREVIEW_MODE: 'true',
      PREVIEW_ACCESS_CODE: 'fixture-preview-code',
      TEXT_AI_PILOT_ENABLED: '1',
      EXTERNAL_AI_CALLS_ENABLED: '0',
    }, { stt: 'local' });
    const { caseRecord, session } = await createUploadedRecording('95000000-0000-4000-8000-000000000006');
    await recordPilotTextAiConsentEvidence(env, counselor, caseRecord.id, {
      noticeVersion: 'recording-result-e2e-v1',
      noticeSha256: 'a'.repeat(64),
      evidenceRef: 'fixture:recording-consent',
      evidenceSha256: 'b'.repeat(64),
      effectiveAt: '2020-01-01T00:00:00.000Z',
    });
    const result = await recordingResultBody();
    const accepted = await commitRecordingResult(env, service, session.id, result);
    expect(accepted.finalized).toBe(false);
    const firstClaim = await claimRecordingResultDownstream(env, service, session.id);
    expect(firstClaim).toEqual(expect.any(String));
    expect(await claimRecordingResultDownstream(env, service, session.id)).toBeNull();
    await t.db.prepare(
      `UPDATE recording_result_commits
       SET downstream_claimed_at = '2020-01-01T00:00:00.000Z'
       WHERE session_id = ?`,
    ).bind(session.id).run();
    const reclaimed = await claimRecordingResultDownstream(env, service, session.id);
    expect(reclaimed).toEqual(expect.any(String));
    expect(reclaimed).not.toBe(firstClaim);
    if (firstClaim === null || reclaimed === null) throw new Error('downstream claim is missing');
    await releaseRecordingResultDownstream(env, service, session.id, firstClaim);
    const currentClaim = await t.db.prepare(
      'SELECT downstream_claimed_at FROM recording_result_commits WHERE session_id = ?',
    ).bind(session.id).first<{ downstream_claimed_at: string | null }>();
    expect(currentClaim?.downstream_claimed_at).toBe(reclaimed);
    await releaseRecordingResultDownstream(env, service, session.id, reclaimed);

    expect((await postResult(env, session.id, result)).status).toBe(204);

    const recovered = await t.db.prepare(
      `SELECT session.ai_status,
              (SELECT COUNT(*) FROM ai_work_items WHERE session_id = session.id) AS work_items,
              (SELECT origin FROM ai_draft_versions AS draft
               JOIN ai_work_items AS work ON work.id = draft.work_item_id
               WHERE work.session_id = session.id
               ORDER BY draft.version DESC LIMIT 1) AS origin
       FROM sessions AS session
       WHERE session.id = ?`,
    ).bind(session.id).first<{ ai_status: string; work_items: number; origin: string | null }>();
    expect(recovered).toEqual({
      ai_status: 'review_ready',
      work_items: 1,
      origin: 'fixture_generated',
    });
  });

  it('rejects unauthorized, cross-organization, malformed, unsafe, and non-numeric results without mutation', async () => {
    await t.reset();
    const { session } = await createUploadedRecording();
    const valid = await recordingResultBody();
    const cases: Array<{ name: string; body: Record<string, unknown>; headers?: HeadersInit; status: number }> = [
      { name: 'counselor', body: valid, headers: { ...counselorHeaders, 'content-type': 'application/json' }, status: 403 },
      {
        name: 'other organization service',
        body: valid,
        headers: {
          'content-type': 'application/json',
          'X-CCC-User-Id': 'service.other@example.invalid',
          'X-CCC-Org-Id': 'org_other',
          'X-CCC-Role': 'service',
        },
        // 다른 기관의 service 는 이 작업을 찾을 수 없다(org 경계, S5 §2.6).
        status: 404,
      },
      { name: 'wrong hash', body: { ...valid, sha256: '0'.repeat(64) }, status: 422 },
      {
        name: 'non numeric emotion',
        body: { ...valid, emotionScores: { combined: '불안함' } },
        status: 400,
      },
      {
        name: 'non-empty emotion while deferred (D64)',
        body: { ...valid, emotionScores: { combined: 0.25, utteranceCount: 1 } },
        status: 409,
      },
      {
        name: 'unmasked sensitive pattern',
        body: await recordingResultBody('연락처 010-1234-5678, test@example.org, 123-456-789012'),
        status: 400,
      },
    ];
    for (const scenario of cases) {
      const response = await postResult(t.env, session.id, scenario.body, scenario.headers);
      expect(response.status, `${scenario.name}: ${await response.clone().text()}`).toBe(scenario.status);
      const responseText = await response.text();
      expect(responseText).not.toContain('010-1234-5678');
      expect(responseText).not.toContain('test@example.org');
      expect(responseText).not.toContain('123-456-789012');
      expect(responseText).not.toContain('불안함');
    }
    const counts = await t.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM ai_masked_source_snapshots WHERE session_id = ?) AS snapshots,
         (SELECT COUNT(*) FROM recording_result_commits WHERE session_id = ?) AS commits`,
    ).bind(session.id, session.id).first<{ snapshots: number; commits: number }>();
    expect(counts).toEqual({ snapshots: 0, commits: 0 });
  });

  it('rejects non-empty emotion scores while emotion analysis is deferred (D64)', async () => {
    await t.reset();
    const { session } = await createUploadedRecording();
    const body = await recordingResultBody();
    const rejected = await postResult(t.env, session.id, {
      ...body,
      emotionScores: { combined: 0.25, utteranceCount: 1 },
    });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: 'emotion_deferred' });
    const counts = await t.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM ai_masked_source_snapshots WHERE session_id = ?) AS snapshots,
         (SELECT COUNT(*) FROM recording_result_commits WHERE session_id = ?) AS commits`,
    ).bind(session.id, session.id).first<{ snapshots: number; commits: number }>();
    expect(counts).toEqual({ snapshots: 0, commits: 0 });
  });

  it('keeps the built-in fixture inside Preview without blocking the configured test-provider seam', async () => {
    await t.reset();
    const unavailableEnv = {
      ...t.env,
      TEXT_AI_PILOT_ENABLED: '1',
      EXTERNAL_AI_CALLS_ENABLED: '0',
    };
    const unavailable = await createUploadedRecording();
    await recordPilotTextAiConsentEvidence(unavailableEnv, counselor, unavailable.caseRecord.id, {
      noticeVersion: 'recording-result-boundary-v1',
      noticeSha256: 'c'.repeat(64),
      evidenceRef: 'fixture:boundary-consent',
      evidenceSha256: 'd'.repeat(64),
      effectiveAt: '2020-01-01T00:00:00.000Z',
    });
    const unavailableResponse = await postResult(
      unavailableEnv,
      unavailable.session.id,
      await recordingResultBody(),
    );
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.json()).toEqual({ error: 'ai_provider_unavailable' });

    await t.reset();
    const provider = new FixtureAiProvider();
    const providerEnv = {
      ...t.env,
      TEXT_AI_PILOT_ENABLED: '1',
      EXTERNAL_AI_CALLS_ENABLED: '0',
      AI_PROVIDER_ADAPTER: provider,
    };
    const configured = await createUploadedRecording();
    await configureProvider(providerEnv, provider, configured.caseRecord.id);
    const configuredResponse = await postResult(
      providerEnv,
      configured.session.id,
      await recordingResultBody(),
    );
    expect(configuredResponse.status).toBe(204);
    expect(provider.calls).toBe(1);
    const draft = await t.db.prepare(
      `SELECT draft.origin, draft.creation_mode
       FROM ai_draft_versions AS draft
       JOIN ai_work_items AS work ON work.id = draft.work_item_id
       WHERE work.session_id = ?`,
    ).bind(configured.session.id).first<{ origin: string; creation_mode: string }>();
    expect(draft).toEqual({ origin: 'generated', creation_mode: 'provider_generated' });
  });

  it('keeps one accepted result pending when provider work fails and resumes it on the same retry', async () => {
    await t.reset();
    const provider = new FixtureAiProvider();
    provider.failure = new Error('fixture provider unavailable');
    const env = {
      ...t.env,
      PREVIEW_MODE: 'true',
      PREVIEW_ACCESS_CODE: 'fixture-preview-code',
      TEXT_AI_PILOT_ENABLED: '1',
      AI_PROVIDER_ADAPTER: provider,
    };
    const { caseRecord, session } = await createUploadedRecording();
    await configureProvider(env, provider, caseRecord.id);
    const body = await recordingResultBody();

    const failed = await postResult(env, session.id, body);
    expect(failed.status).toBe(500);
    const pending = await t.db.prepare(
      `SELECT session.ai_status, result.finalized_at,
              (SELECT COUNT(*) FROM ai_masked_source_snapshots WHERE session_id = session.id) AS snapshots,
              (SELECT COUNT(*) FROM ai_work_items WHERE session_id = session.id) AS work_items
       FROM sessions AS session
       JOIN recording_result_commits AS result ON result.session_id = session.id
       WHERE session.id = ?`,
    ).bind(session.id).first<{ ai_status: string; finalized_at: string | null; snapshots: number; work_items: number }>();
    expect(pending).toEqual({ ai_status: 'uploaded', finalized_at: null, snapshots: 1, work_items: 0 });

    provider.failure = null;
    const retried = await postResult(env, session.id, body);
    expect(retried.status).toBe(204);
    const completed = await t.db.prepare(
      `SELECT session.ai_status, result.finalized_at,
              (SELECT COUNT(*) FROM ai_masked_source_snapshots WHERE session_id = session.id) AS snapshots,
              (SELECT COUNT(*) FROM ai_work_items WHERE session_id = session.id) AS work_items
       FROM sessions AS session
       JOIN recording_result_commits AS result ON result.session_id = session.id
       WHERE session.id = ?`,
    ).bind(session.id).first<{ ai_status: string; finalized_at: string | null; snapshots: number; work_items: number }>();
    expect(completed).toEqual({
      ai_status: 'review_ready',
      finalized_at: expect.any(String),
      snapshots: 1,
      work_items: 1,
    });
    expect(provider.calls).toBe(2);
  });
});
describe('recording result transcript quality (CCC-124)', () => {
  function previewEnv(): ApiEnv {
    return {
      ...t.env,
      PREVIEW_MODE: 'true',
      PREVIEW_ACCESS_CODE: 'fixture-preview-code',
      TEXT_AI_PILOT_ENABLED: '1',
      EXTERNAL_AI_CALLS_ENABLED: '0',
    };
  }

  async function consentedRecording(submissionId: `${string}-${string}-${string}-${string}-${string}`) {
    const env = previewEnv();
    const { caseRecord, session } = await createUploadedRecording(submissionId);
    await recordPilotTextAiConsentEvidence(env, counselor, caseRecord.id, {
      noticeVersion: 'recording-result-e2e-v1',
      noticeSha256: 'a'.repeat(64),
      evidenceRef: 'fixture:recording-consent',
      evidenceSha256: 'b'.repeat(64),
      effectiveAt: '2020-01-01T00:00:00.000Z',
    });
    return { env, caseRecord, session };
  }

  async function storedQuality(sessionId: string): Promise<string | null> {
    const row = await t.db.prepare(
      'SELECT transcript_quality FROM recording_result_commits WHERE session_id = ?',
    ).bind(sessionId).first<{ transcript_quality: string | null }>();
    if (row === null) throw new Error('recording result commit is missing');
    return row.transcript_quality;
  }

  it('stores structured warnings and exposes them on the review draft endpoint', async () => {
    await t.reset();
    const { env, session } = await consentedRecording('95000000-0000-4000-8000-000000000124');
    const body = {
      ...(await recordingResultBody()),
      transcriptReliable: false,
      transcriptWarnings: [
        { startSeconds: 305.5, endSeconds: 512, reason: 'repetition' },
      ],
    };
    const response = await postResult(env, session.id, body);
    expect(response.status, await response.text()).toBe(204);

    const stored = await storedQuality(session.id);
    if (stored === null) throw new Error('transcript quality is missing');
    expect(JSON.parse(stored)).toEqual({
      transcriptReliable: false,
      warnings: [{ startSeconds: 305.5, endSeconds: 512, reason: 'repetition' }],
    });
    // R3: 구조화 컬럼에는 시간 구간·사유 코드만 담긴다 — 전사 내용이 새면 안 된다.
    expect(stored).not.toContain(MASKED_FIXTURE);

    const draft = await worker.fetch(new Request(
      `http://localhost/sessions/${session.id}/ai`,
      { headers: counselorHeaders },
    ), env);
    expect(draft.status).toBe(200);
    const draftBody = await draft.json<{ transcriptQuality: unknown }>();
    expect(draftBody.transcriptQuality).toEqual({
      transcriptReliable: false,
      warnings: [{ startSeconds: 305.5, endSeconds: 512, reason: 'repetition' }],
    });
  });

  it('stores a reliable verdict with an empty warning list', async () => {
    await t.reset();
    const { env, session } = await consentedRecording('95000000-0000-4000-8000-000000000125');
    const body = {
      ...(await recordingResultBody()),
      transcriptReliable: true,
      transcriptWarnings: [],
    };
    expect((await postResult(env, session.id, body)).status).toBe(204);
    const stored = await storedQuality(session.id);
    if (stored === null) throw new Error('transcript quality is missing');
    expect(JSON.parse(stored)).toEqual({ transcriptReliable: true, warnings: [] });
  });

  it('rejects malformed quality fields without committing', async () => {
    await t.reset();
    const { env, session } = await consentedRecording('95000000-0000-4000-8000-000000000127');
    const valid = await recordingResultBody();
    const withoutReliable = { ...valid };
    delete (withoutReliable as Record<string, unknown>).transcriptReliable;
    const withoutWarnings = { ...valid };
    delete (withoutWarnings as Record<string, unknown>).transcriptWarnings;
    const malformed: Array<Record<string, unknown>> = [
      // v2 는 두 필드를 생략할 수 없다(S5 §2.7).
      withoutReliable,
      withoutWarnings,
      { ...valid, transcriptReliable: 'false', transcriptWarnings: [] },
      // 구간이 뒤집히면 거부.
      {
        ...valid,
        transcriptReliable: false,
        transcriptWarnings: [{ startSeconds: 90, endSeconds: 30, reason: 'repetition' }],
      },
      // 사유는 고정 코드 형식만 — 자유 문장(전사 내용 유출 경로)은 거부(R3).
      {
        ...valid,
        transcriptReliable: false,
        transcriptWarnings: [{ startSeconds: 0, endSeconds: 5, reason: '같은 문장 반복 구간' }],
      },
      // 경고 항목에 여분 키(텍스트 등) 금지.
      {
        ...valid,
        transcriptReliable: false,
        transcriptWarnings: [{ startSeconds: 0, endSeconds: 5, reason: 'repetition', text: 'leak' }],
      },
    ];
    for (const body of malformed) {
      const response = await postResult(env, session.id, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const commits = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM recording_result_commits WHERE session_id = ?',
    ).bind(session.id).first<{ count: number }>();
    expect(commits?.count).toBe(0);
  });
});
