import React, { Fragment, useEffect, useRef, useState } from '../../apps/web/node_modules/react/index.js';
import { ParticipantHeroCard } from '../../apps/web/app/components/wire/participant-hero-card.tsx';
import { DateTimePickerControl, isCompleteDateTime } from '../../apps/web/app/components/wire/date-picker-control.tsx';
import { SearchInput } from '../../apps/web/app/components/wire/search-input.tsx';
import { PageTitle } from '../../apps/web/app/components/wire/page-title.tsx';
import { WireBadge } from '../../apps/web/app/components/wire/wire-badge.tsx';
import { WireButton } from '../../apps/web/app/components/wire/wire-button.tsx';
import { WireBullets, WireCard, WireCardDetails, WireField } from '../../apps/web/app/components/wire/wire-card.tsx';
import { WireCallout, WireQuote } from '../../apps/web/app/components/wire/wire-callout.tsx';
import { WireChoice, WireFormField, WireToolbarField } from '../../apps/web/app/components/wire/wire-form-field.tsx';
import { WireModal } from '../../apps/web/app/components/wire/wire-modal.tsx';
import { WireCardSection, WireItem } from '../../apps/web/app/components/wire/wire-section.tsx';
import { ListRow } from '../../apps/web/app/components/wire/list-row.tsx';
import { WireTab, WireTabs } from '../../apps/web/app/components/wire/wire-tabs.tsx';
import { Chevron } from '../../apps/web/app/components/wire/chevron.tsx';
import { RecordOnepage } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/new/record-onepage.tsx';
import { TimeAxisBadge } from '../../apps/web/app/components/wire/time-axis-badge.tsx';
import { formatKoreanDate, formatKoreanDateTime, formatKoreanTime } from '../../apps/web/app/lib/format-korean-date.ts';
import { Icon } from '../../apps/web/app/components/wire/wire-icon.tsx';
import { NavIcon } from '../../apps/web/app/components/wire/shell-icons.tsx';
type CaseStatus = 'active' | 'closed';
type ScheduleView = 'day' | 'week' | 'month';
type PrototypeSchedule = {
  id: string;
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  status: 'scheduled';
  version: number;
  label: string;
  kind: string;
  goal: string;
  questions: string[];
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
  consent: string[];
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
type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  allDay?: boolean;
  extendedProps: { caseId: string; kind: string; note: string; color?: string };
};

type HeroProps = { participant: Participant; supportCase: SupportCase; compact?: boolean };
type CaseSelectorProps = HeroProps & { onChange: (caseId: string) => void };
type RecordStageProps = HeroProps & {
  schedule: PrototypeSchedule | null;
  heldAt: string;
  onBack: () => void;
};
type CandidateSearchProps = {
  selectedId: string;
  selectedCaseId: string;
  onSelect: (participantId: string, caseId: string) => void;
  scheduledAt: string;
  onScheduledAt: (value: string) => void;
  onNext: () => void;
};
type ScheduleToolbarProps = {
  view: ScheduleView;
  setView: (view: ScheduleView) => void;
  anchor: string;
  setAnchor: (anchor: string) => void;
};


const TODAY = '2026-09-09';
const PRIMARY_GOAL = '신용회복위원회 상담을 병행하고 고정비를 줄여 생활비 흐름을 안정시킨다.';
const notify = (message: string) => globalThis.prototypeNotice?.(message);

declare global {
  var prototypeNotice: ((message: string) => void) | undefined;
  var prototypeSetCaseLabel: ((label: string) => void) | undefined;
}

const CASES: Record<string, SupportCase> = {
  'case-micro-001': {
    id: 'case-micro-001', participantId: 'p-001', label: '마이크로크레딧 씬파일러 금융지원·멘토링', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 6, recent: '2026년 9월 8일',
    currentGoal: '매월 고정비를 먼저 분리하고 9월 말까지 신용회복위원회 상담 결과를 확인한다.',
    subGoals: ['월 고정비를 급여일에 별도 계좌로 옮깁니다.', '신용회복 상담 결과를 다음 회차에서 확인합니다.'],
    schedules: [
      { id: 'schedule-101', beneficiaryId: 'turtle-001', supportCaseId: 'case-micro-001', scheduledAt: '2026-09-15T14:00', status: 'scheduled', version: 3, label: '2026년 9월 15일 오후 2:00', kind: '기본 상담', goal: '신용회복 상담 결과와 9월 고정비 분리 상태를 확인합니다.', questions: ['신용회복 상담에서 안내받은 선택지는 무엇인가요?', '9월 고정비를 별도 계좌로 옮겼나요?'] },
      { id: 'schedule-102', beneficiaryId: 'turtle-001', supportCaseId: 'case-micro-001', scheduledAt: '2026-09-29T10:30', status: 'scheduled', version: 1, label: '2026년 9월 29일 오전 10:30', kind: '기본 상담', goal: '상환 계획 초안과 월말 생활비 잔액을 함께 확인합니다.', questions: ['상환 계획 초안에서 가장 부담되는 항목은 무엇인가요?', '추가로 확인할 지원사업이 있나요?'] },
    ],
    consent: ['개인정보 수집·이용: 동의함', 'AI를 활용한 녹취기록: 동의함', '마지막 기록: 2026년 8월 4일'],
  },
  'case-restart-002': {
    id: 'case-restart-002', participantId: 'p-001', label: '소상공인 재도약 상담', status: 'closed',
    readAllowed: true, writeAllowed: false, closeAllowed: false, recordCount: 3, recent: '2025년 12월 18일',
    currentGoal: '폐업 정리 절차와 채무 증빙 제출을 마무리한다.', subGoals: ['채무 증빙 제출 여부를 종결 기록에서 확인합니다.'], schedules: [],
    consent: ['개인정보 수집·이용: 동의함', 'AI를 활용한 녹취기록: 미동의', '마지막 기록: 2025년 10월 2일'],
  },
  'case-supervision-003': {
    id: 'case-supervision-003', participantId: 'p-001', label: '지역 연계 사후관리', status: 'active',
    readAllowed: true, writeAllowed: false, closeAllowed: false, recordCount: 2, recent: '2026년 7월 21일',
    currentGoal: '연계 기관의 사후관리 연락을 확인한다.', subGoals: ['연계 기관 연락 결과를 확인합니다.'], schedules: [],
    consent: ['개인정보 수집·이용: 동의함', 'AI를 활용한 녹취기록: 미동의', '마지막 기록: 2026년 6월 30일'],
  },
  'case-housing-201': {
    id: 'case-housing-201', participantId: 'p-002', label: '주거안정 긴급지원', status: 'closed',
    readAllowed: true, writeAllowed: false, closeAllowed: false, recordCount: 4, recent: '2026년 5월 20일',
    currentGoal: '임대료 체납을 해소하고 공공임대 신청 서류를 제출한다.', subGoals: ['임대료 분납 내역을 확인합니다.'], schedules: [],
    consent: ['개인정보 수집·이용: 동의함', '마지막 기록: 2026년 3월 2일'],
  },
  'case-youth-301': {
    id: 'case-youth-301', participantId: 'p-003', label: '청년 자립생활 지원', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 2, recent: '2026년 8월 28일',
    currentGoal: '취업 준비 일정을 세우고 월별 생활비를 기록한다.', subGoals: ['주 2건 이상 지원서를 제출합니다.', '교통비와 식비를 주 단위로 기록합니다.'],
    schedules: [
      { id: 'schedule-301', beneficiaryId: 'otter-014', supportCaseId: 'case-youth-301', scheduledAt: '2026-09-18T13:30', status: 'scheduled', version: 1, label: '2026년 9월 18일 오후 1:30', kind: '기본 상담', goal: '지원서 제출 일정과 생활비 기록을 확인합니다.', questions: ['이번 주 제출할 지원서는 몇 건인가요?', '교통비 기록에서 달라진 점이 있나요?'] },
      { id: 'schedule-302', beneficiaryId: 'otter-014', supportCaseId: 'case-youth-301', scheduledAt: '2026-10-02T11:00', status: 'scheduled', version: 1, label: '2026년 10월 2일 오전 11:00', kind: '기본 상담', goal: '면접 결과와 다음 지원 계획을 확인합니다.', questions: ['면접에서 확인한 보완점은 무엇인가요?'] },
    ],
    consent: ['개인정보 수집·이용: 동의함', 'AI를 활용한 녹취기록: 미동의', '마지막 기록: 2026년 7월 14일'],
  },
  'case-employment-401': {
    id: 'case-employment-401', participantId: 'p-004', label: '중장년 일자리 연결', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 1, recent: '2026년 9월 1일',
    currentGoal: '직업훈련 과정과 면접 일정을 확정한다.', subGoals: ['직업훈련 등록 서류를 제출합니다.'], schedules: [], consent: ['개인정보 수집·이용: 동의함'],
  },
  'case-finance-402': {
    id: 'case-finance-402', participantId: 'p-004', label: '생활금융 상담', status: 'active',
    readAllowed: true, writeAllowed: true, closeAllowed: true, recordCount: 2, recent: '2026년 9월 4일',
    currentGoal: '급여일 기준의 생활비 예산을 정한다.', subGoals: ['급여일에 고정비를 먼저 분리합니다.'], schedules: [], consent: ['개인정보 수집·이용: 동의함'],
  },
};

const PARTICIPANTS: Participant[] = [
  { id: 'p-001', beneficiaryId: 'turtle-001', name: '오세라', phone: '010-0000-1201', email: 'sera@example.test', birth: '1985년 3월 12일', caseIds: ['case-micro-001', 'case-restart-002', 'case-supervision-003'], blockedCaseLabel: '긴급생계비 지원 (열람 권한 없음)' },
  { id: 'p-002', beneficiaryId: 'badger-008', name: '김도담', phone: '010-0000-3308', email: 'dodam@example.test', birth: '1976년 11월 7일', caseIds: ['case-housing-201'] },
  { id: 'p-003', beneficiaryId: 'otter-014', name: '이로운', phone: '010-0000-7714', email: 'rowoon@example.test', birth: '1998년 5월 26일', caseIds: ['case-youth-301'] },
  { id: 'p-004', beneficiaryId: 'finch-021', name: '박한결', phone: '010-0000-9121', email: 'hangyeol@example.test', birth: '1969년 9월 2일', caseIds: ['case-employment-401', 'case-finance-402'] },
];

