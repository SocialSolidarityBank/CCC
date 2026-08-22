'use client';

import Link from 'next/link';
import { formatKoreanDateTime } from '../../../../../../lib/format-korean-date';
import { Icon } from '../../../../../../components/wire/wire-icon';
import { useRef, useState, type ReactNode } from 'react';
import { DraftRestorePrompt, DraftStatus } from '../../../../../../components/draft/draft-notice';
import { MetaRow } from '../../../../../../components/wire/meta-row';
import { WireBadge } from '../../../../../../components/wire/wire-badge';
import { WireCard, WireCardDetails } from '../../../../../../components/wire/wire-card';
import { WireEmpty } from '../../../../../../components/wire/wire-state';
import { WireChoice, WireFormField } from '../../../../../../components/wire/wire-form-field';
import { DateTimePickerControl } from '../../../../../../components/wire/date-picker-control';
import { DATE_TEXT_HINT } from '../../../../../../components/wire/date-text-input';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { draftKey } from '../../../../../../lib/form-draft';
import { useDomDraft } from '../../../../../../lib/use-dom-draft';
import type {
  CounselingSchedule,
  LifeAreaSnapshotEntry,
  RecordLastSummary,
  RecordSessionGoal,
  SupportCaseRecordGoal,
} from '../../../../../../lib/api';
import { ActionItemFields } from './action-item-fields';
import { LifeAreaFields } from './life-area-fields';
import { OpenActionResolutions, type OpenActionResolutionItem } from './open-action-resolutions';

// 정기 기록지 원페이지(CCC-10 · 설계 v0.2 §1). 배치 순서 자체가 우선순위(P1→P4)다:
// 질문 체크리스트 → 오늘 상담 내용(유일 실질 필수) → 미해결 액션 → 6영역 → 아코디언 → 담당 실무자 의견.
// 진척도는 우측 레일의 필수 채움 카운트로만 표시한다(위저드 스테퍼 폐기).

const flagTypes = [
  ['crisis_utterance', '위기 발언'],
  ['contact_loss_risk', '연락 두절 위험'],
  ['housing_livelihood_shock', '주거·생계·건강 급변'],
  ['debt_deterioration', '부채 악화'],
  ['repeated_noncompliance', '약속 불이행 반복'],
  ['violence_exploitation', '폭력·착취 피해'],
] as const;

const channelOptions = [
  ['in_person', '대면'],
  ['phone', '전화'],
  ['video', '화상'],
] as const;

// 표기는 공용 계약이다(2026-08-07 Q 통일 — "2026년 8월 7일 오후 1:00").
function dateTimeLabel(value: string): string {
  return formatKoreanDateTime(value);
}

/**
 * '완료할 일정' 선택칸의 값(CCC-57). **선택지와 기본값이 이 함수 하나를 같이 써야 한다.**
 * 키 순서만 달라도 문자열이 어긋나 어느 선택지와도 안 맞고, 브라우저는 그때 조용히 첫
 * 선택지로 되돌린다(타입도 렌더도 통과하므로 눈에 띄지 않는다).
 *
 * 그 조용한 되돌림이 덜 아프도록 아래 선택지는 **일정이 먼저, '표시하지 않음'이 마지막**이다.
 * 어긋나도 "가장 이른 예정 일정"에 떨어질 뿐, 이 티켓이 고치는 그 버그(완료 안 함)로는
 * 돌아가지 않는다.
 */
function scheduleChoiceValue(schedule: CounselingSchedule): string {
  return JSON.stringify({ id: schedule.id, version: schedule.version });
}

