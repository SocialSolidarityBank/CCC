import {
  AiProviderInputError,
  AiProviderProhibitedOutputError,
  AiProviderUnavailableError,
  canonicalAiProviderConfigHash,
  resolveAiProviderAdapter,
  validateMemoryGenerationOutput,
  validateMemoryGenerationRequest,
} from '@ccc/ai-runtime';
import {
  beginCounselingMemoryEgress,
  commitCounselingMemoryWork,
  ConflictError,
  failCounselingMemoryWork,
  prepareCounselingMemoryWork,
} from '@ccc/core/gateway';
import type { ApiEnv } from './identity';

const MEMORY_FAILURE_CODES: Readonly<Record<string, true>> = {
  masking_snapshot_missing: true,
  local_ner_unavailable: true,
  registered_pii_detected: true,
  unmasked_identifier_detected: true,
  evidence_hash_mismatch: true,
  masking_pipeline_version_mismatch: true,
  consent_not_effective: true,
  memory_work_superseded: true,
  memory_disabled: true,
  memory_provider_unsupported: true,
};

function failureCode(error: unknown): string {
  if (error instanceof ConflictError) return 'memory_work_superseded';
  if (error instanceof AiProviderUnavailableError) return 'ai_provider_unavailable';
  if (error instanceof AiProviderInputError) return 'invalid_memory_materials';
  if (error instanceof AiProviderProhibitedOutputError) return 'invalid_memory_output';
  if (error instanceof Error && Object.hasOwn(MEMORY_FAILURE_CODES, error.message)) return error.message;
  return 'memory_update_failed';
}

/** A bounded scheduled drain. Source collection and leases are owned by the gateway. */
export async function runCounselingMemory(env: ApiEnv): Promise<Record<string, number>> {
  const jobs = await prepareCounselingMemoryWork(env, 2);
  const counters = { claimed: jobs.length, updated: 0, failed: 0, superseded: 0 };
  for (const job of jobs) {
    try {
      const { adapter, config } = await resolveAiProviderAdapter(env);
      if (adapter.updateMemory === undefined) throw new Error('memory_provider_unsupported');
      const configHash = await canonicalAiProviderConfigHash(config);
      // Re-read consent, source revisions, masking qualification and the lease at egress.
      const request = validateMemoryGenerationRequest(await beginCounselingMemoryEgress(env, job, configHash));
      const output = validateMemoryGenerationOutput(await adapter.updateMemory(request), request);
      // The gateway independently validates and commits against the leased generation.
      await commitCounselingMemoryWork(env, job, output);
      counters.updated += 1;
    } catch (error) {
      const code = failureCode(error);
      await failCounselingMemoryWork(env, job, code);
      if (code === 'memory_work_superseded') counters.superseded += 1;
      else counters.failed += 1;
    }
  }
  return counters;
}