const REPORT_SESSIONS = [
  { no: 1, date: '2026년 4월 3일', kind: '인테이크', summary: '월세 2개월 미납과 신용점수 568점을 확인하고 채무상담 병행 방향을 기록했습니다.' },
  { no: 2, date: '2026년 4월 17일', kind: '기본 상담', summary: '신용회복위원회 상담을 예약하고 통신비 요금제를 변경하기로 했습니다.' },
  { no: 3, date: '2026년 5월 8일', kind: '기본 상담', summary: '단기근로 소득과 신용점수 591점을 확인했지만 지출 기록은 하지 못했습니다.' },
  { no: 4, date: '2026년 6월 5일', kind: '기본 상담', summary: '통신비 요금제를 변경했고 연락 두절 우려가 해소됐다는 실무자 기록이 남았습니다.' },
  { no: 5, date: '2026년 7월 10일', kind: '기본 상담', summary: '주거복지센터 임대료 분납 상담을 마치고 가족 돌봄 일정을 조정했습니다.' },
  { no: 6, date: '2026년 9월 8일', kind: '기본 상담', summary: '신용점수 612점과 고정비 분리 사실을 확인하고 상환 계획 초안을 약속했습니다.' },
];

const SOURCE_CARDS = [
  ['1회차 · 채무/대출 · fact', '신용점수 568점. 카드론 잔액은 820만 원이며, 상환일과 월세 납부일이 같은 주에 모여 있어 지출 순서를 정하기 어렵다고 말했다. 최근 두 달의 고지서와 계좌 내역을 따로 보관하고 있으나 항목별 합계는 아직 정리하지 않은 상태였다.'],
  ['1회차 · 주거 · fact', '월세가 2개월 미납된 보증부 월세 주택에 거주하고 있다. 임대인과 연락은 이어지고 있으며, 당사자는 납부 가능한 날짜와 금액을 구체적으로 전달하지 못했다고 말했다. 퇴거가 확정됐다는 내용은 원문에 없었다.'],
  ['1회차 · 건강/심리정서 · judgment', '긴급도: 주의. 수면이 불규칙하다고 호소함.'],
  ['1회차 · 기타 · plan', PRIMARY_GOAL],
  ['2회차 · 지원사업 연계 이력 · fact', '신용회복위원회 채무상담을 4월 24일로 예약했다. 안내받은 준비물은 신분증, 신용정보조회서와 대출 잔액 확인 자료였다. 당사자는 상담 장소와 시간을 확인했으며, 이 회차에는 상담 결과나 채무조정 확정 여부가 기록되지 않았다.'],
  ['2회차 · 채무/대출 · open_item', '다음 상담에서 신용회복위원회 안내 결과를 확인하기로 함.'],
  ['2회차 · 기타 · plan', '당사자가 통신비 요금제를 변경하기로 함.'],
  ['3회차 · 소득/취업 · fact', '주 3일 단기근로를 시작했고 월 예상소득은 120만 원이라고 말했다. 근무일에 필요한 교통비와 식비를 따로 적기 시작했으며, 첫 급여를 받기 전까지의 생활비는 남아 있는 잔액으로 충당하고 있었다. 장기 고용이 확정됐다는 기록은 없었다.'],
  ['2회차 · 기타 · plan', '당사자가 매일 지출을 기록하기로 함.'],
  ['3회차 · 채무/대출 · fact', '신용점수 591점.'],
  ['3회차 · 기타 · fact', '지출 기록은 시작하지 못했다고 말함.'],
  ['4회차 · 기타 · fact', '통신비 요금제를 변경해 월 3만 원이 줄었다고 확인했다. 변경된 청구 내역을 이전 달과 비교했고, 당사자는 절감액을 다른 소비로 쓰기보다 고정비 납부에 보태겠다고 말했다. 이번 회차에 모든 고정비가 줄었다고 평가한 것은 아니다.'],
  ['4회차 · 건강/심리정서 · judgment', '연락 두절 우려 해소. 정기 연락에 응답하고 있음.'],
  ['5회차 · 가족관계 · fact', '부모 병원 동행을 주 1회로 조정해 근로 일정과 겹치지 않게 함.'],
  ['5회차 · 지원사업 연계 이력 · fact', '은평주거복지센터와 임대료 분납 상담을 완료했다. 미납액과 향후 납부 가능한 시기를 함께 확인했으며, 당사자는 상담 내용을 임대인에게 설명할 준비를 하고 있었다. 상담 완료와 임대인의 분납 합의 확정은 서로 다른 상태로 기록했다.'],
  ['6회차 · 기타 · fact', '급여일에 고정비를 별도 계좌로 옮겼다고 확인함.'],
  ['1회차 · 기타 · fact', '상담 방식: 대면.'],
  ['2회차 · 기타 · fact', '상담 방식: 대면.'],
  ['3회차 · 기타 · fact', '상담 방식: 전화.'],
  ['4회차 · 기타 · fact', '상담 방식: 대면.'],
  ['5회차 · 기타 · fact', '상담 방식: 전화.'],
  ['6회차 · 기타 · fact', '상담 방식: 대면.'],
  ['6회차 · 채무/대출 · fact', '신용점수는 612점, 카드론 잔액은 740만 원으로 기록됐다. 앞선 회차의 568점과 820만 원을 함께 확인할 수 있으나, 점수 변화의 원인이나 개인별 상환 능력 등급을 판정한 내용은 없었다. 수치는 각 회차의 기록값이며 새로운 추정치를 더하지 않았다.'],
  ['6회차 · 기타 · plan', '당사자가 9월 30일까지 상환 계획 초안을 작성하기로 함.'],
];
// 번호는 내용이 아니라 순서다. 사람이 제목 문자열에 적지 않고 이 배열 순서에서 뽑는다(2026-09-09 Q).
const REPORT_SECTIONS = ['상황변화', '목표변화', '실천과제', '자원연계', '위험신호'] as const;
function sectionTitle(label: (typeof REPORT_SECTIONS)[number]) {
  const index = REPORT_SECTIONS.indexOf(label) + 1;
  return <span className="report-section-title"><span className="report-index">{String(index).padStart(2, '0')}</span>{label}</span>;
}

const REPORT_CHANGES: Array<[string, string, number, string, number[]]> = [
  ['상황변화', '월세 2개월 미납·카드론 820만 원', 1, '월세 분납 상담 완료·카드론 740만 원', [5, 6]],
  ['목표변화', PRIMARY_GOAL, 1, '통신비 월 3만 원 절감과 고정비 분리를 확인', [4, 6]],
  ['실천과제', '통신비 요금제 변경 약속', 2, '요금제 변경 완료 사실 확인', [4]],
  ['자원연계', '신용회복위원회 상담 예약', 2, '주거복지센터 임대료 분납 상담 완료', [5]],
  ['위험신호', '긴급도: 주의', 1, '연락 두절 우려 해소', [4]],
];


function caseStatusLabel(item: SupportCase) { return item.status === 'active' ? '진행 중' : '종결'; }
function aggregateStatus(participant: Participant) {
  return participant.caseIds.map((id) => CASES[id]).some((item) => item.readAllowed && item.status === 'active') ? 'active' : 'closed';
}
function participantById(id: string) { return PARTICIPANTS.find((item) => item.id === id) ?? PARTICIPANTS[0]; }

