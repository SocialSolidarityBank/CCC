const messages = {
  trust_missing: '설치 서명을 확인할 공개 키가 없습니다. 배포 설정을 확인해 주세요.',
  installation_invalid: '설치 정보의 서명이나 접속 주소를 확인할 수 없습니다. 로그인을 중단했습니다.',
  installation_expired: '설치 정보의 유효기간이 지났습니다. 관리자가 설치 정보를 갱신한 뒤 다시 열어 주세요.',
  installation_mismatch: '연결한 서버의 설치 정보가 일치하지 않아 업무 자료를 불러오지 않았습니다.',
  local_single_unsupported: '이 웹 진입점은 Local Single의 앱 잠금과 검증된 로컬 포트 연결을 아직 지원하지 않습니다. Cloud 로그인으로 대신 연결하지 않습니다.',
  local_office_unsupported: '이 웹 진입점은 Local Office의 로컬 계정과 관리자 MFA 연결을 아직 지원하지 않습니다. Cloud 로그인으로 대신 연결하지 않습니다.',
  capabilities_required: '서버 기능과 설치 정보 확인을 먼저 마쳐야 합니다.',
  capabilities_invalid: '서버 기능 정보가 설치 계약과 맞지 않습니다. 업무 자료를 불러오지 않았습니다.',
  invalid_api_path: '허용되지 않은 요청 경로라 연결하지 않았습니다.',
  invalid_response: '서버 응답을 확인할 수 없습니다. 관리자에게 문의해 주세요.',
  session_changed: '로그인 상태가 바뀌었습니다. 이전 로그인으로 받은 자료는 표시하지 않습니다.',
  unauthenticated: '로그인이 만료되었거나 취소되었습니다. 다시 로그인해 주세요.',
  forbidden: '현재 계정에는 이 기능을 사용할 권한이 없습니다.',
  mfa_required: '인증 앱의 여섯 자리 번호로 추가 인증을 완료해 주세요.',
  conflict: '다른 사람이 먼저 변경했습니다. 입력한 내용은 남겨 두었습니다. 최신 정보를 확인한 뒤 다시 저장해 주세요.',
  purge_disabled: '최종 파기는 현재 비활성화되어 있습니다. 기록은 그대로 보존됩니다.',
  invalid_request: '입력 내용을 확인해 주세요.',
  program_admission_required: '사업 도입 확인이 필요합니다. 설명을 다시 읽고 선택을 확인해 주세요.',
  emergency_reason_required: '긴급 등록을 고르면 사유를 적어야 합니다.',
  privacy_consent_required: '개인정보 수집과 이용 동의가 없어 등록할 수 없습니다. 동의를 아직 받지 못했으면 긴급 등록 사유를 적어 주세요.',
  unavailable: '서버에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요. 저장 요청이었다면 최신 상태를 먼저 확인해 주세요.',
  invalid_credentials: '이메일 또는 비밀번호를 확인해 주세요.',
  email_not_confirmed: '이메일 확인이 필요합니다. 받은 초대나 확인 메일을 확인해 주세요.',
  mfa_invalid: '인증 번호가 맞지 않거나 시간이 지났습니다. 새 번호를 입력해 주세요.',
  mfa_unsupported: '이 계정에 등록된 추가 인증 방식은 이 화면에서 지원하지 않습니다. 기관 관리자에게 문의해 주세요.',
  mfa_enrollment_failed: '인증 앱 등록을 완료하지 못했습니다. 다시 시도하거나 기관 관리자에게 문의해 주세요.',
  rate_limited: '요청이 너무 많습니다. 잠시 기다린 뒤 다시 시도해 주세요.',
  auth_failed: '로그인을 완료하지 못했습니다. 다시 시도해 주세요.',
  signout_failed: '이 화면의 로그인 정보는 지웠지만 서버의 로그인 종료는 확인하지 못했습니다. 기관 관리자에게 세션 취소를 요청해 주세요.',
} as const;

export type BusinessErrorCode = keyof typeof messages;

/** 공급자 원문, 응답 본문과 URL은 오류 객체에도 남기지 않는다. */
export class BusinessError extends Error {
  constructor(readonly code: BusinessErrorCode, readonly status = 0) {
    super(messages[code]);
    this.name = 'BusinessError';
  }
}

export function safeError(error: unknown): BusinessError {
  return error instanceof BusinessError ? error : new BusinessError('unavailable', 503);
}

export function httpError(status: number, value: unknown): BusinessError {
  if (status === 401) return new BusinessError('unauthenticated', status);
  if (status === 403) {
    const mfa = typeof value === 'object' && value !== null && 'error' in value && value.error === 'mfa_required';
    return new BusinessError(mfa ? 'mfa_required' : 'forbidden', status);
  }
  if (status === 409) {
    const code = typeof value === 'object' && value !== null && 'error' in value ? value.error : undefined;
    return new BusinessError(code === 'purge_disabled' ? 'purge_disabled'
      : code === 'program_admission_required' ? 'program_admission_required' : 'conflict', status);
  }
  if (status === 429) return new BusinessError('rate_limited', status);
  if (status === 422 || status === 400) {
    const code = typeof value === 'object' && value !== null && 'error' in value ? value.error : undefined;
    if (code === 'privacy_consent_required') return new BusinessError('privacy_consent_required', status);
    if (code === 'emergency_reason_required') return new BusinessError('emergency_reason_required', status);
    return new BusinessError('invalid_request', status);
  }
  return new BusinessError('unavailable', status);
}

export function authError(error: unknown): BusinessError {
  if (error instanceof BusinessError) return error;
  if (typeof error !== 'object' || error === null) return new BusinessError('auth_failed');
  const code = 'code' in error ? error.code : undefined;
  const status = 'status' in error && typeof error.status === 'number' ? error.status : 0;
  if (code === 'invalid_credentials') return new BusinessError('invalid_credentials', status);
  if (code === 'email_not_confirmed') return new BusinessError('email_not_confirmed', status);
  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired' || code === 'mfa_invalid') return new BusinessError('mfa_invalid', status);
  if (status === 429) return new BusinessError('rate_limited', status);
  if (status >= 500 || status === 0) return new BusinessError('unavailable', status);
  return new BusinessError('auth_failed', status);
}
