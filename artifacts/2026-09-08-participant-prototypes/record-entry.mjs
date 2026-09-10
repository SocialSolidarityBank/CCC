// Review-only prototype. Generates record-entry.html through the shared frame without service requests.
import {
  h,
  fragment,
  render,
  writePrototype,
  PageTitle,
  WireBadge,
  WireButton,
  WireBullets,
  WireCallout,
  WireCard,
  WireCardSection,
  WireChoice,
  WireField,
  WireFormField,
} from './frame.mjs';

const participantName = '오세라';
const participantId = 'turtle-001';
const programName = '마이크로크레딧 씬파일러 금융지원·멘토링';

function ScheduleChoice({ id, value, date, kind, tone, defaultChecked = false }) {
  return h(WireChoice, {
    id,
    name: 'record-source',
    value,
    type: 'radio',
    defaultChecked,
    label: h('span', { className: 'entry-choice-title' },
      h('span', null, date),
      h(WireBadge, { tone }, kind),
      h(WireBadge, null, '미기록'),
    ),
    desc: '선택한 일정의 일시와 유형을 기존 기록지에 전달합니다.',
  });
}

const participantCard = h(WireCard, { title: '당사자와 사업', as: 'section' },
  h('div', { className: 'entry-fields' },
    h(WireFormField, { label: '당사자', control: 'select', htmlFor: 'entry-participant' },
      h('select', { id: 'entry-participant', name: 'participant', defaultValue: participantId },
        h('option', { value: participantId }, `${participantName} (${participantId})`),
      ),
    ),
    h(WireFormField, { label: '참여 사업', control: 'select', htmlFor: 'entry-program' },
      h('select', { id: 'entry-program', name: 'program', defaultValue: 'microcredit' },
        h('option', { value: 'microcredit' }, programName),
      ),
    ),
  ),
);

const scheduleCard = h(WireCard, {
  title: h('span', { className: 'wire-title-with-badge' },
    '연결할 일정',
    h(WireBadge, null, '미기록 2건'),
  ),
  as: 'section',
},
  h('fieldset', { className: 'entry-choice-fieldset' },
    h('legend', { className: 'wire-form-label' }, '기록할 상담을 선택하세요'),
    h('div', { className: 'wire-choice-group entry-choice-list', 'data-layout': 'stack' },
      h(ScheduleChoice, {
        id: 'entry-schedule-regular',
        value: 'scheduled-regular',
        date: '2026년 9월 15일 화요일 오후 2:00',
        kind: '기본 상담',
        tone: 'mint',
        defaultChecked: true,
      }),
      h(ScheduleChoice, {
        id: 'entry-schedule-intake',
        value: 'scheduled-intake',
        date: '2026년 9월 22일 화요일 오전 10:30',
        kind: '인테이크',
        tone: 'lavender',
      }),
      h(WireChoice, {
        id: 'entry-schedule-none',
        name: 'record-source',
        value: 'unscheduled',
        type: 'radio',
        label: '일정 없이 진행한 상담',
        desc: '실제 상담 일시는 다음 기록지에서 직접 입력합니다.',
      }),
    ),
  ),
  h('fieldset', { className: 'entry-choice-fieldset entry-unscheduled-type', id: 'entry-unscheduled-type', hidden: true },
    h('legend', { className: 'wire-form-label' }, '상담 유형'),
    h('div', { className: 'wire-choice-group', 'data-layout': 'row' },
      h(WireChoice, {
        id: 'entry-kind-regular',
        name: 'unscheduled-kind',
        value: 'regular',
        type: 'radio',
        defaultChecked: true,
        label: '기본 상담',
      }),
      h(WireChoice, {
        id: 'entry-kind-intake',
        name: 'unscheduled-kind',
        value: 'intake',
        type: 'radio',
        label: '인테이크',
      }),
    ),
  ),
);

