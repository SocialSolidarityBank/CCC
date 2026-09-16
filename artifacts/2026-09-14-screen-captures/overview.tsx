// 캡처 전용 정적 화면. 합성 데이터만 쓰고 저장·통신은 없다.
// 기준: artifacts/2026-09-09-workflow-prototypes/prototype-app.tsx(탭·목록·일정 시안)와
// apps/web/app/participants/[beneficiaryId]/page.tsx, programs/[programType]/schedule/*.
import React, { Fragment, type ReactNode } from 'react';
import {
  Chevron,
  DisclosureChevron,
  Icon,
  ParticipantHeroCard,
  WireBadge,
  WireButton,
  WireCard,
  WireCardDetails,
  WireCardSection,
  WireField,
  WireFormField,
  WireMonthCalendar,
  WireToolbarField,
  buildMonthWeeks,
  type WireMonthCalendarEvent,
} from '../../packages/wire/src/index';
import { WireTab } from '../../apps/web/app/components/wire/wire-tabs';
import { SearchInput } from '../../apps/web/app/components/wire/search-input';
import { TimeAxisBadge } from '../../apps/web/app/components/wire/time-axis-badge';
import { NavIcon } from '../../apps/web/app/components/wire/shell-icons';
import { ConsultationTypeMark } from '../../apps/web/app/components/wire/consultation-type-mark';
import { DateTimePickerControl } from '../../apps/web/app/components/wire/date-picker-control';
import { formatKoreanDate, formatKoreanDateTime, formatKoreanTime } from '../../apps/web/app/lib/format-korean-date';

// ── 합성 데이터 (공용 주인공: 김하늘 · crane-001 · 함께온기금 울타리대출) ──────

const TODAY = '2026-09-15';

type CaseStatus = 'active' | 'closed';
type ScheduleView = 'day' | 'week' | 'month';

type PrototypeSchedule = {
  id: string;
  scheduledAt: string;
  label: string;
  kind: 'regular' | 'intake';
  goal: string;
};

type SupportCase = {
  id: string;
  participantId: string;
  label: string;
  status: CaseStatus;
  readAllowed: boolean;
  writeAllowed: boolean;
  closeAllowed: boolean;
  recordCount: number;
  recent: string;
  currentGoal: string;
  subGoals: string[];
  schedules: PrototypeSchedule[];
  consent: { privacy: boolean; recordingAi: boolean; recordedAt: string };
};

type Participant = {
  id: string;
  beneficiaryId: string;
  name: string;
  phone: string;
  email: string;
  birth: string;
  caseIds: string[];
  blockedCaseLabel?: string;
};

const CASES: Record<string, SupportCase> = {
  'case-life-001': {
    id: 'case-life-001', participantId: 'p-001', label: '함께온기금 울타리대출', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 6, recent: '2026년 9월 8일',
    currentGoal: '300만 원 소액대출의 상환 계획을 지키며 신용점수를 회복한다.',
    subGoals: [
      '월 상환액을 급여일에 별도 계좌로 옮깁니다.',
      '고금리 대출 정리 결과를 다음 회차에서 확인합니다.',
      '자격증 학원비를 대출금 안에서 조정합니다.',
    ],
    schedules: [
      { id: 'schedule-101', scheduledAt: '2026-09-15T14:00', label: '2026년 9월 15일 오후 2:00', kind: 'regular', goal: '두 번째 상환일과 9월 상환액 분리 상태를 확인합니다.' },
      { id: 'schedule-102', scheduledAt: '2026-09-29T10:30', label: '2026년 9월 29일 오전 10:30', kind: 'regular', goal: '상환 계획표와 월말 비상금 잔액을 함께 확인합니다.' },
    ],
    consent: { privacy: true, recordingAi: true, recordedAt: '2026-08-04T10:20' },
  },
  'case-restart-002': {
    id: 'case-restart-002', participantId: 'p-001', label: '자립정착금 활용 상담', status: 'closed',
    readAllowed: true, writeAllowed: false, closeAllowed: false, recordCount: 3, recent: '2025년 12월 18일',
    currentGoal: '자립정착금 사용 계획과 정착 지원 절차를 마무리한다.', subGoals: ['자립정착금 사용 내역을 종결 기록에서 확인합니다.'], schedules: [],
    consent: { privacy: true, recordingAi: false, recordedAt: '2025-10-02T15:40' },
  },
  'case-supervision-003': {
    id: 'case-supervision-003', participantId: 'p-001', label: '자립지원전담기관 사후관리', status: 'active',
    readAllowed: true, writeAllowed: false, closeAllowed: false, recordCount: 2, recent: '2026년 7월 21일',
    currentGoal: '보호종료 후 연계 기관의 사후관리 연락을 확인한다.', subGoals: ['연계 기관 연락 결과를 확인합니다.'], schedules: [],
    consent: { privacy: true, recordingAi: false, recordedAt: '2026-06-30T11:05' },
  },
  'case-housing-201': {
    id: 'case-housing-201', participantId: 'p-002', label: '함께온기금 울타리대출', status: 'closed',
    readAllowed: true, writeAllowed: false, closeAllowed: false, recordCount: 4, recent: '2026년 5월 20일',
    currentGoal: '월세 보증금 대출 상환을 완료하고 종결한다.', subGoals: ['상환 완료 내역을 확인합니다.'], schedules: [],
    consent: { privacy: true, recordingAi: false, recordedAt: '2026-03-02T09:30' },
  },
  'case-youth-301': {
    id: 'case-youth-301', participantId: 'p-003', label: '함께온기금 울타리대출', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 2, recent: '2026년 8월 28일',
    currentGoal: '취업 준비 비용 대출의 상환 계획을 세우고 학원 수강을 유지한다.', subGoals: ['자격증 학원 수강을 주 2회 이상 유지합니다.', '첫 상환일 전까지 상환액을 모읍니다.'],
    schedules: [
      { id: 'schedule-301', scheduledAt: '2026-09-18T13:30', label: '2026년 9월 18일 오후 1:30', kind: 'regular', goal: '학원 수강 일정과 첫 상환 준비를 확인합니다.' },
    ],
    consent: { privacy: true, recordingAi: false, recordedAt: '2026-07-14T14:10' },
  },
  'case-employment-401': {
    id: 'case-employment-401', participantId: 'p-004', label: '함께온기금 울타리대출', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 1, recent: '2026년 9월 1일',
    currentGoal: '노트북 등 취업 준비 비용 대출을 실행하고 상환 일정을 확정한다.', subGoals: ['대출 실행 서류를 제출합니다.'], schedules: [],
    consent: { privacy: true, recordingAi: false, recordedAt: '2026-08-20T16:00' },
  },
  'case-finance-402': {
    id: 'case-finance-402', participantId: 'p-004', label: '신용회복 사후 상담', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 2, recent: '2026년 9월 4일',
    currentGoal: '급여일 기준의 상환·생활비 예산을 정한다.', subGoals: ['급여일에 상환액을 먼저 분리합니다.'], schedules: [],
    consent: { privacy: true, recordingAi: false, recordedAt: '2026-08-20T16:00' },
  },
};

