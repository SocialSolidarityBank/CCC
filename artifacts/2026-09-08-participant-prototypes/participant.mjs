// Review-only participant hub prototype. Synthetic data; no requests or persistence.
import {
  Chevron,
  PageTitle,
  ParticipantHeroCard,
  WireBadge,
  WireBullets,
  WireButton,
  WireCard,
  WireCardSection,
  WireField,
  WireTab,
  WireTabs,
  fragment,
  h,
  render,
  writePrototype,
} from './frame.mjs';

const programName = '마이크로크레딧 씬파일러 금융지원·멘토링';
const overallGoal = '생활비 흐름을 안정시키고 계획에 따라 채무를 상환한다.';

const hero = render(h(ParticipantHeroCard, {
  name: '오세라',
  beneficiaryId: 'turtle-001',
  nameSize: 'hub',
  className: 'participant-prototype-hero',
  details: [
    { label: '당사자 ID', value: 'turtle-001' },
    { label: '연락처', value: '010-0000-0000' },
    { label: '이메일', value: 'sera@example.test' },
    { label: '생년월일', value: '1985년 3월 12일', tone: 'blue' },
  ],
  actions: h(fragment, null,
    h(WireButton, { variant: 'secondary', className: 'prototype-action' }, '인테이크'),
    h(WireButton, { variant: 'secondary', className: 'prototype-action' }, '기본정보 수정'),
  ),
})).replace('</header>', `${render(h(fragment, null,
  h('hr', { className: 'participant-hero-divider' }),
  h('div', { className: 'participant-hero-info' },
    h('div', { className: 'participant-hero-details' },
      h(WireField, { label: '진행 중인 사업', layout: 'stack', size: 'sm' }, programName),
      h(WireField, { label: '기록 현황', layout: 'stack', size: 'sm' }, '4회차까지 기록됨'),
      h(WireField, { label: '최근 상담', layout: 'stack', size: 'sm', tone: 'blue' }, '2026년 9월 8일'),
      h(WireField, { label: '진행 상태', layout: 'stack', size: 'sm' }, '진행 중'),
    ),
  ),
))}</header>`);

let tabNumber = 0;
const tabs = render(h(WireTabs, { className: 'participant-tabs' },
  h(WireTab, { active: true, onSelect: () => {} }, '당사자 정보'),
  h(WireTab, { active: false, onSelect: () => {} }, '전체 상담 내역'),
)).replace(/<button /g, () => {
  const info = tabNumber++ === 0;
  return `<button id="${info ? 'participant-info-tab' : 'participant-records-tab'}" aria-controls="${info ? 'participant-info-panel' : 'participant-records-panel'}" tabindex="${info ? '0' : '-1'}" `;
});

const scheduleCard = h(WireCard, {
  as: 'section',
  className: 'participant-hub-card',
  title: h('div', { className: 'wire-card-head' },
    h('span', null, '최신 일정'),
    h(WireButton, { variant: 'primary', className: 'prototype-action' }, '일정 등록하기'),
  ),
},
  h('div', { className: 'participant-next-schedule-link wire-repeat-card', 'data-static': 'true' },
    h('span', { className: 'participant-next-schedule-main' },
      h('span', { className: 'participant-next-schedule-date' }, '2026년 9월 15일 오후 2:00'),
      h(WireBadge, { tone: 'mint' }, '기본 상담'),
      h('span', { className: 'participant-next-schedule-program' }, programName),
    ),
  ),
);

const programCard = h(WireCard, {
  as: 'section',
  className: 'participant-hub-card',
  title: '참여 중인 사업',
},
  h('div', { className: 'participant-program-row wire-repeat-card' },
    h('div', { className: 'participant-program-head' },
      h('span', { className: 'participant-program-head-main' },
        h('h3', { title: programName }, programName),
        h(WireBadge, { tone: 'mint' }, '진행 중'),
      ),
    ),
  ),
);

const goalCard = h(WireCard, {
  as: 'section',
  className: 'participant-hub-card',
  title: '목표',
},
  h(WireCardSection, { title: '전체 목표', tone: 'mint' },
    h('p', { className: 'record-goal-text' }, overallGoal),
  ),
  h(WireCardSection, { title: '세부 목표', tone: 'mint' },
    h(WireBullets, { items: [
      '매주 생활비 지출을 기록하고 고정비와 변동비를 구분한다.',
      '월 상환 가능 금액을 확인해 정한 날짜에 납부한다.',
    ] }),
  ),
);

