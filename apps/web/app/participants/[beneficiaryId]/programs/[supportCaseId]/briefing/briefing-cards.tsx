'use client';

import Link from 'next/link';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { WireBullets, WireField } from '../../../../../components/wire/wire-card';
import { ParticipantName } from '../../../../../components/wire/participant-name';
import { WireButton } from '../../../../../components/wire/wire-button';
import { MetaRow } from '../../../../../components/wire/meta-row';
import { RiskBanner, type RiskBannerFlag } from './risk-banner';
import type { BriefingUpcomingSchedule, ParticipantBriefingSection } from '../../../../../lib/api';

// 재개편 T4(#34) 상담 준비 6카드 개편. 서버 page.tsx 는 브리핑을 fetch 만 하고(감사·접근은
// 게이트웨이가 이미 수행 — R1·D14), 이 클라이언트 컴포넌트가 순수 데이터를 받아 표현·폴백·
// 전체 열기/닫기를 담당한다. lib/api 런타임은 로드하지 않고(`import type`만) jsdom 컴포넌트
// 테스트에서 그대로 렌더된다. 아코디언은 네이티브 <details> + ref 일괄 토글(기존 패턴).

type ActionOwner = ParticipantBriefingSection['openActionItems'][number]['owner'];

const actionOwnerLabels: Record<ActionOwner, string> = {
  counselor: '상담사',
  beneficiary: '참여자',
  org: '기관',
};

export interface BriefingCardsProps {
  beneficiaryId: string;
  participantHref: string;
  recordsHref: string;
  /** HERO 우상단 프라이머리 `상담 시작`의 목적지 — 이 앱에서 상담을 시작한다는 것은 기록을 연다는 뜻이다. */
  recordNewHref: string;
  /** HERO 메타 줄의 사업명. 워크스페이스가 정하므로 화면이 이름을 만들지 않는다. */
  programLabel: string;
  participant: { name: string | null; phone: string | null };
  gasTrend: ParticipantBriefingSection['gasTrend'];
  lastSessionSummary: ParticipantBriefingSection['lastSessionSummary'];
  questions: string[];
  openActionItems: ParticipantBriefingSection['openActionItems'];
  flags: RiskBannerFlag[];
  upcomingSchedule: BriefingUpcomingSchedule | null;
}