const PARTICIPANTS: Participant[] = [
  { id: 'p-001', beneficiaryId: 'crane-001', name: '김하늘', phone: '010-0000-1042', email: 'haneul@example.com', birth: '2004년 5월 18일', caseIds: ['case-life-001', 'case-restart-002', 'case-supervision-003'], blockedCaseLabel: '타 기관 채무조정 상담 (열람 권한 없음)' },
  { id: 'p-002', beneficiaryId: 'badger-008', name: '김도담', phone: '010-0000-3308', email: 'dodam@example.com', birth: '2002년 11월 7일', caseIds: ['case-housing-201'] },
  { id: 'p-003', beneficiaryId: 'otter-014', name: '이로운', phone: '010-0000-7714', email: 'rowoon@example.com', birth: '2003년 5월 26일', caseIds: ['case-youth-301'] },
  { id: 'p-004', beneficiaryId: 'finch-021', name: '박한결', phone: '010-0000-9121', email: 'hangyeol@example.com', birth: '2001년 9월 2일', caseIds: ['case-employment-401', 'case-finance-402'] },
];

const HANEUL = PARTICIPANTS[0];
const LIFE_CASE = CASES['case-life-001'];

const REPORT_SESSIONS = [
  { no: 1, date: '2026년 4월 3일', kind: '인테이크', summary: '보호종료 후 첫 독립 주거의 월세 보증금이 부족해 300만 원 소액대출을 신청했고 신용점수 568점을 확인했습니다.' },
  { no: 2, date: '2026년 4월 17일', kind: '기본 상담', summary: '대출 실행과 함께 월 상환일을 급여일 다음 날로 정하고 자격증 학원비 지출 계획을 세웠습니다.' },
  { no: 3, date: '2026년 5월 8일', kind: '기본 상담', summary: '단기근로 소득과 신용점수 591점을 확인했지만 상환액 분리 저축은 하지 못했습니다.' },
  { no: 4, date: '2026년 6월 5일', kind: '기본 상담', summary: '첫 상환을 마쳤고 카드 돌려막기로 쓰던 고금리 대출 한 건을 정리했습니다.' },
  { no: 5, date: '2026년 7월 10일', kind: '기본 상담', summary: '자립수당 수급 시기에 맞춰 비상금 만들기를 시작하고 원가정과의 연락 문제를 상담했습니다.' },
  { no: 6, date: '2026년 9월 8일', kind: '기본 상담', summary: '신용점수 612점과 상환 계좌 분리 사실을 확인하고 유예 없이 완납하는 계획을 약속했습니다.' },
];

function caseStatusLabel(item: SupportCase) { return item.status === 'active' ? '진행 중' : '종결'; }
function aggregateStatus(participant: Participant) {
  return participant.caseIds.map((id) => CASES[id]).some((item) => item.readAllowed && item.status === 'active') ? 'active' : 'closed';
}
const noop = () => {};

