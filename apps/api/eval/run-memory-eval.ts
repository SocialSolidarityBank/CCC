import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { resolveAiProviderAdapter, validateMemoryGenerationRequest, type AiProviderAdapter } from '@ccc/ai-runtime';
import { MEMORY_EVAL_CASES } from './memory-eval-cases.ts';
import { aggregateMemoryEvalOutcomes, scoreMemoryEvalCase, type MemoryEvalOutcome } from './memory-eval-core.ts';

const usage = 'Usage: pnpm --filter @ccc/api eval:memory --fixtures | --live --allow-external-ai';
const args = process.argv.slice(2).filter((argument, index) => argument !== '--' || index !== 0);

async function main() {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    console.log(usage);
    return;
  }
  const fixtures = args.length === 1 && args[0] === '--fixtures';
  const live = args.length === 2 && args.includes('--live') && args.includes('--allow-external-ai');
  if (!fixtures && !live) {
    console.error('memory_eval_arguments_invalid');
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  let adapter: AiProviderAdapter | undefined;
  if (live) {
    try {
      ({ adapter } = await resolveAiProviderAdapter({
        AI_PROVIDER_CONFIG: process.env.AI_PROVIDER_CONFIG,
        EXTERNAL_AI_CALLS_ENABLED: process.env.EXTERNAL_AI_CALLS_ENABLED,
        secretStore: createEnvironmentSecretStore(process.env),
      }));
      if (!adapter.updateMemory) throw new Error('unsupported');
    } catch {
      console.error('memory_eval_provider_unavailable');
      process.exitCode = 1;
      return;
    }
  }
  let callFailures = 0;
  const outcomes: MemoryEvalOutcome[] = [];
  for (const case_ of MEMORY_EVAL_CASES) {
    let output: unknown;
    try {
      // The live benchmark accepts only this fixed synthetic corpus, never user files.
      output = fixtures ? case_.expectedOutput : await adapter!.updateMemory!(validateMemoryGenerationRequest(case_.request));
    } catch {
      callFailures += 1;
    }
    outcomes.push(scoreMemoryEvalCase(case_, output));
  }
  const report = aggregateMemoryEvalOutcomes(outcomes);
  console.log(JSON.stringify({ mode: fixtures ? 'scorer_selfcheck' : 'synthetic_model_benchmark',
    applicationEgressVerified: false, callFailures, ...report }, null, 2));
  if (callFailures || report.safety.failed || report.deterministic.failed) process.exitCode = 1;
}

await main();
