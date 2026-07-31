import { redirect } from 'next/navigation';
import { createCounselingRecordAction } from '../../../../../../actions';
import { ParticipantHeroCard } from '../../../../../../components/wire/participant-hero-card';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { ApiError, getNewRecordContext, getParticipantDetail, lifeAreaKeys, lifeAreaStatuses, type ApiErrorCode, type NewRecordContext, type ParticipantDetail } from '../../../../../../lib/api';
import { RecordOnepage } from './record-onepage';

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

/** HERO 메타용 날짜. 시각까지는 필요 없다 — 한 줄이 길어질수록 안 읽힌다. */
function dateOnlyLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
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
  const content: Record<RecoveryState, { className: string; role: 'alert' | 'status'; text: string }> = {
    idle: { className: 'status warning', role: 'status', text: '아직 서버에 저장되지 않았습니다.' },
    invalid_request: { className: 'status risk', role: 'alert', text: '입력 형식을 확인한 뒤 같은 제출 ID로 다시 시도하세요.' },
    validation_error: { className: 'status risk', role: 'alert', text: '입력한 상담 기록을 확인한 뒤 같은 제출 ID로 다시 시도하세요.' },
    authentication_required: { className: 'status risk', role: 'alert', text: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 새 상담 기록을 시작하세요.' },
    access_denied: { className: 'status risk', role: 'alert', text: '이 참여 사업에 상담 기록을 남길 권한이 없습니다. 권한을 확인한 뒤 새 상담 기록을 시작하세요.' },
    forbidden: { className: 'status risk', role: 'alert', text: '현재 권한으로는 이 상담 기록을 저장할 수 없습니다. 권한 상태를 확인하세요.' },
    not_found: { className: 'status risk', role: 'alert', text: '요청한 당사자 또는 참여 사업을 찾을 수 없습니다. 목록에서 참여 사업 상태를 확인하세요.' },
    conflict: { className: 'status risk', role: 'alert', text: '같은 제출 ID에 다른 저장 요청이 있어 이 기록을 등록하지 않았습니다.' },
    not_eligible_or_already_purged: { className: 'status risk', role: 'alert', text: '현재 참여 사업에는 상담 기록을 등록할 수 없습니다. 참여 사업 상태를 확인하세요.' },
    pilot_text_ai_consent_required: { className: 'status risk', role: 'alert', text: '텍스트 AI 파일럿 동의가 확인되지 않아 요청을 처리할 수 없습니다. 동의 상태를 확인하세요.' },
    text_ai_pilot_disabled: { className: 'status risk', role: 'alert', text: '텍스트 AI 파일럿이 현재 사용할 수 없어 요청을 처리할 수 없습니다.' },
    stale_draft_version: { className: 'status risk', role: 'alert', text: '기록 초안이 변경되어 요청을 처리할 수 없습니다. 최신 상태를 확인하세요.' },
    draft_version_required: { className: 'status risk', role: 'alert', text: '기록 초안 버전이 확인되지 않아 요청을 처리할 수 없습니다. 최신 상태를 확인하세요.' },
    grounded_evidence_required: { className: 'status risk', role: 'alert', text: '확인 가능한 근거가 없어 요청을 처리할 수 없습니다. 최신 상태를 확인하세요.' },
    ai_provider_not_configured: { className: 'status risk', role: 'alert', text: '텍스트 AI 서비스를 현재 설정할 수 없어 요청을 처리할 수 없습니다.' },
    ai_prohibited_output: { className: 'status risk', role: 'alert', text: '안전 기준에 맞지 않는 AI 결과가 감지되어 요청을 처리할 수 없습니다.' },
    ai_provider_unavailable: { className: 'status risk', role: 'alert', text: '텍스트 AI 서비스를 지금 사용할 수 없어 요청을 처리할 수 없습니다.' },
    // G1 의 두 코드는 등록 화면에서 나는 실패다. 상담 기록 저장 경로에서는 나지 않지만
    // 공용 Notice 타입을 쓰므로 자리는 채워 둔다(빠지면 타입이 깨진다).
    privacy_consent_required: { className: 'status risk', role: 'alert', text: '개인정보 수집·이용 동의가 확인되지 않아 요청을 처리할 수 없습니다. 당사자 정보 화면에서 동의 상태를 확인하세요.' },
    emergency_reason_required: { className: 'status risk', role: 'alert', text: '긴급 등록 사유가 없어 요청을 처리할 수 없습니다.' },
    service_unavailable: { className: 'status risk', role: 'alert', text: '상담 기록 서비스에 연결할 수 없어 저장 여부를 확인할 수 없습니다. 이 화면에서는 재제출하거나 내용을 복원하지 않습니다.' },
    unknown_outcome: { className: 'status risk', role: 'alert', text: '저장 결과를 확인할 수 없습니다. 이 화면에서는 제출 조회나 내용 재구성을 하지 않습니다.' },
  };
  const item = content[state];
  return <p className={item.className} role={item.role} aria-live="polite" data-recovery-state={state}>{item.text}</p>;
}