function Hero({ participant, supportCase, compact = false }: HeroProps) {
  const actions = compact ? undefined : <Fragment>
    <WireButton variant="secondary" disabled={!supportCase.readAllowed} onClick={() => notify('기존 인테이크를 읽는 전용 화면으로 이동합니다. 이 시안에서는 저장하지 않습니다.')}>인테이크</WireButton>
    <WireButton variant="secondary" disabled={!supportCase.writeAllowed} onClick={() => notify(supportCase.writeAllowed ? '기본정보 수정 화면으로 이동하는 시안 행동입니다.' : '이 케이스는 읽기만 허용되어 수정할 수 없습니다.')}>기본정보 수정</WireButton>
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

function CaseSelector({ participant, supportCase, onChange }: CaseSelectorProps) {
  const readable = participant.caseIds.map((id) => CASES[id]).filter((item) => item.readAllowed);
  return <WireCard title={<span id="participant-business-title">참여중인 사업</span>} as="section" className="case-selector-card">
    <div className="case-selector-row">
      <WireFormField label="참여중인 사업" hideLabel control="select" htmlFor="participant-case-select">
        <select id="participant-case-select" aria-labelledby="participant-business-title" value={supportCase.id} onChange={(event) => onChange(event.currentTarget.value)}>
          {readable.map((item) => <option key={item.id} value={item.id}>{`${item.label} (${caseStatusLabel(item)}${item.writeAllowed ? '' : ', 읽기 전용'})`}</option>)}
          {participant.blockedCaseLabel ? <option disabled>{participant.blockedCaseLabel}</option> : null}
        </select>
      </WireFormField>
      <div className="case-selector-actions">
        <WireButton variant="danger" disabled={!supportCase.closeAllowed || supportCase.status === 'closed'} onClick={() => notify('시안에서는 사업을 종결하지 않습니다.')}>{supportCase.status === 'closed' ? '종결됨' : '종결'}</WireButton>
      </div>
    </div>
  </WireCard>;
}

function InformationPanel({ supportCase }: { supportCase: SupportCase }) {
  const latest = supportCase.schedules[0];
  return <section className="participant-panel" aria-label="당사자 정보">
    <WireCard title="최신 일정" as="section">
      {latest ? <div className="wire-repeat-card latest-schedule-row">
        <div><p className="repeat-title">{formatKoreanDateTime(latest.scheduledAt)}</p><p className="repeat-description">{latest.goal}</p></div>
        <WireBadge tone="mint">{latest.kind}</WireBadge>
      </div> : <p className="empty">이 사업에 예정된 일정이 없습니다.</p>}
    </WireCard>
    <WireCard title="목표" as="section">
      <WireCardSection title="현재 전체 목표" tone="mint"><p className="report-body">{supportCase.currentGoal}</p></WireCardSection>
      <WireCardSection title="세부 목표" tone="mint"><WireBullets items={supportCase.subGoals} /></WireCardSection>
    </WireCard>
    <WireCard title="동의" as="section"><div className="readonly-grid">{supportCase.consent.map((item) => { const [label, value] = item.split(': '); return <WireField key={item} label={label} layout="stack" size="sm">{value ?? item}</WireField>; })}</div></WireCard>
    {!supportCase.writeAllowed ? <WireCallout title="읽기 전용 사업" tone="lavender">열람 권한과 기록·종결 권한은 다릅니다. 이 케이스에서는 과거 정보를 볼 수 있지만 상담 기록이나 일정을 만들 수 없습니다.</WireCallout> : null}
  </section>;
}

function Evidence({ sessions }: { sessions: number[] }) {
  return <span className="evidence-list">{sessions.map((no) => {
    const sourceIndex = SOURCE_CARDS.findIndex(([title]) => title.startsWith(`${no}회차 `));
    return <a key={no} href={`#source-card-${sourceIndex}`} aria-label={`${no}회차 합성 원문 보기`}><WireBadge>{no}회차 근거</WireBadge></a>;
  })}</span>;
}

// 공용 카드가 바깥 패딩을, 이 목록이 행 사이 구분선을 소유한다.
function ReportRows({ children }: { children: React.ReactNode }) {
  const rows = React.Children.toArray(children);
  return <div className="report-rows">{rows.map((row, index) => <Fragment key={index}>
    {index > 0 && <hr className="wire-card-divider" />}
    <div className="report-entry">{row}</div>
  </Fragment>)}</div>;
}

const CARD_KIND_LABELS: Record<string, string> = { fact: 'FACT', judgment: 'JUDGEMENT', plan: 'PLAN', open_item: 'OPEN ITEM' };

function FullReport() {
  return <section className="participant-panel full-report" aria-label="전체 상담 리포트">
    <div className="report-heading"><div><h2>전체 상담 리포트</h2><p className="report-description">합성 원문 카드로 만든 시안입니다. 실제 AI 추출이나 기록 저장은 하지 않습니다.</p></div><WireBadge tone="lavender">합성 예시</WireBadge></div>
    <WireCard title="기본정보" as="section"><div className="report-info-grid">
      <WireField label="사업" layout="stack" size="sm">마이크로크레딧 씬파일러 금융지원·멘토링</WireField>
      <WireField label="실무자" layout="stack" size="sm">정민서 실무자</WireField>
      <WireField label="기간" layout="stack" size="sm" tone="blue">2026년 4월 3일부터 9월 8일까지</WireField>
      <WireField label="총 회차" layout="stack" size="sm">6회차, 대면 4회와 전화 2회</WireField>
    </div></WireCard>
    <WireCard title="최초 인테이크 전체 목표" as="section">
      <WireQuote>{PRIMARY_GOAL}</WireQuote><Evidence sessions={[1]} />
      <p className="report-description">현재 수정 가능한 전체 목표와 구분되는 1회차 원문입니다. 아래 목표변화에도 같은 문장을 그대로 반복합니다.</p>
    </WireCard>
    <WireCard title="회차별 요약" as="section"><ReportRows>{REPORT_SESSIONS.map((session) => <Fragment key={session.no}>
      <div className="report-session-meta"><WireBadge>{session.no}회차</WireBadge><span>{session.date}</span><WireBadge tone={session.kind === '인테이크' ? 'lavender' : 'mint'}>{session.kind}</WireBadge></div>
      <p className="report-body">{session.summary}</p>
    </Fragment>)}</ReportRows></WireCard>
    <WireCard title="핵심지표" as="section"><WireCardSection title="신용점수 조건부 숫자 지표" tone="mint">
      <div className="metric-grid"><WireField label="처음" layout="stack" size="sm">568점, 1회차</WireField><WireField label="중간" layout="stack" size="sm">591점, 3회차</WireField><WireField label="현재" layout="stack" size="sm">612점, 6회차</WireField></div>
      <p className="report-description">반복 기록된 수치만 표시했습니다. 증감 이유나 달성률은 원문에 없어 만들지 않았습니다.</p>
    </WireCardSection></WireCard>
    <WireCard title="한눈에 보는 변화" as="section"><ReportRows>
      {REPORT_CHANGES.map(([label, first, firstNo, now, nowNos]) => <Fragment key={label}>
        <h3 className="report-label">{label}</h3>
        <div className="change-grid">
          <WireField label="처음" layout="stack" size="sm" tone="blue">{first}<Evidence sessions={[firstNo]} /></WireField>
          <WireField label="현재" layout="stack" size="sm" tone="mint">{now}<Evidence sessions={nowNos} /></WireField>
        </div>
      </Fragment>)}
    </ReportRows></WireCard>
    <WireCardDetails title={sectionTitle('상황변화')} open><ReportRows>
      <WireCardSection title="처음" tone="mint"><p className="report-body">월세 2개월 미납, 카드론 잔액 820만 원, 불규칙한 수면이 기록됐습니다. 1회차에는 상환일과 월세 납부일이 같은 주에 모여 있었고, 고지서와 계좌 내역을 항목별로 정리하지 못한 상태였습니다.</p><Evidence sessions={[1]} /></WireCardSection>
      <WireCardSection title="지금" tone="mint"><p className="report-body">카드론 잔액 740만 원, 주거복지센터 분납 상담 완료, 주 3일 단기근로 시작이 기록됐습니다. 단기근로는 장기 고용 확정과 구분하며, 분납 상담 완료를 임대인과의 합의 확정으로 바꾸어 쓰지 않았습니다.</p><Evidence sessions={[3, 5, 6]} /></WireCardSection>
      <WireCardSection title="카테고리별 회차"><ReportRows>{[
        ['채무/대출', '1회차 카드론 잔액은 820만 원, 6회차는 740만 원입니다. 신용점수는 1회차 568점, 3회차 591점, 6회차 612점으로 기록됐습니다. 수치의 변화 원인이나 상환 능력 등급은 별도로 추정하지 않았습니다.'],
        ['소득/취업', '3회차에 주 3일 단기근로를 시작했고 월 예상소득을 120만 원이라고 말했습니다. 근무일의 교통비와 식비를 따로 적기 시작했으며, 장기 고용 여부는 아직 기록되지 않았습니다.'],
        ['가족관계', '5회차에 부모 병원 동행을 주 1회로 조정했습니다. 근로 일정과 겹치지 않도록 바꿨다는 사실만 기록됐으며, 다른 가족의 돌봄 참여나 관계 변화는 확인된 원문이 없어 추가하지 않았습니다.'],
        ['주거', '1회차에는 월세 2개월이 미납된 상태였습니다. 5회차에는 주거복지센터의 분납 상담을 마쳤고 임대인에게 설명할 준비를 했습니다. 미납 해소나 임대인의 최종 동의는 후속 확인이 필요합니다.'],
        ['건강/심리정서', '1회차에 수면이 불규칙하다고 호소했습니다. 이후의 수면 상태를 비교할 기록은 없어 호전이나 악화를 판단하지 않았습니다. 기록된 발언과 실무자의 당시 판단을 구분해 표시합니다.'],
        ['지원사업 연계 이력', '2회차에는 신용회복위원회 채무상담을 예약했고, 5회차에는 은평주거복지센터 분납 상담을 완료했습니다. 예약, 상담 완료, 지원 확정은 각각 다른 상태로 다룹니다.'],
        ['기타', '4회차에 통신비 요금제 변경으로 월 3만 원이 줄었고, 6회차에는 급여일에 고정비를 별도 계좌로 옮겼다고 확인했습니다. 전체 생활비의 절감액은 따로 계산하지 않았습니다.'],
      ].map(([label, text]) => <WireCardSection key={label} title={label} tone="mint"><p className="report-body">{text}</p></WireCardSection>)}</ReportRows></WireCardSection>
      <WireCardSection title="다음 확인" tone="lavender"><p className="report-body">신용회복위원회 안내 결과를 확인합니다. 상담을 예약했다는 기록과 실제 상담에서 받은 안내를 구분해 살펴봅니다.</p><Evidence sessions={[2]} /></WireCardSection>
    </ReportRows></WireCardDetails>
    <WireCardDetails title={sectionTitle('목표변화')}><ReportRows>
      <WireCardSection title="최초 인테이크 전체 목표" tone="mint"><WireQuote>{PRIMARY_GOAL}</WireQuote><Evidence sessions={[1]} /></WireCardSection>
      <WireCardSection title="진척상황" tone="mint"><p className="report-body">통신비 요금제 변경으로 월 3만 원이 줄었고, 6회차에 고정비를 별도 계좌로 분리했다고 기록했습니다. 이후 9월 30일까지 상환 계획 초안을 작성하기로 했습니다. 목표 달성 판정이나 진척률은 원문에 없습니다.</p><Evidence sessions={[4, 6]} /></WireCardSection>
      <WireCardSection title="회차별 방향" tone="mint"><WireBullets items={['1회차에 채무상담을 병행하고 고정비를 줄이기로 했습니다.', '2회차에 신용회복위원회 상담 결과를 확인하기로 했습니다.', '6회차에 9월 30일까지 상환 계획 초안을 작성하기로 했습니다.']} /></WireCardSection>
    </ReportRows></WireCardDetails>
    <WireCardDetails title={sectionTitle('실천과제')}><ReportRows>
      <Fragment>
        <WireItem title="통신비 요금제 변경" status={<WireBadge tone="mint">완료</WireBadge>} />
        <WireField label="배경" layout="stack" size="sm" tone="mint">2회차에 당사자가 고정비를 줄이기 위해 통신비 요금제를 변경하기로 했습니다. 이 단계에는 실제 절감액이 기록되지 않았습니다.</WireField>
        <WireField label="근거" layout="stack" size="sm" tone="blue">4회차에 변경된 청구 내역을 이전 달과 비교해 월 3만 원이 줄었다고 확인했습니다.<Evidence sessions={[2, 4]} /></WireField>
      </Fragment>
      <Fragment>
        <WireItem title="지출 기록 시작" status={<WireBadge tone="lavender">미이행</WireBadge>} />
        <WireField label="배경" layout="stack" size="sm" tone="mint">2회차에 당사자가 매일 지출을 기록하기로 했습니다. 이 계획에는 새로운 제출 방식이나 작성 양식을 덧붙이지 않았습니다.</WireField>
        <WireField label="근거" layout="stack" size="sm" tone="blue">3회차에 아직 시작하지 못했다고 말했습니다. 그 이후의 이행 여부를 직접 확인한 기록은 없어 완료로 바꾸지 않았습니다.<Evidence sessions={[2, 3]} /></WireField>
      </Fragment>
      <Fragment>
        <WireItem title="상환 계획 초안 작성" status={<WireBadge>진행 중</WireBadge>} />
        <WireField label="배경" layout="stack" size="sm" tone="mint">6회차에 당사자가 9월 30일까지 작성하기로 했습니다. 앞선 회차의 지출 기록 계획과는 별도 항목입니다.</WireField>
        <WireField label="근거" layout="stack" size="sm" tone="blue">6회차가 최신 기록이므로 초안 제출이나 완료를 확인할 후속 회차가 아직 없습니다. 완료 여부는 다음 기록에서 확인합니다.<Evidence sessions={[6]} /></WireField>
      </Fragment>
    </ReportRows></WireCardDetails>
    <WireCardDetails title={sectionTitle('자원연계')}><ReportRows>
      <WireCardSection title="신용회복위원회" tone="mint"><p className="report-body">채무상담을 위해 2회차에 4월 24일 상담을 예약했습니다. 준비물로 신분증, 신용정보조회서와 대출 잔액 확인 자료를 안내받았습니다. 상담 결과와 채무조정 확정 여부는 아직 확인할 기록이 없습니다.</p><Evidence sessions={[2]} /></WireCardSection>
      <WireCardSection title="은평주거복지센터" tone="mint"><p className="report-body">임대료 분납을 목적으로 5회차에 상담을 완료했습니다. 미납액과 납부 가능한 시기를 확인했으며, 임대인의 분납 동의와 실제 미납액 납부 여부는 별도 후속 기록으로 확인해야 합니다.</p><Evidence sessions={[5]} /></WireCardSection>
      <WireCardSection title="다음 확인" tone="lavender"><p className="report-body">신용회복위원회 안내 결과를 확인합니다. 예약 사실만으로 지원 확정이나 채무조정 완료를 표시하지 않습니다.</p><Evidence sessions={[2]} /></WireCardSection>
    </ReportRows></WireCardDetails>
    <WireCardDetails title={sectionTitle('위험신호')}><ReportRows>
      <WireCardSection title="전체위험도" tone="lavender"><p className="report-body">1회차에 “긴급도: 주의” 판단이 있었고, 4회차에는 “연락 두절 우려 해소”가 기록됐습니다. 당시의 서로 다른 항목을 하나의 새 위험등급으로 합치지 않았으며, 별도 위험등급도 판단하지 않았습니다.</p><Evidence sessions={[1, 4]} /></WireCardSection>
      <WireCardSection title="회차별 항목" tone="lavender"><ReportRows>
        <Fragment><div className="report-session-meta"><WireBadge>1회차</WireBadge><WireBadge tone="lavender">JUDGEMENT</WireBadge></div><WireQuote>긴급도: 주의. 수면이 불규칙하다고 호소함.</WireQuote></Fragment>
        <Fragment><div className="report-session-meta"><WireBadge>4회차</WireBadge><WireBadge tone="lavender">JUDGEMENT</WireBadge></div><WireQuote>연락 두절 우려 해소. 정기 연락에 응답하고 있음.</WireQuote></Fragment>
      </ReportRows></WireCardSection>
    </ReportRows></WireCardDetails>
    <WireCardDetails title="합성 원문 출처 카드"><ReportRows>{SOURCE_CARDS.map(([title, content], index) => {
      const [session, category, kind] = title.split(' · ');
      return <div id={`source-card-${index}`} className="source-card-entry" key={index}>
        {/* 배지끼리 먼저 묶고 카테고리 라벨은 그 뒤에 둔다(2026-09-09 Q). */}
        <div className="report-session-meta"><WireBadge>{session}</WireBadge><WireBadge tone={kind === 'judgment' ? 'lavender' : kind === 'plan' ? 'mint' : 'neutral'}>{CARD_KIND_LABELS[kind]}</WireBadge><span className="report-label">{category}</span></div>
        <p className="report-body">{content}</p>
      </div>;
    })}</ReportRows></WireCardDetails>
    <WireCardDetails title="출처와 콜로폰"><ReportRows>
      <WireCardSection title="출처"><p className="report-body">합성 상담 원문 1–6회차 · 2026년 4월 3일–9월 8일</p><p className="report-description">실제 AI 추출 결과가 아니라 화면 검토용으로 직접 작성한 합성 예시입니다. 기본정보, 원문과 회차별 서술을 같은 사례에 맞춰 채웠습니다.</p></WireCardSection>
      <WireCardSection title="표시하지 않는 항목"><p className="report-body">위험 JUDGEMENT 카드가 없는 사례에서는 위험신호 구획을 생략합니다. “위험 없음”이나 “특이사항 없음”을 새로 만들지 않습니다. 반복 숫자가 없으면 핵심지표도 생략합니다.</p><p className="report-description">실제 제품에서는 미승인 AI 산출물이 공식 리포트 재료에 들어가지 않는지 별도로 검증해야 합니다. 이 정적 시안이 승인 게이트 구현을 대신하지는 않습니다.</p></WireCardSection>
    </ReportRows></WireCardDetails>
  </section>;
}

function LimitedReport({ supportCase }: { supportCase: SupportCase }) {
  return <section className="participant-panel" aria-label="전체 상담 리포트"><WireCallout title="근거가 충분한 항목만 표시" tone="lavender">{supportCase.label}의 합성 예시는 회차 원문이 적어 완성 리포트 대신 확인 가능한 기본정보와 회차 출처만 표시합니다. 비어 있는 위험신호·핵심지표를 임의로 채우지 않습니다.</WireCallout><WireCard title="기본정보"><div className="report-info-grid"><WireField label="사업" layout="stack" size="sm">{supportCase.label}</WireField><WireField label="상태" layout="stack" size="sm">{caseStatusLabel(supportCase)} · {supportCase.recordCount}회차</WireField><WireField label="최근 상담" layout="stack" size="sm" tone="blue">{supportCase.recent}</WireField></div></WireCard><WireCard title="출처와 콜로폰"><p className="report-description">합성 수기 회차 원문만 사용했습니다. 근거가 없는 해석과 섹션은 추가하지 않았습니다.</p></WireCard></section>;
}

type PrototypeTabItem<T extends string> = { id: T; label: string; tabId: string; panelId: string };

/**
 * 공용 `WireTabs`와 `WireTab`을 그대로 쓰되, 탭 계약에 필요한 id와 `aria-controls`,
 * 선택된 탭 하나만 Tab 순서에 두는 처리와 좌우 방향키 이동을 한 자리에서 붙인다.
 * 운영에서는 이 배선을 공용 부품이 갖는 것이 맞고, 시안이 부품을 고치지는 않는다.
 */
function PrototypeTabs<T extends string>({ tabs, active, onSelect, label, className }: {
  tabs: PrototypeTabItem<T>[];
  active: T;
  onSelect: (id: T) => void;
  label: string;
  className: string;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current?.querySelector('[role="tablist"]');
    if (!list) return;
    list.setAttribute('aria-label', label);
    Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]')).forEach((button, index) => {
      const item = tabs[index];
      if (!item) return;
      button.id = item.tabId;
      button.setAttribute('aria-controls', item.panelId);
      button.tabIndex = item.id === active ? 0 : -1;
    });
  }, [active, label, tabs]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.id === active);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onSelect(next.id);
    // 실제로 고른 탭에 초점을 준다. 이동이 거부되면 원래 탭에 그대로 남는다.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus());
  };
  return <div ref={listRef} onKeyDown={onKeyDown}>
    <WireTabs className={className}>
      {tabs.map((item) => <WireTab key={item.id} active={item.id === active} onSelect={() => onSelect(item.id)}>{item.label}</WireTab>)}
    </WireTabs>
  </div>;
}

