// 화면 문구와 제출 게이트. React 를 물지 않는 순수 모듈이라 그대로 검사할 수 있다.
//
// 규칙 둘을 여기서 지킨다.
// 1. provider 원문 오류를 절대 화면에 올리지 않는다. 모르는 code 는 일반 안내로 떨어진다.
// 2. 추측 진행률을 만들지 않는다. 상태는 서버가 준 네 값뿐이다.

import type { EngineId, TrialStatus, UploadLimits } from './contract';

export const STATUS_LABEL: Record<TrialStatus, string> = {
  queued: '대기 중',
  running: '처리 중',
  completed: '완료',
  failed: '실패',
};

export const ENGINE_LABEL: Record<EngineId, string> = {
  'qwen3-asr': '로컬 qwen3-asr',
  azure: 'Azure',
};

/** 엔진이 준비되지 않았을 때. 서버가 준 reason code 는 화면에 그대로 쓰지 않는다. */
export const ENGINE_NOT_READY = '지금은 고를 수 없습니다. 준비 상태를 확인하세요.';

/** 화자 ID 는 제공될 때만 표시한다. 없는 것은 준비 안 됨이 아니라 제공 안 됨이다. */
export const SPEAKER_NOT_PROVIDED = '제공 안 됨';

/**
 * 외부 전송 여부. null 과 누락은 증거가 없다는 뜻이지 보내지 않았다는 뜻이 아니다.
 * 실제로 나갔을 수 있으므로 '없음' 으로 접지 않는다.
 */
export function externalUploadLabel(attempted: boolean | null | undefined): string {
  if (attempted === true) return '시도함';
  if (attempted === false) return '없음';
  return '확인할 수 없음';
}

const GENERIC_ERROR = '시험을 진행하지 못했습니다. 상태를 확인한 뒤 다시 시도하세요.';

// 백엔드가 내는 고정 code 를 그대로 받는다. 목록에 없는 code 는 위 일반 안내로 떨어지므로
// 새 code 가 생겨도 원문 오류나 내부 사정이 화면에 새지 않는다.
const ERROR_COPY: Record<string, string> = {
  // 제출과 검증
  engine_invalid: '고를 수 없는 엔진입니다. 엔진을 다시 고르세요.',
  owned_test_recording_declaration_required: '본인 시험 녹음 확인이 필요합니다.',
  external_upload_not_authorized: '외부 전송 확인이 없어 Azure 로 보내지 않았습니다.',
  external_upload_flag_requires_azure: '외부 전송 확인은 Azure 를 고른 경우에만 보냅니다.',
  content_type_not_allowed: '지원하지 않는 음성 형식입니다.',
  content_length_required: '파일 크기를 확인할 수 없어 보내지 못했습니다. 파일을 다시 고르세요.',
  audio_body_empty: '내용이 없는 파일입니다. 다른 파일을 고르세요.',
  audio_too_large: '파일이 허용 크기를 넘었습니다.',
  chunked_body_not_supported: '이 방식으로는 보낼 수 없는 파일입니다. 파일을 다시 고르세요.',
  audio_body_incomplete: '파일이 끝까지 전송되지 않았습니다. 다시 시도하세요.',
  upload_timeout: '전송이 시간 안에 끝나지 않았습니다. 다시 시도하세요.',
  trial_already_running: '다른 시험이 실행 중입니다. 끝난 뒤 다시 시도하세요.',
  invalid_device: '엔진 실행 장치 설정이 올바르지 않습니다. 준비 상태를 확인하세요.',
  azure_speech_key_missing: 'Azure 사용 준비가 되지 않았습니다. 준비 상태를 확인하세요.',
  qwen_python_required: '로컬 엔진 실행 환경이 준비되지 않았습니다. 준비 상태를 확인하세요.',
  qwen_python_invalid: '로컬 엔진 실행 환경 설정이 올바르지 않습니다. 준비 상태를 확인하세요.',
  host_not_allowed: '허용되지 않은 주소로 열었습니다. 로컬 주소로 다시 여세요.',
  origin_not_allowed: '허용되지 않은 출처의 요청입니다. 로컬 주소로 다시 여세요.',
  not_found: '요청한 자리를 찾을 수 없습니다.',
  method_not_allowed: '허용되지 않은 요청입니다.',
  trial_running: '실행 중인 시험은 지울 수 없습니다. 끝난 뒤 다시 시도하세요.',
  internal_error: GENERIC_ERROR,

  // 실행 실패 errorCode
  engine_timeout: '엔진이 시간 안에 끝내지 못했습니다. 다시 시도하세요.',
  engine_not_ready: '엔진이 준비되지 않았습니다. 준비 상태를 확인하세요.',
  engine_result_invalid: '엔진 결과를 읽지 못했습니다. 다시 시도하세요.',
  audio_rejected: '엔진이 이 음성 파일을 받지 않았습니다. 다른 파일로 시도하세요.',
  engine_execution_failed: '엔진 실행이 실패했습니다. 준비 상태를 확인한 뒤 다시 시도하세요.',
  provider_rejected: '외부 제공자가 요청을 받지 않았습니다. 설정을 확인하세요.',
  provider_unavailable: '외부 제공자에 연결하지 못했습니다. 잠시 후 다시 시도하세요.',
  stt_execution_failed: '전사를 마치지 못했습니다. 다시 시도하세요.',
  result_storage_failed: '결과를 저장하지 못했습니다. 로컬 저장소 상태를 확인해 주세요.',

  // 화면이 스스로 만드는 두 가지
  network_unavailable: '로컬 시험 서버에 연결하지 못했습니다.',
  invalid_response: '결과를 읽지 못했습니다. 다시 시도하세요.',
};

