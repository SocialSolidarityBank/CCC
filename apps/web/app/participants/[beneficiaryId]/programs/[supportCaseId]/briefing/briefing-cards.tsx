'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { WireBullets, WireField } from '../../../../../components/wire/wire-card';
import { ParticipantName } from '../../../../../components/wire/participant-name';
import { WireButton } from '../../../../../components/wire/wire-button';
import { MetaRow } from '../../../../../components/wire/meta-row';
import { RiskBanner, type RiskBannerFlag } from './risk-banner';
import type { BriefingUpcomingSchedule, ParticipantBriefingSection } from '../../../../../lib/api';

// D45(ADR-0018) 브리핑 3영역 재구성. 서버 page.tsx 는 브리핑을 fetch 만 하고(감사·접근은
// 게이트웨이가 이미 수행 — R1·D14), 이 클라이언트 컴포넌트가 순수 데이터를 받아 표현·폴백·
// 전체 열기/닫기를 담당한다. lib/api 런타임은 로드하지 않고(`import type`만) jsdom 컴포넌트
// 테스트에서 그대로 렌더된다. 아코디언은 네이티브 <details> + ref 일괄 토글(기존 패턴).
// GAS 게이지·세부 목표 표시는 D43 보류로 화면에서 뺐다 — 스키마·데이터는 유지된다.

type ActionOwner = ParticipantBriefingSection['openActionItems'][number]['owner'];

const actionOwnerLabels: Record<ActionOwner, string> = {
  counselor: '실무자',
  beneficiary: '당사자',
  org: '기관',
};

// 상담 유형은 현행 2종으로 시작한다(D45) — 세분 유형(초기상담·사정·개입 등)은 §8 미결과 함께.
const sessionKindLabels: Record<'regular' | 'intake', string> = {
  regular: '기본 상담',
  intake: '인테이크',
};