function Message({ code }: { code: LoadError | null }) {
  if (code === null || messages[code] === undefined) return null;
  return <p className="status risk" role="alert">{messages[code]}</p>;
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
  const newRecordPath = beneficiaryId === null || supportCaseId === null ? '/' : `${historyPath}/new`;
  const mustCheckOutcome = state === 'unknown_outcome' || state === 'service_unavailable';
  const mustStartFresh = state === 'conflict';
  // HERO 메타 한 줄(D38 슬롯 ③) — 쓰기 화면에 필요한 맥락은 '지난 상담이 언제였나'와
  // '넘겨받은 액션이 몇 건인가' 둘이다. 없으면 그 조각만 빠진다.
  const heroMeta = [
    lastRecordSummary === null ? '첫 상담 기록' : `지난 상담 ${dateOnlyLabel(lastRecordSummary.heldAt)}`,
    openActionItems.length === 0 ? null : `미해결 액션 ${openActionItems.length}건`,
  ].filter((item): item is string => item !== null).join(' · ');

  return <main className="page-content">
    {/* ParticipantHeroCard (D38): 이 화면도 URL 이 당사자 한 명을 가리키므로 공통 머리를
        단다 — 상담 기록 읽기 화면만 갖고 있던 것을 쓰기 화면에도 맞춘다.
        함께 없앤 것(둘 다 이미 확정된 결정인데 이 화면만 남아 있었다):
         * 브레드크럼 — D35 가 비관례로 기각. 나가는 길은 고정 헤더의 버튼이 갖는다
         * "당사자 ID swallow-003" 표기 — D31(가명 ID 는 기계 식별자). 이름은 HERO 가 갖는다
        제목은 '상담 기록 작성'에서 **'상담 기록'**으로 줄여 상태 태그 자리로 옮겼다(2026-07-31 Q). */}
    <ParticipantHeroCard
      name={participant.data?.name ?? null}
      beneficiaryId={beneficiaryId ?? '확인 불가'}
      stageTag="상담 기록"
      {...(heroMeta.length === 0 ? {} : { meta: heroMeta })}
    />
    <Message code={error} />
    <RecoveryStatus state={state} />

    {context.data === null || beneficiaryId === null || supportCaseId === null ? null : mustCheckOutcome ? <WireCard as="section" labelledBy="outcome-check-title" title={<h2 id="outcome-check-title">제출 결과 확인이 필요합니다.</h2>}>
      <p>서버에 제출 결과 조회 기능이 없어 이 화면에서 같은 내용을 다시 구성하거나 재제출하지 않습니다.</p>
      <p>제출 ID {recoverySubmissionId ?? '확인 불가'}를 유지한 채 해당 참여 사업의 상담 기록에서 등록 여부를 확인하세요.</p>
      <div className="wire-form-actions"><WireButton variant="primary" href={historyPath}>상담 기록 확인</WireButton></div>
    </WireCard> : mustStartFresh ? <WireCard as="section" labelledBy="conflict-record-title" title={<h2 id="conflict-record-title">새 제출 ID가 필요합니다.</h2>}>
      <p>충돌한 제출 ID는 재사용하지 않습니다. 기존 상담 기록을 확인한 뒤 새 상담 기록을 시작하세요.</p>
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
          <WireButton variant="secondary" href={historyPath}>상담 기록으로 돌아가기</WireButton>
          <WireButton variant="primary" type="submit">저장</WireButton>
        </>}
        supportCaseId={activeSupportCaseId}
        submissionFailed={state !== 'idle'}
      />

      <p className="panel-meta">제출 ID {submissionId}. 서버가 즉시 재시도를 허용한 경우에만 같은 ID를 유지합니다.</p>
    </form>}
  </main>;
}