export function ParticipantPage() {
  const [participantId, setParticipantId] = useState('p-001');
  const [caseId, setCaseId] = useState('case-micro-001');
  const [tab, setTab] = useState<'info' | 'report'>('info');
  const [selectionError, setSelectionError] = useState(false);
  const participant = participantById(participantId);
  const readableCases = participant.caseIds.map((id) => CASES[id]).filter((item) => item.readAllowed);
  const supportCase = readableCases.find((item) => item.id === caseId) ?? readableCases[0];

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'report') {
      setTab('report');
      window.setTimeout(() => document.getElementById('open-actions')?.scrollIntoView(), 0);
    }
    const requestedParticipant = params.get('participant');
    const requestedCase = params.get('case');
    if (!requestedParticipant && !requestedCase) return;
    const nextParticipant = PARTICIPANTS.find((item) => item.id === requestedParticipant);
    if (!nextParticipant) { setSelectionError(true); return; }
    const nextReadable = nextParticipant.caseIds.map((id) => CASES[id]).filter((item) => item.readAllowed);
    const nextCase = requestedCase ? nextReadable.find((item) => item.id === requestedCase) : nextReadable[0];
    if (!nextCase) { setSelectionError(true); return; }
    setParticipantId(nextParticipant.id);
    setCaseId(nextCase.id);
  }, []);

  useEffect(() => {
    globalThis.prototypeSetCaseLabel?.(selectionError ? '사업 선택 전' : supportCase.label);
  }, [supportCase.label, selectionError]);

  const tabs = [
    { id: 'info' as const, label: '당사자 정보', tabId: 'participant-info-tab', panelId: 'participant-info-panel' },
    { id: 'report' as const, label: '전체 상담 리포트', tabId: 'participant-report-tab', panelId: 'participant-report-panel' },
  ];

  // 잘못된 조합이면 본문을 그리지 않는다. 기본 사례를 다른 당사자의 요청 결과처럼 보이면 안 된다.
  if (selectionError) return <Fragment>
    <PageTitle>당사자 페이지</PageTitle>
    <WireCallout title="정보를 표시할 수 없습니다" tone="lavender">선택한 당사자와 사업 또는 열람 권한을 확인하세요.</WireCallout>
  </Fragment>;

  return <Fragment>
    <PageTitle>당사자 페이지</PageTitle>
    <Hero participant={participant} supportCase={supportCase} />
    <CaseSelector participant={participant} supportCase={supportCase} onChange={(next) => { if (!readableCases.some((item) => item.id === next)) { setSelectionError(true); return; } setCaseId(next); }} />
    <PrototypeTabs className="participant-tabs" label="당사자 페이지 보기" tabs={tabs} active={tab} onSelect={setTab} />
    <div id="participant-info-panel" role="tabpanel" aria-labelledby="participant-info-tab" hidden={tab !== 'info'}>
      <InformationPanel supportCase={supportCase} />
    </div>
    <div id="participant-report-panel" role="tabpanel" aria-labelledby="participant-report-tab" hidden={tab !== 'report'}>
      <div id="open-actions">
        {participant.id === 'p-001' && supportCase.id === 'case-micro-001'
          ? <FullReport />
          : <LimitedReport supportCase={supportCase} />}
      </div>
    </div>
  </Fragment>;
}


