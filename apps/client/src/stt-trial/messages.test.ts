import { describe, expect, it } from 'vitest';
import {
  externalUploadLabel,
  formatBytes,
  formatTimecode,
  submitBlockReason,
  trialErrorMessage,
  uploadRejection,
  type SubmitGate,
} from './messages';

// 문구를 글자로 고정하지 않는다. 검사하는 것은 관측 가능한 상태와 안전 계약이다.
// 문구를 다듬는 것은 자유롭고, 아래 계약을 깨는 것만 실패한다.

const limits = { maxBytes: 209715200, contentTypes: ['audio/wav', 'audio/mpeg'] };
const file = { name: 'my-test.wav', size: 1024, type: 'audio/wav' };

const gate = (patch: Partial<SubmitGate> = {}): SubmitGate => ({
  file,
  limits,
  engine: 'qwen3-asr',
  engineConfigured: true,
  ownedTestRecording: true,
  allowExternalUpload: false,
  busy: false,
  submitting: false,
  ...patch,
});

// 백엔드가 내는 고정 code. 계약이 늘면 여기에 더하고, 화면이 따라오지 않으면 아래가 실패한다.
const SUBMIT_CODES = [
  'engine_invalid',
  'owned_test_recording_declaration_required',
  'external_upload_not_authorized',
  'external_upload_flag_requires_azure',
  'content_type_not_allowed',
  'content_length_required',
  'audio_body_empty',
  'audio_too_large',
  'chunked_body_not_supported',
  'audio_body_incomplete',
  'upload_timeout',
  'trial_already_running',
  'invalid_device',
  'azure_speech_key_missing',
  'qwen_python_required',
  'qwen_python_invalid',
  'host_not_allowed',
  'origin_not_allowed',
  'not_found',
  'method_not_allowed',
  'trial_running',
];
const EXECUTION_CODES = [
  'engine_timeout',
  'engine_not_ready',
  'engine_result_invalid',
  'audio_rejected',
  'engine_execution_failed',
  'provider_rejected',
  'provider_unavailable',
  'stt_execution_failed',
  'result_storage_failed',
];
const fallback = trialErrorMessage('__code_that_does_not_exist__');

describe('오류 안내의 안전 계약', () => {
  it('provider 원문과 모르는 code 를 그대로 내보내지 않는다', () => {
    const raw = 'AzureError: 401 Unauthorized at https://koreacentral.api.cognitive.microsoft.com/token';
    const shown = trialErrorMessage(raw);
    expect(shown).not.toContain(raw);
    expect(shown).not.toMatch(/https?:|Azure|401|Error/);
    expect(shown).toBe(fallback);
  });

  it('계약에 있는 code 는 원인별로 다른 안내를 받는다', () => {
    const generic = [...SUBMIT_CODES, ...EXECUTION_CODES].filter(
      (code) => trialErrorMessage(code) === fallback,
    );
    // internal_error 만 일부러 일반 안내와 같다. 나머지가 여기 들어오면 표에서 빠진 것이다.
    expect(generic).toEqual([]);
    expect(trialErrorMessage('internal_error')).toBe(fallback);
  });
});

describe('외부 전송 표시', () => {
  it('모름을 보냄이나 안 보냄으로 접지 않는다', () => {
    const unknown = externalUploadLabel(null);
    expect(externalUploadLabel(undefined)).toBe(unknown);
    expect(unknown).not.toBe(externalUploadLabel(false));
    expect(unknown).not.toBe(externalUploadLabel(true));
  });

  it('기록이 있으면 보냄과 안 보냄이 갈린다', () => {
    expect(externalUploadLabel(true)).not.toBe(externalUploadLabel(false));
  });
});

describe('파일 검사 경계', () => {
  it('허용 형식과 상한 이하는 통과한다', () => {
    expect(uploadRejection(file, limits)).toBeNull();
    expect(uploadRejection({ ...file, size: limits.maxBytes }, limits)).toBeNull();
  });

  it('빈 파일, 상한 초과, 목록 밖 형식, 형식 없음을 막는다', () => {
    expect(uploadRejection({ ...file, size: 0 }, limits)).not.toBeNull();
    expect(uploadRejection({ ...file, size: limits.maxBytes + 1 }, limits)).not.toBeNull();
    expect(uploadRejection({ ...file, type: 'video/mp4' }, limits)).not.toBeNull();
    expect(uploadRejection({ ...file, type: '' }, limits)).not.toBeNull();
  });

  it('고른 파일이 없으면 막는다', () => {
    expect(uploadRejection(null, limits)).not.toBeNull();
  });
});

describe('제출 게이트', () => {
  it('모두 갖추면 통과한다', () => {
    expect(submitBlockReason(gate())).toBeNull();
  });

  it('본인 시험 녹음 확인과 엔진 준비와 실행 중 상태가 각각 막는다', () => {
    expect(submitBlockReason(gate({ ownedTestRecording: false }))).not.toBeNull();
    expect(submitBlockReason(gate({ engineConfigured: false }))).not.toBeNull();
    expect(submitBlockReason(gate({ busy: true }))).not.toBeNull();
    expect(submitBlockReason(gate({ submitting: true }))).not.toBeNull();
    expect(submitBlockReason(gate({ engine: null }))).not.toBeNull();
  });

  it('Azure 는 외부 전송 확인 없이 못 나가고 로컬은 그 확인을 요구하지 않는다', () => {
    expect(submitBlockReason(gate({ engine: 'azure' }))).not.toBeNull();
    expect(submitBlockReason(gate({ engine: 'azure', allowExternalUpload: true }))).toBeNull();
    expect(submitBlockReason(gate({ engine: 'qwen3-asr', allowExternalUpload: false }))).toBeNull();
  });

});

describe('시간 표기', () => {
  it('분과 초를 0으로 채워 정렬한다', () => {
    expect(formatTimecode(0)).toBe('00:00.0');
    expect(formatTimecode(4.25)).toBe('00:04.3');
    expect(formatTimecode(75.5)).toBe('01:15.5');
    expect(formatTimecode(-1)).toBe('00:00.0');
  });
});

describe('파일 크기 표기', () => {
  it('작은 파일이 0 으로 사라지지 않는다', () => {
    expect(formatBytes(1644)).not.toMatch(/^0/);
    expect(formatBytes(1)).not.toMatch(/^0/);
  });

  it('상한값은 사람이 읽는 단위로 보인다', () => {
    expect(formatBytes(209715200)).toBe('200MB');
  });
});