export interface BriefingCardsProps {
  beneficiaryId: string;
  /** 전체 목표 저장 폼의 hidden 값 — 게이트웨이 권한 판정에 그대로 넘어간다. */
  supportCaseId: string;
  /** D45 전체 목표 — 케이스당 1개·수정 가능·점수 없음(D33). null = 설정 전. */
  overallGoal: string | null;
  /** 담당 실무자만 true(게이트웨이 판정). admin 은 열람만이라 편집 UI 를 그리지 않는다. */
  canEditOverallGoal: boolean;
  /** 직전 저장 실패 여부(리다이렉트 notice) — 카드 안에 한 줄로 알린다. */
  overallGoalError?: boolean;
  /** 서버 액션. jsdom 테스트는 넘기지 않아도 렌더된다 — 없으면 편집 UI 를 그리지 않는다. */
  overallGoalAction?: (formData: FormData) => Promise<void>;
  participantHref: string;
  recordsHref: string;
  /** HERO 우상단 프라이머리 `상담 시작`의 목적지 — 이 앱에서 상담을 시작한다는 것은 기록을 연다는 뜻이다. */
  recordNewHref: string;
  /** HERO 메타 줄의 사업명. 워크스페이스가 정하므로 화면이 이름을 만들지 않는다. */
  programLabel: string;
  participant: { name: string | null; phone: string | null };
  /** D45 영역 ② 회차별 정리 — 최신순. 승인된 AI 핵심 한 줄, 없으면 수기 발췌 + '수기' 배지(D5). */
  sessionRows: ParticipantBriefingSection['sessionRows'];
  /** 승인 대기 배지 — D45 가 영역 ② 머리로 옮겼다(구 '지난 상담 브리핑' 카드 자리). */
  pendingApprovalCount: number;
  /** D45 영역 ① AI 제안 (CCC-39) — 제목·이유·근거 회차 링크. 재료는 승인본만(R2). */
  aiSuggestions: ParticipantBriefingSection['aiSuggestions'];
  openActionItems: ParticipantBriefingSection['openActionItems'];
  flags: RiskBannerFlag[];
  upcomingSchedule: BriefingUpcomingSchedule | null;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// 회차 줄의 날짜는 시각 없이 YYYY-MM-DD만 — held_at은 ISO 문자열(gateway now() 표준)이라
// 앞 10자를 그대로 뽑으면 시간대 변환 없이 안정적으로 날짜만 남는다.
function formatDateOnly(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? value;
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="briefing-note" role="status">{children}</p>;
}

/** 전체 목표 카드 (D45 · CCC-41) — HERO·리스크 배너 아래 카드형 한 줄. 방향 문장만 —
    점수·게이지는 붙이지 않는다(D43). 비면 "설정 전"이고, 담당 실무자는 그 자리에서 바로
    입력·수정한다(빈 칸 저장 = 설정 전으로 되돌림). 접힘 대상이 아니라 아코디언 밖이다. */
function OverallGoalCard({
  beneficiaryId,
  supportCaseId,
  overallGoal,
  canEdit,
  hasError,
  action,
}: {
  beneficiaryId: string;
  supportCaseId: string;
  overallGoal: string | null;
  canEdit: boolean;
  hasError: boolean;
  action: ((formData: FormData) => Promise<void>) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const isSet = overallGoal !== null && overallGoal.length > 0;
  const editable = canEdit && action !== undefined;

  return (
    <section className="surface-card briefing-goal" aria-label="전체 목표">
      <div className="briefing-goal-row">
        <p className="briefing-qlabel">전체 목표</p>
        {editing && action !== undefined
          ? (
            <form className="briefing-goal-form" action={action}>
              <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
              <input type="hidden" name="supportCaseId" value={supportCaseId} />
              {/* 게이트웨이 상한과 같은 200자 — 길이 실패를 화면에서 먼저 막는다. */}
              <input
                className="briefing-goal-input"
                type="text"
                name="overallGoal"
                defaultValue={overallGoal ?? ''}
                maxLength={200}
                placeholder="이 당사자와 무엇을 향해 가는지 한 문장으로 적습니다"
                aria-label="전체 목표"
                autoFocus
              />
              <WireButton type="submit" variant="secondary" height="sm">저장</WireButton>
              <WireButton variant="ghost" height="sm" onClick={() => setEditing(false)}>취소</WireButton>
            </form>
          )
          : (
            <>
              <p className={isSet ? 'briefing-goal-text' : 'briefing-goal-text is-empty'}>
                {isSet ? overallGoal : '설정 전'}
              </p>
              {editable && (
                <WireButton variant="ghost" height="sm" onClick={() => setEditing(true)}>
                  {isSet ? '수정' : '입력'}
                </WireButton>
              )}
            </>
          )}
      </div>
      {hasError && (
        <p className="briefing-goal-error" role="alert">
          전체 목표를 저장하지 못했습니다. 담당 실무자만 수정할 수 있습니다 — 잠시 후 다시 시도하세요.
        </p>
      )}
    </section>
  );
}

// 카드 = 접힘 가능한 <details>. 요약(제목)만 남기고 본문을 접을 수 있어 '전체 열기/닫기'가
// 카드 접힘 상태에도 일괄 적용된다. 기본은 열림. badge 는 제목 오른쪽(화살표 앞)에 앉는다.
function Card({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <details className="briefing-card" open>
      <summary className="briefing-card-summary">
        <span>{title}</span>
        <span className="briefing-card-summary-right">
          {badge}
          <span aria-hidden="true" className="briefing-card-arrow" />
        </span>
      </summary>
      <div className="briefing-card-body">{children}</div>
    </details>
  );
}

export function BriefingCards({
  beneficiaryId,
  supportCaseId,
  overallGoal,
  canEditOverallGoal,
  overallGoalError = false,
  overallGoalAction,
  participantHref,
  recordsHref,
  recordNewHref,
  programLabel,
  participant,
  sessionRows,
  pendingApprovalCount,
  aiSuggestions,
  openActionItems,
  flags,
  upcomingSchedule,
}: BriefingCardsProps) {
  // 여닫기 범위는 **아코디언을 담은 영역 전체**다 — 3영역과 그리드 카드 전부.
  const accordionsRef = useRef<HTMLDivElement>(null);
  // 버튼 하나로 여닫는다(시안). 두 개(열기/닫기)면 지금 상태를 버튼이 안 알려준다.
  const [allOpen, setAllOpen] = useState(true);

  const toggleAll = () => {
    const next = !allOpen;
    setAllOpen(next);
    const scope = accordionsRef.current;
    if (scope === null) return;
    for (const details of scope.querySelectorAll('details')) {
      details.open = next;
    }
  };

  const sessionGoals = upcomingSchedule?.sessionGoals ?? [];
  const customQuestions = upcomingSchedule?.customQuestions ?? [];
  const hasPii = participant.name !== null || participant.phone !== null;

  return (
    <div className="briefing-page">
      {/* HERO 카드 (D37 §4-5 · D38 공통 부품 계약). **화면의 모든 글자는 카드 안에 있다** —
          HERO 도 카드다. 좌측 이름 묶음(이름 + 상태 태그 + 메타 한 줄), 우측 행동 **최대 2개**
          (세컨더리 → 프라이머리). 축은 사이드바 = 장소 / 우상단 = 행동(D35).
          '상담 준비'는 데이터가 아니라 **화면 상태 태그**다 — sourceSupportCase.status 는
          active/closed 뿐이라 이 문구의 출처가 아니다(D22). */}
      <header className="page-header surface-card briefing-hero">
        <div className="briefing-hero-identity">
          <h1 className="briefing-hero-title">
            <ParticipantName name={participant.name} beneficiaryId={beneficiaryId} size="hero" />
            <span className="briefing-badge is-stage">상담 준비</span>
          </h1>
          {/* 회차는 브리핑 응답에 없어 넣지 않는다 — 없는 숫자를 화면에서 만들지 않는다.
              상담 방식은 v1 이 대면뿐이다(D4). */}
          <p className="briefing-hero-meta">
            <MetaRow items={[
              programLabel,
              upcomingSchedule === null ? '예정된 상담 없음' : formatDateTime(upcomingSchedule.scheduledAt),
              '대면',
            ]} />
          </p>
        </div>
        <div className="page-actions">
          <WireButton href={participantHref} variant="secondary">당사자 정보</WireButton>
          <WireButton href={recordNewHref} variant="primary">상담 시작</WireButton>
        </div>
      </header>

      <RiskBanner flags={flags} />

      {/* 전체 목표 카드는 리스크 배너 아래·아코디언 위다(D45 표 3행). */}
      <OverallGoalCard
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        overallGoal={overallGoal}
        canEdit={canEditOverallGoal}
        hasError={overallGoalError}
        action={overallGoalAction}
      />

      {/* 여닫기 줄은 리스크 배너 **아래**다 — 배너는 HERO 바로 아래 자리를 내줄 수 없고(D9),
          이 줄이 다루는 대상(아코디언 전부)의 바로 위이기도 하다. */}
      <div className="briefing-toolbar">
        <WireButton onClick={toggleAll} variant="ghost" height="sm">
          {allOpen ? '전체 접기' : '전체 열기'}
        </WireButton>
      </div>

      <div className="briefing-accordions" ref={accordionsRef}>

        {/* 영역 ① 오늘 만나기 전 꼭 기억할 것 (D45) — 구 '지난 상담 브리핑'·'오늘 확인할 질문'
            카드를 대체한다. **실무자 입력(세션 목표·맞춤형 질문)이 위, AI 가 아래** — 실무자가
            직접 정한 것이 AI 제안에 밀리지 않는다(R5 의 태도). AI 제안(CCC-39)은 제목·이유·
            근거 회차 링크 3층이고 재료는 승인본만이다(R2 — 게이트웨이가 강제). */}
        <Card title="오늘 만나기 전 꼭 기억할 것">
          <div className="briefing-qsection">
            <p className="briefing-qlabel">세션 목표</p>
            {sessionGoals.length === 0
              ? <EmptyNote>연결된 다가오는 일정의 세션 목표가 없습니다.</EmptyNote>
              : <WireBullets items={sessionGoals.map((goal) => (
                  goal.caseGoalTitle === null ? goal.body : <MetaRow items={[goal.body, `케이스 목표: ${goal.caseGoalTitle}`]} />
                ))} />}
          </div>
          <div className="briefing-qsection">
            <p className="briefing-qlabel">맞춤형 질문</p>
            {customQuestions.length === 0
              ? <EmptyNote>실무자가 적은 맞춤형 질문이 없습니다.</EmptyNote>
              : <WireBullets items={customQuestions} />}
          </div>
          <div className="briefing-qsection">
            <p className="briefing-qlabel">AI 제안</p>
            {aiSuggestions.length === 0
              ? <EmptyNote>승인된 상담 기록이 쌓이면 확인할 것을 제안합니다.</EmptyNote>
              : (
                <ul className="briefing-suggestions">
                  {/* 최대 3개는 서버 계약(D45)이지만 화면도 같은 상한을 지킨다 — 훑는 화면이다. */}
                  {aiSuggestions.slice(0, 3).map((suggestion) => (
                    <li key={`${suggestion.sessionId}-${suggestion.title}`} className="briefing-suggestion">
                      <p className="briefing-suggestion-title">{suggestion.title}</p>
                      {suggestion.reason !== null && (
                        <p className="briefing-suggestion-reason">{suggestion.reason}</p>
                      )}
                      {/* 근거 회차 링크 — 상담 기록 페이지의 해당 회차 앵커(#record-{id})로 간다. */}
                      <Link
                        className="briefing-suggestion-link"
                        href={`${recordsHref}#record-${suggestion.sessionId}`}
                      >
                        근거 회차 보기{suggestion.heldAt === null ? '' : ` (${formatDateOnly(suggestion.heldAt)})`}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </Card>

        {/* 영역 ② 상담 내용 회차별 정리 (D45) — 회차마다 상담일 · 유형 · 핵심 한 줄. 한 줄은
            승인된 AI 산출물만 싣고(R2 — 게이트웨이가 approved 뷰에서만 읽는다), 승인 전이거나
            녹음이 없으면 수기 발췌 + '수기' 배지로 폴백한다(D5 · CCC-38). '승인 대기' 배지는
            구 '지난 상담 브리핑' 카드에서 이 머리로 옮겨 왔다. */}
        <Card
          title="상담 내용 회차별 정리"
          badge={pendingApprovalCount > 0 ? <span className="briefing-badge is-pending">승인 대기 {pendingApprovalCount}건</span> : null}
        >
          {sessionRows.length === 0
            ? <EmptyNote>표시할 상담 회차가 없습니다.</EmptyNote>
            : <WireBullets items={sessionRows.map((row) => (
                <MetaRow items={[
                  formatDateOnly(row.heldAt),
                  sessionKindLabels[row.kind],
                  row.aiOneLiner !== null
                    ? row.aiOneLiner
                    : <>
                        {row.memoExcerpt ?? '수기 메모 없음'}
                        {row.memoExcerpt !== null && <span className="briefing-badge">수기</span>}
                      </>,
                ]} />
              ))} />}
        </Card>

        {/* 영역 ③ 내용 불일치 (D45) — 검출·저장은 CCC-43, 처리 3종은 CCC-42. 골격 단계에서는
            자리와 빈 상태만 둔다. AI 는 판단하지 않고 양쪽 인용만 보여줄 영역이다(R5). */}
        <Card title="내용 불일치">
          <EmptyNote>준비 중입니다 — 기록 사이에 서로 어긋나는 내용이 검출되면 여기에 나란히 표시됩니다.</EmptyNote>
        </Card>

        {/* 유지 카드 2종 (D45 표 7행) — 미해결 액션·개인정보. 표준 그리드(최소 420 → 2열, D37). */}
        <div className="briefing-cards-grid">
          <Card title="미해결 액션">
            {openActionItems.length === 0
              ? <EmptyNote>미해결 항목이 없습니다.</EmptyNote>
              : <WireBullets items={openActionItems.map((item) => (
                  <MetaRow items={[item.description, item.dueDate === null ? null : `기한 ${item.dueDate}`, `담당 ${actionOwnerLabels[item.owner]}`]} />
                ))} />}
          </Card>

          {/* 개인정보 — 실명·연락처 직표시(복호화 클릭 없음, D24). 권한 없으면 값이 null. */}
          <Card title="개인정보">
            {hasPii
              ? (
                <div className="briefing-fields">
                  <WireField label="이름">{participant.name ?? '미등록'}</WireField>
                  <WireField label="연락처">{participant.phone ?? '미등록'}</WireField>
                </div>
              )
              : <EmptyNote>권한 없음. 담당 실무자·기관 관리자만 실명·연락처를 볼 수 있습니다.</EmptyNote>}
          </Card>
        </div>
      </div>

      {/* 브리핑 이어보기 — 별개 화면이 아니라 이 브리핑의 아래쪽 끝이다(D37 · 시안 §19). */}
      <Link className="briefing-more surface-card" href={recordsHref}>
        <span>
          <span className="briefing-more-title">자세한 상담 기록 보기</span>
          <span className="briefing-more-desc">위 브리핑을 펼친 전체 기록과 지난 회차 이력</span>
        </span>
        <span aria-hidden="true" className="briefing-card-arrow" />
      </Link>
    </div>
  );
}
