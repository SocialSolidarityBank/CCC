'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { WireBullets, WireCard, WireCardDetails } from '../../../../../components/wire/wire-card';
import { WireCardSection, WireItem } from '../../../../../components/wire/wire-section';
import { WireEmpty } from '../../../../../components/wire/wire-state';
import { WireQuote, WireSourceQuotes } from '../../../../../components/wire/wire-callout';
import { ParticipantHeroCard } from '../../../../../components/wire/participant-hero-card';
import { WireButton } from '../../../../../components/wire/wire-button';
import { MetaRow } from '../../../../../components/wire/meta-row';
import { Chevron, DisclosureChevron } from '../../../../../components/wire/chevron';
import { ConsultationTypeBadge, consultationTypeLabel } from '../../../../../components/wire/consultation-type-badge';
import { TimeAxisBadge } from '../../../../../components/wire/time-axis-badge';
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
  /** D62 §8 (CCC-69): 활성 세부 목표 — 전체 목표 카드 아래 기본 펼침 최대 3줄(서버가 끊는다). */
  activeGoals: Array<{ id: string; title: string }>;
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
  /** Preview fixture 초안 본문 없이 전용 검수 화면으로 잇는 회차 ID 목록. */
  pendingReviewSessionIds: string[];
  /** D45 영역 ① AI 제안 (CCC-39) — 제목·이유·근거 회차 링크. 재료는 승인본만(R2). */
  aiSuggestions: ParticipantBriefingSection['aiSuggestions'];
  openActionItems: ParticipantBriefingSection['openActionItems'];
  flags: RiskBannerFlag[];
  upcomingSchedule: BriefingUpcomingSchedule | null;
}

// 날짜·시각 표기는 공용 계약 하나다(2026-08-07 Q 통일 — 구 dateStyle medium ·
// YYYY-MM-DD 지역 함수 대체): formatKoreanDate("2026년 8월 7일") ·
// formatKoreanDateTime("2026년 8월 7일 오후 1:00"), lib/format-korean-date.ts.

// 구 EmptyNote(.briefing-note)는 2026-08-09 전수 정리로 공용 WireEmpty 가 대신한다 —
// 빈 상태 규칙이 화면마다 둘로 갈려 있었다(§2-2 · wire-state.tsx).

/** 전체 목표 카드 (D45 · CCC-41) — HERO·리스크 배너 아래 카드형 한 줄. 방향 문장만 —
    점수·게이지는 붙이지 않는다(D43). 비면 "설정 전"이고, 담당 실무자는 그 자리에서 바로
    입력·수정한다(빈 칸 저장 = 설정 전으로 되돌림). 접힘 대상이 아니라 아코디언 밖이다.
    D62 §8 (CCC-69): 활성 세부 목표를 같은 카드 아래에 기본 펼침 압축 한 줄씩 단다 —
    눌러야 보이는 접힘은 금지(15초 훑기에서 한 번 더 눌러야 보이는 정보는 없는 정보다).
    별도 카드로 세우지 않는 것은 한 화면 유지(완료 기준) 때문이고, 위계상으로도 전체 목표의
    하위라 한 카드가 맞다. 없으면 구획 자체를 그리지 않는다 — 입력 자리는 상담 기록 작성이다. */
