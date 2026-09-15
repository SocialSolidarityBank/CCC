// S5 F8 — 세 모드의 route·오디오 전달, 사람과 service 자격 경계, v1 경로 제거,
// 구조화 v2 결과에 대한 generic 400 이 legacy payload 재전송을 만들지 않는지 고정한다.
import { describe, expect, it, vi } from 'vitest';
import worker from './support/local-worker';
import type { DeploymentMode } from '@ccc/contracts/runtime';
import {
  recordSttReadiness,
} from '@ccc/core/gateway';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, type TestApiEnv } from './support/d1';
import {
  claimRequest,
  seedNerQualification,
} from './support/agent-jobs';
import {
  createTestSigner,
  signedManifest,
  SYNTHETIC_AZURE_REGISTRY,
  SYNTHETIC_LOCAL_REGISTRY,
} from './support/install-manifest';

vi.setConfig({ testTimeout: 60_000 });

const t = setupD1();
const { counselor, service } = testActors;

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

async function envForMode(mode: DeploymentMode): Promise<TestApiEnv> {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
    deploymentMode: mode,
    sttMode: 'local',
    llmMode: 'openai',
  });
  const signer = await createTestSigner();
  const manifest = await signedManifest(signer, mode, { approvedSttEngineIds: SYNTHETIC_LOCAL_REGISTRY });
  return {
    ...t.env,
    installationMode: mode,
    TEXT_AI_PILOT_ENABLED: '1',
    CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
    CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys),
    CCC_STT_MODE: 'local',
    CCC_LLM_MODE: 'openai',
  };
}

async function claim(env: TestApiEnv) {
  const qualification = await seedNerQualification(t.db);
  return worker.fetch(new Request('http://localhost/pipeline/jobs/claim', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(claimRequest(qualification)),
  }), env);
}

describe('release STT server boundary', () => {
  it.each(['local-single', 'local-office'] as const)('rejects the %s install mode before readiness, claim, and audio delivery', async (mode) => {
    await t.reset();
    const env = await envForMode(mode);
    const readiness = await worker.fetch(new Request('http://localhost/pipeline/readiness', {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        schemaVersion: 1,
        sttMode: 'local',
        sttEngineId: 'qwen3-asr',
        state: 'ready',
        capacity: 1,
      }),
    }), env);
    expect(readiness.status).toBe(503);
    expect((await claim(env)).status).toBe(503);
    const audio = await worker.fetch(new Request(
      'http://localhost/pipeline/jobs/00000000-0000-4000-8000-000000000001/audio',
      { headers: { ...serviceHeaders, 'X-CCC-Job-Claim': 'f'.repeat(64), 'X-CCC-Job-Attempt': '1' } },
    ), env);
    expect(audio.status).toBe(503);
  });

  it('does not advertise or accept local STT in Community Cloud', async () => {
    await t.reset();
    const env = await envForMode('community-cloud');
    const capabilities = await worker.fetch(new Request('http://localhost/capabilities', {
      headers: counselorHeaders,
    }), env);
    expect(capabilities.status).toBe(200);
    const body = await capabilities.json() as { sttMode: string; sttEngine: string | null; sttOptions: Array<{ mode: string }> };
    expect(body.sttMode).toBe('off');
    expect(body.sttEngine).toBeNull();
    expect(body.sttOptions.map((option) => option.mode)).toEqual(['off', 'azure']);
    expect(JSON.stringify(body)).not.toContain('qwen3-asr');

    const readiness = await worker.fetch(new Request('http://localhost/pipeline/readiness', {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        schemaVersion: 1,
        sttMode: 'local',
        sttEngineId: 'qwen3-asr',
        state: 'ready',
        capacity: 1,
      }),
    }), env);
    expect(readiness.status).toBe(404);
    expect((await claim(env)).status).toBe(503);
  });

  it('keeps Azure readiness and job claim available in Community Cloud', async () => {
    await t.reset();
    await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
      deploymentMode: 'community-cloud',
      sttMode: 'azure',
      llmMode: 'off',
    });
    const signer = await createTestSigner();
    const manifest = await signedManifest(signer, 'community-cloud', {
      approvedSttEngineIds: SYNTHETIC_AZURE_REGISTRY,
    });
    const env: TestApiEnv = {
      ...t.env,
      installationMode: 'community-cloud',
      CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
      CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys),
      CCC_STT_MODE: 'azure',
      CCC_LLM_MODE: 'off',
    };
    await recordSttReadiness(env, service, {
      schemaVersion: 1,
      sttMode: 'azure',
      sttEngineId: 'azure-speech-koreacentral',
      state: 'ready',
      capacity: 1,
    });
    const capabilities = await worker.fetch(new Request('http://localhost/capabilities', {
      headers: counselorHeaders,
    }), env);
    expect(capabilities.status).toBe(200);
    const capabilityBody = await capabilities.json() as {
      sttOptions: Array<{ mode: string }>;
    };
    expect(capabilityBody.sttOptions.map((option) => option.mode)).toEqual(['off', 'azure']);
    const response = await claim(env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ schemaVersion: 2, jobs: [] });
  });
});
