// S5 contract fixtures use synthetic identifiers, text and generated WAV bytes only; no real PII or recordings.
import { expect } from 'vitest';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import {
  admitRecordingUpload,
  appendSupportCaseConsentEvent,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  recordSttReadiness,
  registerRecording,
  type Actor,
  type AgentRuntime,
} from '@ccc/core/gateway';
import type { AgentJob, CheckedTextSource, NerAttestation, ResultRequest, SourceResponse } from '@ccc/contracts/agent-jobs';
import type { DeploymentMode } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';
import worker from './local-worker';
import { createTestSigner, signedManifest, SYNTHETIC_AZURE_REGISTRY, SYNTHETIC_LOCAL_REGISTRY } from './install-manifest';

const TEST_MASKING_PIPELINE_MANIFEST = {
  schemaVersion: 2,
  resultSchemaVersion: 2,
  maskingPipelineVersion: 'ner-mask-v1-addr-cond-dict',
  directIdentifierRulesVersion: 'direct-v1',
  regexRulesVersion: 'regex-v2',
  conditionDictionaryVersion: 'condition-dict-v1',
  quasiIdentifierRulesVersion: 'quasi-v1',
  g7RelativeDateRulesVersion: 'calendar-day-v1',
  nerModelId: 'FrameByFrame/korean-pii-e5-base',
  nerModelRevision: 'a'.repeat(40),
  personLabels: ['PRIVATE_PERSON'],
  addressLabels: ['PRIVATE_ADDRESS'],
  conditionNerModelId: null,
  conditionNerModelRevision: null,
  conditionLabels: [],
  labelSetHash: 'b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc',
  nerHealthCorpusHash: 'b'.repeat(64),
  nerHealthResultHash: 'c'.repeat(64),
} as const;

async function testMaskingPipelineHash(): Promise<string> {
  return sha256Hex(canonicalizeJcs(TEST_MASKING_PIPELINE_MANIFEST));
}

/** schemaVersion 1 registry JSON — claim/result 경로가 요구하는 활성 manifest 등록 형태. */
export async function testMaskingPipelineRegistry(): Promise<string> {
  const maskingPipelineHash = await testMaskingPipelineHash();
  return JSON.stringify({
    schemaVersion: 1,
    activeMaskingPipelineVersion: TEST_MASKING_PIPELINE_MANIFEST.maskingPipelineVersion,
    pipelines: [{ ...TEST_MASKING_PIPELINE_MANIFEST, maskingPipelineHash }],
  });
}
/** Local 두 모드의 런타임. Community Cloud 는 modes 테스트가 따로 만든다. */
export const LOCAL_SINGLE_RUNTIME: AgentRuntime = {
  route: 'local-single-agent',
  sttEngine: 'local',
  sttEngineId: 'qwen3-asr',
  audioDelivery: 'api-stream',
};

/** Azure 승인 엔진 런타임 — resolveAgentRuntime 이 내는 것과 같은 protected-get 전달. */
export const AZURE_CLOUD_RUNTIME: AgentRuntime = {
  route: 'community-cloud-agent',
  sttEngine: 'azure',
  sttEngineId: 'azure-speech-koreacentral',
  audioDelivery: 'protected-get',
};

/**
 * 텍스트 전용 장비 런타임. engine 이 `null` 이라 오디오 작업은 claim 후보에서 빠진다 —
 * 설치 manifest 없이 gateway 를 직접 부르는 테스트가 쓴다.
 */
export const TEXT_ONLY_RUNTIME: AgentRuntime = {
  route: 'local-single-agent',
  sttEngine: null,
  sttEngineId: null,
  audioDelivery: 'api-stream',
};

