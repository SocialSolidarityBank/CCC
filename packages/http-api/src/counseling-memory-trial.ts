import { canonicalAiProviderConfigHash, resolveAiProviderAdapter, AiProviderUnavailableError } from '@ccc/ai-runtime';
import { getActiveAiProviderStatus, getCounselingMemoryTrialState, type Actor } from '@ccc/core/gateway';
import type { ApiEnv } from './identity';
import { previewModeEnabled } from './preview-gate';

/** This control is absent unless the existing synthetic preview/local boundary is active. */
export function memoryTrialEnabled(env: ApiEnv): boolean {
  return previewModeEnabled(env) || (env.LOCAL_ACTOR_HEADER_MODE === 'true'
    && !env.ACCESS_TEAM_DOMAIN?.trim() && !env.ACCESS_AUD?.trim());
}

export async function memoryTrialReadiness(env: ApiEnv, actor: Actor, supportCaseId: string) {
  const state = await getCounselingMemoryTrialState(env, actor, supportCaseId);
  const active = await getActiveAiProviderStatus(env, actor);
  const blockers = state.blockers;
  if (!active.enabled) blockers.push('ai_provider_not_configured');
  let providerMode: 'unavailable' | 'fixture' | 'openai' = 'unavailable';
  try {
    // Resolving reads SecretStore and configuration, but makes no provider request.
    const { adapter, config } = await resolveAiProviderAdapter(env);
    if (!adapter.updateMemory) blockers.push('memory_provider_unsupported');
    if (active.enabled && (active.configHash !== await canonicalAiProviderConfigHash(config)
      || active.adapterId !== adapter.providerId || active.adapterVersion !== adapter.adapterVersion)) {
      blockers.push('ai_provider_config_mismatch');
    }
    providerMode = env.AI_PROVIDER_ADAPTER === undefined ? 'openai' : 'fixture';
  } catch (error) {
    if (!(error instanceof AiProviderUnavailableError)) throw error;
    blockers.push('ai_provider_unavailable');
  }
  return { ...state, ready: blockers.length === 0, providerMode,
    draftMode: previewModeEnabled(env) ? 'fixture' as const : providerMode };
}