// ── 공용 조각 ────────────────────────────────────────────────────────────────

function Hero({ participant, supportCase, compact = false }: { participant: Participant; supportCase: SupportCase; compact?: boolean }) {
  const actions = compact ? undefined : <Fragment>
    <WireButton variant="secondary" disabled={!supportCase.readAllowed}>인테이크</WireButton>
    <WireButton variant="secondary" disabled={!supportCase.writeAllowed}>기본정보 수정</WireButton>
  </Fragment>;
  return <ParticipantHeroCard
    name={participant.name}
    beneficiaryId={participant.beneficiaryId}
    nameSize="hub"
    className="workflow-hero"
    actions={actions}
    details={[
      { label: '당사자 ID', value: participant.beneficiaryId },
      { label: '연락처', value: participant.phone, tone: 'mint' },
      { label: '이메일', value: participant.email, tone: 'mint' },
      { label: '생년월일', value: participant.birth, tone: 'blue' },
      { label: '기록 현황', value: `${supportCase.recordCount}회차까지 기록됨` },
      { label: '최근 상담', value: supportCase.recent, tone: 'blue' },
      { label: '진행 상태', value: caseStatusLabel(supportCase) },
    ]}
  />;
}

function CaseSelector({ participant, supportCase }: { participant: Participant; supportCase: SupportCase }) {
  const readable = participant.caseIds.map((id) => CASES[id]).filter((item) => item.readAllowed);
  return <WireCard title={<span id="participant-business-title">참여중인 사업</span>} as="section" className="case-selector-card">
    <div className="case-selector-row">
      <WireFormField label="참여중인 사업" hideLabel control="select" htmlFor="participant-case-select">
        <select id="participant-case-select" aria-labelledby="participant-business-title" defaultValue={supportCase.id}>
          {readable.map((item) => <option key={item.id} value={item.id}>{`${item.label} (${caseStatusLabel(item)}${item.writeAllowed ? '' : ', 읽기 전용'})`}</option>)}
          {participant.blockedCaseLabel ? <option disabled>{participant.blockedCaseLabel}</option> : null}
        </select>
      </WireFormField>
      <div className="case-selector-actions">
        <WireButton variant="danger" disabled={!supportCase.closeAllowed || supportCase.status === 'closed'}>{supportCase.status === 'closed' ? '종결됨' : '종결'}</WireButton>
      </div>
    </div>
  </WireCard>;
}

// 공용 카드가 바깥 패딩을, 이 목록이 행 사이 구분선을 소유한다(구 시안 ReportRows).
function ReportRows({ children }: { children: ReactNode }) {
  const rows = React.Children.toArray(children);
  return <div className="report-rows">{rows.map((row, index) => <Fragment key={index}>
    {index > 0 && <hr className="wire-card-divider" />}
    <div className="report-entry">{row}</div>
  </Fragment>)}</div>;
}

// 정적 탭 — PrototypeTabs의 키보드·id 배선만 빼고 WireTabs/WireTab 마크업은 그대로다.
function StaticTabs({ tabs, active, label, className }: {
  tabs: { id: string; label: string }[];
  active: string;
  label: string;
  className: string;
}) {
  return <div role="tablist" aria-label={label} className={`wire-tabs ${className}`}>
    {tabs.map((item) => <WireTab key={item.id} active={item.id === active} onSelect={noop}>{item.label}</WireTab>)}
  </div>;
}

const PARTICIPANT_TABS = [
  { id: 'sessions', label: '회차별 요약' },
  { id: 'goals', label: '목표' },
  { id: 'info', label: '정보' },
];

function ParticipantShell({ active, children }: { active: string; children: ReactNode }) {
  return <Fragment>
    <Hero participant={HANEUL} supportCase={LIFE_CASE} />
    <CaseSelector participant={HANEUL} supportCase={LIFE_CASE} />
    <StaticTabs className="participant-tabs" label="당사자 페이지 보기" tabs={PARTICIPANT_TABS} active={active} />
    <div role="tabpanel" className="participant-panel">{children}</div>
  </Fragment>;
}

// ── 탭 1: 회차별 요약 (구 시안 FullReport의 회차별 요약·핵심지표 카드) ─────────

function SessionsTab() {
  return <Fragment>
    <WireCard title="회차별 요약" as="section"><ReportRows>{REPORT_SESSIONS.map((session) => <Fragment key={session.no}>
      <div className="report-session-meta"><WireBadge>{session.no}회차</WireBadge><span>{session.date}</span><WireBadge tone={session.kind === '인테이크' ? 'lavender' : 'mint'}>{session.kind}</WireBadge></div>
      <p className="report-body">{session.summary}</p>
    </Fragment>)}</ReportRows></WireCard>
    <WireCard title="핵심지표" as="section"><WireCardSection title="신용점수 조건부 숫자 지표" tone="mint">
      <div className="metric-grid"><WireField label="처음" layout="stack" size="sm">568점, 1회차</WireField><WireField label="중간" layout="stack" size="sm">591점, 3회차</WireField><WireField label="현재" layout="stack" size="sm">612점, 6회차</WireField></div>
      <p className="report-description">반복 기록된 수치만 표시했습니다. 증감 이유나 달성률은 원문에 없어 만들지 않았습니다.</p>
    </WireCardSection></WireCard>
  </Fragment>;
}