const entryBridge = h('section', { id: 'entry-bridge', className: 'record-entry-stage', 'aria-label': '기록할 상담 선택' },
  h('div', { className: 'record-entry-stack' },
    participantCard,
    scheduleCard,
    h(WireCallout, {
      title: '새 예약을 먼저 등록해야 하나요?',
      tone: 'info',
      actions: h(WireButton, {
        className: 'prototype-register-schedule',
        variant: 'secondary',
        href: '#schedule-registration',
      }, '일정 등록하기'),
    }, '기존 일정 등록 페이지로 이동하는 행동입니다. 이 시안에서는 일정이나 기록을 만들지 않습니다.'),
    h('div', { className: 'entry-actions' },
      h(WireButton, { className: 'prototype-open-record', variant: 'primary', type: 'button' }, '상담 기록하기'),
    ),
  ),
);

const contextCard = h(WireCard, { title: '기록지에 전달되는 맥락', as: 'section' },
  h('div', { className: 'entry-context-fields' },
    h(WireField, { label: '당사자', size: 'sm' }, `${participantName} (${participantId})`),
    h(WireField, { label: '참여 사업', size: 'sm' }, programName),
    h(WireField, { label: '연결 일정', tone: 'blue', size: 'sm' }, h('span', { id: 'preview-schedule' }, '2026년 9월 15일 화요일 오후 2:00')),
    h('div', { id: 'preview-kind-field' },
      h(WireField, { label: '상담 유형', size: 'sm' }, h('span', { id: 'preview-kind' }, '기본 상담')),
    ),
  ),
  h(WireCardSection, { title: '연결된 일정 목표', tone: 'mint' },
    h('p', { id: 'preview-goal', className: 'record-goal-text' }, '사업 운영 현황과 상환 준비 상태를 확인합니다.'),
  ),
  h(WireCardSection, { title: '오늘 확인할 질문', tone: 'mint' },
    h(WireBullets, {
      items: [
        h('span', { id: 'preview-question-one' }, '이번 주 매출 흐름은 어땠나요?'),
        h('span', { id: 'preview-question-two' }, '다음 상환일까지 준비할 사항이 있나요?'),
      ],
    }),
  ),
);

const regularPreview = h('form', { id: 'regular-record-preview', className: 'entry-form-preview' },
  h(WireCard, {
    title: h(fragment, null,
      h('h2', { id: 'regular-record-title' }, '오늘 상담 내용'),
      h('p', { className: 'panel-meta record-writing-help' }, '기존 기본 상담 기록지의 대표 입력만 보여 주는 시각 시안입니다.'),
    ),
    as: 'section',
    labelledBy: 'regular-record-title',
  },
    h('div', { className: 'entry-form-grid' },
      h(WireFormField, { label: '상담 일시', required: true, htmlFor: 'regular-held-at' },
        h('input', { id: 'regular-held-at', name: 'heldAt', type: 'datetime-local', required: true, defaultValue: '2026-09-15T14:00' }),
      ),
      h(WireFormField, { label: '상담 방식', control: 'select', htmlFor: 'regular-channel' },
        h('select', { id: 'regular-channel', name: 'channel', defaultValue: 'in-person' },
          h('option', { value: 'in-person' }, '대면'),
          h('option', { value: 'phone' }, '전화'),
          h('option', { value: 'online' }, '온라인'),
        ),
      ),
      h(WireFormField, { className: 'entry-wide', label: '수기 메모', required: true, control: 'textarea', htmlFor: 'regular-note' },
        h('textarea', { id: 'regular-note', name: 'note', rows: 5, defaultValue: '이번 달 생활비 지출을 함께 확인했습니다. 다음 상담까지 고정비와 변동비를 나누어 적어 보기로 했습니다.', placeholder: '상담에서 확인한 내용을 적습니다.' }),
      ),
    ),
    h('div', { className: 'entry-form-actions' },
      h(WireButton, { variant: 'primary', type: 'submit' }, '저장'),
    ),
  ),
);

