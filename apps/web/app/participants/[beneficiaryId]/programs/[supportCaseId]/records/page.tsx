import { WireBadge } from '../../../../../components/wire/wire-badge';
import { WireError } from '../../../../../components/wire/wire-state';
import Link from 'next/link';
import { GridContainer } from '../../../../../components/wire/grid-container';
import { PageTitle } from '../../../../../components/wire/page-title';
import { MetaRow } from '../../../../../components/wire/meta-row';
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
import { RecordDraftCleanup } from './record-draft-cleanup';
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
    className: 'wire-badge',
    label: '예정',
    message: '기록 작성 시에만 명시적으로 완료 처리할 수 있습니다.',
  },
  completed: {
    className: 'wire-badge',
    label: '완료됨',
    message: '일정이 상담 기록과 연결되어 완료되었습니다.',
  },
  cancelled: {
    className: 'wire-badge',
    label: '취소됨',
    message: '이 일정은 취소되어 상담 기록으로 완료 처리할 수 없습니다.',
  },
  no_show: {
    className: 'wire-badge',
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
  return <WireError>{messages[code]}</WireError>;
}

function Notice({ code }: { code: string | undefined }) {
  if (code !== 'record_submission_processed') return null;
    return <WireBadge role="status" aria-live="polite">상담 기록 화면으로 이동했습니다. 아래 목록에서 제출 결과를 확인하세요.</WireBadge>;
}

/**
 * 전체 목표 한 줄 — 브리핑과 같은 어휘이되 **읽기 전용**이다(D47 §1).
 * 설정·수정은 브리핑 몫이라 여기에는 입력칸도 저장 버튼도 없다.
 * 카드 모양은 WireCard 계약이 갖는다(2026-08-05 컴포넌트화 · ADR-0030).
 */
function OverallGoalRow({ overallGoal, briefingHref }: { overallGoal: string | null; briefingHref: string }) {
  return <WireCard as="section" className="record-goal" labelledBy="record-goal-label">
    <div className="record-goal-row">
      <span className="record-goal-label" id="record-goal-label">전체 목표</span>
      {overallGoal === null || overallGoal.length === 0
        // 일괄 검토 A10 (2026-08-08): 이 화면에서 브리핑으로 가는 길이 없어 문구를 링크로 승격.
        // 인라인 참조는 텍스트 링크가 맞다(D58 ⑥).
        ? <p className="record-goal-text is-empty">아직 설정 전입니다. <Link href={briefingHref}>15초 페이지</Link>에서 설정할 수 있습니다.</p>
        : <p className="record-goal-text">{overallGoal}</p>}
    </div>
  </WireCard>;
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
  //
  // **2026-08-09 Q: 이 조건을 그대로 둔다.** "필수로 추가해야 할 내용이 있을 때만 띄운다"로
  // 바꾸자는 검토가 있었는데, 조사해 보니 지금 조건이 이미 그 뜻이다. 근거 둘:
  //  ① 인테이크 위저드는 42문항 + 부채표 첫 칸 + 연계기관표 첫 칸 + 종합의견을 전부 필수로 세고,
  //     하나라도 비면 canComplete 가 false 라 저장 버튼이 잠긴다(intake-wizard.tsx).
  //     따라서 **화면을 통해 저장된 인테이크는 필수 미완일 수 없다** — '있는데 비어 있는' 상태는
  //     도달 불가다(질문지 정본이 늘어나 예전 인테이크가 소급 미완이 되는 경우만 예외).
  //  ② 그 예외까지 정확히 판정하려면 저장된 답변을 읽어야 하는데, 답변을 실어 주는
  //     getIntakeRecordContext 는 금고를 복호화하고 read_participant_pii 감사를 1건 남긴다
  //     (db/gateway.ts). 전체 상담 기록을 열 때마다 PII 열람 감사가 쌓여 D14·D24 기록이 오염된다.
  // 질문지가 늘어 소급 미완을 잡아야 할 때는 목록 API 가 저장된 답변 키를 함께 내려주는 길로 간다
  // (금고를 안 건드리므로 감사가 늘지 않는다).
  const hasIntake = records.some((record) => record.kind === 'intake');
  // 최신 상담일이 목록 맨 위다(서버가 held_at DESC 로 준다).
  const latestHeldAt = records[0]?.heldAt ?? null;

  // 구분자 가운뎃점 대신 조각을 독립 노드로 두고 간격으로 띄운다(§10, 2026-08-07).
  const heroMetaItems = [
    result.data === null ? null : programLabels[result.data.programType],
    records.length === 0 ? '기록 없음' : `${records.length}회차까지 기록됨`,
    latestHeldAt === null ? null : `최근 상담 ${formatDateOnly(latestHeldAt)}`,
  ].filter((item): item is string => item !== null);

  return <GridContainer as="main" className="page-content">
    {/* 페이지 타이틀(2026-08-08 Q). 이 화면의 이름은 '전체 상담 기록'이다 — 용어 통일. */}
    <div className="page-header"><PageTitle>전체 상담 기록</PageTitle></div>
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
      {...(heroMetaItems.length === 0 ? {} : { meta: <MetaRow items={heroMetaItems} /> })}
      {...(beneficiaryId === null || supportCaseId === null ? {} : {
        actions: <>
          <WireButton variant="secondary" href={participantPath}>당사자 정보</WireButton>
          {/* 인테이크가 없으면 첫 일은 인테이크다(1회 규칙). 있으면 프라이머리는 정기 기록으로
              돌아가고, 인테이크 확인·수정 입구는 아래 목록의 인테이크 회차가 갖는다
              (2026-08-08 Q — 구 '인테이크 작성' 라벨 대체). */}
          {result.data !== null && !hasIntake
            ? <WireButton variant="primary" href={`${basePath}/records/intake`}>인테이크</WireButton>
            : <WireButton variant="primary" href={`${basePath}/records/new`}>상담 기록 작성</WireButton>}
        </>,
      })}
    />

    {result.data !== null && <OverallGoalRow overallGoal={result.data.overallGoal} briefingHref={`${basePath}/briefing`} />}

    <Notice code={notice} />
    {/* 저장 성공 신호(notice)가 있을 때 이 참여 사업의 기록 임시본을 지운다(P0-9 · CCC-111). */}
    <RecordDraftCleanup notice={notice} supportCaseId={supportCaseId} />
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
      recordsHref={`${basePath}/records`}
      briefingHref={`${basePath}/briefing`}
      {...(beneficiaryId === null || supportCaseId === null ? {} : { intakeHref: `${basePath}/records/intake` })}
    />
  </GridContainer>;
}
