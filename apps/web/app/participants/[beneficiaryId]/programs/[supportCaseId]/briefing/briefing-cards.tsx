'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { WireBullets, WireCard, WireCardDetails, WireField } from '../../../../../components/wire/wire-card';
import { ParticipantHeroCard } from '../../../../../components/wire/participant-hero-card';
import { WireButton } from '../../../../../components/wire/wire-button';
import { MetaRow } from '../../../../../components/wire/meta-row';
import { WireBadge } from '../../../../../components/wire/wire-badge';
import { RiskBanner, type RiskBannerFlag } from './risk-banner';
import { formatKoreanDate, formatKoreanDateTime } from '../../../../../lib/format-korean-date';
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

// D45 영역 ③ — 사실 관계 라벨만. "충돌"·"오류" 같은 판단 어휘를 쓰지 않는다(R5).
const discrepancyKindLabels: Record<'cross_session' | 'within_session', string> = {
  cross_session: '회차 간 불일치',
  within_session: '회차 내 모순',
};

// D45 처리 3종 (CCC-42). 순서는 ADR-0018 의 나열 순서를 따른다.
const discrepancyResolutionOptions = ['situation_changed', 'record_error', 'confirmed'] as const;
const discrepancyResolutionLabels: Record<(typeof discrepancyResolutionOptions)[number], string> = {
  situation_changed: '상황 변경',
  record_error: '기록 오류',
  confirmed: '확인 완료',
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
  /** D45 영역 ③ 내용 불일치 — 저장된 검출 결과(CCC-43). 미처리·처리됨이 함께 온다. */
  discrepancies: ParticipantBriefingSection['discrepancies'];
  /** 처리 3종 서버 액션 (CCC-42). 없으면 처리 버튼을 그리지 않는다(jsdom 테스트 기본값). */
  discrepancyAction?: (formData: FormData) => Promise<void>;
  /** 직전 처리 실패 여부(리다이렉트 notice) — 카드 안에 한 줄로 알린다. */
  discrepancyError?: boolean;
  /** 승인 대기 배지 — D45 가 영역 ② 머리로 옮겼다(구 '지난 상담 브리핑' 카드 자리). */
  pendingApprovalCount: number;
  /** D45 영역 ① AI 제안 (CCC-39) — 제목·이유·근거 회차 링크. 재료는 승인본만(R2). */
  aiSuggestions: ParticipantBriefingSection['aiSuggestions'];
  openActionItems: ParticipantBriefingSection['openActionItems'];
  flags: RiskBannerFlag[];
  upcomingSchedule: BriefingUpcomingSchedule | null;
}

// 날짜·시각 표기는 공용 계약 하나다(2026-08-07 Q 통일 — 구 dateStyle medium ·
// YYYY-MM-DD 지역 함수 대체): formatKoreanDate("2026년 8월 7일") ·
// formatKoreanDateTime("2026년 8월 7일 오후 1:00"), lib/format-korean-date.ts.

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
    // 카드다(2026-08-05 Q 카드화 · ADR-0030 — 구 D59 플랫 대체). 읽기 구획도 아웃라인
    // 카드로 통일한다. 수정 가능성은 안쪽 상자가 알린다.
    <WireCard as="section" className="briefing-goal" labelledBy="briefing-goal-label">
      <div className="briefing-goal-row">
        <p className="briefing-qlabel" id="briefing-goal-label">전체 목표</p>
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
              {/* 저장·취소 둘 다 버튼이고 컬러로 가른다(2026-08-06 Q): 저장 = 세컨더리
                  (그라데이션 아웃라인), 취소 = 일반(그레이 아웃라인). 사이 간격은 8. */}
              <span className="briefing-goal-buttons">
                <WireButton type="submit" variant="secondary" height="sm">저장</WireButton>
                <WireButton variant="neutral" height="sm" onClick={() => setEditing(false)}>취소</WireButton>
              </span>
            </form>
          )
          : (
            <>
              {/* 수정할 수 있는 목표는 **입력칸과 같은 상자**로 그린다(2026-08-03 Q — 맨글자는
                  수정 불가로 읽힌다). 상자를 눌러도 바로 편집이 시작된다. */}
              {editable
                ? (
                  <button
                    type="button"
                    className={isSet ? 'briefing-goal-display' : 'briefing-goal-display is-empty'}
                    onClick={() => setEditing(true)}
                  >
                    {isSet ? overallGoal : '설정 전 입력하세요'}
                  </button>
                )
                : (
                  <p className={isSet ? 'briefing-goal-text' : 'briefing-goal-text is-empty'}>
                    {isSet ? overallGoal : '설정 전'}
                  </p>
                )}
              {editable && (
                <WireButton variant="secondary" height="sm" onClick={() => setEditing(true)}>
                  {isSet ? '수정' : '입력'}
                </WireButton>
              )}
            </>
          )}
      </div>
      {hasError && (
        <p className="briefing-goal-error" role="alert">
          전체 목표를 저장하지 못했습니다. 담당 실무자만 수정할 수 있습니다. 잠시 후 다시 시도하세요.
        </p>
      )}
    </WireCard>
  );
}