const consentCard = h(WireCard, {
  as: 'section',
  className: 'participant-hub-card',
  title: '동의 정보',
},
  h('div', { className: 'prototype-readonly-grid', 'aria-label': '현재 동의 상태' },
    h(WireField, { label: '개인정보 수집·이용', layout: 'stack', size: 'sm' }, '동의함'),
    h(WireField, { label: 'AI를 활용한 녹취기록', layout: 'stack', size: 'sm' }, '동의함'),
    h(WireField, { label: '마지막 기록', layout: 'stack', size: 'sm', tone: 'blue' }, '2026년 8월 4일'),
  ),
);

const sessions = [
  {
    ordinal: 4,
    date: '2026년 9월 8일',
    kind: '기본 상담',
    kindTone: 'mint',
    oneLiner: '상환 일정과 이번 달 생활비 계획을 함께 점검했습니다.',
    goal: '9월 지출 계획을 확인하고 상환 가능 금액을 정한다.',
    memo: '지난 상담 뒤 작성한 가계부를 함께 확인했습니다. 고정비는 유지하고 식비와 교통비의 주간 한도를 정했습니다.',
    action: '다음 상담 전까지 가계부의 고정비 항목을 표시하기',
    due: '기한 2026년 9월 15일',
    channel: '대면',
    createdAt: '공식 등록 2026년 9월 8일 오후 3:20',
  },
  {
    ordinal: 3,
    date: '2026년 9월 1일',
    kind: '기본 상담',
    kindTone: 'mint',
    oneLiner: '지난주 지출 기록을 바탕으로 조정할 고정비를 정리했습니다.',
    goal: '정기 지출 가운데 줄일 수 있는 항목을 찾는다.',
    memo: '통신비와 구독 서비스 내역을 확인했습니다. 바로 해지할 항목 하나와 다음 달에 다시 볼 항목을 구분했습니다.',
    action: '사용하지 않는 구독 서비스 해지 여부 확인하기',
    due: '기한 2026년 9월 8일',
    channel: '전화',
    createdAt: '공식 등록 2026년 9월 1일 오후 4:10',
  },
  {
    ordinal: 2,
    date: '2026년 8월 18일',
    kind: '기본 상담',
    kindTone: 'mint',
    oneLiner: '수입일과 납부일을 기준으로 월별 상환 순서를 정했습니다.',
    goal: '수입과 필수 지출을 기준으로 상환 계획을 세운다.',
    memo: '월 수입일 뒤 필수 지출이 빠져나가는 순서를 적고, 남는 금액 안에서 무리 없는 상환액을 정했습니다.',
    action: '다음 수입일에 맞춰 상환 예정 금액을 따로 적어 두기',
    due: '기한 2026년 9월 1일',
    channel: '방문',
    createdAt: '공식 등록 2026년 8월 18일 오전 11:40',
  },
  {
    ordinal: 1,
    date: '2026년 8월 4일',
    kind: '인테이크',
    kindTone: 'lavender',
    oneLiner: '인테이크 질문지 작성 회차',
    goal: '현재 생활비와 채무 현황을 함께 확인한다.',
    memo: '기본 정보와 재무 현황을 확인하고 우선 다룰 과제로 생활비 기록과 상환 일정 정리를 선택했습니다.',
    action: '최근 한 달의 고정 지출 내역 준비하기',
    due: '기한 2026년 8월 18일',
    channel: '대면',
    createdAt: '공식 등록 2026년 8월 4일 오후 2:50',
  },
];

function disclosureChevron() {
  return h('span', {
    'aria-hidden': 'true',
    className: 'wire-disclosure-chevron wire-chevron-button',
    'data-variant': 'button',
  }, h(Chevron, { dir: 'down' }));
}

function recordCard(session, index) {
  return h('details', {
    className: 'surface-card',
    id: `record-${session.ordinal}`,
    open: index === 0,
  },
    h('summary', { className: 'record-summary' },
      h('span', { className: 'record-ordinal' }, `${session.ordinal}회차`),
      h('span', { className: 'record-held-at' }, session.date),
      h(WireBadge, { tone: session.kindTone }, session.kind),
      h('span', { className: 'record-one-liner wire-fade-clip' }, session.oneLiner),
      h('span', { className: 'record-summary-right' }, disclosureChevron()),
    ),
    h('div', { className: 'record-body' },
      h('div', { className: 'record-session-goal' },
        h('span', { className: 'record-session-goal-label' }, '이번 상담의 목표'),
        h('p', null, session.goal),
      ),
      h('section', { className: 'record-block', 'aria-labelledby': `memo-${session.ordinal}` },
        h('h3', { id: `memo-${session.ordinal}` }, '수기 메모'),
        h('p', null, session.memo),
      ),
      h('section', { className: 'record-block', 'aria-labelledby': `actions-${session.ordinal}` },
        h('h3', { id: `actions-${session.ordinal}` }, '액션 아이템'),
        h('ul', null,
          h('li', null,
            session.action,
            h(WireBadge, { tone: 'mint' }, '당사자'),
            h('span', { className: 'record-item-meta' }, session.due),
            h(WireBadge, { tone: 'lavender' }, '미완료'),
          ),
        ),
      ),
    ),
    h('p', { className: 'record-foot' },
      h('span', null, session.channel),
      h('span', null, session.createdAt),
    ),
  );
}

