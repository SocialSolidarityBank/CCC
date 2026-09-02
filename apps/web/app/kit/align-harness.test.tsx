import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { composeRuntimeCss } from '../../../../scripts/design/hierarchy-audit.mjs';
import { wireStyles } from '../components/wire/wire-styles';
import { BriefingCards, type BriefingCardsProps } from '../participants/[beneficiaryId]/programs/[supportCaseId]/briefing/briefing-cards';
import { OpenActionItemsCard } from '../participants/[beneficiaryId]/programs/[supportCaseId]/close/close-cards';
import { OpenActionResolutions } from '../participants/[beneficiaryId]/programs/[supportCaseId]/records/new/open-action-resolutions';
import { RegisterForm } from '../participants/new/register-form';
import { PROGRAM_LABELS } from '../lib/labels';
import { ConsentEditor } from '../participants/[beneficiaryId]/page';
import { GoalTreeCard } from '../participants/[beneficiaryId]/goal-tree';
import type { ParticipantGoalTreeCase, ParticipantProgram, TodaySchedule } from '../lib/api';
import { ScheduleWizard, type ScheduleWizardCandidate } from '../schedules/new/schedule-wizard';
import { ScheduleBody, ScheduleNav } from '../programs/[programType]/schedule/schedule-view';
import { AppSidebar } from '../components/wire/app-sidebar';
import { BackLink } from '../components/wire/back-link';

