import Link from 'next/link';
import type { ParticipantGoalTreeCase, ParticipantGoalTreeGoal, GoalRevisionEntry, ParticipantProgramType } from '../../lib/api';
import { WireBadge } from '../../components/wire/wire-badge';
import { WireCard } from '../../components/wire/wire-card';
import { WireEmpty, WireError } from '../../components/wire/wire-state';
import { MetaRow } from '../../components/wire/meta-row';
import { WireTimeline, WireTimelineItem } from '../../components/wire/wire-timeline';
import { formatKoreanDate, formatKoreanDateTime } from '../../lib/format-korean-date';

// 목표 트리 (D62 §8 · CCC-69) — 당사자 허브의 케이스별 구획. 위계는 전체 > 세부 > 세션이고
// 담당(또는 admin) 케이스만 온다(D36 — 목표는 상담 내용, 게이트웨이가 강제).
//
// - 닫힌 세부 목표는 흐리게 + 사유 배지(달성/중단/재설정)로 남는다 — 지우지 않는다(D62 §5).
// - '이력 보기'는 네이티브 details 다. 문구 이력은 기본 숨김이고(D62 §4) 이전 문구·수정자·
//   시각을 최신부터 보여준다. 최초 작성이 마지막 줄이라 "누가 처음 정했는지"가 함께 남는다.
// - 세션 목표는 세부 목표에 연결된 것만 트리에 있다 — 연결 없이 적은 세션 목표는 위계 밖이라
//   일정·기록 화면 몫이다(게이트웨이 주석과 같은 결정).

const goalCloseReasonLabels: Record<string, string> = {
  achieved: '달성',
  stopped: '중단',
  reset: '재설정',
};

const scheduleStatusSuffix: Record<string, string | null> = {
  scheduled: null,
  completed: null,
  cancelled: '취소된 일정',
  no_show: '불참',
};

/** 문구 이력 아코디언 — 등록 폼 '전문 보기'와 같은 네이티브 details 어휘의 소형 변형. */
function RevisionHistory({ revisions }: { revisions: GoalRevisionEntry[] }) {
  if (revisions.length === 0) return null;
  return (
    <details className="goal-tree-history">
      <summary>이력 보기 <span className="wire-card-arrow" aria-hidden="true" /></summary>
      <WireTimeline>
        {revisions.map((revision, index) => (
          <WireTimelineItem key={`${revision.editedAt}-${index}`} className="goal-tree-history-row">
            {/* title null = 전체 목표를 지움(스키마 주석). 세부 목표에는 빈 문구가 없다. */}
            <p className="goal-tree-history-title">{revision.title ?? '(비워 둠)'}</p>
            <p className="goal-tree-history-meta">
              <MetaRow items={[
                index === revisions.length - 1 ? '최초 작성' : '수정',
                revision.editedByName ?? '이름 미입력',
                formatKoreanDateTime(revision.editedAt),
              ]} />
            </p>
          </WireTimelineItem>
        ))}
      </WireTimeline>
    </details>
  );
}

