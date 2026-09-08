export {};

const usage = 'Usage: pnpm --filter @ccc/api memory:trial check <case-uuid> | step <case-uuid> --allow-external-ai';
const args = process.argv.slice(2).filter((argument, index) => argument !== '--' || index !== 0);
const blockerCodes = new Set(['memory_setting_off', 'memory_disabled', 'consent_not_effective', 'agent_unavailable',
  'local_ner_unavailable', 'masking_pipeline_version_mismatch', 'ai_provider_not_configured', 'memory_provider_unsupported', 'ai_provider_config_mismatch', 'ai_provider_unavailable']);
const statusCodes = new Set(['backfill', 'updating', 'ready', 'blocked', 'failed', 'off', 'closed', 'unavailable']);
const providerModes = new Set(['unavailable', 'fixture', 'openai']);
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid_response');
  return value;
}
function label(value: unknown, allowed: Set<string>): string {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error('invalid_response');
  return value;
}

async function main() {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) { console.log(usage); return; }
  const [command, caseId] = args;
  if (!caseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)
    || !((command === 'check' && args.length === 2)
      || (command === 'step' && args.length === 3 && args[2] === '--allow-external-ai'))) {
    console.error('memory_trial_arguments_invalid'); console.error(usage); process.exitCode = 2; return;
  }
  try {
    const origin = new URL(process.env.CCC_MEMORY_API_ORIGIN ?? 'http://127.0.0.1:8787');
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
      || !(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) {
      throw new Error('invalid_origin');
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const code = process.env.CCC_MEMORY_PREVIEW_CODE;
    const token = process.env.CCC_MEMORY_API_TOKEN;
    if (code && token) throw new Error('ambiguous_authentication');
    if (token) headers.authorization = `Bearer ${token}`;
    if (code) {
      const unlocked = await fetch(new URL('/preview/unlock', origin), { method: 'POST',
        headers, body: JSON.stringify({ code }), redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!unlocked.ok) throw new Error('authentication_failed');
      const session = record(await unlocked.json());
      if (typeof session.token !== 'string' || !/^[A-Za-z0-9._-]+$/.test(session.token)) throw new Error('invalid_response');
      headers.cookie = `ccc_preview=${session.token}`;
    }
    const response = await fetch(new URL(`/support-cases/${caseId}/memory/trial`, origin), {
      method: command === 'step' ? 'POST' : 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(120_000),
      ...(command === 'step' ? { body: JSON.stringify({ confirmExternalAi: true }) } : {}),
    });
    if (!response.ok && response.status !== 409) {
      console.error(`memory_trial_http_${response.status}`); process.exitCode = 1; return;
    }
    const state = record(await response.json());
    if (typeof state.ready !== 'boolean' || typeof state.backfillDone !== 'boolean' || !Array.isArray(state.blockers)) throw new Error('invalid_response');
    const counters = state.counters === undefined ? undefined : record(state.counters);
    // Only allowlisted metadata is printed. Never forward response/error bodies.
    const report = {
      ready: state.ready, status: label(state.status, statusCodes),
      providerMode: label(state.providerMode, providerModes), draftMode: label(state.draftMode, providerModes),
      generation: count(state.generation), appliedGeneration: count(state.appliedGeneration), revision: count(state.revision),
      backfillDone: state.backfillDone, dirtySources: count(state.dirtySources), pendingMasks: count(state.pendingMasks), itemCount: count(state.itemCount),
      blockers: state.blockers.map(value => label(value, blockerCodes)),
      ...(counters ? { counters: { claimed: count(counters.claimed), updated: count(counters.updated),
        failed: count(counters.failed), superseded: count(counters.superseded) } } : {}),
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready || report.counters?.failed || report.status === 'blocked' || report.status === 'failed') process.exitCode = 1;
    else if (command === 'step' && (!report.backfillDone || report.dirtySources || report.pendingMasks
      || report.generation !== report.appliedGeneration)) process.exitCode = 3;
  } catch {
    console.error('memory_trial_request_failed'); process.exitCode = 1;
  }
}

await main();
