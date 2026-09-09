import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin/users/page.test.tsx 와 같은 이유).
afterEach(cleanup);

class TestApiError extends Error {
  constructor(readonly code: string) { super(code); }
}

const getAiProviderStatus = vi.fn();
const getSttCapabilities = vi.fn();

vi.mock('../../lib/api', () => ({
  ApiError: TestApiError,
  getAiProviderStatus: () => getAiProviderStatus(),
  getSttCapabilities: () => getSttCapabilities(),
}));

vi.mock('../../actions', () => ({
  activateAiProviderRuntimeAction: vi.fn(),
}));

// vi.mock 이 먼저 등록돼야 page 가 mock 을 집는다. 정적 import 는 hoisting 때문에 mock 보다
// 먼저 평가되므로 여기서는 동적 import 를 쓴다(admin/users/page.test.tsx 와 같은 방식).
const { default: AdminAiProviderPage } = await import('./page');

const PROVIDER_STATUS = {
  enabled: false,
  adapterId: null,
  adapterVersion: null,
  configHash: null,
  runtime: { configured: false, adapterId: null, adapterVersion: null, configHash: null, matches: null },
};

beforeEach(() => {
  getAiProviderStatus.mockReset();
  getSttCapabilities.mockReset();
  getAiProviderStatus.mockResolvedValue(PROVIDER_STATUS);
});

describe('AI·STT·연결 화면의 STT 상태', () => {
  // 사유는 서버 계약의 고정 3종이다. 화면이 임의 문구를 만들면 실무자가 "왜 못 켜는지"를
  // 화면마다 다르게 읽는다.
  it('엔진별 고정 사유를 그대로 보여준다', async () => {
    getSttCapabilities.mockResolvedValue({
      sttMode: 'off',
      sttEngine: null,
      agentStatus: 'inactive',
      options: [
        { mode: 'off', enabled: true, disabledReason: null },
        { mode: 'local', enabled: false, disabledReason: 'unsupported' },
        { mode: 'azure', enabled: false, disabledReason: 'missing_key' },
      ],
    });

    const { container } = render(await AdminAiProviderPage());
    const text = container.textContent ?? '';

    expect(text).toContain('설치에 승인된 엔진이 없거나 처리 장비가 연결되지 않았습니다.');
    expect(text).toContain('처리 장비에 이 엔진의 자격이 없습니다.');
    expect(text).toContain('연결 없음');
    expect(text).toContain('지정된 엔진 없음');
  });

  it('켜져 있으면 엔진 이름과 사용 가능 상태를 보여준다', async () => {
    getSttCapabilities.mockResolvedValue({
      sttMode: 'local',
      sttEngine: 'qwen3-asr',
      agentStatus: 'connected',
      options: [
        { mode: 'off', enabled: true, disabledReason: null },
        { mode: 'local', enabled: true, disabledReason: null },
        { mode: 'azure', enabled: false, disabledReason: 'unverified' },
      ],
    });

    const { container } = render(await AdminAiProviderPage());
    const text = container.textContent ?? '';

    expect(text).toContain('qwen3-asr');
    expect(text).toContain('연결됨');
    expect(text).toContain('품질 승인 전에는 고를 수 없습니다.');
    expect(text).not.toContain('수기 경로로 남깁니다');
  });

  // signed install manifest 가 없으면 API 가 503 이다(D77). 그때 사업자 카드까지 사라지면
  // 관리자가 AI 설정 자체를 못 본다.
  it('설치 정보를 읽지 못해도 사업자 카드는 남는다', async () => {
    getSttCapabilities.mockRejectedValue(new TestApiError('service_unavailable'));

    const { container } = render(await AdminAiProviderPage());
    const text = container.textContent ?? '';

    expect(text).toContain('AI 사업자');
    expect(text).toContain('설치 정보를 읽을 수 없어 STT 상태를 표시하지 못했습니다.');
  });
});