const intakePreview = h('form', { id: 'intake-record-preview', className: 'entry-form-preview', hidden: true },
  h(WireCard, {
    title: h(fragment, null,
      h('h2', { id: 'intake-record-title' }, '인테이크 1단계'),
      h('p', { className: 'panel-meta record-writing-help' }, '인테이크를 고르면 기본 상담 기록지가 아니라 기존 4단계 인테이크 양식을 엽니다.'),
    ),
    as: 'section',
    labelledBy: 'intake-record-title',
  },
    h('div', { className: 'entry-form-grid' },
      h(WireFormField, { label: '상담일', required: true, htmlFor: 'intake-held-at' },
        h('input', { id: 'intake-held-at', name: 'heldAt', type: 'datetime-local', required: true }),
      ),
      h(WireFormField, { label: '상담 방법', control: 'select', htmlFor: 'intake-channel' },
        h('select', { id: 'intake-channel', name: 'channel', defaultValue: 'in-person' },
          h('option', { value: 'in-person' }, '대면'),
          h('option', { value: 'phone' }, '전화'),
          h('option', { value: 'online' }, '온라인'),
        ),
      ),
      h('fieldset', { className: 'entry-choice-fieldset entry-wide' },
        h('legend', { className: 'wire-form-label' }, '초기 상담 확인'),
        h('div', { className: 'wire-choice-group', 'data-layout': 'stack' },
          h(WireChoice, { type: 'checkbox', name: 'intake-check', value: 'basic-info', label: '기본 현황을 확인했습니다.' }),
          h(WireChoice, { type: 'checkbox', name: 'intake-check', value: 'consent', label: '동의 기록을 확인했습니다.' }),
        ),
      ),
    ),
    h('div', { className: 'entry-form-actions' },
      h(WireButton, { variant: 'primary', type: 'submit' }, '완료'),
    ),
  ),
);

const recordPreview = h('section', { id: 'record-preview', className: 'record-preview-stage', hidden: true, 'aria-label': '기존 기록지 미리보기' },
  h('div', { className: 'record-preview-stack' },
    h('div', { className: 'entry-preview-actions' },
      h(WireButton, { className: 'prototype-back-to-entry', variant: 'neutral', type: 'button', chevron: 'left' }, '선택으로 돌아가기'),
    ),
    h(WireCallout, {
      title: h('span', { id: 'preview-route-title' }, '기본 상담 기록지 미리보기'),
      tone: 'info',
    }, h('span', { id: 'preview-route-description' }, '선택한 일정의 일시를 채운 기존 기록지를 엽니다. 시안에서는 저장하지 않습니다.')),
    contextCard,
    regularPreview,
    intakePreview,
  ),
);

const content = render(h('div', { className: 'record-entry-page' },
  h(PageTitle, null, '상담 기록하기'),
  entryBridge,
  recordPreview,
));

const css = `
.record-entry-page{width:100%;max-width:760px;display:grid;gap:var(--section-gap)}
.record-entry-stage,.record-preview-stage,.record-entry-stack,.record-preview-stack{display:grid;gap:var(--space-5)}
.entry-fields,.entry-form-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-5)}
.entry-choice-fieldset{min-width:0;margin:0;padding:0;border:0}
.entry-choice-fieldset>.wire-form-label{display:flex;align-items:center;min-height:var(--badge-height);margin-bottom:var(--space-3)}
.entry-choice-list{display:grid;gap:var(--space-2)}
.entry-choice-title{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-2)}
.entry-unscheduled-type{margin-top:var(--space-5)}
.entry-actions,.entry-preview-actions,.entry-form-actions{display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-3)}
.entry-context-fields{display:grid;gap:var(--space-3);margin-bottom:var(--space-5)}
.entry-form-preview{display:grid;gap:var(--space-5)}
.entry-form-actions{margin-top:var(--space-5)}
.entry-wide{grid-column:1/-1}
@media(min-width:1100px){.entry-fields,.entry-form-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
@media(max-width:767px){.record-entry-page{max-width:none}.entry-wide{grid-column:auto}.entry-choice-title{align-items:flex-start}}
`;

