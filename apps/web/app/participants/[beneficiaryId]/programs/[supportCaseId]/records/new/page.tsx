import { WireBadge } from '../../../../../../components/wire/wire-badge';
import { WireError } from '../../../../../../components/wire/wire-state';
import { redirect } from 'next/navigation';
import {
  closeGoalAction,
  countGoalUpcomingLinksAction,
  createCounselingRecordAction,
  createGoalAction,
  updateGoalTitleAction,
} from '../../../../../../actions';
import { GoalSection } from './goal-section';
import { MetaRow } from '../../../../../../components/wire/meta-row';
import { PageTitle } from '../../../../../../components/wire/page-title';
import { ParticipantHeroCard } from '../../../../../../components/wire/participant-hero-card';
import { RecordAccordionToggle } from './record-accordion-toggle';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { WireCallout } from '../../../../../../components/wire/wire-callout';
import { ApiError, getNewRecordContext, getParticipantDetail, lifeAreaKeys, lifeAreaStatuses, type ApiErrorCode, type NewRecordContext, type ParticipantDetail } from '../../../../../../lib/api';
import { RecordOnepage } from './record-onepage';
import { formatKoreanDate } from '../../../../../../lib/format-korean-date';

type SearchParams = Record<string, string | string[] | undefined>;
type SubmissionFailure = ApiErrorCode;
type RecoveryState = 'idle' | SubmissionFailure | 'unknown_outcome';
type SubmissionOutcome = 'saved' | 'replayed' | Exclude<RecoveryState, 'idle'>;
type LoadError = 'access_denied' | 'authentication_required' | 'forbidden' | 'not_found' | 'service_unavailable';
type LoadResult<T> = { data: T; error: null } | { data: null; error: LoadError };

class FormInputError extends Error {}

const flagTypes = [
  ['crisis_utterance', '위기 발언'],
  ['contact_loss_risk', '연락 두절 위험'],
  ['housing_livelihood_shock', '주거·생계 급변'],
  ['debt_deterioration', '부채 악화'],
  ['repeated_noncompliance', '약속 불이행 반복'],
] as const;

// 서술형 항목(CCC-10 · 0016). 폼 필드 이름과 record_details 키가 1:1이다.
const detailFields = ['sessionGoalNote', 'changeSinceLast', 'safetyNote', 'counselorOpinion'] as const;

const resolutionStatuses = [
  ['done', '완료'],
  ['in_progress', '진행 중'],
  ['not_done', '못 함'],
  ['hold', '보류'],
] as const;

const messages: Record<LoadError, string> = {
  access_denied: '이 참여 사업에 상담 기록을 남길 권한이 없습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도하세요.',
  forbidden: '이 참여 사업에 상담 기록을 남길 권한이 없습니다.',
  not_found: '요청한 당사자 ID 또는 참여 사업을 찾을 수 없습니다.',
  service_unavailable: '상담 기록 서비스를 지금 사용할 수 없습니다. 잠시 후 다시 시도하세요.',
};

function safeId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

/** HERO 메타용 날짜. 시각까지는 필요 없다 — 한 줄이 길어질수록 안 읽힌다.
 *  표기는 공용 계약(2026-08-07 Q 통일)이다. */
function dateOnlyLabel(value: string): string {
  return formatKoreanDate(value);
}

function safeSubmissionId(value: string | undefined): string | null {
  return value !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value) ? value : null;
}

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

function recoveryState(value: string | undefined): RecoveryState {
  switch (value) {
    case 'invalid_request':
    case 'validation_error':
    case 'authentication_required':
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
    case 'conflict':
    case 'not_eligible_or_already_purged':
    case 'pilot_text_ai_consent_required':
    case 'text_ai_pilot_disabled':
    case 'stale_draft_version':
    case 'draft_version_required':
    case 'grounded_evidence_required':
    case 'ai_provider_not_configured':
    case 'ai_prohibited_output':
    case 'ai_provider_unavailable':
    case 'service_unavailable':
    case 'unknown_outcome':
      return value;
    default:
      return 'idle';
  }
}

