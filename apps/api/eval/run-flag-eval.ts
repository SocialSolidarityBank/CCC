/**
 * 리스크 플래그 제안 수동 평가 실행기 (CCC-130 · D72).
 *
 * 합성 상담 전사 30건을 실제로 설정된 Codex/OpenAI 어댑터로 돌려, 출력을
 * validateAiProviderOutput 으로 검증하고 유형별 precision/recall 과 실패 사례 id 를
 * 보고한다. 기대 판정과 어긋난 사례가 하나라도 있으면 0 아닌 종료 코드로 끝난다.
 *
 * CI 에 없다 — 실제 사업자 호출을 하므로 사람이 직접 돌리는 도구다.
 *
 * 실행 (apps/api 디렉터리 또는 루트에서):
 *   AI_PROVIDER_CONFIG='...' CODEX_API_KEY='...' EXTERNAL_AI_CALLS_ENABLED=1 \
 *     pnpm --filter @ccc/api run eval:flags
 *   pnpm --filter @ccc/api run eval:flags -- --preview   # 네트워크 없이 픽스처로 파이프라인 점검
 *
 * 환경값은 docs/ai-provider-setup-q-actions.md 2~3단계와 같고, 실제 호출은 운영
 * 스위치(EXTERNAL_AI_CALLS_ENABLED=1)까지 있어야 열린다. --preview 는
 * generatePreviewFixtureAiDraft 를 어댑터로 써서 설정·키 없이 파이프라인만 돈다
 * (플래그 제안이 항상 빈 배열이므로 제안 기대 사례가 모두 실패로 잡히는 것이 정상이다).
 *
 * node 가 이 파일을 직접 실행하므로, 상대 import 는 확장자(.ts)까지 쓴다.
 */
import {
  AiProviderUnavailableError,
  generatePreviewFixtureAiDraft,
  resolveAiProviderAdapter,
  validateAiProviderOutput,
  validateAiProviderRequest,
  type AiProviderRuntimeEnv,
  type AiProviderTestAdapter,
} from '../src/ai-provider.ts';
import { FLAG_EVAL_CASES, buildFlagEvalRequest } from './flag-eval-cases.ts';
import {
  buildFlagEvalReport,
  evaluateFlagEvalCase,
  formatFlagEvalReport,
  parseFlagEvalArgs,
} from './flag-eval-core.ts';

const USAGE = [
  'Usage: pnpm --filter @ccc/api run eval:flags [--preview]',
  '',
  '  --preview  외부 호출 없이 미리보기 픽스처로 평가 파이프라인을 점검합니다.',
].join('\n');

function previewAdapter(): AiProviderTestAdapter {
  return {
    providerId: 'codex',
    adapterVersion: 'v1',
    testOnly: true,
    config: {
      registryVersion: 'phase1.v1',
      providerId: 'codex',
      adapterVersion: 'v1',
      configVersion: 'eval-preview',
      model: 'preview-fixture',
    },
    generate: async (request) => generatePreviewFixtureAiDraft(request),
  };
}

function describeError(error: unknown): string {
  if (error instanceof AiProviderUnavailableError) {
    const reason = error.reason === 'unknown' ? '' : `:${error.reason}`;
    return `ai_provider_unavailable${reason}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function main(): Promise<void> {
  let command: ReturnType<typeof parseFlagEvalArgs>;
  try {
    command = parseFlagEvalArgs(process.argv.slice(2));
  } catch (error) {
    console.error(describeError(error));
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (command.kind === 'help') {
    console.log(USAGE);
    return;
  }
  const usePreviewFixture = command.preview;
  const env: AiProviderRuntimeEnv = {
    AI_PROVIDER_CONFIG: process.env.AI_PROVIDER_CONFIG,
    CODEX_API_KEY: process.env.CODEX_API_KEY,
    EXTERNAL_AI_CALLS_ENABLED: process.env.EXTERNAL_AI_CALLS_ENABLED,
    ...(usePreviewFixture ? { AI_PROVIDER_ADAPTER: previewAdapter() } : {}),
  };

  let adapter: ReturnType<typeof resolveAiProviderAdapter>['adapter'];
  try {
    adapter = resolveAiProviderAdapter(env).adapter;
  } catch (error) {
    console.error(`리스크 플래그 평가를 시작할 수 없습니다: ${describeError(error)}`);
    if (!usePreviewFixture) {
      console.error(
        '실제 호출에는 AI_PROVIDER_CONFIG·CODEX_API_KEY·EXTERNAL_AI_CALLS_ENABLED=1 이 필요합니다.',
        '설정 방법: docs/ai-provider-setup-q-actions.md. 네트워크 없이 점검하려면 --preview.',
      );
    }
    process.exitCode = 1;
    return;
  }

  const outcomes = [];
  for (const case_ of FLAG_EVAL_CASES) {
    try {
      const request = validateAiProviderRequest(buildFlagEvalRequest(case_));
      const output = await adapter.generate(request);
      const validated = validateAiProviderOutput(output, request);
      const predicted = validated.flagSuggestions.map((suggestion) => suggestion.type);
      outcomes.push(evaluateFlagEvalCase(case_, predicted));
    } catch (error) {
      outcomes.push(evaluateFlagEvalCase(case_, [], `호출/검증 실패: ${describeError(error)}`));
    }
  }

  const report = buildFlagEvalReport(outcomes);
  const adapterLabel = usePreviewFixture
    ? '미리보기 픽스처 (generatePreviewFixtureAiDraft, 네트워크 없음)'
    : '실제 Codex 어댑터 (OpenAI 호출)';
  console.log(formatFlagEvalReport(report, adapterLabel));
  if (!report.passed) {
    console.error(`\n실패 ${report.failedCaseIds.length}건 — 평가 실패입니다.`);
    process.exitCode = 1;
  }
}

await main();