// ── 탭 2: 목표 (apps/web goal-tree.tsx의 GoalTreeCard 마크업 적응) ────────────

function GoalNode({ title, closed, reason, linkedCount, sessions, sessionGoals, open = false }: {
  title: string;
  closed?: boolean;
  reason?: string;
  linkedCount: number;
  sessions: { date: string; body: string }[];
  sessionGoals: { date: string; body: string; suffix?: string }[];
  open?: boolean;
}) {
  return <li className={closed ? 'goal-tree-goal is-closed' : 'goal-tree-goal'}>
    <details className="goal-tree-goal-details" open={open}>
      <summary className="goal-tree-goal-head">
        <span className="goal-tree-goal-title" title={title}>{title}</span>
        {closed && <WireBadge>{reason === undefined ? '종료' : `종료(${reason})`}</WireBadge>}
        <WireBadge>연결 회차 {linkedCount}건</WireBadge>
        <DisclosureChevron variant="plain" />
      </summary>
      <div className="goal-tree-goal-body">
        {sessions.length === 0 && sessionGoals.length === 0
          ? <p className="empty">연결된 상담 회차가 없습니다.</p>
          : null}
        {sessions.length > 0 && <ul className="goal-tree-session-rows">
          {sessions.map((session) => <li key={session.date}>
            <a className="goal-tree-linked-session" href="#prototype-only">
              <span className="goal-tree-session-date">{session.date}</span>
              <span className="goal-tree-session-body">{session.body}</span>
            </a>
          </li>)}
        </ul>}
        {sessionGoals.length > 0 && <ul className="goal-tree-session-rows">
          {sessionGoals.map((goal) => <li key={goal.date} className="goal-tree-session-row">
            <span className="goal-tree-session-date">{goal.date}</span>
            <span className="goal-tree-session-body">{goal.body}</span>
            {goal.suffix === undefined ? null : <WireBadge>{goal.suffix}</WireBadge>}
          </li>)}
        </ul>}
      </div>
    </details>
  </li>;
}

function GoalsTab() {
  return <WireCard as="section" className="participant-hub-card" title="목표">
    <div className="goal-tree-case">
      <div className="goal-tree-section wire-repeat-card">
        <p className="goal-tree-label">전체 목표</p>
        <div className="goal-tree-overall">
          <span className="goal-tree-overall-text" title={LIFE_CASE.currentGoal}>{LIFE_CASE.currentGoal}</span>
        </div>
      </div>
      <div className="goal-tree-section wire-repeat-card">
        <p className="goal-tree-label">세부 목표</p>
        <ul className="goal-tree-goals wire-bullets">
          <GoalNode
            open
            title="월 상환액을 급여일에 별도 계좌로 옮깁니다."
            linkedCount={2}
            sessions={[
              { date: '2026년 9월 8일', body: '급여일에 상환액을 별도 계좌로 옮겼다고 확인함.' },
              { date: '2026년 6월 5일', body: '첫 상환을 마치고 고금리 대출 한 건을 정리했다고 확인했다.' },
            ]}
            sessionGoals={[
              { date: '2026년 9월 15일', body: '두 번째 상환일과 9월 상환액 분리 상태를 확인합니다.' },
              { date: '2026년 9월 29일', body: '상환 계획표와 월말 비상금 잔액을 함께 확인합니다.' },
            ]}
          />
          <GoalNode
            title="고금리 대출 정리 결과를 다음 회차에서 확인합니다."
            linkedCount={1}
            sessions={[{ date: '2026년 4월 17일', body: '대출 실행과 함께 월 상환일을 급여일 다음 날로 정하고 자격증 학원비 지출 계획을 세웠습니다.' }]}
            sessionGoals={[]}
          />
          <GoalNode
            closed
            reason="달성"
            title="자격증 학원비를 대출금 안에서 조정합니다."
            linkedCount={2}
            sessions={[]}
            sessionGoals={[]}
          />
        </ul>
      </div>
    </div>
  </WireCard>;
}

// ── 탭 3: 정보 (apps/web 허브의 참여 사업·최신 일정·동의서 카드 적응) ──────────

function ProgramRow({ program, authorized }: { program: SupportCase; authorized: boolean }) {
  return <div className="participant-program-row wire-repeat-card">
    <div className="participant-program-head">
      <span className="participant-program-head-main">
        <h3 title={program.label}>{program.label}</h3>
        <WireBadge tone={program.status === 'active' ? 'mint' : 'neutral'}>{caseStatusLabel(program)}</WireBadge>
      </span>
      {authorized && <WireButton variant="secondary">{program.status === 'active' ? '종결' : '종결 정보'}</WireButton>}
    </div>
    <div className="participant-program-assignee">
      <span className="participant-program-assignee-label">담당</span>
      <span>이서연 실무자</span>
    </div>
  </div>;
}