export interface RecordOnepageProps {
  // goals(세부 목표)는 데이터로 받지 않는다 — D62(CCC-68)로 이 화면에 세부 목표 구획이
  // 생겼지만, 구획은 서버 액션이 묶인 채 아래 goalSection 슬롯으로 통째로 들어온다
  // (page.tsx 가 서버 컴포넌트라 액션 바인딩을 갖는다). 구 GAS 입력·종료+신설(D47 §6 제거)은
  // 되살리지 않는다.
  schedules: CounselingSchedule[];
  openActionItems: OpenActionResolutionItem[];
  latestLifeAreaSnapshot: LifeAreaSnapshotEntry[];
  sessionGoals: RecordSessionGoal[];
  customQuestions: string[];
  lastRecordSummary: RecordLastSummary | null;
  briefingPath: string;
  /**
   * 좌측 레일 바닥에 붙는 버튼(2026-08-08 Q — 구 상단 고정 헤더 우측). 나가기·저장이 여기 산다.
   *
   * 이 화면의 버튼 둘은 원래 서로 멀리 떨어져 있었다 — 나가기는 페이지 제목 옆, 저장은
   * 폼 맨 아래. 레일이 sticky 라 둘 다 **언제나 보이는 한 자리**에 있다.
   *
   * 슬롯으로 받는 이유는 저장이 `type="submit"` 이라 폼 소유자(page.tsx)가 쥐어야 하기
   * 때문이다. 이 부품은 폼 안에서 렌더되므로 여기 놓인 제출 버튼도 그대로 동작한다.
   *
   * **선택 항목이 아니다** — 폼 아래에 있던 저장 버튼을 없앴으므로, 빠뜨리면 저장할 길이
   * 하나도 없는 기록지가 조용히 나간다.
   */
  actions: ReactNode;
  /**
   * 세부 목표 구획(D62 · CCC-68). page.tsx 가 서버 액션을 묶은 GoalSection 을 실어 보낸다 —
   * '오늘 상담 내용' 아래에 선다. 기록지 폼과 별개의 즉시 저장이라 이 폼의 제출에는 안 실린다.
   */
  goalSection?: ReactNode;
  /**
   * 미저장 안내(2026-08-09 Q). 레일 최하단, 저장 버튼 아래에 선다 — 구 자리는 HERO 아래
   * 본문 상단이라 매 방문 첫 화면을 안내가 차지했다. 제출 상태 판단은 페이지 몫이라 슬롯이다.
   */
  unsavedNotice?: ReactNode;
  /** 임시본 키(참여 사업 1건당 1개). 없으면 자동 저장을 끈다. */
  supportCaseId?: string;
  /** 직전 제출이 오류로 이 화면에 되돌아왔는가 — 임시본 성공 판정에 쓴다(use-dom-draft). */
  submissionFailed?: boolean;
}

