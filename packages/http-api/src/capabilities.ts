/**
 * `GET /capabilities` 재료 (S2 §2.8, E1-7).
 *
 * 서버가 믿는 설치 사실은 signed install manifest 하나다. mode, installationId, approved STT
 * registry 는 검증된 manifest 에서만 읽는다. manifest 가 없거나 검증에 실패하면 503 으로 닫는다.
 * 키는 존재 여부만 보고 값·이름·hash 는 응답과 로그에 싣지 않는다.
 */
import type { Actor } from '@ccc/core/gateway';
import { getAgentStatusForCapabilities } from '@ccc/core/gateway';
import { buildCapabilityManifest } from '@ccc/contracts/capabilities';
import { verifySignedInstallManifest } from '@ccc/contracts/install-manifest';
import { type CapabilityManifest, type LlmMode, LLM_MODES, STT_MODES, type SttMode } from '@ccc/contracts/runtime';
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

export async function buildCapabilities(env: ApiEnv, actor: Actor): Promise<{ manifest: CapabilityManifest; installationId: string }> {
  // Agent 는 403 (S2 §2.8). 사람 역할 판정보다 먼저라 manifest 유무를 Agent 에게 알리지 않는다.
  const agentStatus = await getAgentStatusForCapabilities(env, actor);
  if (env.CCC_INSTALL_MANIFEST === undefined) throw new CapabilitiesUnavailableError('install manifest missing');
  let raw: unknown;
  try {
    raw = JSON.parse(env.CCC_INSTALL_MANIFEST);
  } catch {
    throw new CapabilitiesUnavailableError('install manifest malformed');
  }
  let installManifest;
  try {
    installManifest = await verifySignedInstallManifest(raw, { publicKeys: parseSigningKeys(env.CCC_INSTALL_SIGNING_KEYS), now: new Date() });
  } catch (error) {
    throw new CapabilitiesUnavailableError(error instanceof Error ? error.message : 'install manifest invalid');
  }
  const requestedStt = env.CCC_STT_MODE ?? 'off';
  const requestedLlm = env.CCC_LLM_MODE ?? 'off';
  const llmKeyPresent = (env.CODEX_API_KEY?.trim().length ?? 0) > 0 || env.AI_PROVIDER_ADAPTER !== undefined;
  const manifest = buildCapabilityManifest({
    mode: installManifest.mode,
    requestedSttMode: STT_MODES.includes(requestedStt as SttMode) ? requestedStt as SttMode : 'off',
    requestedLlmMode: LLM_MODES.includes(requestedLlm as LlmMode) ? requestedLlm as LlmMode : 'off',
    registry: installManifest.approvedSttEngineIds,
    // Q 승인 사실은 signed registry 로만 서버에 닿는다. gate 만 지나고 entry 가 없는 상태를 따로 실어
    // 나르는 signed 필드는 아직 없어 entry 존재를 gate 통과로 읽는다. 그 필드가 생기면 여기만 바꾼다.
    sttGatePassed: {
      local: installManifest.approvedSttEngineIds.some((entry) => entry.mode === 'local'),
      azure: installManifest.approvedSttEngineIds.some((entry) => entry.mode === 'azure'),
    },
    // Azure 자격은 Python Agent 의 SecretStore 에만 있다(계획 129행, S9). Agent 가 존재 여부를
    // 보고하는 경로(E5-3/E9-2)가 붙기 전까지 서버는 없음으로 본다.
    azureKeyPresent: false,
    llmKeyPresent,
    llmGateOpen: env.TEXT_AI_PILOT_ENABLED === '1' && (env.EXTERNAL_AI_CALLS_ENABLED === '1' || env.AI_PROVIDER_ADAPTER !== undefined),
    agentStatus,
    publicSignupEnabled: env.PUBLIC_SIGNUP_ENABLED === '1',
  });
  return { manifest, installationId: installManifest.installationId };
}