export async function sha256Hex(value: string): Promise<string> {

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function seedCanonicalSttConsent(
  env: ApiEnv,
  actor: Actor,
  supportCaseId: string,
  domains: Array<
    | 'personal_data_collection_use'
    | 'sensitive_information_processing'
    | 'counseling_recording'
    | 'external_stt_processing'
    | 'external_llm_cross_border_processing'
  > = [
    'personal_data_collection_use', 'sensitive_information_processing', 'counseling_recording',
    'external_stt_processing', 'external_llm_cross_border_processing',
  ],
): Promise<void> {
  env.CCC_KR_BUSINESS_CALENDAR = JSON.stringify({
    version: 'kr-business-days-v1',
    validFrom: '2025-01-01',
    validUntil: '2030-12-31',
    closedDates: [],
  });
  for (const [provider, recipient, country] of [
    ['institution', 'Synthetic Institution', 'KR'],
    ['institution_recording', 'Synthetic Institution Recording', 'KR'],
    ['institution_private_storage', 'Synthetic Institution Storage', 'KR'],
    ['azure', 'Synthetic Azure Recipient', 'KR'],
    ['openai', 'Synthetic OpenAI Recipient', 'US'],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO consent_provider_registry_snapshots(
         id,org_id,provider,legal_recipient,country,approved_at
       ) VALUES(?,?,?,?,?,?) ON CONFLICT(org_id,provider,approved_at) DO NOTHING`,
    ).bind(`fixture-registry-${actor.orgId}-${provider}`, actor.orgId, provider, recipient, country, '2025-01-01T00:00:00.000Z').run();
  }
  const current = await getSupportCaseConsent(env, actor, supportCaseId);
  const disclosures = await issueSupportCaseConsentDisclosures(env, actor, supportCaseId);
  for (const domain of domains) {
    if (current.find((item) => item.domain === domain)?.state === 'granted') continue;
    const disclosure = disclosures.find((item) => item.domain === domain);
    if (disclosure === undefined) throw new Error('missing consent disclosure fixture');
    await appendSupportCaseConsentEvent(env, actor, supportCaseId, {
      domain,
      decision: 'grant',
      provider: disclosure.provider,
      providerLegalRecipient: disclosure.providerLegalRecipient,
      providerCountry: disclosure.country,
      purpose: disclosure.purpose,
      retentionDuration: null,
      copyVersion: disclosure.copyVersion,
      copyHash: disclosure.copyHash,
      disclosureSnapshotId: disclosure.snapshotId,
      effectiveAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      correctionOfEventId: null,
      expectedRevision: null,
    });
  }
}

export async function registerFixtureRecording(
  env: ApiEnv,
  actor: Actor,
  service: Actor,
  sessionId: string,
  runtime: AgentRuntime = AZURE_CLOUD_RUNTIME,
  key = `audio/${sessionId}/${crypto.randomUUID()}`,
  overrides: { clientAssertedSha256?: string | null; storageSha256?: string | null } = {},
): Promise<{ key: string; sha256: string; generationId: string }> {
  if (env.audioStore === null) throw new Error('fixture audio storage unavailable');
  const scope = await env.DB.prepare(
    'SELECT support_case_id FROM sessions WHERE id=? AND org_id=?',
  ).bind(sessionId, actor.orgId).first<{ support_case_id: string }>();
  if (scope === null) throw new Error('missing session fixture');
  await seedCanonicalSttConsent(env, actor, scope.support_case_id);
  await recordSttReadiness(env, service, runtime.sttEngine === 'azure' ? {
    schemaVersion: 1, sttMode: 'azure', sttEngineId: 'azure-speech-koreacentral', state: 'ready', capacity: 1,
  } : {
    schemaVersion: 1, sttMode: 'local', sttEngineId: 'qwen3-asr', state: 'ready', capacity: 1,
  });
  const admission = await admitRecordingUpload(env, actor, sessionId, runtime);
  const audio = Buffer.alloc(364);
  audio.write('RIFF', 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16_000, 24);
  audio.writeUInt32LE(32_000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write('data', 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  const uploadExpiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  const stored = await env.audioStore.put(key, new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(audio); controller.close(); },
  }), { contentLength: audio.length, contentType: 'audio/wav', expiresAt: uploadExpiresAt });
  await registerRecording(env, actor, sessionId, key, admission, {
    contentLength: audio.length,
    contentType: 'audio/wav',
    clientAssertedSha256: overrides.clientAssertedSha256 ?? null,
    storageSha256: overrides.storageSha256 === undefined ? stored.sha256 : overrides.storageSha256,
    generationId: stored.generationId,
    uploadExpiresAt,
  }, null);
  await env.DB.prepare(
    `UPDATE audio_objects SET eligible_after=? WHERE org_id=? AND session_id=?`,
  ).bind(new Date(Date.now() - 1000).toISOString(), actor.orgId, sessionId).run();
  return { key, sha256: stored.sha256, generationId: stored.generationId };
}

export interface NerQualification {
  receiptId: string;
  attestation: NerAttestation;
}

/** E5-4 가 발급할 immutable 영수증을 테스트에서 미리 심는다. */
export async function seedNerQualification(
  db: D1Database,
  options: { orgId?: string; expiresAt?: string } = {},
): Promise<NerQualification> {
  const orgId = options.orgId ?? 'org_demo';
  const receiptId = `receipt-${crypto.randomUUID()}`;
  const attestation: NerAttestation = {
    id: `attestation-${crypto.randomUUID()}`,
    modelId: 'FrameByFrame/korean-pii-e5-base',
    modelRevision: 'a'.repeat(40),
    labelSetHash: 'b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc',
    corpusHash: 'b'.repeat(64),
    resultHash: 'c'.repeat(64),
    validatedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: options.expiresAt ?? '2099-01-01T00:00:00.000Z',
    status: 'passed',
  };
  await db.prepare(
    `INSERT INTO ner_release_qualification_receipts (
       id, org_id, model_id, model_revision, label_set_hash, corpus_hash, result_hash,
       validated_at, expires_at, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', ?)`,
  ).bind(
    receiptId,
    orgId,
    attestation.modelId,
    attestation.modelRevision,
    attestation.labelSetHash,
    attestation.corpusHash,
    attestation.resultHash,
    attestation.validatedAt,
    attestation.expiresAt,
    attestation.validatedAt,
  ).run();
  return { receiptId, attestation };
}

export function claimRequest(qualification: NerQualification, limit?: number) {
  return {
    ...(limit === undefined ? {} : { limit }),
    nerAttestation: qualification.attestation,
    releaseQualificationReceiptId: qualification.receiptId,
  };
}

export interface AgentResultOptions {
  kind: 'audio' | 'text';
  claimToken: string;
  attempt: number;
  maskedText: string;
  qualification: NerQualification;
  resultId?: string;
  maskingPipelineVersion?: string;
  maskingPipelineHash?: string;
  emotionScores?: Record<string, unknown>;
  transcriptReliable?: boolean;
  checkedSource?: CheckedTextSource;
}

/** Agent 가 만드는 결과 payload. hash 3종을 계약대로 계산한다. */
export async function agentResultRequest(options: AgentResultOptions): Promise<ResultRequest> {
  const sha256 = await sha256Hex(options.maskedText);
  const evidence = [{
    id: `evidence-${crypto.randomUUID()}`,
    sourceRef: `${options.kind}:fixture`,
    sourceSha256: sha256,
    evidenceQuote: options.maskedText,
    sourceStart: 0,
    sourceEnd: [...options.maskedText].length,
  }];
  const defaultMaskingPipelineHash = await testMaskingPipelineHash();
  const masked = {
    maskedText: options.maskedText,
    sha256,
    maskingPipelineVersion: options.maskingPipelineVersion ?? TEST_MASKING_PIPELINE_MANIFEST.maskingPipelineVersion,
    maskingPipelineHash: options.maskingPipelineHash ?? defaultMaskingPipelineHash,
    nerAvailable: true as const,
    nerAttestationId: options.qualification.attestation.id,
    nerAttestationResultHash: options.qualification.attestation.resultHash,
    releaseQualificationReceiptId: options.qualification.receiptId,
    evidenceHash: await sha256Hex(canonicalizeJcs(evidence)),
    evidence,
  };
  const result = options.kind === 'audio'
    ? {
      ...masked,
      kind: 'audio' as const,
      emotionScores: options.emotionScores ?? {},
      transcriptReliable: options.transcriptReliable ?? true,
      transcriptWarnings: [],
    }
    : { ...masked, kind: 'text' as const,
      ...(options.checkedSource === undefined ? {} : { checkedSource: options.checkedSource }) };
  return {
    schemaVersion: 2,
    claimToken: options.claimToken,
    attempt: options.attempt,
    resultId: options.resultId ?? `result-${crypto.randomUUID()}`,
    payloadSha256: await sha256Hex(canonicalizeJcs({ schemaVersion: 2, attempt: options.attempt, result })),
    result,
  };
}


/**
 * Agent claim 이 route·engine 을 읽는 서명된 설치 사실을 env 에 붙인다. `stt: 'off'`
 * 이면 engine 이 `null` 이라 오디오 작업은 claim 되지 않는다(텍스트 전용 장비 흉내).
 */
export async function agentManifestEnv<T extends ApiEnv>(
  env: T,
  options: { mode?: DeploymentMode; stt?: 'off' | 'local' | 'azure' } = {},
): Promise<T> {
  const signer = await createTestSigner();
  // verifiedInstallManifest 는 community-cloud manifest 만 받는다 — 기본을 그에 맞춘다.
  const manifest = await signedManifest(signer, options.mode ?? 'community-cloud', {
    approvedSttEngineIds: options.stt === 'azure' ? SYNTHETIC_AZURE_REGISTRY : SYNTHETIC_LOCAL_REGISTRY,
  });
  return {
    ...env,
    MEMORY_MASKING_PIPELINES: await testMaskingPipelineRegistry(),
    CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
    CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys),
    CCC_STT_MODE: options.stt ?? 'off',
  };
}

export const AGENT_SERVICE_HEADERS = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'service@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'service',
};

/** HTTP claim 1회. 응답 job 목록과 그 claim 이 쓴 NER 자격을 함께 돌려준다. */
export async function claimOverHttp(
  env: ApiEnv,
  db: D1Database,
  headers: Record<string, string> = AGENT_SERVICE_HEADERS,
  reuse?: NerQualification,
): Promise<{ jobs: AgentJob[]; qualification: NerQualification }> {
  const qualification = reuse
    ?? await seedNerQualification(db, { orgId: headers['X-CCC-Org-Id'] ?? 'org_demo' });
  const response = await worker.fetch(new Request('http://localhost/pipeline/jobs/claim', {
    method: 'POST',
    headers,
    body: JSON.stringify(claimRequest(qualification)),
  }), env);
  expect(response.status, await response.clone().text()).toBe(200);
  const claimed = await response.json() as { jobs: AgentJob[] };
  return { jobs: claimed.jobs, qualification };
}

/**
 * 처리 장비 흉내 (S5) — claim 한 텍스트 작업마다 원문을 받아 2차 마스킹 결과를 제출한다.
 * 결과 라우트가 불일치 재검출을 돌리므로 gateway 직접 호출이 아니라 HTTP 를 쓴다.
 */
export async function runAgentTextJobs(
  env: ApiEnv,
  db: D1Database,
  options: { mask?: (text: string) => string; headers?: Record<string, string> } = {},
): Promise<number> {
  const headers = options.headers ?? AGENT_SERVICE_HEADERS;
  const mask = options.mask ?? ((text: string) => text);
  const { jobs, qualification } = await claimOverHttp(env, db, headers);
  let processed = 0;
  for (const job of jobs.filter((candidate) => candidate.kind === 'text')) {
    const sourceResponse = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${job.jobId}/source`, {
      headers: { ...headers, 'X-CCC-Job-Claim': job.claimToken, 'X-CCC-Job-Attempt': String(job.attempt) },
    }), env);
    if (sourceResponse.status !== 200) throw new Error(`job source failed: ${sourceResponse.status}`);
    const source = await sourceResponse.json() as SourceResponse;
    const masked = mask(source.text);
    const response = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${job.jobId}/result`, {
      method: 'POST',
      headers,
      body: JSON.stringify(await agentResultRequest({
        kind: 'text',
        claimToken: job.claimToken,
        attempt: job.attempt,
        maskedText: masked.trim().length === 0 ? 'MASKED_SOURCE_BASELINE' : masked,
        qualification,
        checkedSource: { sourceRevision: source.sourceRevision, sourceSha256: source.sourceSha256,
          sourceStart: 0, sourceEnd: source.sourceLength },
      })),
    }), env);
    if (response.status !== 204) {
      throw new Error(`job result failed: ${response.status} ${await response.text()}`);
    }
    processed += 1;
  }
  return processed;
}