export function RecordOnepage({
  schedules,
  openActionItems,
  latestLifeAreaSnapshot,
  sessionGoals,
  customQuestions,
  lastRecordSummary,
  briefingPath,
  actions,
  goalSection,
  unsavedNotice,
  supportCaseId = '',
  submissionFailed = false,
}: RecordOnepageProps) {
  const [memoFilled, setMemoFilled] = useState(false);
  // D48: 상담 일시는 날짜 칸 + 시각 칸 둘로 나뉘고 합쳐진 값을 숨은 칸으로 낸다. 그래서 이 값만
  // 리액트가 쥔다 — 폼의 나머지 칸은 예전처럼 DOM 이 갖는다.
  const [heldAt, setHeldAt] = useState('');
  const draft = useDomDraft({ storageKey: draftKey('record', supportCaseId), submissionFailed });
  const [crisisAreas, setCrisisAreas] = useState<string[]>([]);
  const [resolvedActionIds, setResolvedActionIds] = useState<string[]>([]);
  const [safetyOpen, setSafetyOpen] = useState(false);
  // 전체 열기/닫기는 HERO 안 작은 버튼이 갖는다(2026-08-09 Q — RecordAccordionToggle).
  // 여기서 상태를 쥐지 않는 이유는 그 부품 주석에 있다(라벨 하나 때문에 HERO 를 클라이언트로
  // 내리지 않는다). 범위 선택자가 .record-main 이므로 그 클래스는 유지한다.

  // 완료 처리할 연결 일정(CCC-57). 예정 건 중 첫째가 기본으로 골라져 있다. 기록을 남겼는데
  // 그 약속이 계속 '예정'으로 서 있는 것이 이 티켓이 고치는 오작동이다. 예정 건이 없으면
  // 선택칸 자체를 그리지 않는다(고를 것이 '표시하지 않음' 하나뿐인 칸은 자리만 먹는다).
  const scheduledSchedules = schedules.filter((schedule) => schedule.status === 'scheduled');
  const linkedSchedule = scheduledSchedules[0];
  const openActionsHandled = openActionItems.length === 0 || resolvedActionIds.length === openActionItems.length;
  const hasCrisis = crisisAreas.length > 0;
  // P1 3종(설계 §2). 6영역은 기본값 '변화 없음'이 곧 유효한 입력이라 언제나 충족으로 센다.
  const requiredItems = [
    { label: '오늘 상담 내용', done: memoFilled },
    { label: '미해결 액션 처리', done: openActionsHandled },
    { label: '6영역 변화 확인', done: true },
  ];
  const filledCount = requiredItems.filter((item) => item.done).length;

  function handleLifeAreaStatus(areaKey: string, status: string) {
    setCrisisAreas((previous) => {
      const next = previous.filter((key) => key !== areaKey);
      return status === 'crisis' ? [...next, areaKey] : next;
    });
    // '위기'를 고르면 위기·안전 아코디언을 그 자리에서 펼친다(설계 §④·§⑤). 닫는 건 실무자 몫.
    if (status === 'crisis') setSafetyOpen(true);
  }

  function handleResolution(actionItemId: string, status: string) {
    setResolvedActionIds((previous) => {
      const next = previous.filter((id) => id !== actionItemId);
      return status.length === 0 ? next : [...next, actionItemId];
    });
  }

  {/* 레이아웃은 인테이크와 같은 레일 격자다(2026-08-08 Q "인테이크랑 같은 레이아웃"
      — 구 우측 200px 레일 대체). 좌측 레일은 형제 카드 3장 스택이다(2026-08-09 Q — 구
      진척도 카드 한 장에 섞여 있던 목표·필수를 가른다): 이번 상담 목표 + 미해결 액션
      아코디언 + 체크리스트(필수 채움·저장). 맨 아래에 미저장 안내가 선다.
      sticky 는 aside 가 갖고, 스크롤해도 화면에 남는다(인테이크 진행 단계 레일과 같은 계약). */}
  return <div className="wire-container rail-grid record-grid" data-grid="true" ref={draft.containerRef}>
    {/* 좌 레일은 고정 폭 트랙이다(2026-08-09 — 구 12칸 span 4 를 대체: 폭을 따라 줄어들다
        카드 안쪽이 165px 까지 좁아졌다). 폭 계단은 공용 .rail-grid 가 갖고, 이 화면의 레일
        폭은 --rail-width 300 이다. 바로가기 목차는 레일이 아니라 **우측 셋째 열**이다. */}
    <aside className="record-side" aria-label="작성 진척도" data-testid="record-side-rail">
      {/* ① 이번 상담 목표 카드(2026-08-09 Q "미해결 액션 위, 같은 크기") — 제목이 카드 제목
          계약(16/600)이라 미해결 액션 아코디언 제목과 같은 크기로 선다. 일정에 연결된 세션
          목표가 있으면 그것이 이번 상담의 목표다 — 읽기만 한다(CCC-76 으로 폴백 입력칸이
          본문으로 떠나 레일은 온전히 읽기 전용이 됐다).
          연결된 부모는 D62 위계(전체 > 세부 > 세션)대로 **세부 목표**다 — 구 라벨 '전체
          목표:'는 goals 표의 문구를 전체 목표라고 잘못 부르고 있었다(CCC-68 정정).
          연결 선택창은 만들지 않는다(2026-08-09 Q 확정, ADR-0032 대체 관계 표 PR #91 행) —
          연결은 일정 등록 몫이고, 세부 목표의 입력·수정·닫기는 본문의 세부 목표 구획이 갖는다.
          배지(CCC-76): 있음 = 민트 N건(진행·상태 축), 없음 = 라벤더 미설정(주의·대기 축) —
          레드는 D9 리스크 독점 위반이라 기각(Q 확정). */}
      <WireCard testId="record-session-goal-card" title={<span className="record-rail-title">이번 상담 목표
        {sessionGoals.length === 0
          ? <WireBadge tone="lavender">미설정</WireBadge>
          : <WireBadge tone="mint">{sessionGoals.length}건</WireBadge>}
      </span>}>
        {sessionGoals.length === 0
          ? <WireEmpty>일정에 연결된 목표가 없습니다.</WireEmpty>
          : <ul className="record-rail-goals">{sessionGoals.map((goal, index) => <li key={index}>
            <MetaRow items={[goal.body, goal.caseGoalTitle === null ? null : `세부 목표: ${goal.caseGoalTitle}`]} />
          </li>)}</ul>}
      </WireCard>
      {/* ② 미해결 액션 아코디언(CCC-76) — 구 WireCallout 은 레일 카드 **안**에 있어 카드 안
          카드 금지(D59)를 어겼다. 형제 카드로 꺼내며 접힘 카드가 됐다 — 건수는 제목이 항상
          보이고, 내용은 눌러서 편다. 본문은 액션 내용이 위·지난 상담 시각이 아래다(구 MetaRow
          한 줄은 시각이 먼저라 값보다 맥락이 앞섰다). '자세히 보기'는 15초 페이지의 미해결
          액션 구획으로 바로 가는 앵커다. HERO 의 전체 여닫기는 .record-main 범위라 이 칸을
          건드리지 않는다. */}
      {lastRecordSummary === null
        ? null
        : <WireCardDetails title={`미해결 액션 ${openActionItems.length}건`} testId="record-open-actions">
          <p>{lastRecordSummary.text}</p>
          <p className="panel-meta">지난 상담 {dateTimeLabel(lastRecordSummary.heldAt)}</p>
          <WireButton className="record-open-actions-link" variant="neutral" height="sm" href={`${briefingPath}#open-actions`}>자세히 보기</WireButton>
        </WireCardDetails>}
      {/* ③ 체크리스트 카드(2026-08-09 Q "필수는 체크리스트로 분리") — 필수 채움 + 저장.
          필수 카운트는 제목 옆 블루 배지다(진행 축, §2-2 규칙 4 — 구 '필수 N/3' 글줄은
          카드 제목과 같은 16/600 이라 위계가 없었다). */}
      <WireCard testId="record-checklist-card" title={<span className="record-rail-title">체크리스트
        <WireBadge tone="blue" testId="record-required-count">필수 {filledCount}/{requiredItems.length}</WireBadge>
      </span>}>
        <ul className="record-rail-list">
          {requiredItems.map((item) => <li key={item.label} data-done={item.done}>
            <span aria-hidden="true">{item.done ? <Icon name="dot" size={14} /> : <Icon name="dot-empty" size={14} />}</span> {item.label}
            <span className="record-rail-state">{item.done ? ' 채움' : ' 남음'}</span>
          </li>)}
        </ul>
        {/* 별도 임시 저장 버튼이 없다 — 자동 저장이 곧 임시 저장이므로 상태를 상시 보여준다. */}
        <DraftStatus savedAt={draft.savedAt} available={draft.available} />
        {/* 저장·나가기는 레일 바닥 고정이다(2026-08-08 Q — 구 상단 고정 헤더 우측 대체). */}
        <div className="record-rail-actions">{actions}</div>
        {/* 페이지 전체 안내는 사람 말로 저장 버튼 줄 아래 선다(CCC-76 이동 — 구 자리는 저장
            상태와 버튼 사이라 안내문이 행동을 가로막았다. ID 는 숨은 폼 값으로만 다니고,
            재시도 보호라는 뜻만 남긴다 — 2026-08-08 Q, 구 "제출 ID d16b…" 원문 표기 대체.
            "저장 전 내용은 서버에 없고"는 뺐다 — 바로 아래 미저장 안내가 같은 말을 한다). */}
        <p className="panel-meta">수기 메모 하나만 채워도 저장됩니다.
          저장 버튼을 여러 번 눌러도 같은 기록이 두 번 만들어지지 않습니다.</p>
      </WireCard>
      {/* ④ 미저장 안내 — 레일 최하단, 저장 버튼 아래(2026-08-09 Q — 구 자리는 HERO 아래
          본문 상단). 페이지가 제출 상태를 보고 넘겨주는 슬롯이라 여기서는 자리만 정한다. */}
      {unsavedNotice}
    </aside>
    <div className="record-main">
      {draft.restorable === null
        ? null
        : <DraftRestorePrompt
          savedAt={draft.restorable.savedAt}
          uncertain={draft.restorable.uncertain}
          onResume={draft.resume}
          onDiscard={draft.discard}
        />}

      {/* 1. 오늘 확인할 질문 — 체크리스트(기록 대상 아님, 진행 표시용) */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="questions-title"
        title={<><h2 id="questions-title">오늘 확인할 질문</h2><p className="panel-meta">일정에 등록한 맞춤형 질문입니다. 체크는 진행 표시용이며 저장하지 않습니다. AI가 만든 질문은 15초 페이지에서 확인하세요.</p></>}
      >
        {customQuestions.length === 0
          ? <p className="empty"><span>등록된 맞춤형 질문이 없습니다. <Link href={briefingPath}>15초 페이지</Link>에서 질문을 확인하세요.</span></p>
          : <fieldset className="wire-fieldset"><legend>질문 체크리스트</legend>
            <div className="wire-choice-group" data-layout="stack">
              {customQuestions.map((question, index) => <WireChoice key={index} label={question} type="checkbox" />)}
            </div>
          </fieldset>}
      </WireCard>

      {/* 1-1. 이번 상담에서 확인할 것 — 일정 없이 쓴 회차(워크인)의 폴백 자유 글(D62 §6 —
          세션 목표의 이원 구조). CCC-76 으로 레일에서 본문 폼 맨 위(오늘 상담 내용 위)로
          옮겼다 — 읽기(레일)와 쓰기(본문)를 가른다. 라벨은 목표 낱말을 쓰지 않는다 —
          '세부 목표 작성'이라 부르면 본문 세부 목표 구획과 층이 섞인다(ADR-0032 §6
          "폴백 칸 라벨은 현행 문구 유지"). 카드 제목과 필드 라벨이 같은 문구인 것은
          담당 실무자 의견 카드와 같은 짜임이다. */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="session-goal-note-title"
        title={<><h2 id="session-goal-note-title">이번 상담에서 확인할 것 <small>(선택)</small></h2><p className="panel-meta">일정에 연결된 목표가 없을 때 이번 상담에서 다룰 내용을 적어 둡니다. 연결된 목표는 좌측 레일에서 확인합니다.</p></>}
      >
        <WireFormField label="이번 상담에서 확인할 것" note="(선택)" htmlFor="session-goal-note">
          <input id="session-goal-note" name="sessionGoalNote" type="text" maxLength={200} />
        </WireFormField>
      </WireCard>

      {/* 2. 오늘 상담 내용 — 이 기록지의 유일한 실질 필수(P1) */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="record-form-title"
        title={<><h2 id="record-form-title">오늘 상담 내용 <small>(필수)</small></h2><p className="panel-meta">수기 메모는 서버 저장 확인 후 즉시 공식 기록입니다. AI가 항목을 선택하거나 기록을 확정하지 않습니다.</p></>}
      >
        {/* 수기 메모(상담 내용 전문)는 임시본(localStorage)에서 뺀다(P0-9 · CCC-111) —
            브라우저에 남는 사본은 서버의 권한·감사·파기 통제를 우회한 상담 내용이 된다.
            data-draft="skip" 이 form-draft 수집 단계(보관 규율 4)에서 이 칸을 거른다.
            아래 위기·안전 확인 내용과 담당 실무자 의견도 같은 이유로 뺀다. 날짜·선택지 같은
            비민감 칸의 자동 저장 편의는 그대로다. 도움말 문구도 이 동작과 같은 말을 한다. */}
        <WireFormField
          label="수기 메모"
          required
          control="textarea"
          htmlFor="record-memo"
          hint={<>사실과 상담 내용을 직접 작성합니다. 이 칸의 내용은 브라우저에 임시 보관하지 않습니다. 저장 전에 화면을 닫으면 사라집니다.</>}
        >
          <textarea
            id="record-memo"
            name="memo"
            rows={14}
            required
            data-draft="skip"
            aria-describedby="record-memo-hint"
            onChange={(event) => setMemoFilled(event.currentTarget.value.trim().length > 0)}
          />
        </WireFormField>
        <div className="wire-form-grid">
          {/* D48: 네이티브 datetime-local 은 표기가 보는 사람의 브라우저 언어를 따라 팀원마다
              달랐다(R6). 상담 일시는 요일로 잡는 값이라 KRDS 기준 달력이 맞는 자리다 —
              입력칸은 그대로 두고 달력을 옆에 붙인다. 제출값은 예전과 같은 문자열이다. */}
          <WireFormField label="상담 일시" required htmlFor="record-held-at" hint={DATE_TEXT_HINT}>
            <DateTimePickerControl
              id="record-held-at"
              name="heldAt"
              fieldLabel="상담 일시"
              describedBy="record-held-at-hint"
              required
              value={heldAt}
              onChange={setHeldAt}
            />
          </WireFormField>
          <WireFormField label="상담 방식" control="select" htmlFor="record-channel">
            <select id="record-channel" name="channel" defaultValue="in_person">{channelOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </WireFormField>
        </div>
        {/* 완료할 일정(CCC-57, 2026-08-08 Q 승인). 접힌 '새 액션 · 다음 만남' 구획에서 여기로
            올렸다. 기본이 켬이 된 이상 안 보이는 곳에서 일정이 완료되면 안 된다. "이 기록이
            어느 약속의 기록인가"는 바로 위 상담 일시·상담 방식과 같은 성격이라 자리도 여기다. */}
        {linkedSchedule === undefined ? null : <WireFormField
          label="완료할 일정"
          control="select"
          htmlFor="schedule-completion"
          hint="선택한 일정의 현재 버전을 함께 제출합니다. 그 사이 일정이 바뀌었으면 기록을 저장하지 않고 알려 줍니다."
        >
          <select
            id="schedule-completion"
            name="scheduleCompletion"
            aria-describedby="schedule-completion-hint"
            defaultValue={scheduleChoiceValue(linkedSchedule)}
          >
            {scheduledSchedules.map((schedule) => <option key={schedule.id} value={scheduleChoiceValue(schedule)}>{dateTimeLabel(schedule.scheduledAt)} 일정 완료</option>)}
            <option value="">일정을 완료로 표시하지 않음</option>
          </select>
        </WireFormField>}
      </WireCard>

      {/* 2-1. 세부 목표 구획(D62 · CCC-68) — 입력·수정·닫기. page.tsx 가 서버 액션을 묶어
          실어 보낸 슬롯이라 여기서는 자리만 정한다. 오늘 상담 내용 바로 아래인 이유:
          본 상담 1회차에 목표를 합의해 적는 흐름이 기록 작성과 같은 자리에서 이어진다. */}
      {goalSection}

      {/* 3. 미해결 액션 원클릭 처리 */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="open-actions-title"
        title={<><h2 id="open-actions-title">미해결 액션 처리</h2><p className="panel-meta">지난 회차의 미해결 액션을 이번 상담에서 처리합니다. 처리 상태를 선택하지 않으면 다음 회차로 그대로 넘어갑니다. &apos;완료&apos;만 미해결 목록에서 내려갑니다.</p></>}
      >
        <OpenActionResolutions actions={openActionItems} onResolutionChange={handleResolution} />
      </WireCard>

      {/* 4. 6영역 변화 확인 */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="life-areas-title"
        title={<><h2 id="life-areas-title">생활 6영역 변화 확인</h2><p className="panel-meta">영역별 기본값은 &apos;변화 없음&apos;이며, 그대로 두면 직전 회차 상태를 이어 기록합니다. 달라진 영역만 상태를 선택하세요. 이 상태는 실무자가 직접 기입하며 감정 점수가 아닙니다.</p></>}
      >
        <LifeAreaFields latest={latestLifeAreaSnapshot} onStatusChange={handleLifeAreaStatus} />
      </WireCard>

      {/* 5. GAS 아코디언은 **제거됐다** (D47 §6 · ADR-0019). D43 이 보류한 것은 'GAS 와
          세부 목표 층' 둘 다이고, 브리핑은 D45 에서 이미 뺐는데 이 화면만 남아 있었다
          (UI 훑기 R1). 점수를 입력하면 데이터는 쌓이는데 어디에도 안 보이는 상태였다.
          DB·게이트웨이·기존 데이터는 그대로다 — 재활성 시 이 자리에 UI 만 되살린다. */}

      {/* 6. 회차 템플릿(D29) — 이번 범위는 자리 구조까지 */}
      {/* 접힘 칸 4개는 전부 WireCardDetails 다(2026-08-09 Q, D60 ② — 구 손 카드
          details.surface-card.record-accordion). 카드 모양·패딩·제목 줄·꺽쇠를 부품이 갖는다. */}
      <WireCardDetails id="record-template" className="wire-form-card" title="회차 템플릿 항목" badge={<small>(준비 중)</small>}>
        <p>회차별 상담 템플릿(D29)이 들어올 자리입니다. 항목 풀이 확정되면 세션 목표·맥락에 맞춰 재구성된 선택 항목이 여기에 표시되고, 실무자가 상담 전에 고칠 수 있습니다.</p>
        <p className="panel-meta">지금은 코어 항목(위의 액션·플래그)만으로 기록합니다. 템플릿이 없어도 기록과 저장은 그대로 됩니다.</p>
      </WireCardDetails>

      {/* 7. 새 액션 · 다음 만남 */}
      <WireCardDetails id="record-new-actions" className="wire-form-card" title={<MetaRow items={['새 액션', '다음 만남']} />} badge={<small>(선택)</small>}>
        <p>필요한 항목만 작성하세요. 새 기록의 액션 아이템은 미완료 상태로 등록됩니다.</p>
        <div className="wire-fieldset-list">{[0, 1, 2].map((index) => <ActionItemFields index={index} key={index} />)}</div>
        {/* '완료할 일정'은 여기 있었다. CCC-57 로 '오늘 상담 내용' 카드로 올렸다. */}
        <p className="panel-meta">다음 만남은 상담 일정 화면에서 등록합니다.</p>
        <WireFormField label="지난 상담 이후 달라진 일" note="(선택)" htmlFor="change-since-last">
          <input id="change-since-last" name="changeSinceLast" type="text" maxLength={200} />
        </WireFormField>
      </WireCardDetails>

      {/* 8. 위기·안전 — 6영역 '위기' 선택 시 자동 펼침 + 강조.
          is-crisis 클래스 이름은 그대로 둔다 — 위의 toggleAll 이 이 이름으로 '전체 접기'에서
          이 칸만 빼기 때문이다(위기 선택 중에는 숨길 수 없다). */}
      <WireCardDetails
        id="record-safety"
        className={hasCrisis ? 'wire-form-card is-crisis' : 'wire-form-card'}
        testId="safety-accordion"
        open={safetyOpen}
        onToggle={(event) => setSafetyOpen(event.currentTarget.open)}
        title="위기·안전 확인"
        badge={hasCrisis ? <WireBadge tone="risk">확인 필요</WireBadge> : <small>(선택)</small>}
      >
        {hasCrisis ? <WireBadge tone="risk" role="status">6영역에서 &apos;위기&apos;를 선택했습니다. 안전 확인 내용을 적어 두세요.</WireBadge> : null}
        <p>당사자의 안전과 관련해 확인한 사실을 그대로 적습니다. 판단이나 진단은 적지 않습니다.</p>
        <WireFormField label="위기·안전 확인 내용" note="(선택)" control="textarea" htmlFor="safety-note">
          {/* 안전 관련 메모도 임시본 제외다(P0-9 — 위 수기 메모 주석 참조). */}
          <textarea id="safety-note" name="safetyNote" rows={4} data-draft="skip" />
        </WireFormField>
      </WireCardDetails>

      {/* 9. 플래그 수기 추가. 구 '목표 종료 + 신설' fieldset 은 D47 §6 이 제거했고 되살리지
          않는다 — D62 가 세부 목표를 부활시켰지만 닫기는 순수하게 사유의 기록이라(ADR-0032 §5)
          위 세부 목표 구획이 갖고, 승계(종료+신설) 흐름은 만들지 않는다. */}
      <WireCardDetails id="record-flags" className="wire-form-card" title="리스크 플래그" badge={<small>(조건부)</small>}>
        <p>사전 정의된 유형만 실무자가 직접 표시합니다. 진단이나 AI가 선택한 자유 항목은 기록하지 않습니다.</p>
        <fieldset className="wire-fieldset"><legend>표시할 플래그 <small>(선택)</small></legend>
          <div className="wire-choice-group">
            {flagTypes.map(([value, label]) => <WireChoice key={value} label={label} type="checkbox" name="flagType" value={value} />)}
          </div>
        </fieldset>
      </WireCardDetails>

      {/* 10. 담당 실무자 의견 — 접지 않고 항상 노출 */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="opinion-title"
        title={<><h2 id="opinion-title">담당 실무자 의견 <small>(선택)</small></h2><p className="panel-meta">실무자의 종합 판단을 당사자 발언과 구분해 남깁니다.</p></>}
      >
        <WireFormField label="담당 실무자 의견" control="textarea" htmlFor="counselor-opinion">
          {/* 실무자 의견도 임시본 제외다(P0-9 — 수기 메모 주석 참조). */}
          <textarea id="counselor-opinion" name="counselorOpinion" rows={4} data-draft="skip" />
        </WireFormField>
      </WireCard>
    </div>

    {/* 구획 바로가기 목차 — **우측 셋째 열**, 광폭 전용(2026-08-09 Q 2차 "TOC 는 우측에",
        "모바일·태블릿에서는 안 보여도 돼" — 구 레일 맨 위 카드 대체). 컨테이너 질의
        ≥1150(.record-toc-rail 규칙)에서만 그려지고, 그 아래 폭에서는 CSS 가 숨긴다.
        세로로 긴 원페이지라 목차가 스크롤을 대신한다. 접힘 칸은 눌러도 접힌 채 제목
        줄로만 이동한다. */}
    <WireCard as="nav" labelledBy="record-toc-title" testId="record-toc" className="wire-toc-rail"
      title={<span id="record-toc-title">바로가기</span>}>
      <ol className="wire-toc-list">
        <li><a href="#questions-title">오늘 확인할 질문</a></li>
        <li><a href="#session-goal-note-title">이번 상담에서 확인할 것</a></li>
        <li><a href="#record-form-title">오늘 상담 내용</a></li>
        <li><a href="#record-goals-title">세부 목표</a></li>
        <li><a href="#open-actions-title">미해결 액션 처리</a></li>
        <li><a href="#life-areas-title">생활 6영역 변화 확인</a></li>
        <li><a href="#record-template">회차 템플릿 항목</a></li>
        <li><a href="#record-new-actions">새 액션·다음 만남</a></li>
        <li><a href="#record-safety">위기·안전 확인</a></li>
        <li><a href="#record-flags">리스크 플래그</a></li>
        <li><a href="#opinion-title">담당 실무자 의견</a></li>
      </ol>
    </WireCard>
  </div>;
}