function ConsentBlock({ program, showTitle }: { program: SupportCase; showTitle: boolean }) {
  return <div className="participant-consent-block wire-repeat-card">
    {showTitle && <div className="participant-program-head">
      <h3 className="participant-consent-program">{program.label}</h3>
      <WireButton type="button" icon={<Icon name="check" />}>저장</WireButton>
    </div>}
    <div className="participant-program-consent">
      <fieldset className="consent-fieldset" aria-label="동의">
        {[
          { label: '개인정보 수집·이용 동의', checked: program.consent.privacy },
          { label: 'AI를 활용한 녹취기록 동의', checked: program.consent.recordingAi },
        ].map((item) => <div className="consent-item" key={item.label}>
          <label className="consent-checkbox">
            <input type="checkbox" className="wire-checkbox" defaultChecked={item.checked} readOnly />
            <span>{item.label}</span>
          </label>
        </div>)}
        <p className="participant-program-consent-meta">마지막 기록 {formatKoreanDateTime(program.consent.recordedAt)}</p>
      </fieldset>
    </div>
  </div>;
}

function InfoTab() {
  const programs = HANEUL.caseIds.map((id) => CASES[id]).filter((item) => item.readAllowed);
  const consentPrograms = programs.filter((item) => item.writeAllowed || item.id === 'case-life-001');
  return <Fragment>
    <WireCard as="section" className="participant-hub-card" title="참여 중인 사업">
      {programs.map((program) => <ProgramRow key={program.id} program={program} authorized={program.id !== 'case-supervision-003'} />)}
    </WireCard>
    <WireCard as="section" className="participant-hub-card" title={
      <div className="wire-card-head">
        <span>최신 일정</span>
        <div className="participant-next-schedule-actions">
          <WireButton icon={<NavIcon name="calendar" />}>상담 등록</WireButton>
          <WireButton>상담 기록 확인</WireButton>
        </div>
      </div>
    }>
      {LIFE_CASE.schedules.map((schedule) => <a key={schedule.id} className="participant-next-schedule-link wire-repeat-card" href="#prototype-only">
        <span className="participant-next-schedule-main">
          <span className="participant-next-schedule-date">{formatKoreanDateTime(schedule.scheduledAt)}</span>
          <ConsultationTypeMark kind={schedule.kind} />
          <span className="participant-next-schedule-program">{LIFE_CASE.label}</span>
        </span>
        <Chevron dir="right" />
      </a>)}
    </WireCard>
    <WireCard as="section" className="participant-hub-card" title={
      consentPrograms.length === 1
        ? <div className="wire-card-head"><span>동의서</span><WireButton type="button" icon={<Icon name="check" />}>저장</WireButton></div>
        : '동의서'
    }>
      {consentPrograms.map((program) => <ConsentBlock key={program.id} program={program} showTitle={consentPrograms.length > 1} />)}
    </WireCard>
  </Fragment>;
}

// ── 당사자 목록 (구 시안 ParticipantsPage: 상태 토글 + 검색 + 아코디언 행) ────

function ParticipantListRow({ participant }: { participant: Participant }) {
  const readable = participant.caseIds.map((id) => CASES[id]).filter((item) => item.readAllowed);
  const writableActive = readable.filter((item) => item.writeAllowed && item.status === 'active');
  const status = aggregateStatus(participant);
  const joinedPrograms = [...readable.map((item) => item.label), ...(participant.blockedCaseLabel ? [participant.blockedCaseLabel] : [])];
  return <WireCardDetails
    className="participant-list-card"
    open
    title={<span>{participant.name} <span className="participant-card-id">{participant.beneficiaryId}</span></span>}
    badge={status === 'active' ? <WireBadge tone="mint">진행 중</WireBadge> : <WireBadge>종결</WireBadge>}
  >
    <div className="participant-list-info">
      <WireField label="연락처" layout="stack" size="sm">{participant.phone}</WireField>
      <WireField label="이메일" layout="stack" size="sm">{participant.email}</WireField>
      <WireField label="참여중인 사업" layout="stack" size="sm">
        <span className="participant-program-list">{joinedPrograms.map((label) => <span key={label} title={label}>{label}</span>)}</span>
      </WireField>
    </div>
    <hr className="wire-card-divider" />
    <div className="participant-list-actions">
      <span className="wire-input-box" data-control="select">
        <select aria-label={`${participant.name} 대상 사업`} defaultValue={writableActive[0]?.id ?? ''} disabled={writableActive.length === 0}>
          {writableActive.length === 0
            ? <option value="">기록과 등록이 가능한 사업 없음</option>
            : writableActive.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <Chevron dir="down" />
      </span>
      <div className="participant-list-buttons">
        <WireButton variant="neutral" icon={<NavIcon name="participants" />} disabled={readable.length === 0}>당사자 정보 보기</WireButton>
        <WireButton variant="primary" icon={<NavIcon name="calendar-plus" />} disabled={writableActive.length === 0}>일정 등록하기</WireButton>
        <WireButton variant="neutral" icon={<NavIcon name="record" />} disabled={writableActive.length === 0}>상담 기록하기</WireButton>
      </div>
    </div>
  </WireCardDetails>;
}

const PARTICIPANT_FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'active', label: '진행 중' },
  { id: 'closed', label: '종결' },
];