function setNativeInput(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function RecordStage({ participant, supportCase, schedule, heldAt, onBack }: RecordStageProps) {
  const [recordGoal, setRecordGoal] = useState(schedule?.goal ?? '');
  const [recordQuestions, setRecordQuestions] = useState((schedule?.questions ?? []).join('\n'));
  useEffect(() => {
    if (!heldAt) return;
    const dateInput = document.querySelector<HTMLInputElement>('#record-held-at');
    setNativeInput(dateInput, heldAt.slice(0, 10));
    const timer = window.setTimeout(() => setNativeInput(document.querySelector<HTMLInputElement>('input[name="heldAtTime"]'), heldAt.slice(11, 16)), 0);
    return () => window.clearTimeout(timer);
  }, [heldAt]);
  const schedules = schedule ? [schedule] : [];
  const sessionGoals = recordGoal.trim() ? [{ body: recordGoal, caseGoalTitle: schedule ? supportCase.subGoals[0] ?? null : null }] : [];
  const customQuestions = recordQuestions.split('\n').map((question) => question.trim()).filter(Boolean);
  const openActionItems = supportCase.id === 'case-micro-001'
    ? [{ id: 'action-1', description: '신용회복위원회 안내 결과를 확인합니다.', owner: 'beneficiary' as const, dueDate: '2026-09-15', sourceHeldAt: '2026-09-08T11:00' }]
    : supportCase.id === 'case-youth-301'
      ? [{ id: 'action-2', description: '이번 주 지원서 제출 결과를 확인합니다.', owner: 'beneficiary' as const, dueDate: '2026-09-18', sourceHeldAt: '2026-08-28T13:30' }]
      : [];
  const goalSection = <Fragment>
    <WireCard as="section" className="wire-form-card" title={<><h2 id="record-goals-title">세부 목표</h2><p className="panel-meta record-writing-help">현재 케이스의 세부 목표를 이 시안에서 읽기 전용으로 보여줍니다. 운영의 세부 목표는 별도 화면에서 수정할 수 있으며, 이 기록지에서는 수정하지 않습니다.</p></>}>
      <WireBullets items={supportCase.subGoals} />
    </WireCard>
    <WireCard as="section" className="wire-form-card prototype-preinfo" title={<><h2 id="prototype-preinfo-title">{schedule ? '일정에서 전달된 사전 정보' : '예약 없이 진행한 상담의 사전 정보'}</h2><p className="panel-meta record-writing-help">{schedule ? '선택한 일정의 목표와 질문을 기록 맥락으로 이어 받습니다. 여기서 쓰는 메모는 기존 일정이나 잠긴 세션 목표를 수정하지 않습니다.' : '가짜 예약을 만들지 않습니다. 이 상담에서 이미 확인한 맥락이 있을 때만 직접 적습니다.'}</p></>}>
      <WireFormField label="세션 목표" control="textarea" htmlFor="prototype-record-goal"><textarea id="prototype-record-goal" rows={3} value={recordGoal} onChange={(event) => setRecordGoal(event.currentTarget.value)} placeholder="이번 상담에서 확인할 목표" /></WireFormField>
      <WireFormField label="맞춤형 질문" control="textarea" htmlFor="prototype-record-questions"><textarea id="prototype-record-questions" rows={3} value={recordQuestions} onChange={(event) => setRecordQuestions(event.currentTarget.value)} placeholder="질문을 한 줄에 하나씩 적습니다." /></WireFormField>
    </WireCard>
  </Fragment>;
  return <Fragment><div className="record-stage-head"><WireButton variant="neutral" chevron="left" onClick={onBack}>선택으로 돌아가기</WireButton><span className="prototype-safety">공통 기록지입니다. 합성 데이터만 쓰고 저장하지 않습니다.</span></div><Hero participant={participant} supportCase={supportCase} compact />
    <form onSubmit={(event) => { event.preventDefault(); notify('시안에서는 상담 기록을 저장하지 않습니다.'); }}>
      <RecordOnepage
        schedules={schedules}
        openActionItems={openActionItems}
        latestLifeAreaSnapshot={[]}
        sessionGoals={sessionGoals}
        customQuestions={customQuestions}
        briefingPath={`participant.html?participant=${encodeURIComponent(participant.id)}&case=${encodeURIComponent(supportCase.id)}&tab=report`}
        actions={<Fragment><WireButton variant="neutral" href={`participant.html?participant=${encodeURIComponent(participant.id)}&case=${encodeURIComponent(supportCase.id)}&tab=report`}>전체 상담 리포트</WireButton><WireButton variant="primary" type="button" icon={<Icon name="check" />} onClick={() => notify('시안에서는 상담 기록을 저장하지 않습니다.')}>저장</WireButton></Fragment>}
        goalSection={goalSection}
        unsavedNotice={<p className="record-writing-help">공통 기록지의 “자동 저장 대기” 표시는 재사용된 원형입니다. 이 시안은 자동 저장·브라우저 저장·서버 저장을 모두 하지 않습니다.</p>}
        supportCaseId=""
      />
    </form>
  </Fragment>;
}

export function RecordEntryPage() {
  const writableParticipants = PARTICIPANTS.filter((participant) => participant.caseIds.some((id: string) => CASES[id].writeAllowed && CASES[id].status === 'active'));
  const [query, setQuery] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [heldAt, setHeldAt] = useState('');
  const [stage, setStage] = useState<'entry' | 'record'>('entry');
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    // 목록에서 넘어오면 당사자와 사업을 미리 고른 상태로 연다. 일정과 일시는 여기서 고른다.
    const requested = PARTICIPANTS.find((item) => item.id === params.get('participant'));
    const requestedCase = params.get('case');
    if (requested && requestedCase && requested.caseIds.includes(requestedCase) && CASES[requestedCase].writeAllowed && CASES[requestedCase].status === 'active') {
      setParticipantId(requested.id);
      setCaseId(requestedCase);
      return;
    }
    if (params.get('example') !== 'filled') return;
    const sample = CASES['case-micro-001'].schedules[0];
    setParticipantId('p-001');
    setCaseId('case-micro-001');
    setScheduleId(sample.id);
    setHeldAt(sample.scheduledAt);
  }, []);
  const matches = writableParticipants.filter((item) => `${item.name} ${item.beneficiaryId}`.toLowerCase().includes(query.trim().toLowerCase()));
  const participant = writableParticipants.find((item) => item.id === participantId) ?? null;
  const caseOptions = participant?.caseIds.map((id) => CASES[id]).filter((item) => item.writeAllowed && item.status === 'active') ?? [];
  const supportCase = caseId ? CASES[caseId] : null;
  const schedule = supportCase?.schedules.find((item) => item.id === scheduleId) ?? null;
  const resetAfterParticipant = (next: string) => { setParticipantId(next); setCaseId(''); setScheduleId(''); setHeldAt(''); };
  const selectCase = (next: string) => { setCaseId(next); setScheduleId(''); setHeldAt(''); };
  const selectSchedule = (next: string) => { setScheduleId(next); const selected = CASES[caseId]?.schedules.find((item) => item.id === next); setHeldAt(selected?.scheduledAt ?? ''); };
  useEffect(() => { globalThis.prototypeSetCaseLabel?.(supportCase?.label ?? '사업 선택 전'); }, [supportCase?.label]);
  if (stage === 'record' && participant && supportCase) return <Fragment><PageTitle>상담 기록하기</PageTitle><RecordStage participant={participant} supportCase={supportCase} schedule={schedule} heldAt={heldAt} onBack={() => setStage('entry')} /></Fragment>;
  return <Fragment><PageTitle>상담 기록하기</PageTitle><WireCard title="당사자 정보 입력하기" as="section"><div className="entry-search-grid">
    <SearchInput label="검색" name="entry-search" value={query} onChange={(next) => { setQuery(next); if (participant && !`${participant.name} ${participant.beneficiaryId}`.toLowerCase().includes(next.trim().toLowerCase())) resetAfterParticipant(''); }} placeholder="이름 또는 당사자 ID" />
    <SearchInput label="당사자 이름" variant="select" name="entry-participant" value={participantId} onChange={resetAfterParticipant} options={[{ value: '', label: matches.length ? '당사자를 선택하세요' : '검색 결과 없음' }, ...matches.map((item) => ({ value: item.id, label: `${item.name} (${item.beneficiaryId})` }))]} />
    <SearchInput label="참여 사업" variant="select" name="entry-case" value={caseId} onChange={selectCase} options={[{ value: '', label: participant ? (caseOptions.length ? '사업을 선택하세요' : '기록 가능한 사업 없음') : '당사자를 먼저 선택하세요' }, ...caseOptions.map((item) => ({ value: item.id, label: item.label }))]} />
  </div>
  {query && matches.length === 0 ? <p className="wire-form-hint">일치하는 합성 당사자가 없습니다. 검색어를 바꾸면 이전 사업·일정 선택은 유지되지 않습니다.</p> : null}
  <p className="wire-form-hint">인테이크는 공통 기록지로 바꾸지 않고 기존 전용 양식을 사용합니다.</p>
  </WireCard>
    {participant ? (supportCase
      ? <Hero participant={participant} supportCase={supportCase} compact />
      : <ParticipantHeroCard name={participant.name} beneficiaryId={participant.beneficiaryId} nameSize="hub" className="workflow-hero" details={[
        { label: '당사자 ID', value: participant.beneficiaryId },
        { label: '연락처', value: participant.phone, tone: 'mint' },
        { label: '이메일', value: participant.email, tone: 'mint' },
        { label: '생년월일', value: participant.birth, tone: 'blue' },
      ]} />)
      : <WireCallout title="당사자를 선택하세요" tone="lavender">선택이 바뀌면 이전 사업·일정·일시 상태를 모두 지웁니다.</WireCallout>}
    {participant && supportCase ? <Fragment><WireCard title="일정 선택하기" as="section"><div className="entry-schedule-grid">
      <WireFormField label="기록할 상담" control="select" htmlFor="entry-schedule"><select id="entry-schedule" value={scheduleId} onChange={(event) => selectSchedule(event.currentTarget.value)}><option value="">일정을 선택하세요</option>{supportCase.schedules.slice(0, 2).map((item) => <option key={item.id} value={item.id}>{formatKoreanDateTime(item.scheduledAt)} · {item.kind}</option>)}<option value="unscheduled">예약 없이 진행한 상담</option></select></WireFormField>
      <WireFormField label="상담 일시" required htmlFor="entry-held-at" hint={scheduleId === 'unscheduled' ? '예약을 만들지 않고 이 일시를 기록지로 전달합니다.' : '선택한 일정의 일시이며 기록지에 그대로 전달됩니다.'}><DateTimePickerControl id="entry-held-at" name="entryHeldAt" fieldLabel="상담 일시" value={heldAt} onChange={setHeldAt} required /></WireFormField>
    </div></WireCard>
    {/* 행동은 카드 밖 왼쪽이다(2026-09-09 Q). 카드와의 거리는 페이지 스택 간격이 만든다. */}
    <div className="entry-actions"><WireButton variant="primary" disabled={!scheduleId || !isCompleteDateTime(heldAt)} onClick={() => setStage('record')}>기록 시작하기</WireButton></div></Fragment> : null}
  </Fragment>;
}

