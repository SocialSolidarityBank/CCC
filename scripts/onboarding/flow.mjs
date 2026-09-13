import { PlanFailure } from '../supabase/plan.mjs';

export const ONBOARDING_MODES = Object.freeze(['community-cloud', 'local-single', 'local-office']);
const STAGES = Object.freeze({
  environment: '처음 설치하나요, 기존 설치를 이어가나요? (1: 처음, 2: 이어가기)',
  'cloud-resources': '계정, 소유 기관, 서울 리전과 요금 구성이 확인됐나요?',
  installation: '설치 대상과 서명된 설치 자료가 준비됐나요?',
  'first-admin': '첫 관리자로 초대할 계정과 설치 대상이 확인됐나요?',
  institution: '기관 이름, 첫 사업, 동의 문안과 보유기간을 확인했나요?',
  llm: '설정 도움을 위해 OpenAI를 연결할까요, 고정 안내로 계속할까요?',
  stt: '처리 장비와 음성 인식의 승인 조건이 준비됐나요?',
  storage: '현재 연결을 점검하나요, 저장 위치를 이전하려 하나요?',
});
const GUIDANCE = Object.freeze({
  environment: '기존 설치 여부는 선택만으로 확정되지 않습니다. 실제 상태와 설치 기록을 먼저 확인합니다.',
  'cloud-resources': '사용자가 계정 인증과 비용을 확인하고 자원 생성 묶음을 승인해야 합니다. 자격과 대상은 비공개 입력 경로로 공급합니다.',
  installation: '서명과 소유권을 검증한 읽기 전용 plan 뒤에 승인과 적용 직전 지문 검사를 거칩니다. 기존 설치기에서는 --format json을 사용합니다.',
  'first-admin': '초대 발송, 수락과 신원 결속을 따로 확인합니다. 초대 토큰이나 비밀번호를 입력하지 마세요. Cloud 추가 인증은 선택입니다.',
  institution: '기관 준비 상태와 사업 도입 확인을 실제로 검사합니다. 설정 도우미가 동의나 확인을 대신하지 않습니다.',
  llm: '연결 성공은 상담 AI 활성화가 아닙니다. 키 없이도 고정 안내와 수기 업무 준비를 계속합니다.',
  stt: '설치 기본값은 off이고 승인 전 sttEngine은 null입니다. 키 연결이나 장비 준비만으로 음성 인식을 켜지 않습니다.',
  storage: '현재 연결은 읽기 전용으로 점검합니다. 저장 위치 변경은 검증된 백업과 .cccx 이전 절차로 진행하며 기존 DB를 덮어쓰지 않습니다.',
});
const LOCAL_GUIDANCE = Object.freeze({
  'local-single': 'Local Single은 Windows 11 x64의 서명 설치물, 암호화 SQLite, 앱 잠금과 127.0.0.1 접속을 확인해야 합니다. 로컬 Supabase 점검은 이 설치가 아닙니다.',
  'local-office': 'Local Office는 서명된 서버와 클라이언트 설치물, 암호화 SQLite, 내부망 HTTPS, 로컬 계정과 관리자 추가 인증을 확인해야 합니다.',
});
const BINDING_KEYS = ['mode', 'stageId', 'targetSha256', 'desiredSha256', 'observedSha256'];
const SHA256 = /^[a-f0-9]{64}$/u;
const EXTRA_MESSAGES = Object.freeze({
  CHECK_NOT_RUN: '실제 상태와 자격 검사를 아직 실행하지 않았습니다.',
  CHECK_RESULT_INVALID: '설치 검사 결과가 없거나 유효하지 않습니다. 실제 상태를 다시 읽습니다.',
  UNKNOWN_CHECK_CODE: '알 수 없는 검사 코드가 있어 진행을 멈췄습니다. 현재 설치기의 검사 결과를 확인합니다.',
  ONBOARDING_INPUT_INVALID: '지원하는 모드와 단계만 선택할 수 있습니다.',
  STAGE_BINDING_INVALID: '단계 승인에는 유효한 모드, 단계와 세 가지 SHA-256 값만 필요합니다.',
  SUPABASE_NOT_LOCAL_INSTALL: 'Supabase 검사 결과로 Local Single이나 Office의 설치를 확인할 수 없습니다.',
  PLAN_READY: '읽기 전용 계획을 확인했습니다. 설치 완료나 실행 권한을 뜻하지 않습니다.',
  INSTALLATION_VERIFIED: '설치 검사를 통과했습니다. 기관 준비와 AI/STT 사용 가능 여부는 별도로 확인합니다.',
  REGION_UNVERIFIED: '서울 리전 증거를 읽을 권한을 확인한 뒤 다시 점검합니다.',
  REGION_MISMATCH: '승인된 설치 대상의 서울 리전을 확인합니다. 현재 프로젝트는 변경하지 않습니다.',
  EXISTING_PROJECT_NOT_CLEAN: '기존 자료를 지우지 말고 소유 승인과 설치 이력을 확인합니다.',
  CONNECTION_NOT_READ_ONLY: '읽기 전용 권한과 점검 경로를 확인한 뒤 다시 실행합니다.',
  STATE_CHANGED_DURING_PLAN: '다른 변경 작업이 끝난 뒤 읽기 전용 계획을 다시 만듭니다.',
});
const INPUT_CODES = new Set(['CREDENTIAL_MISSING', 'PROJECT_REF_MISSING', 'OWNER_EVIDENCE_MISSING']);
const NOTICE_CODES = new Set(['RELEASE_SUPERSEDED', 'RUNTIME_NOT_READY']);
const PLAN_KEYS = new Set([
  'operation', 'target', 'readOnly', 'ready', 'productionReady', 'unchanged',
  'planFingerprint', 'stateFingerprint', 'resourcesSha256', 'migrationsSha256',
  'project', 'connection', 'installed', 'observed', 'providerBaseline',
  'plannedResources', 'migrations', 'blockers', 'notes',
]);
const DOCTOR_KEYS = new Set([
  'operation', 'readOnly', 'ready', 'productionReady', 'installed', 'stateFingerprint',
  'completedSteps', 'blockers', 'notices', 'health', 'providerBaseline',
]);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

