import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ApiError, getScheduleSessionPlan, listGoals } from '../../../lib/api';
import { updateScheduleSessionGoalsAction } from '../../../actions';
import { GridContainer } from '../../../components/wire/grid-container';
import { MetaRow } from '../../../components/wire/meta-row';
import { PageTitle } from '../../../components/wire/page-title';
import { WireBullets, WireCard } from '../../../components/wire/wire-card';
import { WireCallout } from '../../../components/wire/wire-callout';
import { WireEmpty, WireError } from '../../../components/wire/wire-state';
import { formatKoreanDateTime } from '../../../lib/format-korean-date';
import { SessionPlanEditor, type SessionPlanGoalOption } from './session-plan-editor';

// 세션 목표 수정 화면 (D62 §6 · CCC-70). 상담 전에는 자유롭게 고치고, 일정 시작 시각이
// 지나면 그날의 계획 기록으로 잠근다. 미루면 새 시각까지 다시 열리고, 취소된 일정은
// 잠긴 기록이다. 진입점은 15초 페이지 영역 ①(다가오는 일정의 세션 목표 구획).
// 잠금 판정은 여기(표시)와 게이트웨이(강제) 둘 다 한다. 화면이 열려 있는 사이 시각이
// 지나면 저장 시점의 게이트웨이 검사가 최종이다(R1).

const SCHEDULE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function loadErrorMessage(error: ApiError): string {
  switch (error.code) {
    case 'authentication_required':
      return '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.';
    case 'access_denied':
    case 'forbidden':
      return '담당 중인 케이스의 일정만 볼 수 있습니다.';
    case 'not_found':
      return '일정을 찾을 수 없습니다.';
    default:
      return '일정 정보를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
  }
}

/** 잠긴 상태별 안내 한 줄. 열림(null)이면 편집 폼을 그린다. */
function lockNotice(status: 'scheduled' | 'completed' | 'cancelled' | 'no_show', scheduledAt: string): string | null {
  if (status === 'cancelled') return '취소된 일정입니다. 세션 목표는 그날 계획의 기록으로 남습니다.';
  if (status === 'completed') return '완료된 일정입니다. 세션 목표는 그날 계획의 기록으로 남습니다.';
  if (status === 'no_show') return '불참 처리된 일정입니다. 세션 목표는 그날 계획의 기록으로 남습니다.';
  if (Date.parse(scheduledAt) <= Date.now()) {
    return '일정 시작 시각이 지나 세션 목표가 잠겼습니다. 일정을 미루면 새 시각까지 다시 열립니다.';
  }
  return null;
}

export default async function ScheduleSessionPlanPage({
  params,
}: {
  params: Promise<{ scheduleId: string }>;
}) {
  const { scheduleId } = await params;
  if (!SCHEDULE_UUID.test(scheduleId)) notFound();

  const frame = (body: ReactNode) => (
    <GridContainer as="main" className="page-content">
      <div className="page-header"><PageTitle>세션 목표 수정</PageTitle></div>
      {body}
    </GridContainer>
  );

  try {
    const plan = await getScheduleSessionPlan(scheduleId);
    if (plan.sessionKind === 'intake') {
      // 인테이크 일정은 세션 목표를 갖지 않는다(CCC-64, 아직 연결할 세부 목표가 없는 시점).
      return frame(<WireError>인테이크 일정에는 세션 목표가 없습니다.</WireError>);
    }

    const notice = lockNotice(plan.status, plan.scheduledAt);
    const scheduledAtLabel = formatKoreanDateTime(plan.scheduledAt);

    if (notice !== null) {
      return frame(
        <div className="wizard-stack">
          <WireCallout tone="info" title={`상담 일시: ${scheduledAtLabel}`}>{notice}</WireCallout>
          <WireCard title="세션 목표">
            {plan.sessionGoals.length === 0
              ? <WireEmpty>등록된 세션 목표가 없습니다.</WireEmpty>
              : <WireBullets items={plan.sessionGoals.map((goal) => (
                  goal.caseGoalTitle === null
                    ? goal.body
                    : <MetaRow items={[goal.body, `세부 목표: ${goal.caseGoalTitle}`]} />
                ))} />}
          </WireCard>
        </div>,
      );
    }

    // 연결 선택창에는 활성 세부 목표만 올린다(D62 §5). 종료된 목표는 기존 연결이 가리키는
    // 것만 "(종료됨)" 표기로 남긴다. 말없이 떨어뜨리지 않되, 그대로 저장하려 하면 서버가
    // 거부하고 화면이 바꿔 달라고 안내한다.
    const allGoals = await listGoals(plan.supportCaseId);
    const linkedIds = new Set(
      plan.sessionGoals.map((goal) => goal.caseGoalId).filter((id): id is string => id !== null),
    );
    const goalOptions: SessionPlanGoalOption[] = allGoals
      .filter((goal) => goal.status === 'active' || linkedIds.has(goal.id))
      .map((goal) => ({ id: goal.id, title: goal.title, closed: goal.status !== 'active' }));

    // 편집 화면은 제목 줄(+ 우측 저장)까지 편집기가 그린다(CCC-75 — 저장 버튼·자동 저장
    // 상태가 제목 줄에 서므로 클라이언트 상태가 필요하다). 잠금·오류 화면만 frame 을 쓴다.
    return (
      <GridContainer as="main" className="page-content">
        <SessionPlanEditor
          scheduleId={plan.scheduleId}
          beneficiaryId={plan.beneficiaryId}
          supportCaseId={plan.supportCaseId}
          version={plan.version}
          scheduledAtLabel={scheduledAtLabel}
          initialGoals={plan.sessionGoals.map((goal) => ({ body: goal.body, caseGoalId: goal.caseGoalId ?? '' }))}
          goalOptions={goalOptions}
          submit={updateScheduleSessionGoalsAction}
        />
      </GridContainer>
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return frame(<WireError>{loadErrorMessage(error)}</WireError>);
  }
}
