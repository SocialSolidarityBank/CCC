/**
 * `GET /capabilities` 재료 (S2 §2.8, E1-7).
 *
 * 서버가 믿는 설치 사실은 signed install manifest 하나다. mode, installationId, approved STT
 * registry 는 검증된 manifest 에서만 읽는다. manifest 가 없거나 검증에 실패하면 503 으로 닫는다.
 * 키는 존재 여부만 보고 값·이름·hash 는 응답과 로그에 싣지 않는다.
 */
import type { Actor } from '@ccc/core/gateway';
import { getAgentStatusForCapabilities, hasFreshSttReadiness, getInstalledAiPolicy } from '@ccc/core/gateway';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
import { verifySignedInstallManifest } from '@ccc/contracts/install-manifest';
import { type Actor as IdentityActor, type CapabilityManifest } from '@ccc/contracts/runtime';
import type { ApiEnv } from './identity';

export class CapabilitiesUnavailableError extends Error {}

function parseSigningKeys(raw: string | undefined): Record<string, string> {
  if (raw === undefined) throw new CapabilitiesUnavailableError('signing keys missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CapabilitiesUnavailableError('signing keys malformed');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || Object.values(parsed).some((value) => typeof value !== 'string')) {
    throw new CapabilitiesUnavailableError('signing keys malformed');
  }
  return parsed as Record<string, string>;
}

/**
 * 서버가 믿는 설치 사실 하나. 검증에 실패하면 이 값을 쓰는 모든 경로가 함께 닫힌다.
 * `GET /capabilities` 와 Agent claim 의 route·engine 판정이 같은 정본을 읽는다.
 */
export async function verifiedInstallManifest(env: Pick<ApiEnv, 'CCC_INSTALL_MANIFEST' | 'CCC_INSTALL_SIGNING_KEYS'>) {
  if (env.CCC_INSTALL_MANIFEST === undefined) throw new CapabilitiesUnavailableError('install manifest missing');
  let raw: unknown;
  try {
    raw = JSON.parse(env.CCC_INSTALL_MANIFEST);
  } catch {
    throw new CapabilitiesUnavailableError('install manifest malformed');
  }
  try {
    return await verifySignedInstallManifest(raw, {
      publicKeys: parseSigningKeys(env.CCC_INSTALL_SIGNING_KEYS),
      now: new Date(),
    });
  } catch (error) {
    throw new CapabilitiesUnavailableError(error instanceof Error ? error.message : 'install manifest invalid');
  }
}

export async function buildCapabilities(env: ApiEnv, actor: Actor | IdentityActor): Promise<{ manifest: CapabilityManifest; installationId: string }> {
  // Agent 는 403 (S2 §2.8). 사람 역할 판정보다 먼저라 manifest 유무를 Agent 에게 알리지 않는다.
  const agentStatus = await getAgentStatusForCapabilities(env, actor);
  const installManifest = await verifiedInstallManifest(env);
  if (actor.orgId === null) throw new CapabilitiesUnavailableError('organization unavailable');
  const localReady = await hasFreshSttReadiness(env, actor.orgId, 'local', 'qwen3-asr');
  const azureReady = await hasFreshSttReadiness(env, actor.orgId, 'azure', 'azure-speech-koreacentral');
  const policy = await getInstalledAiPolicy(env, actor);
  const llmKeyPresent = env.AI_PROVIDER_ADAPTER !== undefined || ((await env.secretStore.get('CODEX_API_KEY'))?.trim().length ?? 0) > 0;
  const manifest = buildCapabilityManifest({
    mode: installManifest.mode,
    requestedSttMode: policy.sttMode,
    requestedLlmMode: policy.llmMode,
    registry: installManifest.approvedSttEngineIds,
    sttGatePassed: {
      local: localReady && installManifest.approvedSttEngineIds.some(
        (entry) => entry.id === 'qwen3-asr' && entry.mode === 'local',
      ),
      azure: installManifest.approvedSttEngineIds.some(
        (entry) => entry.id === 'azure-speech-koreacentral' && entry.mode === 'azure',
      ),
    },
    // Agent readiness is accepted only after its live Azure preflight, never from env key presence.
    azureKeyPresent: azureReady,
    llmKeyPresent,
    llmGateOpen: env.TEXT_AI_PILOT_ENABLED === '1' && (env.EXTERNAL_AI_CALLS_ENABLED === '1' || env.AI_PROVIDER_ADAPTER !== undefined),
    agentStatus,
    publicSignupEnabled: env.PUBLIC_SIGNUP_ENABLED === '1',
  });
  return { manifest, installationId: installManifest.installationId };
}