function ParticipantsContent() {
  return <Fragment>
    <StaticTabs className="status-tabs" label="당사자 상태 거르기" tabs={PARTICIPANT_FILTERS} active="all" />
    <div className="participant-search-row">
      <SearchInput label="당사자 검색" name="participant-search" placeholder="이름, 당사자 ID, 연락처 또는 이메일" />
      <SearchInput
        label="사업"
        variant="select"
        name="participant-program"
        options={[{ value: '', label: '사업 전체' }, ...Object.values(CASES).filter((item) => item.readAllowed).map((item) => ({ value: item.id, label: item.label }))]}
      />
    </div>
    <p className="prototype-live" role="status">{`${PARTICIPANTS.length}명`}</p>
    <div role="tabpanel" className="participant-list">
      {PARTICIPANTS.map((participant) => <ParticipantListRow key={participant.id} participant={participant} />)}
    </div>
  </Fragment>;
}

// ── 일정 (구 시안 SchedulePage: 도구 모음 + 일간/주간 날짜 묶음 + 월간 격자) ──

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  allDay?: boolean;
  color?: string;
};

const HOLIDAYS: Record<string, string> = {
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-09': '한글날',
};

const EVENTS: CalendarEvent[] = [
  { id: 'event-0', title: '박한결 대출 실행 상담', start: '2026-09-15T11:00:00' },
  { id: 'event-1', title: '김하늘 상환 상담', start: '2026-09-15T14:00:00' },
  { id: 'event-2', title: '이로운 첫 상환 준비 상담', start: '2026-09-18T13:30:00' },
  { id: 'event-3', title: '박한결 신용회복 상담', start: '2026-09-23T10:00:00' },
  { id: 'event-4', title: '김하늘 상환 상담', start: '2026-09-29T10:30:00' },
  { id: 'event-7', title: '이로운 대출 상담', start: '2026-09-04T15:00:00' },
  { id: 'event-8', title: '김하늘 상환 상담', start: '2026-09-08T11:00:00' },
  { id: 'event-5', title: '김도담 주거지 방문', start: '2026-09-17', allDay: true, color: 'coral' },
  { id: 'event-6', title: '이로운 대출 서류 마감', start: '2026-09-28', allDay: true, color: 'cyan' },
];

function isoDate(date: Date) { const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function weekLabel(anchor: string) { const date = new Date(`${anchor}T12:00:00`); const monday = new Date(date); monday.setDate(date.getDate() - ((date.getDay() + 6) % 7)); const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); return `${formatKoreanDate(isoDate(monday))}–${formatKoreanDate(isoDate(sunday))}`; }

function ScheduleToolbar({ view, anchor }: { view: ScheduleView; anchor: string }) {
  const period = view === 'month'
    ? `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`
    : view === 'week'
      ? weekLabel(anchor)
      : formatKoreanDate(anchor);
  return <nav className="schedule-nav" aria-label="일정 보기 조작">
    <div className="schedule-nav-period">
      <button type="button" className="wire-chevron-button schedule-nav-step" aria-label="이전 기간"><Chevron dir="left" /></button>
      <span className="schedule-period-label">{period}</span>
      <button type="button" className="wire-chevron-button schedule-nav-step" aria-label="다음 기간"><Chevron dir="right" /></button>
    </div>
    <div className="schedule-nav-controls">
      <WireToolbarField label="기간 단위" className="schedule-view-select">
        <select aria-label="기간 단위" defaultValue={view}>
          <option value="day">일간</option>
          <option value="week">주간</option>
          <option value="month">월간</option>
        </select>
        <Chevron dir="down" />
      </WireToolbarField>
      <WireButton variant="neutral">오늘</WireButton>
    </div>
    <div className="schedule-nav-register">
      <WireButton variant="primary" icon={<NavIcon name="calendar-plus" />}>일정 등록하기</WireButton>
    </div>
  </nav>;
}