function formatScore(score: number): string {
  return score > 0 ? `+${score}` : `${score}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

// #17 잔여: 목표 종료 칩에 붙는 날짜는 시각 없이 YYYY-MM-DD만 — closedAt은 ISO 문자열(gateway
// now() 표준)이라 앞 10자를 그대로 뽑으면 시간대 변환 없이 안정적으로 날짜만 남는다.
function formatDateOnly(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? value;
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="briefing-note" role="status">{children}</p>;
}

// 카드 = 접힘 가능한 <details>. 요약(제목)만 남기고 본문을 접을 수 있어 '전체 열기/닫기'가
// 카드 접힘 상태에도 일괄 적용된다. 기본은 열림.
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="briefing-card" open>
      <summary className="briefing-card-summary">
        <span>{title}</span>
        <span aria-hidden="true" className="briefing-card-arrow" />
      </summary>
      <div className="briefing-card-body">{children}</div>
    </details>
  );
}

// GAS 척도는 −2~+2 다섯 단계다. 게이지 채움 비율은 그 구간을 0~100% 로 편 값이다
// (−2 → 0% · 0 → 50% · +2 → 100%). 점수의 좋고 나쁨을 색으로 알리지 않으므로(D6·R4)
// 채움 색은 점수가 아니라 **목표 순서**가 정한다 — 계열 3색 회전은 구분 장치다(DESIGN.md §1-5).
function gaugePercent(score: number): number {
  return ((score + 2) / 4) * 100;
}

const GAUGE_SERIES = ['blue', 'mint', 'lavender'] as const;

/**
 * GAS 게이지 한 칸(DESIGN.md §5): **96px 원형** · 트랙은 계열 tint · 채움은 같은 계열 base ·
 * 중앙 점수 24/700. 게이지 아래 미니 추이는 직전 점수 흐름이다(CLAUDE.md 6장).
 * 이전 구현은 납작한 사각 박스에 숫자만 있어 이 계약을 지키지 않았다.
 */
function GasGauge({ goal, index }: { goal: ParticipantBriefingSection['gasTrend'][number]; index: number }) {
  const latest = goal.points.length === 0 ? null : goal.points[goal.points.length - 1]!;
  const series = GAUGE_SERIES[index % GAUGE_SERIES.length]!;
  // 추이는 최근 5개까지만 — 그보다 길어지면 막대가 실선처럼 뭉개져 흐름이 안 읽힌다.
  const trend = goal.points.slice(-5);
  return (
    <div className="briefing-gas-goal" data-series={series}>
      <div
        className="briefing-gauge"
        style={{ '--gauge-pct': `${latest === null ? 0 : gaugePercent(latest.score)}%` } as CSSProperties}
        role="img"
        aria-label={latest === null
          ? `${goal.goalTitle} 목표는 아직 GAS 점수 기록이 없습니다`
          : `${goal.goalTitle} 목표 최신 GAS 점수 ${formatScore(latest.score)}점`}
      >
        <span className="briefing-gas-score" aria-hidden="true">
          {latest === null ? '–' : formatScore(latest.score)}
        </span>
      </div>
      <span className="briefing-gas-goal-title">
        {goal.goalTitle}
        {goal.status === 'closed' ? <span className="briefing-gas-goal-closed">종료</span> : null}
      </span>
      {trend.length > 1 ? (
        <span className="briefing-gas-trend" aria-hidden="true">
          {trend.map((point, i) => (
            <i key={i} style={{ '--bar': `${Math.max(8, gaugePercent(point.score) * 0.24)}px` } as CSSProperties} />
          ))}
        </span>
      ) : null}
      {goal.status === 'closed' && goal.closedAt !== null ? (
        <span className="briefing-meta">{formatDateOnly(goal.closedAt)}</span>
      ) : null}
    </div>
  );
}

function GasCard({ gasTrend }: { gasTrend: ParticipantBriefingSection['gasTrend'] }) {
  if (gasTrend.length === 0) return <EmptyNote>표시할 GAS 기록이 없습니다.</EmptyNote>;
  return (
    <>
      <div className="briefing-gas-grid">
        {gasTrend.map((goal, index) => <GasGauge key={goal.goalId} goal={goal} index={index} />)}
      </div>
      <p className="briefing-meta"><MetaRow items={['GAS 척도 −2 ~ +2', '점수는 상담사가 직접 기록']} /></p>
    </>
  );
}

export function BriefingCards({
  beneficiaryId,
  participantHref,
  recordsHref,
  recordNewHref,
  programLabel,
  participant,
  gasTrend,
  lastSessionSummary,
  questions,
  openActionItems,
  flags,
  upcomingSchedule,
}: BriefingCardsProps) {
  // 여닫기 범위는 **아코디언을 담은 영역 전체**다 — GAS 도 아코디언이 됐고 그리드 밖에 있어서,
  // 예전처럼 카드 그리드에만 ref 를 걸면 '전체 접기'가 GAS 를 건너뛴다.
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

  // 진행 중이 4개 이상이면 최근 갱신순 3개만 게이지로 세우고 나머지는 "외 N개"로 접는다
  // (CLAUDE.md 6장 · D33). 게이지가 늘어나면 '5분 전에 훑는' 화면이 아니게 된다.
  const activeGoals = gasTrend.filter((goal) => goal.status === 'active');
  const shownGoals = (activeGoals.length > 0 ? activeGoals : gasTrend).slice(0, 3);
  const hiddenGoalCount = (activeGoals.length > 0 ? activeGoals : gasTrend).length - shownGoals.length;

  const summarySource = lastSessionSummary?.source;
  const pendingApprovalCount = lastSessionSummary?.pendingApprovalCount ?? 0;
  const sessionGoals = upcomingSchedule?.sessionGoals ?? [];
  const customQuestions = upcomingSchedule?.customQuestions ?? [];
  const hasPii = participant.name !== null || participant.phone !== null;

  return (
    <div className="briefing-page">
      {/* HERO 카드 (D37 §4-5 · D22). **화면의 모든 글자는 카드 안에 있다** — HERO 도 카드다.
          좌측 이름 묶음(이름 + 상태 태그 + 메타 한 줄), 우측 행동 **최대 2개**(세컨더리 → 프라이머리).
          축은 사이드바 = 장소 / 우상단 = 행동(D35).
          D37 이 D35 의 이동 버튼 배치를 고쳤다: `참여자 정보`는 여기 우상단 세컨더리로 올라오고
          `상담 기록`은 `자세한 상담 기록 보기`가 되어 이 페이지 맨 아래로 내려간다.
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
          <WireButton href={participantHref} variant="secondary">참여자 정보</WireButton>
          <WireButton href={recordNewHref} variant="primary">상담 시작</WireButton>
        </div>
      </header>

      <RiskBanner flags={flags} />

      {/* 여닫기 줄은 리스크 배너 **아래**다 — 배너는 HERO 바로 아래 자리를 내줄 수 없고(D9),
          이 줄이 다루는 대상(아코디언 전부)의 바로 위이기도 하다. */}
      <div className="briefing-toolbar">
        <WireButton onClick={toggleAll} variant="ghost" height="sm">
          {allOpen ? '전체 접기' : '전체 열기'}
        </WireButton>
      </div>

      <div className="briefing-accordions" ref={accordionsRef}>

      {/* GAS — **전폭 아코디언 하나**다(시안 `artifacts/layout-frame-v1/briefing.html`).
          전폭이어야 하는 이유는 조밀 그리드 때문이다: 2열 카드(폭 510) 안에서는 최소 280 으로
          3열이 물리적으로 안 나오고 계약이 2열을 금지한다(세부 목표 3개가 둘 + 외톨이로 앉는다).
          전폭 1040 이면 3열 각 333 이 나온다. */}
      <details className="briefing-card briefing-gas-card" open>
        <summary className="briefing-card-summary">
          <span>진행 중인 세부 목표</span>
          <span className="briefing-card-summary-right">
            {hiddenGoalCount > 0 ? <span className="briefing-badge">외 {hiddenGoalCount}개</span> : null}
            <span aria-hidden="true" className="briefing-card-arrow" />
          </span>
        </summary>
        <div className="briefing-card-body">
          <GasCard gasTrend={shownGoals} />
        </div>
      </details>

      <section className="briefing-section" aria-labelledby="briefing-materials-heading">
        <h2 id="briefing-materials-heading" className="briefing-section-heading">상담 준비 자료</h2>

      {/* 아코디언 4종(CLAUDE.md 6장). **구 '기본정보' 카드는 없앴다** — 담고 있던 셋이 전부
          다른 자리로 갔기 때문이다: 시간·이름은 HERO 로 올라갔고, 연락처는 아래 개인정보 카드에
          이미 있으며, '전체 참여사업' 링크는 HERO 우상단 `참여자 정보`가 잇는다(그 페이지가
          전 참여 사업을 보여주는 허브다 — D35). 남겨 두면 같은 값이 한 화면에 두 번 나온다. */}
      <div className="briefing-cards-grid">
        {/* ① 지난 상담 브리핑 — 승인 AI 요약/수기 폴백 + 승인 대기 배지 (D5) */}
        <Card title="지난 상담 브리핑">
          <div className="briefing-badges">
            <span className={summarySource === 'ai' ? 'briefing-badge is-approved' : 'briefing-badge'}>
              {lastSessionSummary === null ? '기록 없음' : summarySource === 'ai' ? '승인된 AI 요약' : '수기 기록'}
            </span>
            {pendingApprovalCount > 0 ? <span className="briefing-badge is-pending">승인 대기 {pendingApprovalCount}건</span> : null}
          </div>
          {lastSessionSummary === null
            ? <EmptyNote>표시할 승인된 AI 요약 또는 수기 기록이 없습니다.</EmptyNote>
            : <WireBullets items={[lastSessionSummary.text]} />}
        </Card>

        {/* ④ 오늘 확인할 질문 — 세션 목표 / 맞춤형 질문 / AI 질문 */}
        <Card title="오늘 확인할 질문">
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
              ? <EmptyNote>상담사가 적은 맞춤형 질문이 없습니다.</EmptyNote>
              : <WireBullets items={customQuestions} />}
          </div>
          <div className="briefing-qsection">
            <p className="briefing-qlabel">AI 질문</p>
            {questions.length === 0
              ? <EmptyNote>승인된 상담 기록이 쌓이면 질문을 제안합니다.</EmptyNote>
              : <WireBullets items={questions} />}
          </div>
        </Card>

        {/* ⑤ 미해결 액션 */}
        <Card title="미해결 액션">
          {openActionItems.length === 0
            ? <EmptyNote>미해결 항목이 없습니다.</EmptyNote>
            : <WireBullets items={openActionItems.map((item) => (
                <MetaRow items={[item.description, item.dueDate === null ? null : `기한 ${item.dueDate}`, `담당 ${actionOwnerLabels[item.owner]}`]} />
              ))} />}
        </Card>

        {/* ⑥ 개인정보 — 실명·연락처 직표시(복호화 클릭 없음, T2 제공). 권한 없으면 값이 null. */}
        <Card title="개인정보">
          {hasPii
            ? (
              <div className="briefing-fields">
                <WireField label="이름">{participant.name ?? '미등록'}</WireField>
                <WireField label="연락처">{participant.phone ?? '미등록'}</WireField>
              </div>
            )
            : <EmptyNote>권한 없음. 담당자·배정 책임자만 실명·연락처를 볼 수 있습니다.</EmptyNote>}
        </Card>
        </div>
      </section>
      </div>

      {/* 브리핑 이어보기 — 별개 화면이 아니라 이 브리핑의 아래쪽 끝이다(D37 · 시안 §19).
          D35 가 이름 아래 뒀던 `상담 기록` 버튼을 D37 이 여기로 내리고 이름을 바꿨다:
          "상담 기록"은 무엇이 열리는지 안 알려줬고, 이 자리에서는 위 브리핑을 다 읽은 다음의
          다음 걸음이라 문장으로 설명할 수 있다. */}
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
