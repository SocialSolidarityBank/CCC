'use client';

import Link from 'next/link';
import { Icon } from '../../../../../../components/wire/wire-icon';
import { useRef, useState, type ReactNode } from 'react';
import { DraftRestorePrompt, DraftRetentionNote, DraftStatus } from '../../../../../../components/draft/draft-notice';
import { MetaRow } from '../../../../../../components/wire/meta-row';
import { WireCard } from '../../../../../../components/wire/wire-card';
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
  ['housing_livelihood_shock', '주거·생계 급변'],
  ['debt_deterioration', '부채 악화'],
  ['repeated_noncompliance', '약속 불이행 반복'],
] as const;

const channelOptions = [
  ['in_person', '대면'],
  ['phone', '전화'],
  ['video', '화상'],
] as const;

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export interface RecordOnepageProps {
  // goals(세부 목표)는 더 이상 받지 않는다 — GAS 입력·목표 종료+신설이 D47 §6 으로 빠지면서
  // 이 화면에서 쓸 곳이 없어졌다. 조회 API 는 그대로 내려보내므로 재활성 시 되돌리면 된다.
  schedules: CounselingSchedule[];
  openActionItems: OpenActionResolutionItem[];
  latestLifeAreaSnapshot: LifeAreaSnapshotEntry[];
  sessionGoals: RecordSessionGoal[];
  customQuestions: string[];
  lastRecordSummary: RecordLastSummary | null;
  briefingPath: string;
  /**
   * 고정 헤더 오른쪽에 붙는 버튼(2026-07-31 Q). 나가기·저장이 여기 산다.
   *
   * 이 화면의 버튼 둘은 원래 서로 멀리 떨어져 있었다 — 나가기는 페이지 제목 옆, 저장은
   * 폼 맨 아래. 저장은 스크롤을 끝까지 내려야 보였고 나가기는 어느 것과도 묶이지 않아
   * 혼자 떠 있었다. 둘 다 **언제나 보이는 한 자리**(이 고정 헤더)로 모은다.
   *
   * 슬롯으로 받는 이유는 저장이 `type="submit"` 이라 폼 소유자(page.tsx)가 쥐어야 하기
   * 때문이다. 이 부품은 폼 안에서 렌더되므로 여기 놓인 제출 버튼도 그대로 동작한다.
   *
   * **선택 항목이 아니다** — 폼 아래에 있던 저장 버튼을 없앴으므로, 빠뜨리면 저장할 길이
   * 하나도 없는 기록지가 조용히 나간다.
   */
  actions: ReactNode;
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
  // 전체 열기/닫기 — 브리핑과 같은 규칙이다(버튼 하나, ref 일괄 토글). 기본은 접힘(CCC-5).
  const accordionsRef = useRef<HTMLDivElement>(null);
  const [allOpen, setAllOpen] = useState(false);

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

  const toggleAll = () => {
    const next = !allOpen;
    setAllOpen(next);
    const scope = accordionsRef.current;
    if (scope === null) return;
    for (const details of scope.querySelectorAll('details')) {
      // 위기·안전 칸의 자동 펼침은 일괄 접기보다 우선한다 — 위기 선택 중에는 숨길 수 없다.
      if (!next && details.classList.contains('is-crisis')) continue;
      details.open = next;
    }
  };

  return <div className="record-layout" ref={draft.containerRef}>
    <div className="record-main" ref={accordionsRef}>
      {draft.restorable === null
        ? null
        : <DraftRestorePrompt
          savedAt={draft.restorable.savedAt}
          uncertain={draft.restorable.uncertain}
          onResume={draft.resume}
          onDiscard={draft.discard}
        />}

      {/* 고정 헤더 — 스크롤해도 이번 상담 목표(D28)와 전체 목표 N 이 항상 보인다. */}
      <header className="surface-card record-sticky" data-testid="record-sticky-header">
        <div className="record-sticky-row">
          <div>
            <p className="record-sticky-label">이번 상담 목표</p>
            {sessionGoals.length === 0
              ? <p className="record-sticky-value">미연결 <small>아래에서 이번 상담 목표를 적을 수 있습니다.</small></p>
              : <ul className="record-sticky-list">{sessionGoals.map((goal, index) => <li key={index}>
                <MetaRow items={[goal.body, goal.caseGoalTitle === null ? null : `전체 목표: ${goal.caseGoalTitle}`]} />
              </li>)}</ul>}
          </div>
          {/* 여기 있던 `전체 목표 N` 카운트는 제거했다(D47 §6). 세던 것은 goals 테이블의
              **세부 목표**라 D43 보류 대상이었고, 이름도 전체 목표(케이스당 1개, D33)와
              달라 숫자가 늘 2 이상으로 보였다. 전체 목표는 브리핑이 한 줄로 보여준다.
              그 자리를 나가기·저장 버튼이 이어받는다(2026-07-31 Q). */}
          <div className="record-sticky-actions">{actions}</div>
        </div>
        {sessionGoals.length === 0
          ? <WireFormField label="이번 상담 목표" note="(선택, 일정에 연결된 목표가 없을 때)" htmlFor="session-goal-note">
            <input id="session-goal-note" name="sessionGoalNote" type="text" maxLength={200} placeholder="이번 상담에서 확인할 것" />
          </WireFormField>
          : null}
        {lastRecordSummary === null
          ? null
          : <p className="record-sticky-meta">
            <MetaRow items={[`지난 상담(${dateTimeLabel(lastRecordSummary.heldAt)})`, `미해결 액션 ${openActionItems.length}건`]} />
            {' '}<Link href={briefingPath}>{lastRecordSummary.text} 브리핑에서 보기</Link>
          </p>}
      </header>

      {/* 여닫기 줄 — 브리핑과 같은 자리 규칙(조작 대상 바로 위, 오른쪽 정렬). */}
      <div className="record-toolbar">
        <WireButton onClick={toggleAll} variant="ghost" height="sm">
          {allOpen ? '전체 접기' : '전체 열기'}
        </WireButton>
      </div>

      {/* 1. 오늘 확인할 질문 — 체크리스트(기록 대상 아님, 진행 표시용) */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="questions-title"
        title={<><h2 id="questions-title">오늘 확인할 질문</h2><p className="panel-meta">일정에 등록한 맞춤형 질문입니다. 체크는 진행 표시용이며 저장하지 않습니다. AI가 만든 질문은 상담 준비 화면에서 확인하세요.</p></>}
      >
        {customQuestions.length === 0
          ? <p className="empty"><span>등록된 맞춤형 질문이 없습니다. <Link href={briefingPath}>상담 준비 화면</Link>에서 질문을 확인하세요.</span></p>
          : <fieldset className="wire-fieldset"><legend>질문 체크리스트</legend>
            <div className="wire-choice-group" data-layout="stack">
              {customQuestions.map((question, index) => <WireChoice key={index} label={question} type="checkbox" />)}
            </div>
          </fieldset>}
      </WireCard>

      {/* 2. 오늘 상담 내용 — 이 기록지의 유일한 실질 필수(P1) */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="record-form-title"
        title={<><h2 id="record-form-title">오늘 상담 내용 <small>(필수)</small></h2><p className="panel-meta">수기 메모는 서버 저장 확인 후 즉시 공식 기록입니다. AI가 항목을 선택하거나 기록을 확정하지 않습니다.</p></>}
      >
        <WireFormField
          label="수기 메모"
          required
          control="textarea"
          htmlFor="record-memo"
          hint={<>사실과 상담 내용을 직접 작성합니다. <DraftRetentionNote /></>}
        >
          <textarea
            id="record-memo"
            name="memo"
            rows={14}
            required
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
      </WireCard>

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
      <details className="surface-card record-accordion">
        <summary className="record-accordion-summary">회차 템플릿 항목 <small>(준비 중)</small></summary>
        <div className="record-accordion-body">
          <p>회차별 상담 템플릿(D29)이 들어올 자리입니다. 항목 풀이 확정되면 세션 목표·맥락에 맞춰 재구성된 선택 항목이 여기에 표시되고, 실무자가 상담 전에 고칠 수 있습니다.</p>
          <p className="panel-meta">지금은 코어 항목(위의 액션·플래그)만으로 기록합니다. 템플릿이 없어도 기록과 저장은 그대로 됩니다.</p>
        </div>
      </details>

      {/* 7. 새 액션 · 다음 만남 */}
      <details className="surface-card record-accordion">
        <summary className="record-accordion-summary"><MetaRow items={['새 액션', '다음 만남']} /> <small>(선택)</small></summary>
        <div className="record-accordion-body">
          <p>필요한 항목만 작성하세요. 새 기록의 액션 아이템은 미완료 상태로 등록됩니다.</p>
          <div className="wire-fieldset-list">{[0, 1, 2].map((index) => <ActionItemFields index={index} key={index} />)}</div>
          <WireFormField label="완료할 일정" note="(선택)" control="select" htmlFor="schedule-completion">
            <select id="schedule-completion" name="scheduleCompletion" defaultValue=""><option value="">일정을 완료로 표시하지 않음</option>{schedules.filter((schedule) => schedule.status === 'scheduled').map((schedule) => <option key={schedule.id} value={JSON.stringify({ id: schedule.id, version: schedule.version })}>{dateTimeLabel(schedule.scheduledAt)} 일정 완료</option>)}</select>
          </WireFormField>
          <p className="panel-meta">다음 만남은 상담 일정 화면에서 등록합니다. 선택한 일정의 현재 버전을 함께 제출하며, 버전이 달라지면 완료 처리하지 않습니다.</p>
          <WireFormField label="지난 상담 이후 달라진 일" note="(선택)" htmlFor="change-since-last">
            <input id="change-since-last" name="changeSinceLast" type="text" maxLength={200} />
          </WireFormField>
        </div>
      </details>

      {/* 8. 위기·안전 — 6영역 '위기' 선택 시 자동 펼침 + 강조 */}
      <details
        className={hasCrisis ? 'record-accordion is-crisis' : 'record-accordion'}
        data-testid="safety-accordion"
        open={safetyOpen}
        onToggle={(event) => setSafetyOpen(event.currentTarget.open)}
      >
        <summary className="record-accordion-summary">위기·안전 확인 {hasCrisis ? <span className="wire-badge" data-tone="risk">확인 필요</span> : <small>(선택)</small>}</summary>
        <div className="record-accordion-body">
          {hasCrisis ? <p className="wire-badge" data-tone="risk" role="status">6영역에서 &apos;위기&apos;를 선택했습니다. 안전 확인 내용을 적어 두세요.</p> : null}
          <p>당사자의 안전과 관련해 확인한 사실을 그대로 적습니다. 판단이나 진단은 적지 않습니다.</p>
          <WireFormField label="위기·안전 확인 내용" note="(선택)" control="textarea" htmlFor="safety-note">
            <textarea id="safety-note" name="safetyNote" rows={4} />
          </WireFormField>
        </div>
      </details>

      {/* 9. 플래그 수기 추가. '목표 종료 + 신설' fieldset 은 **제거됐다** (D47 §6 · ADR-0019)
          — 그것도 GAS 와 같은 세부 목표 층이라 D43 보류 대상이다. 이로써 앱 안에 세부 목표를
          만들거나 닫을 경로가 없어지는 것은 알고 받아들인 결과이고, 전체 목표 편집은 브리핑에
          남아 있다(D45). goals·closed_reason·replaced_by_goal_id 스키마는 그대로 둔다. */}
      <details className="surface-card record-accordion">
        <summary className="record-accordion-summary">리스크 플래그 <small>(조건부)</small></summary>
        <div className="record-accordion-body">
          <p>사전 정의된 유형만 실무자가 직접 표시합니다. 진단이나 AI가 선택한 자유 항목은 기록하지 않습니다.</p>
          <fieldset className="wire-fieldset"><legend>표시할 플래그 <small>(선택)</small></legend>
            <div className="wire-choice-group">
              {flagTypes.map(([value, label]) => <WireChoice key={value} label={label} type="checkbox" name="flagType" value={value} />)}
            </div>
          </fieldset>
        </div>
      </details>

      {/* 10. 담당 실무자 의견 — 접지 않고 항상 노출 */}
      <WireCard
        as="section"
        className="wire-form-card"
        labelledBy="opinion-title"
        title={<><h2 id="opinion-title">담당 실무자 의견 <small>(선택)</small></h2><p className="panel-meta">실무자의 종합 판단을 당사자 발언과 구분해 남깁니다.</p></>}
      >
        <WireFormField label="담당 실무자 의견" control="textarea" htmlFor="counselor-opinion">
          <textarea id="counselor-opinion" name="counselorOpinion" rows={4} />
        </WireFormField>
      </WireCard>
    </div>

    <aside className="surface-card record-rail" aria-label="작성 진척도">
      <p className="record-rail-count" data-testid="record-required-count">필수 {filledCount}/{requiredItems.length}</p>
      {/* 별도 임시 저장 버튼이 없다 — 자동 저장이 곧 임시 저장이므로 상태를 상시 보여준다. */}
      <DraftStatus savedAt={draft.savedAt} available={draft.available} />
      <ul className="record-rail-list">
        {requiredItems.map((item) => <li key={item.label} data-done={item.done}>
          <span aria-hidden="true">{item.done ? <Icon name="dot" size={14} /> : <Icon name="dot-empty" size={14} />}</span> {item.label}
          <span className="record-rail-state">{item.done ? ' 채움' : ' 남음'}</span>
        </li>)}
      </ul>
      <p className="panel-meta">수기 메모 하나만 채워도 저장됩니다. 나머지는 권장 항목입니다.</p>
    </aside>
  </div>;
}