export function trialErrorMessage(code: string | null | undefined): string {
  if (typeof code !== 'string') return GENERIC_ERROR;
  return ERROR_COPY[code] ?? GENERIC_ERROR;
}

export interface PickedFile {
  name: string;
  size: number;
  type: string;
}

/** 제출 전 파일 검사. 통과하면 null. */
export function uploadRejection(file: PickedFile | null, limits: UploadLimits | null): string | null {
  if (file === null) return '음성 파일을 고르세요.';
  if (file.size === 0) return '내용이 없는 파일입니다. 다른 파일을 고르세요.';
  if (limits === null) return null;
  if (file.size > limits.maxBytes) {
    return `파일이 허용 크기 ${formatBytes(limits.maxBytes)} 를 넘었습니다.`;
  }
  if (file.type === '') return '형식을 알 수 없는 파일입니다. 음성 파일을 고르세요.';
  if (limits.contentTypes.length > 0 && !limits.contentTypes.includes(file.type)) {
    return '지원하지 않는 음성 형식입니다.';
  }
  return null;
}

export interface SubmitGate {
  file: PickedFile | null;
  limits: UploadLimits | null;
  engine: EngineId | null;
  engineConfigured: boolean;
  ownedTestRecording: boolean;
  allowExternalUpload: boolean;
  busy: boolean;
  submitting: boolean;
}

/**
 * 제출을 막는 첫 사유. 통과하면 null 이다.
 * 버튼 비활성과 화면 안내가 같은 판정을 쓰도록 한 곳에 둔다.
 */
export function submitBlockReason(gate: SubmitGate): string | null {
  if (gate.submitting) return '제출 중입니다.';
  if (gate.busy) return '다른 시험이 실행 중입니다. 끝난 뒤 다시 시도하세요.';
  if (gate.engine === null) return '엔진을 고르세요.';
  if (!gate.engineConfigured) return ENGINE_NOT_READY;
  const fileProblem = uploadRejection(gate.file, gate.limits);
  if (fileProblem !== null) return fileProblem;
  if (!gate.ownedTestRecording) return '본인의 비민감 시험 녹음임을 확인하세요.';
  if (gate.engine === 'azure' && !gate.allowExternalUpload) {
    return 'Azure 로 원본 파일을 보내는 것에 대한 확인이 필요합니다.';
  }
  return null;
}

/** 파일 크기. 작은 파일이 0.0MB 로 사라지지 않게 단위를 낮춘다. */
export function formatBytes(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes}B`;
  const mb = kb / 1024;
  if (mb < 1) return `${Math.round(kb)}KB`;
  if (mb >= 10) return `${Math.round(mb)}MB`;
  return `${mb.toFixed(1)}MB`;
}

/** 초 단위 시각을 mm:ss.s 로. 서버가 준 값만 쓰고 반올림으로 늘리지 않는다. */
export function formatTimecode(seconds: number): string {
  const safe = seconds < 0 ? 0 : seconds;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}