function ScheduleCandidateSearch({ selectedId, selectedCaseId, onSelect, scheduledAt, onScheduledAt, onNext }: CandidateSearchProps) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(selectedId);
  // 목록 밖에서 당사자가 정해지면(주소 매개변수, 예시 값) 그 카드를 펼친 채로 연다.
  useEffect(() => { if (selectedId) setOpenId(selectedId); }, [selectedId]);
  // 후보는 당사자 하나에 등록 가능한 사업 여럿이다. 카드는 사람 단위로 접고, 펼치면 그 사람이 선택된다.
  const candidates = PARTICIPANTS
    .map((participant) => ({ participant, cases: participant.caseIds.map((id) => CASES[id]).filter((item) => item.writeAllowed && item.status === 'active') }))
    .filter(({ cases }) => cases.length > 0);
  const term = query.trim().toLowerCase();
  const matches = candidates.filter(({ participant, cases }) => (
    `${participant.name} ${participant.beneficiaryId} ${participant.phone} ${cases.map((item) => item.label).join(' ')}`.toLowerCase().includes(term)
  ));
  return <Fragment>
    <SearchInput
      label="당사자 검색"
      name="schedule-participant-search"
      value={query}
      onChange={(next) => {
        setQuery(next);
        // 검색 결과에서 사라진 당사자의 선택은 남기지 않는다. 안 보이는 사람의 2단계로 넘어가면 안 된다.
        const term = next.trim().toLowerCase();
        const visible = candidates.some(({ participant, cases }) => (
          participant.id === selectedId
          && `${participant.name} ${participant.beneficiaryId} ${participant.phone} ${cases.map((item) => item.label).join(' ')}`.toLowerCase().includes(term)
        ));
        if (selectedId && !visible) { setOpenId(''); onSelect('', ''); }
      }}
      placeholder="이름, 당사자 ID, 연락처 또는 사업"
    />
    <div className="schedule-candidate-list">
      {matches.map(({ participant, cases }) => <WireCardDetails
        key={participant.id}
        className="participant-list-card schedule-candidate-card"
        open={openId === participant.id}
        onToggle={(event) => {
          if (event.currentTarget.open) {
            setOpenId(participant.id);
            const nextCase = cases.some((item) => item.id === selectedCaseId) ? selectedCaseId : cases[0].id;
            onSelect(participant.id, nextCase);
            return;
          }
          if (openId === participant.id) setOpenId('');
        }}
        title={<span>{participant.name} <span className="participant-card-id">{participant.beneficiaryId}</span></span>}
        badge={selectedId === participant.id ? <WireBadge tone="mint">선택함</WireBadge> : undefined}
      >
        <div className="participant-list-info">
          <WireField label="연락처" layout="stack" size="sm">{participant.phone}</WireField>
          <WireField label="이메일" layout="stack" size="sm">{participant.email}</WireField>
          <WireField label="등록 가능한 사업" layout="stack" size="sm">{`${cases.length}건`}</WireField>
        </div>
        <hr className="wire-card-divider" />
        <div className="schedule-case-choices">
          {cases.map((item) => <WireChoice
            key={item.id}
            type="radio"
            name={`schedule-case-${participant.id}`}
            value={item.id}
            label={item.label}
            checked={selectedId === participant.id && selectedCaseId === item.id}
            onChange={() => onSelect(participant.id, item.id)}
          />)}
        </div>
        {/* 사업을 고르면 같은 카드 안에서 일시를 정하고 다음 단계로 넘어간다(2026-09-09 Q). */}
        {selectedId === participant.id && cases.some((item) => item.id === selectedCaseId) ? <Fragment>
          <hr className="wire-card-divider" />
          <div className="schedule-datetime-row">
            <WireFormField label="상담 일시" required htmlFor="schedule-new-at">
              <DateTimePickerControl id="schedule-new-at" fieldLabel="상담 일시" value={scheduledAt} onChange={onScheduledAt} required />
            </WireFormField>
            <WireButton variant="primary" disabled={!isCompleteDateTime(scheduledAt)} chevron onClick={onNext}>다음: 이번 상담의 목표</WireButton>
          </div>
        </Fragment> : null}
      </WireCardDetails>)}
    </div>
    {matches.length === 0 ? <WireCallout title="찾는 당사자가 없습니다" tone="lavender">검색어를 바꿔 보세요. 기록과 등록이 가능한 사업이 없는 당사자는 이 목록에 나오지 않습니다.</WireCallout> : null}
  </Fragment>;
}

export function ScheduleNewPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [participantId, setParticipantId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [goal, setGoal] = useState('');
  const [question, setQuestion] = useState('');
  const [goalLink, setGoalLink] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('example') !== 'filled' || params.has('participant')) return;
    setParticipantId('p-001');
    setCaseId('case-micro-001');
    setScheduledAt('2026-09-17T14:00');
    setGoal('월말 생활비와 상환 계획을 함께 확인한다.');
    setQuestion('이번 주 지출에서 달라진 점은 무엇인가요?');
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedParticipant = PARTICIPANTS.find((item) => item.id === params.get('participant'));
    const requestedCase = params.get('case');
    if (!requestedParticipant || !requestedCase || !requestedParticipant.caseIds.includes(requestedCase)) return;
    const supportCase = CASES[requestedCase];
    if (!supportCase.writeAllowed || supportCase.status !== 'active') return;
    setParticipantId(requestedParticipant.id);
    setCaseId(supportCase.id);
  }, []);

  const participant = participantId ? PARTICIPANTS.find((item) => item.id === participantId) ?? null : null;
  const supportCase = caseId ? CASES[caseId] : null;
  useEffect(() => {
    globalThis.prototypeSetCaseLabel?.(supportCase?.label ?? '사업 선택 전');
  }, [supportCase?.label]);
  const validDate = isCompleteDateTime(scheduledAt);

  const steps = [
    { id: '1' as const, label: '1 당사자 선택', tabId: 'schedule-step1-tab', panelId: 'schedule-step1-panel' },
    { id: '2' as const, label: '2 상담 목표와 맞춤형 질문', tabId: 'schedule-step2-tab', panelId: 'schedule-step2-panel' },
  ];
  const goStep = (next: 1 | 2) => {
    if (next === 2 && !(participant && supportCase && validDate)) {
      notify('당사자와 사업을 고르고 상담 일시를 채우면 다음 단계로 넘어갑니다.');
      return;
    }
    setStep(next);
  };

  return <Fragment>
    <PageTitle>일정 등록하기</PageTitle>
    <WireCallout title="검토용 시안" tone="lavender">합성 데이터만 사용하며 완료를 눌러도 예약을 저장하거나 API를 호출하지 않습니다.</WireCallout>
    {/* 단계 표시도 당사자 관리와 같은 토글이다(2026-09-09 Q, 구 WireSteps). */}
    <PrototypeTabs className="status-tabs schedule-step-tabs" label="일정 등록 단계" tabs={steps} active={step === 1 ? '1' : '2'} onSelect={(next) => goStep(next === '1' ? 1 : 2)} />
    <div id="schedule-step1-panel" role="tabpanel" aria-labelledby="schedule-step1-tab" hidden={step !== 1} className="participant-panel">
      <ScheduleCandidateSearch
        selectedId={participantId}
        selectedCaseId={caseId}
        scheduledAt={scheduledAt}
        onScheduledAt={setScheduledAt}
        onNext={() => goStep(2)}
        onSelect={(nextParticipant, nextCase) => {
          if (nextParticipant === participantId && nextCase === caseId) return;
          setParticipantId(nextParticipant);
          setCaseId(nextCase);
          setScheduledAt('');
          setGoal('');
          setQuestion('');
          setGoalLink('');
        }}
      />
    </div>
    <div id="schedule-step2-panel" role="tabpanel" aria-labelledby="schedule-step2-tab" hidden={step !== 2} className="participant-panel">
      {participant && supportCase ? <Fragment>
        <ListRow selected className="schedule-selected-context">
          <span><strong>{participant.name}</strong> <span className="participant-card-id">{participant.beneficiaryId}</span></span>
          <span>{supportCase.label}</span>
          <span>{formatKoreanDateTime(scheduledAt)}</span>
        </ListRow>
        <div className="schedule-plan-grid">
          <WireCard title="이번 상담의 목표" as="section">
            <WireFormField label="세부 목표 연결" control="select" htmlFor="schedule-goal-link">
              <select id="schedule-goal-link" value={goalLink} onChange={(event) => setGoalLink(event.currentTarget.value)}>
                <option value="">연결 안 함</option>
                {supportCase.subGoals.map((subGoal) => <option key={subGoal} value={subGoal}>{subGoal}</option>)}
              </select>
            </WireFormField>
            <WireFormField label="세션 목표" control="textarea" htmlFor="schedule-goal">
              <textarea id="schedule-goal" rows={4} value={goal} onChange={(event) => setGoal(event.currentTarget.value)} placeholder="이번 상담에서 다룰 목표" />
            </WireFormField>
          </WireCard>
          <WireCard title="맞춤형 질문" as="section">
            <p className="report-description">AI 질문과 별개로 실무자가 직접 묻고 싶은 내용을 적습니다.</p>
            <WireFormField label="질문 1" control="textarea" htmlFor="schedule-question">
              <textarea id="schedule-question" rows={4} value={question} onChange={(event) => setQuestion(event.currentTarget.value)} />
            </WireFormField>
          </WireCard>
        </div>
        <div className="wizard-actions">
          <WireButton variant="neutral" chevron="left" onClick={() => setStep(1)}>이전</WireButton>
          <WireButton variant="primary" icon={<Icon name="check" />} onClick={() => notify('시안에서는 일정을 저장하지 않습니다.')}>완료</WireButton>
        </div>
      </Fragment> : null}
    </div>
  </Fragment>;
}