const script = `
const bridge=document.getElementById('entry-bridge');
const preview=document.getElementById('record-preview');
const unscheduledType=document.getElementById('entry-unscheduled-type');
const regularForm=document.getElementById('regular-record-preview');
const intakeForm=document.getElementById('intake-record-preview');
const regularHeldAt=document.getElementById('regular-held-at');
const intakeHeldAt=document.getElementById('intake-held-at');
const scheduleOptions={
  'scheduled-regular':{
    route:'regular',kind:'기본 상담',schedule:'2026년 9월 15일 화요일 오후 2:00',heldAt:'2026-09-15T14:00',
    goal:'사업 운영 현황과 상환 준비 상태를 확인합니다.',
    questions:['이번 주 매출 흐름은 어땠나요?','다음 상환일까지 준비할 사항이 있나요?']
  },
  'scheduled-intake':{
    route:'intake',kind:'인테이크',schedule:'2026년 9월 22일 화요일 오전 10:30',heldAt:'2026-09-22T10:30',
    goal:'초기 상담을 위해 생활과 사업의 기본 현황을 확인합니다.',
    questions:['현재 가장 먼저 확인해야 할 생활 현황은 무엇인가요?','사업 운영에서 도움이 필요한 부분은 무엇인가요?']
  }
};
let activeSelection='scheduled-regular';
function selectedSource(){return document.querySelector('input[name="record-source"]:checked')?.value||'scheduled-regular'}
function selectedUnscheduledKind(){return document.querySelector('input[name="unscheduled-kind"]:checked')?.value||'regular'}
function syncSource(){unscheduledType.hidden=selectedSource()!=='unscheduled'}
document.querySelectorAll('input[name="record-source"]').forEach(input=>input.addEventListener('change',syncSource));
document.querySelector('.prototype-register-schedule').addEventListener('click',event=>{
  event.preventDefault();
  window.prototypeNotice('일정 등록하기는 기존 예약 페이지로 이동합니다. 이 시안에서는 일정을 만들지 않습니다.');
});
document.querySelector('.prototype-open-record').addEventListener('click',()=>{
  const source=selectedSource();
  const unscheduled=source==='unscheduled';
  const route=unscheduled?selectedUnscheduledKind():scheduleOptions[source].route;
  const kind=route==='intake'?'인테이크':'기본 상담';
  const option=unscheduled?{
    schedule:'일정 없이 진행한 상담',heldAt:'',
    goal:'연결된 일정 목표가 없습니다. 기록지의 입력칸에서 이번 상담에서 확인할 내용을 적습니다.',
    questions:['실제 상담에서 확인할 내용을 기록지에 직접 적습니다.','기존 예정 일정은 연결하거나 완료하지 않습니다.']
  }:scheduleOptions[source];
  const selectionKey=unscheduled+'-'+source+'-'+route;
  if(activeSelection!==selectionKey){
    (route==='intake'?intakeHeldAt:regularHeldAt).value=option.heldAt;
    activeSelection=selectionKey;
  }
  document.getElementById('preview-route-title').textContent=route==='intake'?'인테이크 기록지 미리보기':'기본 상담 기록지 미리보기';
  document.getElementById('preview-route-description').textContent=unscheduled
    ? '일정은 만들지 않고 기존 기록지를 엽니다. 실제 상담 일시는 기록지에서 직접 입력하며 시안에서는 저장하지 않습니다.'
    : '선택한 일정의 일시를 채운 기존 기록지를 엽니다. 예약 일시는 바꾸지 않으며 시안에서는 저장하지 않습니다.';
  document.getElementById('preview-schedule').textContent=option.schedule;
  document.getElementById('preview-kind').textContent=kind;
  document.querySelector('#preview-kind-field .wire-field-row').dataset.tone=route==='intake'?'lavender':'mint';
  document.getElementById('preview-goal').textContent=option.goal;
  document.getElementById('preview-question-one').textContent=option.questions[0];
  document.getElementById('preview-question-two').textContent=option.questions[1];
  regularForm.hidden=route!=='regular';
  intakeForm.hidden=route!=='intake';
  bridge.hidden=true;
  preview.hidden=false;
  document.querySelector('.prototype-back-to-entry').focus();
});
document.querySelector('.prototype-back-to-entry').addEventListener('click',()=>{
  preview.hidden=true;
  bridge.hidden=false;
  document.querySelector('.prototype-open-record').focus();
});
syncSource();
`;

writePrototype({
  filename: 'record-entry.html',
  title: '상담 기록하기',
  content,
  css,
  script,
  active: 'entry',
});
