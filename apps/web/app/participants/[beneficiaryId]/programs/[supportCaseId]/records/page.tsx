import Link from 'next/link';
import { MetaRow } from '../../../../../components/wire/meta-row';
import { WireButton } from '../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../components/wire/wire-card';
import {
  ApiError,
  listSupportCaseRecords,
  type CounselingScheduleStatus,
  type FlagType,
  type SupportCaseRecord,
  type SupportCaseRecordGoal,
  type SupportCaseRecords,
} from '../../../../../lib/api';

type SearchParams = Record<string, string | string[] | undefined>;

type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';
type ActionOwner = SupportCaseRecord['actionItems'][number]['owner'];
type FlagSource = SupportCaseRecord['flags'][number]['source'];
type FlagReviewStatus = SupportCaseRecord['flags'][number]['reviewStatus'];
type LoadResult<T> = { data: T; error: null } | { data: null; error: ErrorKind };

const messages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 상담 기록을 확인하세요.',
  access_or_not_found: '요청한 상담 기록 정보를 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: '상담 기록을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
};
const channelLabels: Record<SupportCaseRecord['channel'], string> = {
  in_person: '대면',
  phone: '전화',
  video: '화상',
};
const flagLabels: Record<FlagType, string> = {
  crisis_utterance: '위기 발언',
  contact_loss_risk: '연락 두절 위험',
  housing_livelihood_shock: '주거·생계 급변',
  debt_deterioration: '부채 악화',
  repeated_noncompliance: '약속 불이행 반복',
};
const actionOwnerLabels: Record<ActionOwner, string> = {
  counselor: '실무자',
  beneficiary: '당사자',
  org: '기관',
};
const flagSourceLabels: Record<FlagSource, string> = {
  ai: 'AI 제안',
  counselor: '실무자 기록',
};
const flagReviewStatusLabels: Record<FlagReviewStatus, string> = {
  confirmed: '확인됨',
  rejected: '제외됨',
  pending: '검토 대기',
};
const goalStatusLabels: Record<SupportCaseRecordGoal['status'], string> = {
  active: '진행 중',
  closed: '종료됨',
};
const schedulePresentations: Record<CounselingScheduleStatus, { className: string; label: string; message: string }> = {
  scheduled: {
    className: 'status warning',
    label: '예정',
    message: '기록 작성 시에만 명시적으로 완료 처리할 수 있습니다.',
  },
  completed: {
    className: 'status',
    label: '완료됨',
    message: '일정이 상담 기록과 연결되어 완료되었습니다.',
  },
  cancelled: {
    className: 'status risk',
    label: '취소됨',
    message: '이 일정은 취소되어 상담 기록으로 완료 처리할 수 없습니다.',
  },
  no_show: {
    className: 'status risk',
    label: '불참',
    message: '이 일정은 불참으로 처리되어 상담 기록으로 완료 처리할 수 없습니다.',
  },
};

function actionOwnerLabel(owner: ActionOwner): string {
  const label = actionOwnerLabels[owner];
  if (label === undefined) throw new Error('Record action item owner was invalid.');
  return label;
}

function channelLabel(channel: SupportCaseRecord['channel']): string {
  const label = channelLabels[channel];
  if (label === undefined) throw new Error('Record channel was invalid.');
  return label;
}

function flagLabel(flagType: FlagType): string {
  const label = flagLabels[flagType];
  if (label === undefined) throw new Error('Record flag type was invalid.');
  return label;
}

function flagSourceLabel(source: FlagSource): string {
  const label = flagSourceLabels[source];
  if (label === undefined) throw new Error('Record flag source was invalid.');
  return label;
}

function flagReviewStatusLabel(reviewStatus: FlagReviewStatus): string {
  const label = flagReviewStatusLabels[reviewStatus];
  if (label === undefined) throw new Error('Record flag review status was invalid.');
  return label;
}

function goalStatusLabel(status: SupportCaseRecordGoal['status']): string {
  const label = goalStatusLabels[status];
  if (label === undefined) throw new Error('Record goal status was invalid.');
  return label;
}

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

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function Message({ code }: { code: ErrorKind | null }) {
  if (code === null) return null;
  return <p className="status risk" role="alert">{messages[code]}</p>;
}
function Notice({ code }: { code: string | undefined }) {
  if (code !== 'record_submission_processed') return null;
  return <p className="status" role="status" aria-live="polite">상담 기록 화면으로 이동했습니다. 아래 목록에서 제출 결과를 확인하세요.</p>;
}

function GoalContext({ goals }: { goals: SupportCaseRecordGoal[] }) {
  return <aside className="note" aria-labelledby="record-goals-title">
    <div>
      <h2 id="record-goals-title">읽기 전용 목표</h2>
      <p>상담 기록에서 목표를 만들거나 바꾸지 않습니다. 각 기록의 GAS는 아래 목표를 기준으로 실무자가 직접 남깁니다.</p>
      {goals.length === 0 ? <p>등록된 목표가 없습니다.</p> : <ul>{goals.map((goal) => <li key={goal.id}>{goal.title} <span className="panel-meta">{goalStatusLabel(goal.status)}</span></li>)}</ul>}
    </div>
  </aside>;
}