function ParticipantListRow({ participant }: { participant: Participant }) {
  const readable = participant.caseIds.map((id) => CASES[id]).filter((item) => item.readAllowed);
  const writableActive = readable.filter((item) => item.writeAllowed && item.status === 'active');
  const [targetCase, setTargetCase] = useState(writableActive[0]?.id ?? '');
  const status = aggregateStatus(participant);
  // 참여중인 사업은 열람 권한과 무관하게 모두 적는다. 열람할 수 없는 사업은 이름만 나오고
  // 선택창과 세 행동에서는 빠져 정보 열람과 일정 등록, 기록 진입이 막힌다(2026-09-09 Q).
  const joinedPrograms = [...readable.map((item) => item.label), ...(participant.blockedCaseLabel ? [participant.blockedCaseLabel] : [])];
  const hubLink = `participant.html?participant=${encodeURIComponent(participant.id)}&case=${encodeURIComponent(readable[0]?.id ?? '')}`;
  return <WireCardDetails
    className="participant-list-card"
    title={<span>{participant.name} <span className="participant-card-id">{participant.beneficiaryId}</span></span>}
    badge={status === 'active' ? <WireBadge tone="mint">진행 중</WireBadge> : <WireBadge>종결</WireBadge>}
  >
    {/* 라벨 아래에 값을 쌓고 세 칸을 옆으로 두어 카드가 세로로 길어지지 않게 한다. */}
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
        <select
          aria-label={`${participant.name} 대상 사업`}
          value={targetCase}
          disabled={writableActive.length === 0}
          onChange={(event) => setTargetCase(event.currentTarget.value)}
        >
          {writableActive.length === 0
            ? <option value="">기록과 등록이 가능한 사업 없음</option>
            : writableActive.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <Chevron dir="down" />
      </span>
      <div className="participant-list-buttons">
        {readable.length === 0
          ? <WireButton variant="neutral" icon={<NavIcon name="participants" />} disabled>당사자 정보 보기</WireButton>
          : <WireButton variant="neutral" icon={<NavIcon name="participants" />} href={hubLink}>당사자 정보 보기</WireButton>}
        {writableActive.length === 0 ? <Fragment>
          <WireButton variant="primary" icon={<NavIcon name="calendar-plus" />} disabled>일정 등록하기</WireButton>
          <WireButton variant="neutral" icon={<NavIcon name="record" />} disabled>상담 기록하기</WireButton>
        </Fragment> : <Fragment>
          <WireButton variant="primary" icon={<NavIcon name="calendar-plus" />} href={`schedule-new.html?participant=${encodeURIComponent(participant.id)}&case=${encodeURIComponent(targetCase)}`}>일정 등록하기</WireButton>
          <WireButton variant="neutral" icon={<NavIcon name="record" />} href={`record-entry.html?participant=${encodeURIComponent(participant.id)}&case=${encodeURIComponent(targetCase)}`}>상담 기록하기</WireButton>
        </Fragment>}
      </div>
    </div>
  </WireCardDetails>;
}

// 세 필터가 같은 목록 하나를 바꾸므로 패널은 하나이고 이름표만 고른 필터를 따라간다.
const PARTICIPANT_FILTERS = [
  { id: 'all' as const, label: '전체', tabId: 'participant-filter-all-tab', panelId: 'participant-list-panel' },
  { id: 'active' as const, label: '진행 중', tabId: 'participant-filter-active-tab', panelId: 'participant-list-panel' },
  { id: 'closed' as const, label: '종결', tabId: 'participant-filter-closed-tab', panelId: 'participant-list-panel' },
];

export function ParticipantsPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'closed'>('all');
  const [query, setQuery] = useState('');
  const [programId, setProgramId] = useState('');
  const programs = Object.values(CASES).filter((item) => item.readAllowed);
  const term = query.trim().toLowerCase();
  const filtered = PARTICIPANTS.filter((participant) => {
    if (filter !== 'all' && aggregateStatus(participant) !== filter) return false;
    if (programId && !participant.caseIds.includes(programId)) return false;
    if (!term) return true;
    return `${participant.name} ${participant.beneficiaryId} ${participant.phone} ${participant.email}`.toLowerCase().includes(term);
  });
  return <Fragment>
    <PageTitle>당사자 관리</PageTitle>
    <PrototypeTabs className="status-tabs" label="당사자 상태 거르기" tabs={PARTICIPANT_FILTERS} active={filter} onSelect={setFilter} />
    <div className="participant-search-row">
      <SearchInput label="당사자 검색" name="participant-search" value={query} onChange={setQuery} placeholder="이름, 당사자 ID, 연락처 또는 이메일" />
      <SearchInput
        label="사업"
        variant="select"
        name="participant-program"
        value={programId}
        onChange={setProgramId}
        options={[{ value: '', label: '사업 전체' }, ...programs.map((item) => ({ value: item.id, label: item.label }))]}
      />
    </div>
    {/* 화면에 설명 문구를 두지 않는다. 결과 수만 보조기기에 알린다. */}
    <p className="prototype-live" role="status">{`${filtered.length}명`}</p>
    <div id="participant-list-panel" role="tabpanel" aria-labelledby={`participant-filter-${filter}-tab`} className="participant-list">
      {filtered.length === 0
        ? <WireCallout title="찾는 당사자가 없습니다" tone="lavender">검색어나 사업 선택을 바꿔 보세요. 열람 권한이 없는 사업은 이 목록에 나오지 않습니다.</WireCallout>
        : filtered.map((participant) => <ParticipantListRow key={participant.id} participant={participant} />)}
    </div>
  </Fragment>;
}

// 종일 일정에 고를 수 있는 색은 승인된 배지 variation 다섯 가지뿐이다(DESIGN-RULES §4).
const ALLDAY_COLORS = [
  { id: 'mint', label: '민트', fill: 'var(--badge-mint)', ink: 'var(--on-badge)' },
  { id: 'lavender', label: '라벤더', fill: 'var(--badge-lavender)', ink: 'var(--on-badge)' },
  { id: 'coral', label: '코랄', fill: 'var(--badge-coral)', ink: 'var(--on-badge)' },
  { id: 'cyan', label: '시안', fill: 'var(--badge-cyan)', ink: 'var(--on-badge)' },
  { id: 'light-magenta', label: '라이트마젠타', fill: 'var(--badge-light-magenta)', ink: 'var(--on-badge-light-magenta)' },
];

// 2026년 관공서 공휴일 중 이 시안 기간에 걸리는 날짜다. 추석은 한국천문연구원 발표 기준
// 9월 24일부터 26일까지이고, 개천절과 한글날은 날짜가 고정된 공휴일이다.
const HOLIDAYS: Record<string, string> = {
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-09': '한글날',
};
const INITIAL_EVENTS: CalendarEvent[] = [
  { id: 'event-0', title: '박한결', start: '2026-09-09T11:00:00', extendedProps: { caseId: 'case-finance-402', kind: '기본 상담', note: '급여일 기준 생활비 예산을 함께 정합니다.' } },
  { id: 'event-1', title: '오세라', start: '2026-09-15T14:00:00', extendedProps: { caseId: 'case-micro-001', kind: '기본 상담', note: '신용회복 상담 결과와 고정비 분리 상태를 확인합니다.' } },
  { id: 'event-2', title: '이로운', start: '2026-09-18T13:30:00', extendedProps: { caseId: 'case-youth-301', kind: '기본 상담', note: '지원서 제출 일정과 생활비 기록을 확인합니다.' } },
  { id: 'event-3', title: '박한결', start: '2026-09-23T10:00:00', extendedProps: { caseId: 'case-employment-401', kind: '기본 상담', note: '직업훈련 등록 서류 준비 상태를 확인합니다.' } },
  { id: 'event-4', title: '오세라', start: '2026-09-29T10:30:00', extendedProps: { caseId: 'case-micro-001', kind: '기본 상담', note: '상환 계획 초안과 월말 생활비 잔액을 확인합니다.' } },
  // 지난 날짜가 접힌 모습을 보이기 위한 합성 과거 회차다.
  { id: 'event-7', title: '이로운', start: '2026-09-04T15:00:00', extendedProps: { caseId: 'case-youth-301', kind: '기본 상담', note: '지난 주 상담입니다. 지난 날짜 묶음은 접힌 채로 열립니다.' } },
  { id: 'event-5', title: '김도담 가정방문', start: '2026-09-17', allDay: true, extendedProps: { caseId: 'case-housing-201', kind: '기본 상담', note: '시간이 정해지지 않은 종일 일정입니다.', color: 'coral' } },
  { id: 'event-6', title: '이로운 서류 마감', start: '2026-09-28', allDay: true, extendedProps: { caseId: 'case-youth-301', kind: '기본 상담', note: '제출 마감일이라 시간을 비워 둔 종일 일정입니다.', color: 'cyan' } },
];

function isoDate(date: Date) { const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function shiftAnchor(anchor: string, amount: number, view: ScheduleView) {
  const date = new Date(`${anchor}T12:00:00`);
  // 월간은 달 단위로 옮긴다. 말일에서 넘어갈 때 다음 달로 밀리지 않게 1일을 기준으로 센다.
  if (view === 'month') return `${isoDate(new Date(date.getFullYear(), date.getMonth() + amount, 1)).slice(0, 7)}-01`;
  date.setDate(date.getDate() + amount * (view === 'week' ? 7 : 1));
  return isoDate(date);
}
function weekLabel(anchor: string) { const date = new Date(`${anchor}T12:00:00`); const monday = new Date(date); monday.setDate(date.getDate() - ((date.getDay() + 6) % 7)); const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); return `${formatKoreanDate(isoDate(monday))}–${formatKoreanDate(isoDate(sunday))}`; }

function ScheduleToolbar({ view, setView, anchor, setAnchor }: ScheduleToolbarProps) {
  const period = view === 'month'
    ? `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`
    : view === 'week'
      ? weekLabel(anchor)
      : formatKoreanDate(anchor);

  return <nav className="schedule-nav" aria-label="일정 보기 조작">
    <div className="schedule-nav-period">
      <button type="button" className="wire-chevron-button schedule-nav-step" aria-label="이전 기간" onClick={() => setAnchor(shiftAnchor(anchor, -1, view))}><Chevron dir="left" /></button>
      <span className="schedule-period-label">{period}</span>
      <button type="button" className="wire-chevron-button schedule-nav-step" aria-label="다음 기간" onClick={() => setAnchor(shiftAnchor(anchor, 1, view))}><Chevron dir="right" /></button>
    </div>
    {/* 한 줄 왼쪽 정렬이고 순서는 기간 이동, 보기 선택, 오늘이다. 등록만 오른쪽 끝이다(2026-09-09 Q). */}
    <div className="schedule-nav-controls">
      <WireToolbarField label="기간 단위" className="schedule-view-select">
        <select aria-label="기간 단위" value={view} onChange={(event) => setView(event.currentTarget.value as ScheduleView)}>
          <option value="day">일간</option>
          <option value="week">주간</option>
          <option value="month">월간</option>
        </select>
        <Chevron dir="down" />
      </WireToolbarField>
      <WireButton variant="neutral" onClick={() => setAnchor(TODAY)}>오늘</WireButton>
    </div>
    <div className="schedule-nav-register">
      <WireButton variant="primary" icon={<NavIcon name="calendar-plus" />} href="schedule-new.html">일정 등록하기</WireButton>
    </div>
  </nav>;
}

function DayWeekBody({ view, anchor, events, onOpen }: { view: ScheduleView; anchor: string; events: CalendarEvent[]; onOpen: (id: string) => void }) {
  const anchorDate = new Date(`${anchor}T00:00:00`);
  const days = view === 'day' ? [anchorDate] : Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchorDate);
    date.setDate(anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7) + index);
    return date;
  });
  // 운영과 같은 날짜 묶음이다: 일정이 있는 날짜만 그리고, 지난 날짜는 접은 채로 둔다.
  const groups = days
    .map((date) => ({ dateKey: isoDate(date), dayEvents: events.filter((item) => item.start.startsWith(isoDate(date))) }))
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
      onClick={() => onOpen(event.id)}
    >
      <span>{event.allDay ? '종일' : formatKoreanTime(event.start)}</span><strong>{event.title}</strong><WireBadge tone="mint">예정</WireBadge>
    </button>)}</div>
  </WireCardDetails>)}</div>;
}

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const MONTH_CELL_EVENT_LIMIT = 3;

/**
 * 월간 격자를 공용 부품 어휘로 직접 그린다(2026-09-09 Q, 구 FullCalendar 대체).
 * 기간 계산은 화면이 이미 갖고 있고, 여기서는 셀 배치와 넘침 접기만 만든다.
 */