/** 세부 목표 한 그루 — 제목 줄(상태·이력) + 연결된 세션 목표 목록. */
function GoalNode({ goal, recordsHref }: { goal: ParticipantGoalTreeGoal; recordsHref: string }) {
  const closed = goal.status === 'closed';
  const reasonLabel = goal.closedReason === null ? null : goalCloseReasonLabels[goal.closedReason] ?? null;
  return (
    <li className={closed ? 'goal-tree-goal is-closed' : 'goal-tree-goal'}>
      <details className="goal-tree-goal-details">
        <summary className="goal-tree-goal-head">
          <span className="goal-tree-goal-title">{goal.title}</span>
          {closed && <WireBadge>{reasonLabel === null ? '종료' : `종료(${reasonLabel})`}</WireBadge>}
              <WireBadge>연결 회차 {goal.linkedSessions.length}건</WireBadge>
          <span className="wire-card-arrow" aria-hidden="true" />
        </summary>
        <div className="goal-tree-goal-body">
          <RevisionHistory revisions={goal.revisions} />
          {goal.linkedSessions.length === 0
            ? <WireEmpty>연결된 상담 회차가 없습니다.</WireEmpty>
            : <ul className="goal-tree-session-rows">
                {goal.linkedSessions.map((session) => (
                  <li key={session.sessionId}>
                    <Link
                      className="goal-tree-linked-session"
                      href={`${recordsHref}#record-${session.sessionId}`}
                    >
                      <span className="goal-tree-session-date">{formatKoreanDate(session.heldAt)}</span>
                      <span className="goal-tree-session-body">{session.oneLiner ?? '핵심 한 줄이 없습니다.'}</span>
                    </Link>
                  </li>
                ))}
              </ul>}
          {goal.sessionGoals.length > 0 && (
            <ul className="goal-tree-session-rows">
              {goal.sessionGoals.map((sessionGoal) => {
            const suffix = scheduleStatusSuffix[sessionGoal.scheduleStatus] ?? null;
            // MetaRow 를 쓰지 않는다(2026-08-09) — 이 줄은 짧은 메타 조각들이 아니라 **날짜 +
            // 문장**이라, 조각 사이 세로선 구분자가 문장의 줄바꿈에 걸려 본문 앞 인용 막대처럼
            // 보였다(Q 보고 "아래 날짜 | 중복 내용"). 날짜는 줄지 않는 칸으로 두고 문장만 자기
            // 칸 안에서 접히게 한다. 구분은 세로선이 아니라 날짜 색이 맡는다(§10 은 문자
            // 구분자를 금지할 뿐, 조각을 독립 노드로 두고 간격으로 띄우는 계약은 그대로다).
                return (
                  <li key={sessionGoal.id} className="goal-tree-session-row">
                    <span className="goal-tree-session-date">{formatKoreanDate(sessionGoal.scheduledAt)}</span>
                    <span className="goal-tree-session-body">{sessionGoal.body}</span>
                    {suffix === null ? null : <WireBadge>{suffix}</WireBadge>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

/** 케이스 한 구획: 전체 목표 → 세부 목표(각각 세션 목표를 매단다). */
function GoalTreeCaseBlock({ tree, programTitle, showTitle, recordsHref }: {
  tree: ParticipantGoalTreeCase;
  programTitle: string;
  showTitle: boolean;
  recordsHref: string;
}) {
  const overallSet = tree.overallGoal !== null && tree.overallGoal.length > 0;
  return (
    <div className="goal-tree-case">
      {showTitle && (
        <div className="participant-program-head">
          <h3 className="goal-tree-case-title">{programTitle}</h3>
          {tree.sourceSupportCase.status === 'closed' && <WireBadge tone="mint">종결</WireBadge>}
        </div>
      )}
      <div className="goal-tree-section wire-repeat-card">
        <p className="goal-tree-label">전체 목표</p>
        <div className="goal-tree-overall">
          <span className={overallSet ? 'goal-tree-overall-text' : 'goal-tree-overall-text is-empty'}>
            {overallSet ? tree.overallGoal : '설정 전'}
          </span>
          <RevisionHistory revisions={tree.overallGoalRevisions} />
        </div>
      </div>
      <div className="goal-tree-section wire-repeat-card">
        <p className="goal-tree-label">세부 목표</p>
        {tree.goals.length === 0
          ? <WireEmpty>세부 목표가 없습니다. 상담 기록을 작성할 때 세웁니다.</WireEmpty>
          : (
            // 불릿은 항목이 2개 이상일 때만 얹는다(§5 불릿 목록 규칙) — 세부 목표가 하나뿐이면
            // 나열이 아니라 문장이라 점도 들여쓰기도 두지 않는다.
            <ul className={tree.goals.length > 1 ? 'goal-tree-goals wire-bullets' : 'goal-tree-goals'}>
              {tree.goals.map((goal) => <GoalNode key={goal.id} goal={goal} recordsHref={recordsHref} />)}
            </ul>
          )}
      </div>
    </div>
  );
}

/** 목표 카드 — 담당 케이스가 여럿이면 구획 머리에 사업명이 선다(동의서 카드와 같은 문법).
 *  목표 조회만 실패했을 때는 카드 자리에 오류 한 줄을 남긴다 — 구획 하나의 장애가 허브
 *  전체를 막지 않는다(D8 폴백 태도, 인테이크의 전체 목표 오류 안내와 같은 결정). */
export function GoalTreeCard({ beneficiaryId, cases, programLabels, loadFailed = false }: {
  beneficiaryId: string;
  cases: ParticipantGoalTreeCase[];
  programLabels: Record<ParticipantProgramType, string>;
  loadFailed?: boolean;
}) {
  if (loadFailed) {
    return (
      <WireCard as="section" className="participant-hub-card" title="목표">
        <WireError>목표를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.</WireError>
      </WireCard>
    );
  }
  if (cases.length === 0) return null;
  return (
    <WireCard as="section" className="participant-hub-card" title="목표">
      {cases.map((tree) => (
        <GoalTreeCaseBlock
          key={tree.sourceSupportCase.id}
          tree={tree}
          programTitle={programLabels[tree.sourceSupportCase.programType] ?? tree.sourceSupportCase.programType}
          showTitle={cases.length > 1}
          recordsHref={`/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(tree.sourceSupportCase.id)}/records`}
        />
      ))}
    </WireCard>
  );
}