export function checkMessage(code) {
  if (Object.hasOwn(EXTRA_MESSAGES, code)) return EXTRA_MESSAGES[code];
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(code)) {
    const failure = new PlanFailure(code);
    if (failure.code === code) return failure.message;
  }
  return EXTRA_MESSAGES.UNKNOWN_CHECK_CODE;
}

function fail(code) {
  throw Object.assign(new Error(checkMessage(code)), { code });
}

function assertStage(mode, stageId) {
  if (!ONBOARDING_MODES.includes(mode) || typeof stageId !== 'string' || !Object.hasOwn(STAGES, stageId)) {
    fail('ONBOARDING_INPUT_INVALID');
  }
}

/** Content binding only. Callers must separately recheck authority and S11 signatures. */
export function assertSameApprovedStage(approved, planned, observed) {
  for (const binding of [approved, planned, observed]) {
    if (!record(binding) || Reflect.ownKeys(binding).length !== BINDING_KEYS.length
      || !BINDING_KEYS.every(key => Object.hasOwn(binding, key))
      || !ONBOARDING_MODES.includes(binding.mode) || typeof binding.stageId !== 'string'
      || !Object.hasOwn(STAGES, binding.stageId)
      || !['targetSha256', 'desiredSha256', 'observedSha256'].every(key => sha256(binding[key]))) {
      fail('STAGE_BINDING_INVALID');
    }
  }
  if (BINDING_KEYS.some(key => approved[key] !== planned[key] || approved[key] !== observed[key])) {
    throw new PlanFailure('PLAN_STATE_CHANGED');
  }
}

function view(mode, stageId, status, checks) {
  return {
    schemaVersion: 1, mode, stageId, status, checks,
    questionId: status === 'verified' ? null : status === 'needs_approval' ? 'installation-approval' : stageId,
    canAsk: true,
  };
}

export function initialView(mode, stageId = 'environment') {
  assertStage(mode, stageId);
  return view(mode, stageId, 'needs_input', [{ name: stageId, status: 'NOT_RUN', code: 'CHECK_NOT_RUN' }]);
}

