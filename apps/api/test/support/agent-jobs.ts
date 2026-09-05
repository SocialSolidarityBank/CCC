// S5 계약 테스트 공용 픽스처. 합성 ID·텍스트만 쓰고 실제 PII·오디오는 넣지 않는다.
import { expect } from 'vitest';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import type { AgentRuntime } from '@ccc/core/gateway';
import type { AgentJob, NerAttestation, ResultRequest } from '@ccc/contracts/agent-jobs';
import type { DeploymentMode } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';
import worker from './local-worker';
import { createTestSigner, signedManifest, SYNTHETIC_LOCAL_REGISTRY } from './install-manifest';

/** Local 두 모드의 런타임. Community Cloud 는 modes 테스트가 따로 만든다. */
export const LOCAL_SINGLE_RUNTIME: AgentRuntime = {
  route: 'local-single-agent',
  sttEngine: 'local',
  audioDelivery: 'api-stream',
};

/**
 * 텍스트 전용 장비 런타임. engine 이 `null` 이라 오디오 작업은 claim 후보에서 빠진다 —
 * 설치 manifest 없이 gateway 를 직접 부르는 테스트가 쓴다.
 */
export const TEXT_ONLY_RUNTIME: AgentRuntime = {
  route: 'local-single-agent',
  sttEngine: null,
  audioDelivery: 'api-stream',
};

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
    modelRevision: 'fixture-rev-1',
    labelSetHash: 'a'.repeat(64),
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
  emotionScores?: Record<string, unknown>;
  transcriptReliable?: boolean;
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
  const masked = {
    maskedText: options.maskedText,
    sha256,
    maskingPipelineVersion: options.maskingPipelineVersion ?? 'ner-mask-v1-addr-cond-dict',
    maskingPipelineHash: 'd'.repeat(64),
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
    : { ...masked, kind: 'text' as const };
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
export async function agentManifestEnv(
  env: ApiEnv,
  options: { mode?: DeploymentMode; stt?: 'off' | 'local' } = {},
): Promise<ApiEnv> {
  const signer = await createTestSigner();
  const manifest = await signedManifest(signer, options.mode ?? 'local-single', {
    approvedSttEngineIds: SYNTHETIC_LOCAL_REGISTRY,
  });
  return {
    ...env,
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
  expect(response.status).toBe(200);
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
    const { text } = await sourceResponse.json() as { text: string };
    const masked = mask(text);
    const response = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${job.jobId}/result`, {
      method: 'POST',
      headers,
      body: JSON.stringify(await agentResultRequest({
        kind: 'text',
        claimToken: job.claimToken,
        attempt: job.attempt,
        maskedText: masked.trim().length === 0 ? 'MASKED_SOURCE_BASELINE' : masked,
        qualification,
      })),
    }), env);
    if (response.status !== 204) {
      throw new Error(`job result failed: ${response.status} ${await response.text()}`);
    }
    processed += 1;
  }
  return processed;
}