/**
 * 불일치 한 건 (D45 영역 ③ · CCC-42). 양쪽 원문 인용 + 회차 링크를 나란히 놓고, 그 아래
 * 처리 3종 버튼을 둔다. 처리된 항목도 같은 부품으로 그린다 — 처리 종류는 다시 바꿀 수
 * 있으므로(Q 결정) 이력에서도 버튼이 살아 있고, 지금 처리 상태만 한 줄로 덧붙는다.
 */
function DiscrepancyItem({
  item,
  beneficiaryId,
  supportCaseId,
  recordsHref,
  action,
}: {
  item: ParticipantBriefingSection['discrepancies'][number];
  beneficiaryId: string;
  supportCaseId: string;
  recordsHref: string;
  action: ((formData: FormData) => Promise<void>) | undefined;
}) {
  return (
    <div className="briefing-qsection">
      <p className="briefing-qlabel">{discrepancyKindLabels[item.kind]}</p>
      <div className="briefing-fields">
        {[item.left, item.right].map((side, index) => (
          <WireField key={`${item.id}-${index}`} label={`${formatKoreanDate(side.heldAt)} 회차`}>
            <span>“{side.quote}”</span>
            {' '}
            <Link href={`${recordsHref}#record-${side.sessionId}`}>기록 보기</Link>
          </WireField>
        ))}
      </div>
      {item.resolution !== null && (
        <p className="briefing-note">
          <MetaRow items={[
            `${discrepancyResolutionLabels[item.resolution.status]}으로 처리됨`,
            formatKoreanDate(item.resolution.resolvedAt),
          ]} />
        </p>
      )}
      {action !== undefined && (
        <form className="briefing-resolution-form" action={action}>
          <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
          <input type="hidden" name="supportCaseId" value={supportCaseId} />
          <input type="hidden" name="discrepancyId" value={item.id} />
          {discrepancyResolutionOptions.map((status) => (
            <WireButton
              key={status}
              type="submit"
              name="status"
              value={status}
              variant="secondary"
              disabled={item.resolution?.status === status}
            >
              {discrepancyResolutionLabels[status]}
            </WireButton>
          ))}
        </form>
      )}
    </div>
  );
}