export function stagePrompt(current) {
  assertStage(current.mode, current.stageId);
  return {
    question: current.questionId === null ? null
      : current.questionId === 'installation-approval' ? '변경 대상, 비용, 권한과 외부 전송 범위를 확인했나요?' : STAGES[current.stageId],
    guidance: current.mode !== 'community-cloud' && ['environment', 'installation'].includes(current.stageId)
      ? LOCAL_GUIDANCE[current.mode] : GUIDANCE[current.stageId],
  };
}

function checkForCode(code, status = 'FAIL') {
  const recognized = typeof code === 'string'
    && /^[A-Z][A-Z0-9_]*$/u.test(code)
    && (Object.hasOwn(EXTRA_MESSAGES, code) || new PlanFailure(code).code === code);
  const safeCode = recognized ? code : 'UNKNOWN_CHECK_CODE';
  const name = ['CREDENTIAL_MISSING', 'CREDENTIAL_INVALID', 'CREDENTIAL_INSUFFICIENT'].includes(safeCode)
    ? 'environment'
    : ['PROJECT_REF_MISSING', 'REGION_UNVERIFIED', 'REGION_MISMATCH'].includes(safeCode)
      ? 'cloud-resources' : 'installation';
  return { name, status: recognized ? status : 'FAIL', code: safeCode };
}

function blocked(mode, checks) {
  const failures = checks.filter(check => check.status === 'FAIL');
  const first = failures.find(check => !INPUT_CODES.has(check.code)) ?? failures[0];
  return view(mode, first.name, failures.every(check => INPUT_CODES.has(check.code)) ? 'needs_input' : 'blocked', checks);
}

/** Projects trusted plan/doctor results into public guidance, never execution authority. */
export function viewFromSupabaseResult(mode, result) {
  assertStage(mode, 'installation');
  if (result == null) return initialView(mode, 'installation');
  const invalid = code => blocked(mode, [checkForCode(code)]);
  if (mode !== 'community-cloud') return invalid('SUPABASE_NOT_LOCAL_INSTALL');
  if (!record(result)) return invalid('CHECK_RESULT_INVALID');
  if (Object.hasOwn(result, 'error')) {
    if (Object.keys(result).length !== 1) return invalid('CHECK_RESULT_INVALID');
    return invalid(result.error?.code);
  }
  const keys = result.operation === 'plan' ? PLAN_KEYS : result.operation === 'doctor' ? DOCTOR_KEYS : null;
  if (!keys || Object.keys(result).some(key => !keys.has(key))
    || result.readOnly !== true || typeof result.ready !== 'boolean'
    || !Array.isArray(result.blockers)
    || (result.notices !== undefined && !Array.isArray(result.notices))) return invalid('CHECK_RESULT_INVALID');
  const checks = result.blockers.map(item => checkForCode(item?.code));
  checks.push(...(result.notices ?? []).map(item => checkForCode(item?.code,
    NOTICE_CODES.has(item?.code) ? 'NOT_RUN' : 'FAIL')));
  if (checks.some(check => check.status === 'FAIL')) return blocked(mode, checks);
  if (!result.ready || !sha256(result.stateFingerprint)) return invalid('CHECK_RESULT_INVALID');
  if (result.operation === 'plan') {
    if (result.target !== 'hosted' || !sha256(result.planFingerprint)) return invalid('CHECK_RESULT_INVALID');
    if (result.unchanged !== true) return invalid('PLAN_STATE_CHANGED');
    return view(mode, 'installation', 'needs_approval', [{ name: 'installation', status: 'PASS', code: 'PLAN_READY' }]);
  }
  if (result.installed?.state !== 'installed' || result.health?.installedHealthy !== true) {
    return invalid('HEALTH_FAILED');
  }
  if (result.health.runtimeReady !== true && !checks.some(check => check.code === 'RUNTIME_NOT_READY')) {
    checks.push(checkForCode('RUNTIME_NOT_READY', 'NOT_RUN'));
  }
  return view(mode, 'installation', 'verified', [
    { name: 'installation', status: 'PASS', code: 'INSTALLATION_VERIFIED' }, ...checks,
  ]);
}
