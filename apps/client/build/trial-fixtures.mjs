// 화면 검수 전용 응답 더미. **개발 서버에서만, 환경변수를 켰을 때만** 산다.
//
// 왜 필요한가: 이 화면의 disabled, 실패, 완료 상태는 실제 엔진을 돌려야 나오는데 그것은 이
// 단계의 범위 밖이다(실제 Qwen, Azure, 자격 조회 없음). 결정론적 화면 검수만을 위한 도구다.
//
// 제품 fallback 이 아니다. 근거 셋:
//   1. `apply: 'serve'` 라 빌드 산출물에 들어갈 길이 없다. vite.config 의 서버 훅에만 산다.
//   2. `CCC_STT_TRIAL_FIXTURES` 가 없으면 플러그인 자체가 만들어지지 않는다.
//   3. 실제 백엔드로 가는 프록시를 대체하는 것이 아니라, 이 환경변수를 켠 개발 서버에서만
//      앞에 선다. 켜지 않으면 요청은 평소대로 프록시로 간다.

const SCENARIOS = new Set(['ready', 'disabled', 'busy', 'failed', 'completed']);

const localEngine = (configured) => ({
  configured,
  ...(configured ? {} : { reason: 'model_missing' }),
  modelId: 'Qwen/Qwen3-ASR-1.7B',
  modelRevision: 'fixture-revision',
  alignerId: 'Qwen/Qwen3-ForcedAligner-0.6B',
  alignerRevision: 'fixture-revision',
  device: 'cpu',
});

const azureEngine = (configured) => ({
  configured,
  ...(configured ? {} : { reason: 'azure_speech_key_missing' }),
  region: 'koreacentral',
  apiVersion: '2025-10-15',
  externalUploadAuthorizationRequired: true,
});

function statusBody(scenario) {
  const enginesReady = scenario !== 'disabled';
  return {
    purpose: 'internal-stt-trial',
    productActivation: false,
    busy: scenario === 'busy',
    activeTrialId: scenario === 'busy' ? 'f'.repeat(32) : null,
    engines: {
      'qwen3-asr': localEngine(enginesReady),
      azure: azureEngine(enginesReady),
    },
    upload: { maxBytes: 209715200, contentTypes: ['audio/wav', 'audio/mpeg', 'audio/mp4'] },
  };
}

function trialBody(scenario, trialId) {
  if (scenario === 'failed') {
    return {
      trialId,
      status: 'failed',
      engine: 'qwen3-asr',
      externalUploadAttempted: false,
      errorCode: 'engine_timeout',
    };
  }
  return {
    trialId,
    status: 'completed',
    engine: 'azure',
    // 증거가 없는 경우. 화면이 '아니오' 로 접지 않는지 보는 자리다.
    externalUploadAttempted: null,
    segmentCount: 3,
    repetitionWarningCount: 1,
  };
}

const TRANSCRIPT = {
  segments: [
    { start: 0, end: 4.2, text: '안녕하세요. 오늘 시험 녹음을 시작하겠습니다.', speaker: 'spk_0' },
    { start: 4.2, end: 11.8, text: '네, 저는 지난주에 말씀드린 서류를 준비해 왔습니다. 확인 부탁드립니다.', speaker: 'spk_1' },
    { start: 11.8, end: 13.1, text: '같은 말이 계속 반복됩니다 같은 말이 계속 반복됩니다', warning: true },
    { start: 13.1, end: 19.4, text: '확인했습니다. 다음 상담 일정은 다시 잡아서 알려 드리겠습니다.', speaker: 'spk_0' },
  ],
  repetitionWarnings: [{ start: 11.8, end: 13.1, count: 4, reason: 'repetition' }],
  forcedCuts: 2,
  qualityEvaluation: 'deferred',
};

const send = (res, statusCode, body) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

/**
 * @param {string | undefined} raw CCC_STT_TRIAL_FIXTURES 값
 * @returns {import('vite').Plugin | null}
 */
export function trialFixtures(raw) {
  if (raw === undefined || raw === '') return null;
  const scenario = SCENARIOS.has(raw) ? raw : 'ready';
  const trialId = '0123456789abcdef0123456789abcdef';

  return {
    name: 'ccc-stt-trial-fixtures',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/internal/stt', (req, res, next) => {
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/status') return send(res, 200, statusBody(scenario));
        if (path === '/trials' && req.method === 'POST') {
          return send(res, 202, { trialId, status: 'queued' });
        }
        if (path === `/trials/${trialId}`) {
          if (req.method === 'DELETE') return send(res, 204, null);
          return send(res, 200, trialBody(scenario, trialId));
        }
        if (path === `/trials/${trialId}/transcript`) return send(res, 200, TRANSCRIPT);
        return next();
      });
      server.config.logger.warn(`[ccc] STT 시험 더미 응답이 켜져 있다: ${scenario}`);
    },
  };
}