function OverallGoalCard({
  beneficiaryId,
  supportCaseId,
  overallGoal,
  activeGoals,
  canEdit,
  hasError,
  action,
}: {
  beneficiaryId: string;
  supportCaseId: string;
  overallGoal: string | null;
  activeGoals: Array<{ id: string; title: string }>;
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
        {/* 목표 라벨은 민트(진행 축)로 눈에 들게 통일한다(2026-08-29 Q, 구 --sub). */}
        <p className="goal-tree-label" id="briefing-goal-label">전체 목표</p>
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
                <WireButton type="submit" variant="secondary">저장</WireButton>
                <WireButton variant="neutral" onClick={() => setEditing(false)}>취소</WireButton>
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
                <WireButton variant="secondary" onClick={() => setEditing(true)}>
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
      {/* 활성 세부 목표 (D62 §8) — 줄이 셋 이상 쌓이므로 가로선으로 가른다(§2-2 규칙 2ⓐ).
          말줄임 규칙(이 티켓에서 확정): 한 줄 압축은 회차 행과 같은 .wire-fade-clip —
          줄바꿈 대신 오른쪽 끝 마스크 페이드, 767px 이하에서는 줄바꿈으로 전환. */}
      {activeGoals.length > 0 && (
        <>
          <hr className="wire-card-divider" />
          <WireCardSection title="세부 목표" tone="mint">
            {/* 불릿·14 는 CSS(.briefing-subgoal-row)와 .wire-bullets 가 갖는다(2026-08-30 Q
                — 불릿은 2개 이상일 때만, 목표 트리와 같은 규칙). */}
            <ul className={activeGoals.length > 1 ? 'briefing-subgoal-rows wire-bullets' : 'briefing-subgoal-rows'}>
              {activeGoals.map((goal) => (
                <li key={goal.id} className="briefing-subgoal-row wire-fade-clip">{goal.title}</li>
              ))}
            </ul>
          </WireCardSection>
        </>
      )}
    </WireCard>
  );
}

/**
 * 전체 목표 미설정 안내 (D62 §7 · CCC-69). AI 제안을 차단하지 않고 안내만 한다 —
 * "설정을 해야만 정확한 AI 조언"의 '해야만'은 차단이 아니라 이 안내로 확정됐다(2026-08-09 Q).
 * 자리는 'AI 제안' 라벨 행의 오른쪽이다(2026-08-30 Q "같은 행의 오른쪽에 안내 문구로" —
 * 구 본문 위 전폭 행 대체. 본문처럼 읽히던 문제를 안내 자리로 푼다).
 * 닫으면 케이스 단위로 브라우저에 남아 다시 뜨지 않는다(매번 뜨지 않게 — ADR-0032 §7).
 * 서버에 저장하지 않는 이유: 케이스 데이터가 아니라 화면 안내이고, 실무자마다 따로 닫는 것이
 * 자연스럽다. 저장 실패(시크릿 모드 등)의 대가는 다음 방문에 다시 뜨는 것뿐이다.
 */
const GOAL_HINT_STORE_PREFIX = 'ccc:briefing-goal-hint-closed:v1:';

