import { GridContainer } from '../../../../../components/wire/grid-container';
import { ParticipantHeroCard } from '../../../../../components/wire/participant-hero-card';
import { WireButton } from '../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../components/wire/wire-card';
import { getDisplayLabels } from '../../../../../lib/display-labels';
import {
  ApiError,
  getParticipantDetail,
  listSupportCaseRecords,
  type CounselingScheduleStatus,
  type ParticipantDetail,
  type SupportCaseRecords,
} from '../../../../../lib/api';
import { RecordHashOpener } from './record-hash-opener';
import { RecordList, formatDateOnly, formatDateTime } from './record-list';

// 상담 기록 — 회차 상세 (D47 · ADR-0019).
//
// 브리핑 영역 ②가 한 줄 목록이면 이 화면은 **그 줄을 펴서 보는 곳**이다. 그래서 기본은
// 최신 1개만 펼치고 나머지는 같은 모양의 접힌 줄로 둔다.
//
// 이 화면에서 없앤 것(전부 확정 결정 이행, UI 훑기 R1~R3):
//  * GAS 점수·'읽기 전용 목표' 카드 — D43(GAS·세부 목표 층 전체 보류)
//  * 브레드크럼 — D35(비관례라 기각). 출구는 HERO 왼쪽 버튼이 갖는다
//  * "당사자 ID firefly-001" 표기 — D31(가명 ID는 기계 식별자). 이름은 HERO 가 갖는다
//
// 표현·회차 번호는 record-list.tsx 가 갖는다. 여기는 fetch·스코프·머리만 맡는다.

type SearchParams = Record<string, string | string[] | undefined>;

type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';
type LoadResult<T> = { data: T; error: null } | { data: null; error: ErrorKind };

const messages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 상담 기록을 확인하세요.',
  access_or_not_found: '요청한 상담 기록 정보를 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: '상담 기록을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
};
// 일정 상태는 전부 무채색 기본 배지다(2026-08-05 배지 스윕) — 전체 일정 화면(month-row-status)과
// 같은 어휘. 구 '예정'=라벤더는 '승인 대기'(AI 축)와 색이 겹쳤고, 구 '취소됨'·'불참'=리스크
// 핑크는 D9 위반이었다(리스크 색은 확인된 플래그·오류 전용, 일정 상태는 사실이지 경고가 아니다).
const schedulePresentations: Record<CounselingScheduleStatus, { className: string; label: string; message: string }> = {
  scheduled: {
    className: 'status',
    label: '예정',
    message: '기록 작성 시에만 명시적으로 완료 처리할 수 있습니다.',
  },
  completed: {
    className: 'status',
    label: '완료됨',
    message: '일정이 상담 기록과 연결되어 완료되었습니다.',
  },
  cancelled: {
    className: 'status',
    label: '취소됨',
    message: '이 일정은 취소되어 상담 기록으로 완료 처리할 수 없습니다.',
  },
  no_show: {
    className: 'status',
    label: '불참',
    message: '이 일정은 불참으로 처리되어 상담 기록으로 완료 처리할 수 없습니다.',
  },
};

function schedulePresentation(status: CounselingScheduleStatus): { className: string; label: string; message: string } {
  const presentation = schedulePresentations[status];
  if (presentation === undefined) throw new Error('Counseling schedule status was invalid.');
  return presentation;
}

function safeId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

function expectedApiErrorKind(error: ApiError): ErrorKind | null {
  switch (error.code) {
    case 'authentication_required':
      return 'authentication_required';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return 'access_or_not_found';
    case 'service_unavailable':
      return 'service_unavailable';
    default:
      return null;
  }
}

async function load<T>(request: Promise<T>): Promise<LoadResult<T>> {
  try {
    return { data: await request, error: null };
  } catch (error) {
    const kind = error instanceof ApiError ? expectedApiErrorKind(error) : null;
    if (kind === null) throw error;
    return { data: null, error: kind };
  }
}

function Message({ code }: { code: ErrorKind | null }) {
  if (code === null) return null;
  return <p className="status risk" role="alert">{messages[code]}</p>;
}

function Notice({ code }: { code: string | undefined }) {
  if (code !== 'record_submission_processed') return null;
  return <p className="status blue" role="status" aria-live="polite">상담 기록 화면으로 이동했습니다. 아래 목록에서 제출 결과를 확인하세요.</p>;
}

/**
 * 전체 목표 한 줄 — 브리핑과 같은 어휘이되 **읽기 전용**이다(D47 §1).
 * 설정·수정은 브리핑 몫이라 여기에는 입력칸도 저장 버튼도 없다.
 */
function OverallGoalRow({ overallGoal }: { overallGoal: string | null }) {
  return <section className="surface-card record-goal" aria-label="전체 목표">
    <span className="record-goal-label">전체 목표</span>
    {overallGoal === null || overallGoal.length === 0
      ? <p className="record-goal-text is-empty">아직 설정 전입니다. 상담 준비 화면에서 설정할 수 있습니다.</p>
      : <p className="record-goal-text">{overallGoal}</p>}
  </section>;
}