function MonthGrid({ anchor, events, onOpen, onPickDay }: { anchor: string; events: CalendarEvent[]; onOpen: (id: string) => void; onPickDay: (dateKey: string) => void }) {
  const first = new Date(`${anchor.slice(0, 7)}-01T00:00:00`);
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((leading + daysInMonth) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(first);
    date.setDate(1 - leading + index);
    return { date, dateKey: isoDate(date), inMonth: date.getMonth() === first.getMonth() };
  });
  return <div className="month-grid" aria-label="월간 상담 일정">
    {/* 요일 줄은 월요일부터 일요일까지 이어지는 면 하나다. */}
    <div className="month-grid-head" role="presentation">
      {WEEKDAY_LABELS.map((label, index) => <span key={label} className="month-weekday" data-weekend={index >= 5 ? 'true' : undefined}>{label}</span>)}
    </div>
    <div className="month-grid-body">{cells.map(({ date, dateKey, inMonth }) => {
      const dayEvents = events.filter((item) => item.start.startsWith(dateKey));
      const shown = dayEvents.slice(0, MONTH_CELL_EVENT_LIMIT);
      const hidden = dayEvents.length - shown.length;
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      return <div
        key={dateKey}
        className="month-cell"
        data-today={dateKey === TODAY ? 'true' : undefined}
        data-outside={inMonth ? undefined : 'true'}
      >
        <span className="month-date" data-coral={weekend || HOLIDAYS[dateKey] ? 'true' : undefined}>{date.getDate()}</span>
        <div className="month-cell-events">
          {shown.map((event) => <button type="button" className="month-event" key={event.id} onClick={() => onOpen(event.id)}>
            <span className="calendar-event-content" data-allday={event.allDay ? 'true' : undefined} data-color={event.allDay ? event.extendedProps.color ?? 'mint' : undefined}>
              {event.allDay ? null : <span className="calendar-event-time">{formatKoreanTime(event.start)}</span>}
              <span className="calendar-event-title">{event.title}</span>
            </span>
          </button>)}
          {hidden > 0 ? <button type="button" className="month-more" onClick={() => onPickDay(dateKey)}>{`+${hidden}건`}</button> : null}
        </div>
      </div>;
    })}</div>
  </div>;
}

function ScheduleEventModal({ event, onClose, onSave }: { event: CalendarEvent | null; onClose: () => void; onSave: (next: CalendarEvent) => void }) {
  const [draft, setDraft] = useState<CalendarEvent | null>(event);
  useEffect(() => setDraft(event), [event]);
  if (!draft) return null;
  const patch = (next: Partial<CalendarEvent>) => setDraft({ ...draft, ...next });
  const patchProps = (next: Partial<CalendarEvent['extendedProps']>) => setDraft({ ...draft, extendedProps: { ...draft.extendedProps, ...next } });
  const dateOnly = draft.start.slice(0, 10);
  return <WireModal
    open
    onClose={onClose}
    title="일정 수정"
    description={`${formatKoreanDate(dateOnly)} 일정입니다. 시안에서는 저장하지 않습니다.`}
    actions={<Fragment>
      <WireButton variant="neutral" onClick={onClose}>취소</WireButton>
      <WireButton variant="primary" icon={<Icon name="check" />} onClick={() => { onSave(draft); notify('시안에서는 일정 변경을 저장하지 않습니다.'); }}>확인</WireButton>
    </Fragment>}
  >
    <div className="schedule-modal-body">
      <WireFormField label="당사자" htmlFor="schedule-modal-title">
        <input id="schedule-modal-title" value={draft.title} onChange={(e) => patch({ title: e.currentTarget.value })} />
      </WireFormField>
      <WireFormField label="상담 형태" control="select" htmlFor="schedule-modal-kind">
        <select id="schedule-modal-kind" value={draft.extendedProps.kind} onChange={(e) => patchProps({ kind: e.currentTarget.value })}>
          <option value="기본 상담">기본 상담</option>
          <option value="인테이크">인테이크</option>
        </select>
      </WireFormField>
      <WireChoice
        type="checkbox"
        label="종일 일정"
        checked={draft.allDay === true}
        desc="시간이 정해지지 않은 일정입니다. 색을 골라 박스로 표시합니다."
        onChange={(checked) => patch({ allDay: checked, start: checked ? dateOnly : `${dateOnly}T10:00:00` })}
      />
      {draft.allDay ? <fieldset className="schedule-color-set">
        <legend className="wire-form-label">컬러 수정</legend>
        <div className="schedule-color-row">{ALLDAY_COLORS.map((color) => <label key={color.id} className="schedule-color-choice" data-color={color.id} data-selected={(draft.extendedProps.color ?? 'mint') === color.id ? 'true' : undefined}>
          <input type="radio" name="schedule-modal-color" value={color.id} aria-label={color.label} checked={(draft.extendedProps.color ?? 'mint') === color.id} onChange={() => patchProps({ color: color.id })} />
        </label>)}</div>
      </fieldset> : <WireFormField label="시작 시각" htmlFor="schedule-modal-time">
        <input id="schedule-modal-time" type="time" value={draft.start.slice(11, 16)} onChange={(e) => patch({ start: `${dateOnly}T${e.currentTarget.value || '10:00'}:00` })} />
      </WireFormField>}
      <WireFormField label="일정 내용" control="textarea" htmlFor="schedule-modal-note">
        <textarea id="schedule-modal-note" rows={3} value={draft.extendedProps.note} onChange={(e) => patchProps({ note: e.currentTarget.value })} />
      </WireFormField>
    </div>
  </WireModal>;
}

export function SchedulePage() {
  // 기본 보기는 월간이다(2026-09-09 Q). `?view=`가 있으면 그 값을 따른다.
  const [view, setView] = useState<ScheduleView>('month');
  const [anchor, setAnchor] = useState(TODAY);
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const pickDay = (dateKey: string) => { setAnchor(dateKey); setView('day'); };
  // 월간 달력은 anchor 를 그 달 1일로 옮긴다. 월간에서 나갈 때만, 그 달이 이번 달이면 오늘로 되돌린다.
  // 주간과 일간 사이 이동에서는 보던 기간을 그대로 둔다.
  const changeView = (next: ScheduleView) => {
    setView(next);
    if (view === 'month' && next !== 'month' && anchor.slice(0, 7) === TODAY.slice(0, 7)) setAnchor(TODAY);
  };
  useEffect(() => {
    globalThis.prototypeSetCaseLabel?.('열람 가능한 사업 전체');
    const params = new URLSearchParams(location.search);
    const requestedView = params.get('view');
    const requestedDate = params.get('date');
    const validDate = requestedDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate);
    if (requestedView !== 'day' && requestedView !== 'week' && requestedView !== 'month') {
      if (validDate) setAnchor(requestedDate);
      return;
    }
    setView(requestedView);
    if (validDate) setAnchor(requestedDate);
    else if (requestedView !== 'month') setAnchor(TODAY);
  }, []);
  // 보기와 기준 날짜는 주소가 갖는다. 새로고침과 주소 공유에서 보던 기간이 살아남는다.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    params.set('view', view);
    params.set('date', anchor);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  }, [view, anchor]);
  return <Fragment>
    <PageTitle>일정 보기</PageTitle>
    <ScheduleToolbar view={view} setView={changeView} anchor={anchor} setAnchor={setAnchor} />
    {view === 'month'
      ? <MonthGrid anchor={anchor} events={events} onOpen={setEditingId} onPickDay={pickDay} />
      : <DayWeekBody view={view} anchor={anchor} events={events} onOpen={setEditingId} />}
    <p className="prototype-safety">모든 일정은 합성 데이터입니다. 팝업에서 고친 값은 이 화면에서만 보이며 저장하지 않습니다.</p>
    <ScheduleEventModal
      event={events.find((item) => item.id === editingId) ?? null}
      onClose={() => setEditingId(null)}
      onSave={(next) => { setEvents(events.map((item) => (item.id === next.id ? next : item))); setEditingId(null); }}
    />
  </Fragment>;
}

const SPACING_SESSIONS = [
  { date: '2026년 9월 8일', body: '고정비 정리표를 함께 확인하고 통신비와 보험료를 다음 달부터 줄이기로 했다.' },
  { date: '2026년 8월 25일', body: '신용회복위원회 상담 일정을 잡았고 필요한 서류 목록을 함께 정리했다.' },
  { date: '2026년 8월 11일', body: '생활비 흐름을 주 단위로 적어 보기로 하고 다음 회차에 함께 읽기로 했다.' },
];

// 포크 4 비교용 시안. 같은 부품을 간격만 바꿔 세 벌 늘어놓는다(2026-09-09 Q 요청).
function SpacingColumn({ title, note, pick, read }: { title: string; note: string; pick: '8' | '20'; read: '8' | '20' }) {
  return <div className="spacing-col">
    <h2 className="spacing-col-title">{title}</h2>
    <p className="spacing-col-note">{note}</p>
    <p className="spacing-col-label">고르는 목록 (당사자 관리) · 간격 {pick}</p>
    <div className="spacing-list" data-gap={pick}>
      {PARTICIPANTS.slice(0, 3).map((participant) => <ParticipantListRow key={participant.id} participant={participant} />)}
    </div>
    <p className="spacing-col-label">읽는 목록 (회차별 정리) · 간격 {read}</p>
    <div className="spacing-list" data-gap={read}>
      {SPACING_SESSIONS.map((session) => <WireCard key={session.date} title={session.date} as="section">
        <p className="report-body">{session.body}</p>
      </WireCard>)}
    </div>
  </div>;
}

export function SpacingPage() {
  return <Fragment>
    <PageTitle>목록 간격 비교</PageTitle>
    <WireCallout title="같은 부품, 간격만 다릅니다" tone="lavender">왼쪽이 지금 규칙이고 가운데와 오른쪽이 개정안입니다. 세로로 붙은 카드 사이만 다르고 카드 안쪽 여백은 셋 다 같습니다.</WireCallout>
    <div className="spacing-lab">
      <SpacingColumn title="지금 규칙" note="목록 안 카드는 전부 20이다(D60 3단)." pick="20" read="20" />
      <SpacingColumn title="A. 전부 8" note="목록 안 카드를 성격과 무관하게 8로 좁힌다." pick="8" read="8" />
      <SpacingColumn title="B. 고르는 8, 읽는 20" note="훑어 고르는 목록만 8이고 글을 읽는 목록은 20이다." pick="8" read="20" />
    </div>
  </Fragment>;
}

export function pageComponent(page: string) {
  if (page === 'participant') return <ParticipantPage />;
  if (page === 'entry') return <RecordEntryPage />;
  if (page === 'scheduleNew') return <ScheduleNewPage />;
  if (page === 'participants') return <ParticipantsPage />;
  if (page === 'spacing') return <SpacingPage />;
  if (page === 'schedule') return <SchedulePage />;
  return <WireCallout title="시안을 찾을 수 없습니다" tone="lavender">올바른 산출물 파일을 여세요.</WireCallout>;
}