function AiGoalHint({ supportCaseId }: { supportCaseId: string }) {
  // 첫 렌더부터 보인다(2026-08-30 — 구 "마운트 뒤 표시" 반전). 정적 렌더(하니스·align
  // 게이트)가 이 행을 재야 하고, 안 닫은 다수에게 마운트 후 내용이 밀리던 것도 없앤다.
  // 닫았던 사람만 마운트 직후 사라진다 — localStorage 는 마운트 뒤에만 읽을 수 있어
  // 서버·클라이언트 첫 렌더를 같게 두는 방식은 그대로다(하이드레이션 정합).
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(`${GOAL_HINT_STORE_PREFIX}${supportCaseId}`) !== null) setDismissed(true);
    } catch {
      // 저장소를 못 읽으면 안내를 그대로 둔다 — 안내라 막을 일이 아니다.
    }
  }, [supportCaseId]);
  if (dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(`${GOAL_HINT_STORE_PREFIX}${supportCaseId}`, new Date().toISOString());
    } catch {
      // 닫힘을 남기지 못하면 다음 방문에 다시 뜬다 — 안내라 막을 일이 아니다.
    }
  };
  return (
    <span className="briefing-ai-goal-hint" role="note" data-testid="briefing-ai-goal-hint">
      <span>전체 목표를 설정하면 AI 제안이 더 정확해집니다.</span>
      <WireButton variant="neutral" onClick={dismiss}>닫기</WireButton>
    </span>
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
    <WireCardSection title={discrepancyKindLabels[item.kind]} tone="discrepancy">
      <div className="briefing-discrepancy-sides" id={`discrepancy-${item.id}`}>
        {[item.left, item.right].map((side, index) => (
          <div key={`${item.id}-${index}`} className="briefing-discrepancy-side">
            {/* 라벨 레시피는 격자 밖에서도 같다(.wire-field-label margin 0 계약). */}
            <p className="wire-field-label">{formatKoreanDate(side.heldAt)} 회차</p>
            {/* 인용은 공용 인용 어휘다(D61 ⑤ WireQuote — 구 맨 span 따옴표 대체.
                2026-08-28 Q "다른 컴포넌트 구성과 같이 맞출 것"). */}
            <WireQuote>{side.quote}</WireQuote>
            <WireButton
              variant="neutral"
              href={`${recordsHref}#record-${side.sessionId}`}
            >
              회차 확인하기
            </WireButton>
          </div>
        ))}
      </div>
      {item.resolution !== null && (
        <p className="panel-meta">
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
    </WireCardSection>
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
  activeGoals,
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
  pendingReviewSessionIds,
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

  /**
   * HERO 상태 태그 = **최신 회차의 유형 + 회차 수**(2026-08-09 Q — 구 화면 이름 '15초 페이지').
   * 화면 이름은 사이드바와 제목이 이미 말한다. 이 자리에서 알고 싶은 것은 "지금 몇 회차이고
   * 무슨 상담인가"다. sessionRows 는 최신순이라 [0] 이 최신이고 길이가 곧 회차 수다 —
   * 브리핑 응답을 늘리지 않는다. 기록이 없으면 화면 이름으로 돌아간다.
   */
  const latestSession = sessionRows[0];
  const latestSessionTag = latestSession === undefined
    ? '15초 페이지'
    : `${consultationTypeLabel(latestSession.kind)} ${sessionRows.length}회`;

  // 처리된 항목은 접힌 이력으로 내려간다(ADR-0018) — 목록에서 사라지지도, 지워지지도 않는다.
  const unresolvedDiscrepancies = discrepancies.filter((item) => item.resolution === null);
  const resolvedDiscrepancies = discrepancies.filter((item) => item.resolution !== null);

  const sessionGoals = upcomingSchedule?.sessionGoals ?? [];
  const customQuestions = upcomingSchedule?.customQuestions ?? [];
  const pendingReviewRows = pendingReviewSessionIds.map((sessionId) => {
    const row = sessionRows.find((candidate) => candidate.sessionId === sessionId);
    return {
      sessionId,
      heldAtLabel: row === undefined ? '상담일 확인 필요' : formatKoreanDate(row.heldAt),
      kindLabel: row === undefined ? '상담 유형 확인 필요' : consultationTypeLabel(row.kind),
    };
  });

  return (
    <div className="briefing-page">
      {/* HERO — 공통 부품 ParticipantHeroCard(D38). 기록·허브와 같은 부품이라 여백·태그
          모양이 화면마다 갈리지 않는다(2026-08-05 컴포넌트화 — 구 손 마크업 대체).
          2026-08-09 Q: 상태 태그가 **화면 이름 대신 최신 회차의 유형·회차**를 보인다 — 화면
          이름은 이미 사이드바와 제목이 말하고 있고, 이 자리에서 알고 싶은 것은 "지금 몇 회차이고
          무슨 상담인가"다. 회차 수는 영역 ② 재료(sessionRows)가 그대로 갖고 있어 새 응답
          필드가 필요 없다. 기록이 하나도 없으면 화면 이름으로 돌아간다.
          상담 방식은 v1 이 대면뿐이다(D4).
          상태 태그는 부품의 wire-status-tag 계약 — 트랙 C(PR #61)의 .is-stage 폐지와
          같은 결론이라 리베이스에서 컴포넌트 쪽으로 합쳤다. */}
      <ParticipantHeroCard
        name={participant.name}
        beneficiaryId={beneficiaryId}
        stageTag={latestSessionTag}
        meta={<MetaRow items={[
          programLabel,
          upcomingSchedule === null ? '예정된 상담 없음' : formatKoreanDateTime(upcomingSchedule.scheduledAt),
          '대면',
        ]} />}
        actions={<>
          {/* '전체 상담 기록'은 2026-08-06 Q 로 페이지 맨 아래(구 '자세한 상담 기록 보기')에서
              여기로 올라왔다 — D38 의 행동 2개 상한은 이 화면에 한해 3개로 넓힌다.
              HERO 행동 줄은 전부 40 이다(2026-08-26 Q "상담 기록만 크다" — 구 보조 32 폐지). */}
          <WireButton href={participantHref} variant="secondary">당사자 정보</WireButton>
          <WireButton className="briefing-more" href={recordsHref} variant="secondary">상담 기록 확인하기</WireButton>
          <WireButton href={recordNewHref} variant="primary">상담 기록하기</WireButton>
        </>}
      />

      <RiskBanner flags={flags} recordsHref={recordsHref} />

      {/* 전체 목표 카드는 리스크 배너 아래·아코디언 위다(D45 표 3행). */}
      <OverallGoalCard
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        overallGoal={overallGoal}
        activeGoals={activeGoals}
        canEdit={canEditOverallGoal}
        hasError={overallGoalError}
        action={overallGoalAction}
      />

      {/* 여닫기 줄은 리스크 배너 **아래**다 — 배너는 HERO 바로 아래 자리를 내줄 수 없고(D9),
          이 줄이 다루는 대상(아코디언 전부)의 바로 위이기도 하다.
          왼쪽은 섹션 제목이다(2026-08-07 Q — 구 카드 바로가기 알약 4개 삭제: 카드 제목과
          같은 문구가 두 번 서 소음이었다). 카드 여러 장을 묶는 섹션 제목이라 카드 밖 예외
          자리이고(§7-6), 상담 기록의 '회차별 기록'과 같은 스타일(18/600)을 쓴다. */}
      {/* 섹션 제목과 그 아래 항목은 한 묶음이다(2026-08-28 Q — .record-section 공용 계약).
          제목-내용 간격 16 은 래퍼가 갖고, 섹션 사이는 페이지 스택(--section-gap 32)이 그대로 가른다. */}
      <section className="record-section">
      <div className="briefing-toolbar">
        <h2 className="record-section-title">상담 전 꼭 봐야할 내용</h2>
        {/* 보기 조작이라 일반(neutral) 그레이 버튼이다(2026-08-07 Q — 구 세컨더리). */}
        <WireButton onClick={toggleAll} variant="neutral">
          {allOpen ? '전체 접기' : '전체 열기'}
        </WireButton>
      </div>

      <div className="briefing-accordions" ref={accordionsRef}>

        {/* 영역 ① 오늘 만나기 전 꼭 기억할 것 (D45) — 구 '지난 상담 브리핑'·'오늘 확인할 질문'
            카드를 대체한다. **실무자 입력(세션 목표·맞춤형 질문)이 위, AI 가 아래** — 실무자가
            직접 정한 것이 AI 제안에 밀리지 않는다(R5 의 태도). AI 제안(CCC-39)은 제목·이유·
            근거 회차 링크 3층이고 재료는 승인본만이다(R2 — 게이트웨이가 강제). */}
        <Card id="briefing-remember" title="오늘 만나기 전 꼭 기억할 것">
          <div className="briefing-memo-item wire-repeat-card">
            <WireCardSection
              title="세션 목표"
              tone="mint"
              action={upcomingSchedule === null
                ? undefined
                : (
                    <WireButton
                      variant="neutral"
                      href={`/schedules/${encodeURIComponent(upcomingSchedule.id)}/plan`}
                    >
                      세션 목표 수정
                    </WireButton>
                  )}
            >
              {sessionGoals.length === 0
                ? <WireEmpty>연결된 다가오는 일정의 세션 목표가 없습니다.</WireEmpty>
                : (
                  <WireBullets
                    items={sessionGoals.map((goal) => (
                      goal.caseGoalTitle === null ? goal.body : <MetaRow items={[
                        goal.body,
                        <span
                          key="parent"
                          className={goal.caseGoalStatus === 'closed' ? 'briefing-parent-goal is-closed' : 'briefing-parent-goal'}
                        >
                          {goal.caseGoalStatus === 'closed' ? '세부 목표(종료)' : '세부 목표'}: {goal.caseGoalTitle}
                        </span>,
                      ]} />
                    ))}
                  />
                )}
            </WireCardSection>
          </div>
          <div className="briefing-memo-item wire-repeat-card">
            <WireCardSection title="맞춤형 질문" tone="mint">
              {customQuestions.length === 0
                ? <WireEmpty>실무자가 적은 맞춤형 질문이 없습니다.</WireEmpty>
                : <WireBullets items={customQuestions} />}
            </WireCardSection>
          </div>
          <div className="briefing-memo-item wire-repeat-card">
            {/* 전체 목표 미설정 안내(D62 §7)는 라벨 행 오른쪽 action 슬롯이다(2026-08-30 Q).
                제안을 차단하지 않는다. 닫으면 케이스 단위로 남고, 닫힌 뒤에는 라벨만 남는다. */}
            <WireCardSection
              title="AI 제안"
              tone="lavender"
              action={overallGoal === null ? <AiGoalHint supportCaseId={supportCaseId} /> : undefined}
            >
              {aiSuggestions.length === 0
                ? <WireEmpty>승인된 상담 기록이 쌓이면 확인할 것을 제안합니다.</WireEmpty>
                : (
                  <ul className="briefing-suggestions">
                    {/* D45: slice(0,3) mirrors server cap (CCC-39); 재료는 승인본만 (R2) */}
                    {aiSuggestions.slice(0, 3).map((suggestion) => (
                      <li key={`${suggestion.sessionId}-${suggestion.title}`}>
                        {/* 2026-08-10: WireItem으로 교체 (이유 16/400 --sub, 링크 제목과 동일 16/600 --ink → 위계 사라짐 방지) */}
                        <WireItem
                          tone="lavender"
                          title={suggestion.title}
                          {...(suggestion.reason !== null ? { description: suggestion.reason } : {})}
                          action={
                            <WireButton
                              variant="neutral"
                              href={`${recordsHref}#record-${suggestion.sessionId}`}
                            >
                              근거 회차 보기{suggestion.heldAt === null ? '' : ` (${formatKoreanDate(suggestion.heldAt)})`}
                            </WireButton>
                          }
                        />
                        <WireSourceQuotes
                          quotes={suggestion.sourceQuotes}
                          sourceHref={`${recordsHref}#record-${suggestion.sessionId}`}
                        />
                      </li>
                    ))}
                  </ul>
                )}
            </WireCardSection>
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
          {/* 이 문은 이제 프리뷰 fixture 만이 아니라 실제 생성 초안도 담는다(D69 · ADR-0036
              · CCC-100 — 검토 화면이 "AI 초안 검토"로 넓어진 뒤 문구도 그 성격을 따라간다.
              구획 카드(.briefing-memo-item)는 2026-08-30 Q "div 컴포넌트화" — 영역 ① 과
              같은 반복 행 카드다. */}
          {pendingReviewRows.length > 0 && (
            <div className="briefing-memo-item wire-repeat-card">
            <WireCardSection
              title="검토할 AI 초안"
              tone="lavender"
              testId="pending-fixture-reviews"
            >
              <ul className="briefing-suggestions">
                {pendingReviewRows.map((row) => (
                  <li key={row.sessionId}>
                  <WireItem
                    tone="lavender"
                    title={row.heldAtLabel}
                    description={row.kindLabel}
                    action={(
                      <Link
                        href={`${recordsHref}/${encodeURIComponent(row.sessionId)}/review`}
                        aria-label={`${row.heldAtLabel} ${row.kindLabel} AI 초안 검토`}
                      >
                        AI 초안 검토
                      </Link>
                    )}
                  />
                  </li>
                ))}
              </ul>
            </WireCardSection>
            </div>
          )}
          {/* 회차 행(2026-08-06 Q — 구 불릿 + 메타 줄 대체): 날짜 → 유형 배지 →
              수기 뱃지 → 핵심 한 줄. 각 항목은 **고정 폭 칸**에 앉아 어느 행에서나 같은
              x 에서 시작한다(2026-08-07 Q 9차 — 수기 칸은 배지가 없어도 자리를 지켜
              본문 시작점이 안 흔들린다). 한 줄이 넘치는 본문은 줄바꿈 대신 오른쪽 끝에서
              자연스럽게 사라진다(마스크 페이드). */}
          {sessionRows.length === 0
            ? <WireEmpty>표시할 상담 회차가 없습니다.</WireEmpty>
            : (
              <ul className="briefing-session-rows">
                {sessionRows.map((row) => (
                  <li key={row.sessionId}>
                    {/* 행 전체가 원문 회차로 가는 링크다(2026-08-30 Q "원본 연결" · D73 ① —
                        도착지는 전체 상담 기록의 회차 앵커(#record-{id}, RecordHashOpener 가
                        접힌 회차를 펼친다). 꺽쇠는 이동 어휘의 오른쪽 꺽쇠(§8). */}
                    <Link className="briefing-session-row" href={`${recordsHref}#record-${row.sessionId}`}>
                      <span className="briefing-session-date">{formatKoreanDate(row.heldAt)}</span>
                      <span className="briefing-session-kind">
                        <ConsultationTypeBadge kind={row.kind} />
                      </span>
                      <span className="briefing-session-memo">
                        {row.aiOneLiner === null && row.memoExcerpt !== null && (
                          <WireBadge>수기</WireBadge>
                        )}
                      </span>
                      <span className="briefing-session-text wire-fade-clip">
                        {/* 일괄 검토 A9 (2026-08-08): 인테이크는 메모 칸이 없어 '수기 메모 없음'이
                            항상 나오는 빈말이었다 — 질문지 회차임을 알리는 문구로 낮춘다. */}
                        {row.aiOneLiner ?? row.memoExcerpt
                          ?? (row.kind === 'intake' ? '인테이크 질문지 작성 회차' : '수기 메모 없음')}
                      </span>
                      <Chevron dir="right" />
                    </Link>
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
            ? <WireBadge tone="coral">{unresolvedDiscrepancies.length}건</WireBadge>
            : null}
        >
          {unresolvedDiscrepancies.length === 0
            ? <WireEmpty>검출된 불일치가 없습니다. 기록이 저장·승인될 때마다 자동으로 대조합니다.</WireEmpty>
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
              <summary>처리된 항목 {resolvedDiscrepancies.length}건 <DisclosureChevron variant="plain" /></summary>
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
          {/* id 는 상담 기록 작성 레일의 '자세히 보기' 앵커가 여기로 온다(CCC-76 —
              구 briefing-actions 개명, 다른 참조 0건 확인). 기본 펼침 카드라 앵커 진입
              시 내용이 바로 보인다. */}
          <Card id="open-actions" title="미해결 액션">
            {/* 액션 행(2026-08-06 Q): 내용은 왼쪽, 오른쪽 끝은 뱃지 둘 — 담당(민트 =
                사람·담당 축)과 기한(블루 = 일정 축, D58 ④). '담당 실무자/당사자/기관'은
                이 액션을 해 오기로 한 주체다(action_items.owner). */}
            {openActionItems.length === 0
              ? <WireEmpty>미해결 항목이 없습니다.</WireEmpty>
              : (
                <ul className="briefing-action-rows">
                  {openActionItems.map((item) => (
                    <li key={item.id} className="briefing-action-row">
                      <span className="briefing-action-desc">{item.description}</span>
                      <WireBadge tone="mint">담당 {actionOwnerLabels[item.owner]}</WireBadge>
                      {item.dueDate !== null && (
                    <TimeAxisBadge>기한 {item.dueDate}</TimeAxisBadge>
                      )}
                      {item.sessionId !== null && (
                        <WireButton
                          className="briefing-action-source"
                          variant="neutral"
                          href={`${recordsHref}#record-${item.sessionId}`}
                        >
                          출처 회차 보기
                        </WireButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </div>
      </div>
      </section>

      {/* 맨 아래 '자세한 상담 기록 보기'는 2026-08-06 Q 로 폐지 — '전체 상담 기록' 버튼이
          HERO 행동 줄(당사자 정보 옆)로 올라갔다. */}
    </div>
  );
}