async function load<T>(request: Promise<T>): Promise<LoadResult<T>> {
  try {
    return { data: await request, error: null };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    switch (error.code) {
      case 'access_denied':
      case 'authentication_required':
      case 'forbidden':
      case 'not_found':
      case 'service_unavailable':
        return { data: null, error: error.code };
      default:
        throw error;
    }
  }
}

function historyDestination(beneficiaryId: string, supportCaseId: string): string {
  const params = new URLSearchParams({ notice: 'record_submission_processed' });
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/records?${params.toString()}`;
}

function recoveryDestination(beneficiaryId: string, supportCaseId: string, state: Exclude<RecoveryState, 'idle'>, submissionId: string): string {
  const params = new URLSearchParams({ outcome: state, submissionId });
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/records/new?${params.toString()}`;
}

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string') throw new FormInputError();
  return value;
}

/**
 * 조건부로 렌더되거나 disabled 인 필드(이번 상담 목표·목표 종료 사유 등)는 폼 데이터에
 * 아예 실리지 않는다. 없는 값은 빈 문자열로 본다 — 미입력과 같은 취급이다.
 */
function optionalStringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (value === null) return '';
  if (typeof value !== 'string') throw new FormInputError();
  return value;
}

function stringValues(formData: FormData, name: string): string[] {
  return formData.getAll(name).map((value) => {
    if (typeof value !== 'string') throw new FormInputError();
    return value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function jsonRecord(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new FormInputError();
  }
  if (!isRecord(parsed)) throw new FormInputError();
  return parsed;
}

function parseChoice(value: string): { id: string; version: number } {
  const parsed = jsonRecord(value);
  const id = parsed.id;
  const version = parsed.version;
  if (typeof id !== 'string' || safeId(id) === null || typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new FormInputError();
  }
  return { id, version };
}

function parseGasScores(formData: FormData): Array<{ goalId: string; score: number }> {
  const gasScores: Array<{ goalId: string; score: number }> = [];
  const scoredGoalIds = new Set<string>();

  for (const value of stringValues(formData, 'gasScore')) {
    if (value.length === 0) continue;

    const parsed = jsonRecord(value);
    const goalId = parsed.goalId;
    const score = parsed.score;
    if (
      typeof goalId !== 'string'
      || safeId(goalId) === null
      || typeof score !== 'number'
      || !Number.isInteger(score)
      || score < -2
      || score > 2
      || scoredGoalIds.has(goalId)
    ) throw new FormInputError();
    scoredGoalIds.add(goalId);
    gasScores.push({ goalId, score });
  }
  return gasScores;
}

function buildRecordFormData(formData: FormData): FormData {
  const payload = new FormData();
  for (const name of ['beneficiaryId', 'supportCaseId', 'submissionId', 'heldAt', 'channel', 'memo']) {
    payload.set(name, stringValue(formData, name));
  }

  payload.set('gasScoresJson', JSON.stringify(parseGasScores(formData)));

  const actionItems: Array<{ description: string; owner: 'counselor' | 'beneficiary' | 'org'; dueDate?: string }> = [];
  for (let index = 0; index < 3; index += 1) {
    const description = stringValue(formData, `actionDescription${index}`).trim();
    const owner = stringValue(formData, `actionOwner${index}`);
    const dueDate = stringValue(formData, `actionDueDate${index}`);
    if (description.length === 0 && dueDate.length === 0) continue;
    if (
      description.length === 0
      || (owner !== 'counselor' && owner !== 'beneficiary' && owner !== 'org')
      || (dueDate.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
    ) throw new FormInputError();
    actionItems.push(dueDate.length === 0 ? { description, owner } : { description, owner, dueDate });
  }
  payload.set('actionItemsJson', JSON.stringify(actionItems));

  const flags = stringValues(formData, 'flagType').map((value) => {
    if (!flagTypes.some(([flagType]) => flagType === value)) throw new FormInputError();
    return { flagType: value };
  });
  payload.set('flagsJson', JSON.stringify(flags));

  // 6영역 스냅샷(CCC-8): 6영역 전부 실어 보낸다. 상태 미선택('')이면 '변화 없음'(changed=false).
  const lifeAreas = lifeAreaKeys.map((areaKey) => {
    const status = stringValue(formData, `lifeAreaStatus_${areaKey}`);
    const note = stringValue(formData, `lifeAreaNote_${areaKey}`).trim();
    if (status.length === 0) return { areaKey, changed: false as const };
    if (!(lifeAreaStatuses as readonly string[]).includes(status)) throw new FormInputError();
    return note.length === 0
      ? { areaKey, changed: true as const, status }
      : { areaKey, changed: true as const, status, note };
  });
  payload.set('lifeAreasJson', JSON.stringify(lifeAreas));

  const resolutions: Array<{ actionItemId: string; status: string; note?: string }> = [];
  const resolvedActionIds = new Set<string>();
  for (const actionItemId of stringValues(formData, 'openActionItemId')) {
    if (safeId(actionItemId) === null || resolvedActionIds.has(actionItemId)) throw new FormInputError();
    resolvedActionIds.add(actionItemId);
    const status = stringValue(formData, `resolutionStatus_${actionItemId}`);
    if (status.length === 0) continue;
    if (!resolutionStatuses.some(([value]) => value === status)) throw new FormInputError();
    const note = stringValue(formData, `resolutionNote_${actionItemId}`).trim();
    resolutions.push(note.length === 0 ? { actionItemId, status } : { actionItemId, status, note });
  }
  payload.set('actionResolutionsJson', JSON.stringify(resolutions));

  // 서술형 항목(CCC-10): 채운 항목만 담고, 하나도 없으면 detailsJson 자체를 비운다.
  const details: Record<string, string> = {};
  for (const field of detailFields) {
    const text = optionalStringValue(formData, field).trim();
    if (text.length > 0) details[field] = text;
  }
  payload.set('detailsJson', Object.keys(details).length === 0 ? '' : JSON.stringify(details));

  // 목표 종료+신설(D12): 종료할 목표를 고른 경우에만 사유(필수)·새 목표(선택)를 함께 보낸다.
  const closeGoalId = optionalStringValue(formData, 'closeGoalId').trim();
  if (closeGoalId.length === 0) {
    payload.set('goalTransitionJson', '');
  } else {
    if (safeId(closeGoalId) === null) throw new FormInputError();
    const closedReason = optionalStringValue(formData, 'goalClosedReason').trim();
    if (closedReason.length === 0) throw new FormInputError();
    const newGoalTitle = optionalStringValue(formData, 'newGoalTitle').trim();
    payload.set('goalTransitionJson', JSON.stringify(
      newGoalTitle.length === 0 ? { closeGoalId, closedReason } : { closeGoalId, closedReason, newGoalTitle },
    ));
  }

  const scheduleChoice = optionalStringValue(formData, 'scheduleCompletion');
  if (scheduleChoice.length > 0) {
    const { id, version } = parseChoice(scheduleChoice);
    payload.set('scheduleId', id);
    payload.set('expectedScheduleVersion', String(version));
  }
  return payload;
}


function responseOutcome(result: unknown): SubmissionOutcome {
  if (!isRecord(result) || Object.keys(result).length !== 1 || typeof result.status !== 'string') {
    return 'unknown_outcome';
  }

  switch (result.status) {
    case 'saved':
    case 'replayed':
    case 'invalid_request':
    case 'validation_error':
    case 'authentication_required':
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
    case 'conflict':
    case 'not_eligible_or_already_purged':
    case 'pilot_text_ai_consent_required':
    case 'text_ai_pilot_disabled':
    case 'stale_draft_version':
    case 'draft_version_required':
    case 'grounded_evidence_required':
    case 'ai_provider_not_configured':
    case 'ai_prohibited_output':
    case 'ai_provider_unavailable':
    case 'service_unavailable':
      return result.status;
    default:
      return 'unknown_outcome';
  }
}

async function submitRecord(formData: FormData): Promise<void> {
  'use server';

  let beneficiaryId: string;
  let supportCaseId: string;
  let submissionId: string;
  try {
    beneficiaryId = stringValue(formData, 'beneficiaryId');
    supportCaseId = stringValue(formData, 'supportCaseId');
    submissionId = stringValue(formData, 'submissionId');
    if (safeId(beneficiaryId) === null || safeId(supportCaseId) === null || safeSubmissionId(submissionId) === null) {
      throw new FormInputError();
    }
  } catch (error) {
    if (error instanceof FormInputError) redirect('/');
    throw error;
  }

  let payload: FormData;
  try {
    payload = buildRecordFormData(formData);
  } catch (error) {
    if (error instanceof FormInputError) {
      redirect(recoveryDestination(beneficiaryId, supportCaseId, 'invalid_request', submissionId));
    }
    throw error;
  }

  let outcome: SubmissionOutcome;
  try {
    outcome = responseOutcome(await createCounselingRecordAction(payload));
  } catch {
    outcome = 'unknown_outcome';
  }

  if (outcome === 'saved' || outcome === 'replayed') {
    redirect(historyDestination(beneficiaryId, supportCaseId));
  }
  redirect(recoveryDestination(beneficiaryId, supportCaseId, outcome, submissionId));
}

function RecoveryStatus({ state }: { state: RecoveryState }) {
  const content: Record<RecoveryState, { tone: 'lavender' | 'risk'; role: 'alert' | 'status'; text: string }> = {
    idle: { tone: 'lavender', role: 'status', text: '아직 서버에 저장되지 않았습니다.' },
    invalid_request: { tone: 'risk', role: 'alert', text: '입력 형식을 확인한 뒤 같은 제출 ID로 다시 시도하세요.' },
    validation_error: { tone: 'risk', role: 'alert', text: '입력한 상담 기록을 확인한 뒤 같은 제출 ID로 다시 시도하세요.' },
    authentication_required: { tone: 'risk', role: 'alert', text: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 새 상담 기록을 시작하세요.' },
    access_denied: { tone: 'risk', role: 'alert', text: '이 참여 사업에 상담 기록을 남길 권한이 없습니다. 권한을 확인한 뒤 새 상담 기록을 시작하세요.' },
    forbidden: { tone: 'risk', role: 'alert', text: '현재 권한으로는 이 상담 기록을 저장할 수 없습니다. 권한 상태를 확인하세요.' },
    not_found: { tone: 'risk', role: 'alert', text: '요청한 당사자 또는 참여 사업을 찾을 수 없습니다. 목록에서 참여 사업 상태를 확인하세요.' },
    // CCC-57: 이 코드는 두 원인에서 온다. 같은 제출 ID의 다른 저장 요청, 그리고 완료할
    // 일정이 그 사이 바뀐 경우(버전 불일치). 완료할 일정이 기본으로 골라지게 되면서 후자가
    // 실제로 날 수 있는 길이 됐다. 서버가 둘을 다른 코드로 주지 않으므로 문구가 둘 다 덮는다.
    conflict: { tone: 'risk', role: 'alert', text: '같은 제출 ID에 다른 저장 요청이 있거나, 완료할 일정이 그 사이 변경되어 이 기록을 등록하지 않았습니다.' },
    not_eligible_or_already_purged: { tone: 'risk', role: 'alert', text: '현재 참여 사업에는 상담 기록을 등록할 수 없습니다. 참여 사업 상태를 확인하세요.' },
    pilot_text_ai_consent_required: { tone: 'risk', role: 'alert', text: '텍스트 AI 파일럿 동의가 확인되지 않아 요청을 처리할 수 없습니다. 동의 상태를 확인하세요.' },
    text_ai_pilot_disabled: { tone: 'risk', role: 'alert', text: '텍스트 AI 파일럿이 현재 사용할 수 없어 요청을 처리할 수 없습니다.' },
    stale_draft_version: { tone: 'risk', role: 'alert', text: '기록 초안이 변경되어 요청을 처리할 수 없습니다. 최신 상태를 확인하세요.' },
    draft_version_required: { tone: 'risk', role: 'alert', text: '기록 초안 버전이 확인되지 않아 요청을 처리할 수 없습니다. 최신 상태를 확인하세요.' },
    grounded_evidence_required: { tone: 'risk', role: 'alert', text: '확인 가능한 근거가 없어 요청을 처리할 수 없습니다. 최신 상태를 확인하세요.' },
    ai_provider_not_configured: { tone: 'risk', role: 'alert', text: '텍스트 AI 서비스를 현재 설정할 수 없어 요청을 처리할 수 없습니다.' },
    ai_prohibited_output: { tone: 'risk', role: 'alert', text: '안전 기준에 맞지 않는 AI 결과가 감지되어 요청을 처리할 수 없습니다.' },
    ai_provider_unavailable: { tone: 'risk', role: 'alert', text: '텍스트 AI 서비스를 지금 사용할 수 없어 요청을 처리할 수 없습니다.' },
    // G1 의 두 코드는 등록 화면에서 나는 실패다. 상담 기록 저장 경로에서는 나지 않지만
    // 공용 Notice 타입을 쓰므로 자리는 채워 둔다(빠지면 타입이 깨진다).
    privacy_consent_required: { tone: 'risk', role: 'alert', text: '개인정보 수집·이용 동의가 확인되지 않아 요청을 처리할 수 없습니다. 당사자 정보 화면에서 동의 상태를 확인하세요.' },
    emergency_reason_required: { tone: 'risk', role: 'alert', text: '긴급 등록 사유가 없어 요청을 처리할 수 없습니다.' },
    service_unavailable: { tone: 'risk', role: 'alert', text: '상담 기록 서비스에 연결할 수 없어 저장 여부를 확인할 수 없습니다. 이 화면에서는 재제출하거나 내용을 복원하지 않습니다.' },
    unknown_outcome: { tone: 'risk', role: 'alert', text: '저장 결과를 확인할 수 없습니다. 이 화면에서는 제출 조회나 내용 재구성을 하지 않습니다.' },
  };
  const item = content[state];
  // 미저장 안내는 알약이 아니라 공용 안내줄이다(2026-08-08 Q — 주의·대기 축의 콜아웃,
  // 인테이크 남은 필수·일정 경고와 같은 부품). 오류는 다른 화면과 같은 risk 배지 유지.
  if (state === 'idle') {
    return <WireCallout tone="lavender" role="status" testId="record-unsaved-notice" title="아직 서버에 저장되지 않았습니다">
      저장을 누르기 전까지 이 화면의 내용은 서버에 남지 않습니다.
    </WireCallout>;
  }
  return <WireBadge tone={item.tone} role={item.role} aria-live="polite" data-recovery-state={state}>{item.text}</WireBadge>;
}

function Message({ code }: { code: LoadError | null }) {
  if (code === null || messages[code] === undefined) return null;
  return <WireError>{messages[code]}</WireError>;
}

export default async function NewRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ beneficiaryId: rawBeneficiaryId, supportCaseId: rawSupportCaseId }, query] = await Promise.all([params, searchParams]);
  const beneficiaryId = safeId(rawBeneficiaryId);
  const supportCaseId = safeId(rawSupportCaseId);
  const context: LoadResult<NewRecordContext> = beneficiaryId === null || supportCaseId === null
    ? { data: null, error: 'not_found' }
    : await load(getNewRecordContext(beneficiaryId, supportCaseId));
  // 이름은 HERO 의 고정 1층이라 따로 읽는다(D38). 실패해도 화면은 성립해야 하므로
  // 가명 ID 폴백으로 낮춘다 — 기록을 못 쓰는 것보다 이름이 없는 편이 낫다.
  const participant: LoadResult<ParticipantDetail> = beneficiaryId === null
    ? { data: null, error: 'not_found' }
    : await load(getParticipantDetail(beneficiaryId));
  const activeBeneficiaryId = beneficiaryId ?? '';
  const activeSupportCaseId = supportCaseId ?? '';
  const programPath = beneficiaryId === null || supportCaseId === null
    ? '/'
    : `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;
  const historyPath = programPath === '/' ? '/' : `${programPath}/records`;
  const state = recoveryState(queryValue(query, 'outcome'));
  const recoverySubmissionId = safeSubmissionId(queryValue(query, 'submissionId'));
  const retryWithSameSubmissionId = state === 'invalid_request' || state === 'validation_error';
  const submissionId = retryWithSameSubmissionId && recoverySubmissionId !== null
    ? recoverySubmissionId
    : state === 'idle' || retryWithSameSubmissionId
      ? crypto.randomUUID()
      : '';
  const error = context.error;
  const goals = context.data?.goals ?? [];
  const schedules = context.data?.schedules ?? [];
  const openActionItems = context.data?.openActionItems ?? [];
  const latestLifeAreaSnapshot = context.data?.latestLifeAreaSnapshot ?? [];
  const sessionGoals = context.data?.sessionGoals ?? [];
  const customQuestions = context.data?.customQuestions ?? [];
  const lastRecordSummary = context.data?.lastRecordSummary ?? null;
  // HERO 상태 태그는 **화면 이름이 아니라 이 기록이 무엇인가**를 보인다(2026-08-09 Q).
  // 이 화면은 정기 상담 전용이다(인테이크는 자기 라우트가 있다) — 그래서 유형은 고정이고
  // 회차만 서버가 센 값을 따라간다. 조회 실패로 회차를 모르면 유형만 남긴다.
  const nextSessionSequence = context.data?.nextSessionSequence ?? null;
  const stageTag = nextSessionSequence === null ? '기본 상담' : `기본 상담 ${nextSessionSequence}회`;
  const newRecordPath = beneficiaryId === null || supportCaseId === null ? '/' : `${historyPath}/new`;
  const mustCheckOutcome = state === 'unknown_outcome' || state === 'service_unavailable';
  const mustStartFresh = state === 'conflict';
  // HERO 메타 한 줄(D38 슬롯 ③) — 쓰기 화면에 필요한 맥락은 '지난 상담이 언제였나'와
  // '넘겨받은 액션이 몇 건인가' 둘이다. 없으면 그 조각만 빠진다.
  // 구분자 가운뎃점 대신 조각을 독립 노드로 두고 간격으로 띄운다(§10, 2026-08-07).
  const heroMetaItems = [
    lastRecordSummary === null ? '첫 상담 기록' : `지난 상담 ${dateOnlyLabel(lastRecordSummary.heldAt)}`,
    openActionItems.length === 0 ? null : `미해결 액션 ${openActionItems.length}건`,
  ].filter((item): item is string => item !== null);

  return <main className="page-content">
    {/* 페이지 타이틀(2026-08-08 Q — 구 '상담 시작' 어휘 대체, 화면 이름은 '상담 기록'). */}
    <div className="page-header"><PageTitle>상담 기록</PageTitle></div>
    {/* ParticipantHeroCard (D38): 이 화면도 URL 이 당사자 한 명을 가리키므로 공통 머리를
        단다 — 상담 기록 읽기 화면만 갖고 있던 것을 쓰기 화면에도 맞춘다.
        함께 없앤 것(둘 다 이미 확정된 결정인데 이 화면만 남아 있었다):
         * 브레드크럼 — D35 가 비관례로 기각. 나가는 길은 고정 헤더의 버튼이 갖는다
         * "당사자 ID swallow-003" 표기 — D31(가명 ID 는 기계 식별자). 이름은 HERO 가 갖는다
        제목은 '상담 기록 작성'에서 **'상담 기록'**으로 줄여 상태 태그 자리로 옮겼다(2026-07-31 Q).
        전체 여닫기 버튼도 이 카드 안이다(2026-08-09 Q) — 구 자리는 본문 맨 위의 조작 줄이라
        스크롤을 내리면 화면 밖으로 나갔고, 정작 접힘 칸을 볼 때는 없었다. */}
    <ParticipantHeroCard
      name={participant.data?.name ?? null}
      beneficiaryId={beneficiaryId ?? '확인 불가'}
      stageTag={stageTag}
      {...(heroMetaItems.length === 0 ? {} : { meta: <MetaRow items={heroMetaItems} /> })}
      actions={<RecordAccordionToggle />}
    />
    <Message code={error} />
    <RecoveryStatus state={state} />

    {context.data === null || beneficiaryId === null || supportCaseId === null ? null : mustCheckOutcome ? <WireCard as="section" labelledBy="outcome-check-title" title={<h2 id="outcome-check-title">제출 결과 확인이 필요합니다.</h2>}>
      <p>서버에 제출 결과 조회 기능이 없어 이 화면에서 같은 내용을 다시 구성하거나 재제출하지 않습니다.</p>
      <p>제출 ID {recoverySubmissionId ?? '확인 불가'}를 유지한 채 해당 참여 사업의 상담 기록에서 등록 여부를 확인하세요.</p>
      <div className="wire-form-actions"><WireButton variant="primary" href={historyPath}>상담 기록 확인</WireButton></div>
    {/* CCC-57: 이 자리는 conflict 코드 하나가 오는 곳인데 원인이 둘이다. 제출 ID 충돌과
        완료할 일정의 버전 불일치. 서버가 둘을 가르지 않으므로 문구가 둘 다 덮는다. 어느
        쪽이든 다시 여는 것이 답이고, 쓰던 내용은 임시본으로 남아 다시 열 때 복원된다. */}
    </WireCard> : mustStartFresh ? <WireCard as="section" labelledBy="conflict-record-title" title={<h2 id="conflict-record-title">이 기록을 등록하지 않았습니다.</h2>}>
      <p>같은 제출 ID에 다른 저장 요청이 있었거나, 완료할 일정이 그 사이 변경되었습니다. 기존 상담 기록과 일정을 확인한 뒤 새 상담 기록을 시작하세요. 쓰던 내용은 임시본으로 남아 있어 새로 열면 복원할 수 있습니다.</p>
      <div className="wire-form-actions">
        <WireButton variant="secondary" href={historyPath}>상담 기록 보기</WireButton>
        <WireButton variant="primary" href={newRecordPath}>새 상담 기록 작성</WireButton>
      </div>
    </WireCard> : <form action={submitRecord} autoComplete="off" className="record-form" aria-labelledby="record-form-title">
      <input type="hidden" name="beneficiaryId" value={activeBeneficiaryId} />
      <input type="hidden" name="supportCaseId" value={activeSupportCaseId} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <RecordOnepage
        schedules={schedules}
        openActionItems={openActionItems}
        latestLifeAreaSnapshot={latestLifeAreaSnapshot}
        sessionGoals={sessionGoals}
        customQuestions={customQuestions}
        lastRecordSummary={lastRecordSummary}
        briefingPath={`${programPath}/briefing`}
        actions={<>
          {/* '상담 기록으로 돌아가기' → '상담 기록'(2026-08-09 Q). 가는 곳의 이름이 곧 라벨이고,
              '돌아가기'는 이 버튼이 하는 일을 두 번 말한다. */}
          <WireButton variant="secondary" href={historyPath}>상담 기록</WireButton>
          <WireButton variant="primary" type="submit">저장</WireButton>
        </>}
        // 세부 목표 구획(D62 · CCC-68). 서버 컴포넌트인 이 페이지가 액션을 묶어 슬롯으로
        // 내려보낸다 — 기록지 폼과 별개의 즉시 저장이다(구획 주석 참조).
        goalSection={(
          <GoalSection
            beneficiaryId={activeBeneficiaryId}
            supportCaseId={activeSupportCaseId}
            goals={goals}
            createAction={createGoalAction}
            renameAction={updateGoalTitleAction}
            closeAction={closeGoalAction}
            upcomingLinksAction={countGoalUpcomingLinksAction}
          />
        )}
        supportCaseId={activeSupportCaseId}
        submissionFailed={state !== 'idle'}
      />

      {/* 구 "제출 ID <uuid> …" 원문 표기는 삭제(2026-08-08 Q — 사람용 안내는 좌측 레일이
          갖고, ID 는 위 숨은 폼 값으로만 다닌다). */}
    </form>}
  </main>;
}