vi.mock('../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getParticipantHubDetail: vi.fn(),
  getParticipantGoalTree: vi.fn(),
}));
vi.mock('../lib/display-labels', () => ({ getDisplayLabels: vi.fn() }));
vi.mock('../actions', () => ({ updateParticipantConsentAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/programs/financial_support_v1/schedule',
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));

// 정렬 실측 하니스 (2026-08-30 Q — align-check 스킬 계약을 레포 게이트로).
//
// 위계 하니스(hierarchy-harness.test.tsx)와 같은 원칙이다: **실제 부품으로** 렌더한 정적
// HTML 을 만들고, 브라우저 실측(scripts/design/align-check.py)이 그 파일을 잰다. 마크업을
// 손으로 옮겨 적으면 부품이 바뀌어도 옛 모양을 재고 초록불이 거짓이 된다.
//
// 위계 하니스와 따로 두는 이유: 재는 물음이 다르다. 그쪽은 이웃 줄의 옷과 기하 결함이고,
// 이쪽은 선언된 정렬 단언의 중심 공유, 여백 대칭, 항목 리듬, 꺽쇠와 배지 중앙을 잰다.
//
// AI 제안 유무, 등록 동의 접힘·펼침, 긴급 등록, 당사자 정보 동의, 긴 모바일 회차,
// 목표 트리, 일정 업무 바와 주간 날짜, 시간축 배지 생산 사용처를 실제 부품으로 렌더한다.
// 셀렉터는 각 래퍼 id로 범위를 좁힌다.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT_DIR = join(repoRoot, 'artifacts/align-harness');

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const hubProgram: ParticipantProgram = {
  id: CASE_ID,
  beneficiaryId: 'swallow-003',
  programType: 'financial_support_v1',
  status: 'active',
  intakeAt: '2026-07-01T00:00:00.000Z',
  creationKind: 'initial',
  sourceSupportCase: null,
  authorized: true,
  assigneeNames: ['홍길동'],
  consent: { privacy: true, recordingAi: true },
  consentRecordedAt: '2026-07-01T00:00:00.000Z',
  upcomingSchedule: null,
};

const goalTreeCases: ParticipantGoalTreeCase[] = [{
  sourceSupportCase: { id: CASE_ID, programType: 'financial_support_v1', status: 'active' },
  overallGoal: '안정적인 주거를 유지하면서 월 고정 지출과 채무 상환 계획을 함께 실행한다',
  overallGoalRevisions: [],
  goals: [
    {
      id: 'g1',
      title: '매주 지출 내역을 기록하고 다음 상담 전까지 상환 가능 금액을 확정한다',
      status: 'active',
      closedReason: null,
      closedAt: null,
      revisions: [],
      sessionGoals: [],
      linkedSessions: [],
    },
    {
      id: 'g2',
      title: '월세 자동이체일 전에 생활비 통장 잔액을 확인한다',
      status: 'active',
      closedReason: null,
      closedAt: null,
      revisions: [],
      sessionGoals: [],
      linkedSessions: [],
    },
  ],
}];

const scheduleCandidates: ScheduleWizardCandidate[] = [{
  value: `swallow-003|${CASE_ID}`,
  beneficiaryId: 'swallow-003',
  supportCaseId: CASE_ID,
  programLabel: PROGRAM_LABELS.financial_support_v1,
  participantName: '홍서희',
  participantPhone: '010-1234-5678',
  participantEmail: null,
  intakeAt: '2026-07-01T00:00:00.000Z',
}];

const actionFixture = {
  id: 'action-1',
  description: '임대인에게 분할 납부 가능 여부를 확인한다',
  owner: 'beneficiary' as const,
  dueDate: '2026-09-10',
  sessionId: 's-2',
};

const scheduleRows: TodaySchedule[] = [{
  id: 'schedule-today',
  beneficiaryId: 'swallow-003',
  supportCaseId: CASE_ID,
  scheduledAt: '2026-09-02T04:00:00.000Z',
  programType: 'financial_support_v1',
  status: 'scheduled',
  participantName: '홍서희',
  participantPhone: '010-1234-5678',
  sessionKind: 'regular',
  completedSessionId: null,
}];

// 전체 목표 미설정이라 AI 제안 라벨 옆 안내가 첫 렌더부터 선다. 세부 목표는 불릿 2개다.
const baseProps: BriefingCardsProps = {
  beneficiaryId: 'swallow-003',
  supportCaseId: CASE_ID,
  overallGoal: null,
  activeGoals: [
    { id: 'g1', title: '월세 체납 해소' },
    { id: 'g2', title: '고정 지출 정리' },
  ],
  canEditOverallGoal: true,
  participantHref: '/participants/swallow-003',
  recordsHref: `/participants/swallow-003/programs/${CASE_ID}/records`,
  recordNewHref: `/participants/swallow-003/programs/${CASE_ID}/records/new`,
  programLabel: PROGRAM_LABELS.financial_support_v1,
  participant: { name: '홍서희', phone: '010-1234-5678' },
  sessionRows: [
    { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', kind: 'regular', aiOneLiner: null, memoExcerpt: '구직 활동 근황과 지출 정리를 확인하고 다음 상담 전까지 매주 기록할 항목과 실행 순서를 함께 정했다' },
    { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', kind: 'intake', aiOneLiner: '인테이크 질문지에서 확인한 채무 현황과 다음 상담에서 먼저 다룰 생활비 계획을 정리했다', memoExcerpt: '채무 현황과 정서적 어려움 확인' },
  ],
  discrepancies: [],
  pendingApprovalCount: 0,
  pendingReviewSessionIds: [],
  aiSuggestions: [],
  openActionItems: [actionFixture],
  flags: [],
  upcomingSchedule: null,
};

// 제안 2건 — 항목 사이 리듬(.briefing-suggestions gap)을 재려면 형제가 둘 필요하다.
const contentProps: BriefingCardsProps = {
  ...baseProps,
  aiSuggestions: [
    {
      title: '최근 구직 활동은 어땠는지',
      reason: '지난 회차에서 면접 결과를 기다리고 있었다',
      sessionId: 's-2',
      heldAt: '2026-07-15T05:00:00Z',
      sourceQuotes: ['면접 결과는 다음 주에 나와요.'],
    },
    {
      title: '주간 재료비 상한은 정했는지',
      reason: '지난 회차에서 다음 상담까지 정해 오기로 했다',
      sessionId: 's-1',
      heldAt: '2026-07-01T05:00:00Z',
      sourceQuotes: ['상한을 얼마로 둘지 아직 못 정했어요.'],
    },
  ],
};

describe('정렬 하니스 생성기', () => {
  it('정렬 대상 실제 부품의 정적 HTML을 만든다', async () => {
    const empty = renderToStaticMarkup(<BriefingCards {...baseProps} />);
    const content = renderToStaticMarkup(<BriefingCards {...contentProps} />);
    const register = renderToStaticMarkup(
      <RegisterForm
        currentUser={{ name: '홍길동', email: 'worker@example.test' }}
        action={() => {}}
        programLabel={PROGRAM_LABELS.financial_support_v1}
      />,
    );
    const hubConsent = renderToStaticMarkup(
      <div className="participant-consent-block wire-repeat-card">
        <ConsentEditor beneficiaryId="swallow-003" program={hubProgram} />
      </div>,
    );
    const sidebar = renderToStaticMarkup(
      <div className="app-shell">
        <AppSidebar activePath="/programs/financial_support_v1/schedule" />
      </div>,
    );
    Object.defineProperty(window.history, 'length', { value: 3, configurable: true });
    const backView = render(<BackLink />);
    const backLink = backView.container.innerHTML;
    cleanup();
    const goalTree = renderToStaticMarkup(
      <GoalTreeCard beneficiaryId="swallow-003" cases={goalTreeCases} programLabels={PROGRAM_LABELS} />,
    );
    const scheduleNav = renderToStaticMarkup(
      <ScheduleNav
        basePath="/programs/financial_support_v1/schedule"
        view="week"
        anchor="2026-09-02"
      />,
    );
    const scheduleBody = renderToStaticMarkup(
      <ScheduleBody
        view="week"
        schedules={scheduleRows}
        timeZone="Asia/Seoul"
        todayKey="2026-09-02"
      />,
    );
    const closeActions = renderToStaticMarkup(<OpenActionItemsCard items={[actionFixture]} />);
    const actionResolutions = renderToStaticMarkup(
      <OpenActionResolutions actions={[actionFixture]} />,
    );
    const scheduleView = render(
      <ScheduleWizard
        candidates={scheduleCandidates}
        loadContext={(async () => ({
          status: 'loaded',
          caseGoals: [{ id: 'g1', title: '월세 체납 해소' }],
          lastBriefing: null,
        })) as never}
        submit={(async () => ({ status: 'saved' as const })) as never}
      />,
    );
    fireEvent.click(scheduleView.getByRole('button', { name: /홍서희/ }));
    fireEvent.change(scheduleView.getByLabelText('상담 일시 날짜'), { target: { value: '2026-07-20' } });
    fireEvent.change(scheduleView.getByLabelText('상담 일시 시각'), { target: { value: '13:00' } });
    fireEvent.click(scheduleView.getByRole('button', { name: /다음: 이번 상담의 목표/ }));
    await waitFor(() => expect(scheduleView.getByLabelText('세부 목표 연결')).not.toBeNull());
    const scheduleGoals = scheduleView.container.innerHTML;
    cleanup();
    // 펼친 상태는 **생성된 마크업에 open 속성만 얹어** 만든다 — 마크업을 손으로 옮겨 적으면
    // 부품이 바뀌어도 옛 모양을 재게 된다(위계 하니스와 같은 이유). 여는 방법은 이 한 줄뿐이다:
    // details 는 서버 렌더에서 열 수 있는 프롭이 RegisterForm 에 없고, 실측 대상은 열린 상자다.
    const registerOpen = register.replace('<details class="consent-detail', '<details open class="consent-detail');
    const hubConsentOpen = hubConsent.replace('<details class="consent-detail', '<details open class="consent-detail');
    const goalTreeOpen = goalTree.replace('<details class="goal-tree-goal-details', '<details open class="goal-tree-goal-details');

    // 단언 대상이 실제로 렌더에 서야 실측이 성립한다. 빈 껍데기면 실측이 "요소 없음"으로
    // 늦게 죽는 대신 여기서 원인(어느 fixture 가 비었나)을 말하며 막는다.
    for (const [name, markup] of [['제안 없음', empty], ['제안 있음', content]] as const) {
      expect(markup, `${name}: AI 제안 안내 행이 정적 렌더에 없다`).toContain('briefing-ai-goal-hint');
      expect(markup, `${name}: 세부 목표 불릿 목록이 정적 렌더에 없다`).toContain('briefing-subgoal-rows wire-bullets');
    }
    expect(empty, '제안 없음: 빈 상태 줄이 없다').toContain('승인된 상담 기록이 쌓이면');
    expect(content, '제안 있음: 제안 목록이 없다').toContain('briefing-suggestions');
    expect(register, '등록: 동의 전문 상자가 없다').toContain('consent-detail register-consent-block wire-repeat-card');
    expect(registerOpen, '등록: 펼침 변형에 open 이 안 붙었다').toContain('<details open class="consent-detail');
    expect(hubConsent, '당사자 정보 동의 행이 없다').toContain('consent-item');
    expect(hubConsent, '당사자 정보 동의 묶음 상자가 없다').toContain('participant-consent-block wire-repeat-card');
    expect(hubConsentOpen, '당사자 정보 동의 전문 펼침 변형이 없다').toContain('<details open class="consent-detail');
    expect(sidebar, '사이드바 내비게이션 행이 없다').toContain('navigation-link');
    expect(backLink, '뒤로 버튼의 왼쪽 공용 꺽쇠가 없다').toContain('wire-chevron');
    expect(goalTree, '당사자 정보 목표 트리가 없다').toContain('goal-tree-case');
    expect(goalTreeOpen, '당사자 정보 세부 목표 펼침 변형이 없다').toContain('<details open class="goal-tree-goal-details');
    expect(goalTree, '당사자 정보 세부 목표 연결 회차 배지가 없다').toContain('연결 회차 0건');
    expect(goalTree, '당사자 정보 세부 목표 불릿 목록이 없다').toContain('goal-tree-goals wire-bullets');
    expect(content, '제안 있음: 수기 배지 없는 회차 변형이 없다').toContain('<span class="briefing-session-memo"></span>');
    expect(scheduleGoals, '일정 등록: 목표 선택창이 없다').toContain('session-goal-link');
    expect(scheduleGoals, '일정 등록: 세션 목표 입력칸이 없다').toContain('session-goal-input');
    expect(scheduleNav, '일정 업무 바: 보기 선택창이 없다').toContain('schedule-view-select');
    expect(scheduleBody, '일정 주간: 오늘 배지가 있는 날짜 묶음이 없다').toContain('schedule-day-summary-title');
    expect(scheduleBody, '일정 주간: 오늘 시간축 배지가 없다').toContain('data-tone="blue"');
    expect(content, '브리핑: 기한 시간축 배지가 없다').toContain('data-tone="blue"');
    expect(closeActions, '종결: 기한 시간축 배지가 없다').toContain('data-tone="blue"');
    expect(actionResolutions, '기록 작성: 기한 시간축 배지가 없다').toContain('data-tone="blue"');

    const tokens = readFileSync(join(repoRoot, 'design/tokens.css'), 'utf8');
    const runtimeCss = composeRuntimeCss(join(repoRoot, 'apps/web/app/layout.tsx'), wireStyles);
    const pretendardCssUrl = pathToFileURL(join(
      process.cwd(),
      'node_modules/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css',
    )).href;
    const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>정렬 하니스</title>
<link rel="stylesheet" href="${pretendardCssUrl}">
<style>${tokens}</style>
<style>${runtimeCss}</style>
<style>body{background:var(--canvas)}</style>
</head><body>
<div id="align-empty">${empty}</div>
<div id="align-content">${content}</div>
<div id="align-register">${register}</div>
<div id="align-register-open">${registerOpen}</div>
<div id="align-hub-consent">${hubConsent}</div>
<div id="align-hub-consent-open">${hubConsentOpen}</div>
<div id="align-sidebar">${sidebar}</div>
<div id="align-back">${backLink}</div>
<div id="align-goal-tree">${goalTree}</div>
<div id="align-goal-tree-open">${goalTreeOpen}</div>
<div id="align-schedule-goals">${scheduleGoals}</div>
<div id="align-schedule-nav">${scheduleNav}</div>
<div id="align-schedule-body">${scheduleBody}</div>
<div id="align-close-actions">${closeActions}</div>
<div id="align-action-resolutions">${actionResolutions}</div>
</body></html>`;

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'align.html'), html);
    expect(html).toContain('--text-sm');
    expect(html).toContain('pretendardvariable-dynamic-subset.css');
  });
});