// 구획 카드 = 접힘 카드(WireCardDetails, 2026-08-05 카드화 — 구 플랫 아코디언).
// '전체 열기/닫기'는 네이티브 details 라 그대로 일괄 적용된다. 기본은 열림.
// badge 는 제목 오른쪽(화살표 앞), id 는 툴바 바로가기(2026-08-03 Q)의 앵커다.
function Card({ id, title, badge, children }: { id?: string; title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <WireCardDetails className="briefing-card" open id={id} title={title} badge={badge}>
      {children}
    </WireCardDetails>
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
  discrepancies,
  discrepancyAction,
  discrepancyError = false,
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

  // 처리된 항목은 접힌 이력으로 내려간다(ADR-0018) — 목록에서 사라지지도, 지워지지도 않는다.
  const unresolvedDiscrepancies = discrepancies.filter((item) => item.resolution === null);
  const resolvedDiscrepancies = discrepancies.filter((item) => item.resolution !== null);

  const sessionGoals = upcomingSchedule?.sessionGoals ?? [];
  const customQuestions = upcomingSchedule?.customQuestions ?? [];

  return (
    <div className="briefing-page">
      {/* HERO — 공통 부품 ParticipantHeroCard(D38). 기록·허브와 같은 부품이라 여백·태그
          모양이 화면마다 갈리지 않는다(2026-08-05 컴포넌트화 — 구 손 마크업 대체).
          '상담 준비'는 데이터가 아니라 **화면 상태 태그**다 — sourceSupportCase.status 는
          active/closed 뿐이라 이 문구의 출처가 아니다(D22).
          회차는 브리핑 응답에 없어 메타에 넣지 않는다. 상담 방식은 v1 이 대면뿐이다(D4).
          상태 태그는 부품의 wire-status-tag 계약 — 트랙 C(PR #61)의 .is-stage 폐지와
          같은 결론이라 리베이스에서 컴포넌트 쪽으로 합쳤다. */}
      <ParticipantHeroCard
        name={participant.name}
        beneficiaryId={beneficiaryId}
        stageTag="상담 준비"
        meta={<MetaRow items={[
          programLabel,
          upcomingSchedule === null ? '예정된 상담 없음' : formatKoreanDateTime(upcomingSchedule.scheduledAt),
          '대면',
        ]} />}
        actions={<>
          {/* '전체 상담 기록'은 2026-08-06 Q 로 페이지 맨 아래(구 '자세한 상담 기록 보기')에서
              여기로 올라왔다 — D38 의 행동 2개 상한은 이 화면에 한해 3개로 넓힌다. */}
          <WireButton href={participantHref} variant="secondary">당사자 정보</WireButton>
          <WireButton className="briefing-more" href={recordsHref} variant="secondary">전체 상담 기록</WireButton>
          <WireButton href={recordNewHref} variant="primary">상담 시작</WireButton>
        </>}
      />

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
          이 줄이 다루는 대상(아코디언 전부)의 바로 위이기도 하다.
          왼쪽은 섹션 제목이다(2026-08-07 Q — 구 카드 바로가기 알약 4개 삭제: 카드 제목과
          같은 문구가 두 번 서 소음이었다). 카드 여러 장을 묶는 섹션 제목이라 카드 밖 예외
          자리이고(§7-6), 상담 기록의 '회차별 기록'과 같은 스타일(18/600)을 쓴다. */}
      <div className="briefing-toolbar">
        <h2 className="record-section-title">상담 전 꼭 봐야할 내용</h2>
        {/* 보기 조작이라 일반(neutral) 그레이 버튼이다(2026-08-07 Q — 구 세컨더리). */}
        <WireButton onClick={toggleAll} variant="neutral" height="sm">
          {allOpen ? '전체 접기' : '전체 열기'}
        </WireButton>
      </div>

      <div className="briefing-accordions" ref={accordionsRef}>

        {/* 영역 ① 오늘 만나기 전 꼭 기억할 것 (D45) — 구 '지난 상담 브리핑'·'오늘 확인할 질문'
            카드를 대체한다. **실무자 입력(세션 목표·맞춤형 질문)이 위, AI 가 아래** — 실무자가
            직접 정한 것이 AI 제안에 밀리지 않는다(R5 의 태도). AI 제안(CCC-39)은 제목·이유·
            근거 회차 링크 3층이고 재료는 승인본만이다(R2 — 게이트웨이가 강제). */}
        <Card id="briefing-remember" title="오늘 만나기 전 꼭 기억할 것">
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
            <p className="briefing-qlabel" data-tone="ai">AI 제안</p>
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
                        근거 회차 보기{suggestion.heldAt === null ? '' : ` (${formatKoreanDate(suggestion.heldAt)})`}
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
          id="briefing-sessions"
          title="상담 내용 회차별 정리"
          badge={pendingApprovalCount > 0 ? <WireBadge tone="lavender">승인 대기 {pendingApprovalCount}건</WireBadge> : null}
        >
          {/* 회차 행(2026-08-06 Q — 구 불릿 + 메타 줄 대체): 날짜 → 유형 뱃지(블루) →
              수기 뱃지 → 핵심 한 줄. 각 항목은 **고정 폭 칸**에 앉아 어느 행에서나 같은
              x 에서 시작한다(2026-08-07 Q 9차 — 수기 칸은 배지가 없어도 자리를 지켜
              본문 시작점이 안 흔들린다). 한 줄이 넘치는 본문은 줄바꿈 대신 오른쪽 끝에서
              자연스럽게 사라진다(마스크 페이드). */}
          {sessionRows.length === 0
            ? <EmptyNote>표시할 상담 회차가 없습니다.</EmptyNote>
            : (
              <ul className="briefing-session-rows">
                {sessionRows.map((row) => (
                  <li key={row.sessionId} className="briefing-session-row">
                    <span className="briefing-session-date">{formatKoreanDate(row.heldAt)}</span>
                    <span className="briefing-session-kind">
                      <WireBadge tone="blue">{sessionKindLabels[row.kind]}</WireBadge>
                    </span>
                    <span className="briefing-session-memo">
                      {row.aiOneLiner === null && row.memoExcerpt !== null && (
                        <WireBadge>수기</WireBadge>
                      )}
                    </span>
                    <span className="briefing-session-text wire-fade-clip">
                      {row.aiOneLiner ?? row.memoExcerpt ?? '수기 메모 없음'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </Card>

        {/* 영역 ③ 내용 불일치 (D45 · CCC-43 · CCC-42) — 기록 공식화 시점에 검출·저장된 결과.
            AI 는 어느 쪽이 맞는지 판단하지 않으므로(R5) 양쪽 원문 인용과 회차 링크만 나란히
            놓고, 판단은 실무자의 처리 3종이 한다. 처리는 **표시일 뿐 원본 기록은 불변**이며
            처리된 항목은 삭제되지 않고 접힌 이력으로 내려간다(ADR-0018). 배지는 **미처리만**
            센다 — 이력이 쌓일수록 숫자가 불어나면 '남은 일'을 알려주지 못한다. */}
        <Card
          id="briefing-discrepancies"
          title="내용 불일치"
          badge={unresolvedDiscrepancies.length > 0
            ? <WireBadge tone="lavender">{unresolvedDiscrepancies.length}건</WireBadge>
            : null}
        >
          {unresolvedDiscrepancies.length === 0
            ? <EmptyNote>검출된 불일치가 없습니다. 기록이 저장·승인될 때마다 자동으로 대조합니다.</EmptyNote>
            : unresolvedDiscrepancies.map((item) => (
              <DiscrepancyItem
                key={item.id}
                item={item}
                beneficiaryId={beneficiaryId}
                supportCaseId={supportCaseId}
                recordsHref={recordsHref}
                action={discrepancyAction}
              />
            ))}
          {discrepancyError && (
            <p className="briefing-goal-error" role="alert">
              처리하지 못했습니다. 담당 실무자와 기관 관리자만 처리할 수 있습니다. 잠시 후 다시 시도하세요.
            </p>
          )}
          {resolvedDiscrepancies.length > 0 && (
            <details className="briefing-history">
              <summary>처리된 항목 {resolvedDiscrepancies.length}건</summary>
              {resolvedDiscrepancies.map((item) => (
                <DiscrepancyItem
                  key={item.id}
                  item={item}
                  beneficiaryId={beneficiaryId}
                  supportCaseId={supportCaseId}
                  recordsHref={recordsHref}
                  action={discrepancyAction}
                />
              ))}
            </details>
          )}
        </Card>

        {/* 미해결 액션 (D45 표 7행). 개인정보 카드는 여기서 뺐다(2026-08-03 Q) — 개인 정보는
            당사자 정보 화면의 HERO(이름 클릭)에서 본다. 표준 그리드는 유지(D37). */}
        <div className="briefing-cards-grid">
          <Card id="briefing-actions" title="미해결 액션">
            {/* 액션 행(2026-08-06 Q): 내용은 왼쪽, 오른쪽 끝은 뱃지 둘 — 담당(민트 =
                사람·담당 축)과 기한(블루 = 일정 축, D58 ④). '담당 실무자/당사자/기관'은
                이 액션을 해 오기로 한 주체다(action_items.owner). */}
            {openActionItems.length === 0
              ? <EmptyNote>미해결 항목이 없습니다.</EmptyNote>
              : (
                <ul className="briefing-action-rows">
                  {openActionItems.map((item) => (
                    <li key={item.id} className="briefing-action-row">
                      <span className="briefing-action-desc">{item.description}</span>
                      <span className="wire-badge" data-tone="mint">담당 {actionOwnerLabels[item.owner]}</span>
                      {item.dueDate !== null && (
                        <span className="wire-badge" data-tone="blue">기한 {item.dueDate}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </div>
      </div>

      {/* 맨 아래 '자세한 상담 기록 보기'는 2026-08-06 Q 로 폐지 — '전체 상담 기록' 버튼이
          HERO 행동 줄(당사자 정보 옆)로 올라갔다. */}
    </div>
  );
}