function DayWeekBody({ view, anchor }: { view: ScheduleView; anchor: string }) {
  const anchorDate = new Date(`${anchor}T00:00:00`);
  const days = view === 'day' ? [anchorDate] : Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchorDate);
    date.setDate(anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7) + index);
    return date;
  });
  const groups = days
    .map((date) => ({ dateKey: isoDate(date), dayEvents: EVENTS.filter((item) => item.start.startsWith(isoDate(date))) }))
    .filter((group) => group.dayEvents.length > 0);
  if (groups.length === 0) return <WireCard><p className="empty">이 기간에는 등록된 일정이 없습니다.</p></WireCard>;
  return <div className="schedule-day-stack">{groups.map(({ dateKey, dayEvents }) => <WireCardDetails
    key={dateKey}
    className="schedule-day-card"
    open={dateKey >= TODAY}
    title={<span className="schedule-day-summary-title">
      <span>{formatKoreanDate(dateKey)}</span>
      {dateKey === TODAY ? <TimeAxisBadge>오늘</TimeAxisBadge> : null}
      {HOLIDAYS[dateKey] ? <WireBadge tone="coral">{HOLIDAYS[dateKey]}</WireBadge> : null}
      <span className="schedule-day-count">{dayEvents.length}건</span>
      <span className="schedule-day-names">{dayEvents.map((event) => event.title).join(', ')}</span>
    </span>}
  >
    <div className="schedule-event-list">{dayEvents.map((event) => <button
      type="button"
      className="wire-repeat-card schedule-event-row"
      key={event.id}
    >
      <span>{event.allDay ? '종일' : formatKoreanTime(event.start)}</span><strong>{event.title}</strong><WireBadge tone="mint">예정</WireBadge>
    </button>)}</div>
  </WireCardDetails>)}</div>;
}

function MonthView({ anchor }: { anchor: string }) {
  const month = anchor.slice(0, 7);
  const byDate = new Map<string, WireMonthCalendarEvent[]>();
  for (const event of EVENTS) {
    const key = event.start.slice(0, 10);
    const list = byDate.get(key) ?? [];
    list.push({
      id: event.id,
      label: event.allDay ? event.title : `${formatKoreanTime(event.start)} ${event.title}`,
      href: '#prototype-only',
      ...(event.color !== undefined ? { color: event.color as WireMonthCalendarEvent['color'] } : {}),
    });
    byDate.set(key, list);
  }
  const weeks = buildMonthWeeks(month, byDate, TODAY, 3, (dateKey) => `#day-${dateKey}`);
  return <WireMonthCalendar month={month} weeks={weeks} />;
}

function ScheduleContent({ view, anchor }: { view: ScheduleView; anchor: string }) {
  return <Fragment>
    <ScheduleToolbar view={view} anchor={anchor} />
    {view === 'month' ? <MonthView anchor={anchor} /> : <DayWeekBody view={view} anchor={anchor} />}
    <p className="report-description">모든 일정은 합성 데이터입니다.</p>
  </Fragment>;
}

// ── 상담 기록하기 — 당사자·사업·일정 선택 (구 시안 RecordEntryPage 진입 단계) ──

function RecordStartContent() {
  const writable = PARTICIPANTS.filter((participant) => participant.caseIds.some((id) => CASES[id].writeAllowed && CASES[id].status === 'active'));
  const caseOptions = HANEUL.caseIds.map((id) => CASES[id]).filter((item) => item.writeAllowed && item.status === 'active');
  return <Fragment>
    <WireCard title="당사자 정보 입력하기" as="section"><div className="entry-search-grid">
      <SearchInput label="검색" name="entry-search" value="김하늘" placeholder="이름 또는 당사자 ID" />
      <SearchInput label="당사자 이름" variant="select" name="entry-participant" value="p-001" options={[{ value: '', label: '당사자를 선택하세요' }, ...writable.map((item) => ({ value: item.id, label: `${item.name} (${item.beneficiaryId})` }))]} />
      <SearchInput label="참여 사업" variant="select" name="entry-case" value={LIFE_CASE.id} options={[{ value: '', label: '사업을 선택하세요' }, ...caseOptions.map((item) => ({ value: item.id, label: item.label }))]} />
    </div>
      <p className="wire-form-hint">인테이크는 공통 기록지로 바꾸지 않고 기존 전용 양식을 사용합니다.</p>
    </WireCard>
    <Hero participant={HANEUL} supportCase={LIFE_CASE} compact />
    <WireCard title="일정 선택하기" as="section"><div className="entry-schedule-grid">
      <WireFormField label="기록할 상담" control="select" htmlFor="entry-schedule"><select id="entry-schedule" defaultValue="schedule-101"><option value="">일정을 선택하세요</option>{LIFE_CASE.schedules.map((item) => <option key={item.id} value={item.id}>{formatKoreanDateTime(item.scheduledAt)} · 기본 상담</option>)}<option value="unscheduled">예약 없이 진행한 상담</option></select></WireFormField>
      <WireFormField label="상담 일시" required htmlFor="entry-held-at" hint="선택한 일정의 일시이며 기록지에 그대로 전달됩니다."><DateTimePickerControl id="entry-held-at" name="entryHeldAt" fieldLabel="상담 일시" value="2026-09-15T14:00" onChange={noop} required /></WireFormField>
    </div></WireCard>
    <div className="entry-actions"><WireButton variant="primary">기록 시작하기</WireButton></div>
  </Fragment>;
}

// ── 페이지보내기 ──────────────────────────────────────────────────────────

const wrap = (content: ReactNode) => <div className="workflow-prototype">{content}</div>;