function RecordCard({ record, recordError }: { record: SupportCaseRecord; recordError: boolean }) {
  const title = <div className="wire-card-head">
    <div>
      <h2 id={`record-${record.id}`}>{record.kind === 'intake' ? '인테이크 기록' : '상담 기록'}</h2>
      <p className="panel-meta"><MetaRow items={[formatDateTime(record.heldAt), channelLabel(record.channel)]} /></p>
    </div>
    <span className="status" data-record-kind={record.kind}>{record.kind === 'intake' ? '인테이크 공식 기록' : '공식 기록'}</span>
  </div>;

  return <WireCard as="article" labelledBy={`record-${record.id}`} title={title}>
    {/* 불일치 처리 '기록 오류'의 흔적 (D45 · ADR-0018 · CCC-42). 원본은 손대지 않고 표시만
        붙여 다음 열람자의 오해를 막는다 — 정정이 필요하면 실무자가 따로 기록한다. */}
    {recordError && <p className="note" role="note">
      이 기록과 관련된 내용 불일치가 <strong>기록 오류</strong>로 처리되었습니다. 아래 내용은 원본 그대로입니다.
    </p>}
    <section className="wire-card-section" aria-labelledby={`memo-${record.id}`}>
      <h3 id={`memo-${record.id}`}>수기 메모</h3>
      <p>{record.memo}</p>
    </section>

    <section className="wire-card-section" aria-labelledby={`gas-${record.id}`}>
      <h3 id={`gas-${record.id}`}>GAS</h3>
      {record.gasScores.length === 0 ? <p>기록된 GAS가 없습니다.</p> : <ul>{record.gasScores.map((score) => <li key={score.goalId}>{score.goalTitle}: <strong>{score.score > 0 ? `+${score.score}` : score.score}</strong></li>)}</ul>}
    </section>

    <section className="wire-card-section" aria-labelledby={`actions-${record.id}`}>
      <h3 id={`actions-${record.id}`}>액션 아이템</h3>
      {record.actionItems.length === 0 ? <p>기록된 액션 아이템이 없습니다.</p> : <ul>{record.actionItems.map((item) => <li key={item.id}>{item.description} <MetaRow items={[`담당 ${actionOwnerLabel(item.owner)}`, item.dueDate === null ? null : `기한 ${item.dueDate}`]} /> <span className="status">{item.resolved ? '완료' : '미완료'}</span></li>)}</ul>}
    </section>

    <section className="wire-card-section" aria-labelledby={`flags-${record.id}`}>
      <h3 id={`flags-${record.id}`}>플래그</h3>
      {record.flags.length === 0 ? <p>표시된 플래그가 없습니다.</p> : <ul>{record.flags.map((flag) => <li key={flag.id}>{flagLabel(flag.flagType)} <span className="panel-meta"><MetaRow items={[flagSourceLabel(flag.source), flagReviewStatusLabel(flag.reviewStatus)]} /></span></li>)}</ul>}
    </section>

    <p className="panel-meta">공식 등록 {formatDateTime(record.createdAt)}</p>
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
  const records = result.data?.records ?? [];
  const goals = result.data?.goals ?? [];
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
  // 인테이크(kind=intake)가 아직 없는 케이스에서만 인테이크 작성 진입 버튼을 보인다(1회 규칙).
  const hasIntake = records.some((record) => record.kind === 'intake');

  return <main className="page-content">
    <nav className="breadcrumb" aria-label="현재 위치">
      <Link href="/">오늘 상담</Link><span>/</span><Link href={participantPath}>당사자 ID {beneficiaryId ?? '확인 불가'}</Link><span>/</span><Link href={`${basePath}/briefing`}>참여 사업</Link><span>/</span><strong>상담 기록</strong>
    </nav>
    <header className="page-header">
      <div>
        <h1>상담 기록</h1>
        <p>당사자 ID {beneficiaryId ?? '확인 불가'}의 참여 사업 상담 기록입니다. 수기 메모는 서버 저장이 확인되는 즉시 공식 기록입니다.</p>
      </div>
      {beneficiaryId === null || supportCaseId === null ? null : <div className="page-actions">
        {result.data !== null && !hasIntake ? <WireButton variant="secondary" href={`${basePath}/records/intake`}>인테이크 작성</WireButton> : null}
        <WireButton variant="primary" href={`${basePath}/records/new`}>상담 기록 작성</WireButton>
      </div>}
    </header>
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

    <section className="card-grid" aria-label="상담 기록 목록">
      {result.data === null ? <WireCard><div className="empty"><span>상담 기록 목록을 확인할 수 없습니다.</span></div></WireCard> : records.length === 0 ? <WireCard><div className="empty"><span>아직 상담 기록이 없습니다.</span></div><p className="panel-meta">상담 일시, 방식, 수기 메모, GAS, 액션 아이템, 플래그를 한 번에 기록하세요.</p></WireCard> : records.map((record) => <RecordCard key={record.id} record={record} recordError={recordErrorSessionIds.has(record.id)} />)}
    </section>
    {result.data === null ? null : <GoalContext goals={goals} />}
  </main>;
}