const informationPanel = h('section', {
  id: 'participant-info-panel',
  className: 'prototype-panel-stack',
  role: 'tabpanel',
  'aria-labelledby': 'participant-info-tab',
  tabIndex: 0,
}, scheduleCard, programCard, goalCard, consentCard);

const recordsPanel = h('section', {
  id: 'participant-records-panel',
  className: 'prototype-panel-stack',
  role: 'tabpanel',
  'aria-labelledby': 'participant-records-tab',
  tabIndex: 0,
  hidden: true,
},
  h('div', { className: 'prototype-panel-head' },
    h('h2', { className: 'record-section-title' }, '전체 상담 내역'),
    h(WireButton, { variant: 'primary', href: 'record-entry.html' }, '상담 기록하기'),
  ),
  h(WireCard, { as: 'section', className: 'record-goal', labelledBy: 'record-goal-label' },
    h('div', { className: 'record-goal-row' },
      h('span', { className: 'record-goal-label', id: 'record-goal-label' }, '전체 목표'),
      h('p', { className: 'record-goal-text' }, overallGoal),
    ),
  ),
  h('section', { className: 'record-section', 'aria-labelledby': 'record-list-title' },
    h('h2', { className: 'record-section-title', id: 'record-list-title' }, '회차별 기록'),
    h('section', { className: 'record-list', 'aria-label': '상담 기록 목록' },
      ...sessions.map(recordCard),
    ),
  ),
);

const content = [
  render(h('div', { className: 'page-header' }, h(PageTitle, null, '당사자 정보'))),
  hero,
  tabs,
  render(h(fragment, null, informationPanel, recordsPanel)),
].join('');

const css = `
.participant-prototype-hero .participant-hero-info{min-width:0}
.prototype-panel-stack{display:grid;gap:var(--section-gap);min-width:0}
.prototype-panel-head{display:flex;align-items:center;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap}
.prototype-readonly-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:var(--space-5) var(--space-6);min-width:0}
@container (min-width:960px){.participant-prototype-hero .participant-hero-details{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media(max-width:767px){
  .participant-tabs{gap:var(--space-4)}
  .prototype-panel-head{align-items:flex-start}
  .record-section{padding:var(--space-4)}
  .record-summary{gap:var(--space-2);padding:var(--space-4)}
  .record-held-at{width:auto}
  .record-body{padding:var(--space-4)}
  .record-foot{padding-inline:var(--space-4)}
}
`;

const script = `
const participantTabs=[...document.querySelectorAll('.participant-tabs [role="tab"]')];
const participantPanels=participantTabs.map(tab=>document.getElementById(tab.getAttribute('aria-controls')));
function selectParticipantTab(index,moveFocus=false){
  participantTabs.forEach((tab,current)=>{
    const selected=current===index;
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex=selected?0:-1;
    participantPanels[current].hidden=!selected;
  });
  if(moveFocus)participantTabs[index].focus();
}
participantTabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>selectParticipantTab(index));
  tab.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();
    const step=event.key==='ArrowRight'?1:-1;
    selectParticipantTab((index+step+participantTabs.length)%participantTabs.length,true);
  });
});
document.querySelectorAll('.prototype-action').forEach(button=>button.addEventListener('click',event=>{
  event.preventDefault();
  const label=button.textContent.trim();
  window.prototypeNotice(label==='일정 등록하기'
    ? '화면 검토용 시안입니다. 실제 일정을 등록하지 않습니다.'
    : '화면 검토용 시안입니다. 실제 정보 조회·수정 화면으로 이동하지 않습니다.');
}));
`;

writePrototype({
  filename: 'participant.html',
  title: '당사자 정보',
  content,
  css,
  script,
  active: 'participant',
});