export const pages = [
  {
    slug: 'participant-sessions',
    title: '당사자 정보: 회차별 요약',
    heading: '당사자 정보',
    group: '당사자',
    source: 'artifacts/2026-09-09-workflow-prototypes/prototype-app.tsx ParticipantPage·FullReport 회차별 요약·핵심지표',
    public: false,
    content: wrap(<ParticipantShell active="sessions"><SessionsTab /></ParticipantShell>),
  },
  {
    slug: 'participant-goals',
    title: '당사자 정보: 목표',
    heading: '당사자 정보',
    group: '당사자',
    source: 'apps/web/app/participants/[beneficiaryId]/goal-tree.tsx GoalTreeCard + prototype-app.tsx ParticipantPage 탭',
    public: false,
    content: wrap(<ParticipantShell active="goals"><GoalsTab /></ParticipantShell>),
  },
  {
    slug: 'participant-info',
    title: '당사자 정보: 정보',
    heading: '당사자 정보',
    group: '당사자',
    source: 'apps/web/app/participants/[beneficiaryId]/page.tsx ParticipantHub(참여 중인 사업·최신 일정·동의서) + prototype-app.tsx 탭',
    public: false,
    content: wrap(<ParticipantShell active="info"><InfoTab /></ParticipantShell>),
  },
  {
    slug: 'participants',
    title: '당사자 목록',
    group: '당사자',
    source: 'artifacts/2026-09-09-workflow-prototypes/prototype-app.tsx ParticipantsPage·ParticipantListRow',
    public: false,
    content: wrap(<ParticipantsContent />),
  },
  {
    slug: 'schedule-day',
    title: '일정 보기: 일간',
    heading: '일정 보기',
    group: '일정',
    source: 'artifacts/2026-09-09-workflow-prototypes/prototype-app.tsx SchedulePage·DayWeekBody(일간)',
    public: false,
    content: wrap(<ScheduleContent view="day" anchor={TODAY} />),
  },
  {
    slug: 'schedule-week',
    title: '일정 보기: 주간',
    heading: '일정 보기',
    group: '일정',
    source: 'artifacts/2026-09-09-workflow-prototypes/prototype-app.tsx SchedulePage·DayWeekBody(주간)',
    public: false,
    content: wrap(<ScheduleContent view="week" anchor={TODAY} />),
  },
  {
    slug: 'schedule-month',
    title: '일정 보기: 월간',
    heading: '일정 보기',
    group: '일정',
    source: 'packages/wire/src/wire-month-calendar.tsx WireMonthCalendar·buildMonthWeeks(D88 월간 격자)',
    public: false,
    content: wrap(<ScheduleContent view="month" anchor={TODAY} />),
  },
  {
    slug: 'record-start',
    title: '상담 기록하기: 당사자 선택',
    heading: '상담 기록하기',
    group: '일정',
    source: 'artifacts/2026-09-09-workflow-prototypes/prototype-app.tsx RecordEntryPage 진입 단계',
    public: false,
    content: wrap(<RecordStartContent />),
  },
];

// 탭이 세 개라 구 시안의 2열 격자만 3열로 바꾼다. 나머지는 prototype.css 그대로다.
export const css = `
.workflow-prototype .participant-tabs{grid-template-columns:repeat(3,minmax(0,1fr))}
/* 세로 스택은 본문 자리에만 준다. body 에 주면 셸 전체가 max-content 로 늘어 모바일에서 넘친다. */
.workflow-prototype .capture-stack>.workflow-prototype{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--section-gap);min-width:0}
/* 긴 사업 이름과 일정 이름이 줄어들 수 있게 내재 폭 사슬을 끊는다. 단일열 grid 의
   암시 auto 트랙은 minmax(auto, max-content) 라 가장 긴 문장만큼 카드를 밀어 올린다 —
   이 모듈이 쓰는 단일열 격자 전부에 minmax(0,1fr) 를 명시한다. */
.workflow-prototype .schedule-day-stack,.workflow-prototype .participant-panel,.workflow-prototype .participant-list,.workflow-prototype .full-report{grid-template-columns:minmax(0,1fr)}
.workflow-prototype .wire-card-body,.workflow-prototype .schedule-event-list,.workflow-prototype .report-entry,.workflow-prototype .participant-program-row,.workflow-prototype .participant-consent-block,.workflow-prototype .goal-tree-goal-body,.workflow-prototype .goal-tree-session-rows,.workflow-prototype .wire-fieldset,.workflow-prototype .wire-bullets,.workflow-prototype .participant-card,.workflow-prototype .participant-hero-info,.workflow-prototype .wire-card-section,.workflow-prototype .wire-form-field,.workflow-prototype .wire-search,.workflow-prototype .month-cell,.workflow-prototype .month-cell-events{grid-template-columns:minmax(0,1fr)}
.workflow-prototype .wire-card,.workflow-prototype .wire-card-details,.workflow-prototype .wire-card-summary,.workflow-prototype .schedule-day-summary-title{min-width:0}
.workflow-prototype .consent-fieldset{min-inline-size:0}
`;