export default async function RecordHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ beneficiaryId: rawBeneficiaryId, supportCaseId: rawSupportCaseId }, query] = await Promise.all([params, searchParams]);
  const beneficiaryId = safeId(rawBeneficiaryId);
  const supportCaseId = safeId(rawSupportCaseId);
  const result: LoadResult<SupportCaseRecords> = beneficiaryId === null || supportCaseId === null
    ? { data: null, error: 'access_or_not_found' }
    : await load(listSupportCaseRecords(beneficiaryId, supportCaseId));
  // 이름은 HERO 의 고정 1층이라 별도로 읽는다(D38). 실패해도 화면은 성립해야 하므로
  // 가명 ID 폴백으로 낮춘다 — 기록을 못 여는 것보다 이름이 없는 편이 낫다.
  const participant: LoadResult<ParticipantDetail> = beneficiaryId === null
    ? { data: null, error: 'access_or_not_found' }
    : await load(getParticipantDetail(beneficiaryId));
  const { programLabels } = await getDisplayLabels();

  const records = result.data?.records ?? [];
  const schedule = result.data?.schedule ?? null;
  // '기록 오류'로 처리된 불일치가 가리키는 회차 (CCC-42). 쌍의 양쪽에 붙는다 — 0027 에
  // 어느 쪽이 오류인지 담는 칸이 없다.
  const recordErrorSessionIds = new Set(result.data?.recordErrorSessionIds ?? []);
  const notice = queryValue(query, 'notice');
  const error = result.error;
  const basePath = beneficiaryId === null || supportCaseId === null
    ? '/'
    : `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;
  const participantPath = beneficiaryId === null ? '/' : `/participants/${encodeURIComponent(beneficiaryId)}`;
  const currentSchedulePresentation = schedule === null ? null : schedulePresentation(schedule.status);
  // 인테이크(kind=intake)가 아직 없는 케이스에서만 인테이크 작성이 프라이머리다(1회 규칙).
  // 버튼을 하나 더 두지 않고 자리를 갈아끼워 D38 의 '최대 2개'를 지킨다(D47 §3).
  const hasIntake = records.some((record) => record.kind === 'intake');
  // 최신 상담일이 목록 맨 위다(서버가 held_at DESC 로 준다).
  const latestHeldAt = records[0]?.heldAt ?? null;

  const heroMeta = [
    result.data === null ? null : programLabels[result.data.programType],
    records.length === 0 ? '기록 없음' : `${records.length}회차까지 기록됨`,
    latestHeldAt === null ? null : `최근 상담 ${formatDateOnly(latestHeldAt)}`,
  ].filter((item): item is string => item !== null).join(' · ');

  return <GridContainer as="main" className="page-content">
    <RecordHashOpener />
    {/* ParticipantHeroCard (D38): 케이스 1개를 보는 화면이라 상태 태그가 필수다(슬롯 ②).
        브레드크럼은 이 카드가 대체한다 — 출구는 왼쪽 세컨더리 하나다(D35).
        exactOptionalPropertyTypes 라 없는 슬롯은 undefined 대신 키를 뺀다. */}
    <ParticipantHeroCard
      name={participant.data?.name ?? null}
      beneficiaryId={beneficiaryId ?? '확인 불가'}
      {...(result.data === null
        ? {}
        : { stageTag: result.data.caseStatus === 'active' ? '진행 중' : '종결' })}
      {...(heroMeta.length === 0 ? {} : { meta: heroMeta })}
      {...(beneficiaryId === null || supportCaseId === null ? {} : {
        actions: <>
          <WireButton variant="secondary" href={participantPath}>당사자 정보</WireButton>
          {result.data !== null && !hasIntake
            ? <WireButton variant="primary" href={`${basePath}/records/intake`}>인테이크 작성</WireButton>
            : <WireButton variant="primary" href={`${basePath}/records/new`}>상담 기록 작성</WireButton>}
        </>,
      })}
    />

    {result.data !== null && <OverallGoalRow overallGoal={result.data.overallGoal} />}

    <Notice code={notice} />
    <Message code={error} />

    {schedule === null || currentSchedulePresentation === null ? null : <WireCard
      as="section"
      labelledBy="schedule-status-title"
      title={<div className="wire-card-head">
        <h2 id="schedule-status-title">상담 일정</h2>
        <span className={currentSchedulePresentation.className}>{currentSchedulePresentation.label}</span>
      </div>}
    >
      <p>{formatDateTime(schedule.scheduledAt)} {currentSchedulePresentation.message}</p>
    </WireCard>}

    <h2 className="record-section-title">회차별 기록</h2>
    <RecordList
      records={records}
      recordErrorSessionIds={recordErrorSessionIds}
      unavailable={result.data === null}
    />
  </GridContainer>;
}
