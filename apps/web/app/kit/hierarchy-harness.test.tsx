/**
 * 위계 하니스 **생성기** (CCC-80 2/2).
 *
 * 왜 이 자리인가. `guard:hierarchy` 는 CSS 만 보고 한 요소의 최종 조합을 세울 수 있지만,
 * "이웃한 두 줄이 같은 옷인가"(DESIGN.md §2-2 규칙 1)는 DOM 순서를 알아야 답할 수 있고
 * 그건 CSS 파일에 없다. 그래서 **실제 부품으로 렌더한 정적 HTML** 을 만들어 브라우저에
 * 물리고, 계산된 크기·굵기·색을 읽는다. 재는 쪽은 `scripts/design/hierarchy-measure.py` 다.
 *
 * 마크업을 손으로 베끼지 않는 것이 이 파일의 존재 이유다. 손으로 옮기면 부품이 바뀌어도
 * 하니스는 옛 모양을 재고, 그러면 초록불이 거짓이 된다. 화면 컴포넌트를 그대로 렌더한다.
 *
 * 재는 대상은 **실제 데이터가 아니라 골격**이다. 픽스처 값은 각 화면의 기존 테스트가 쓰는
 * 것과 같은 모양이면 충분하다 — 위계는 글자 내용이 아니라 조합이 만든다.
 *
 * 실행: pnpm --filter @ccc/web test   (이 파일이 돌면 harness.html 이 다시 쓰인다)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';

import { extractCss } from '../../../../scripts/design/hierarchy-audit.mjs';
import { wireStyles } from '../components/wire/wire-styles';
import KitPage from './page';
import { PageLoading } from '../components/wire/page-loading';
import { BriefingCards, type BriefingCardsProps } from '../participants/[beneficiaryId]/programs/[supportCaseId]/briefing/briefing-cards';
import { RecordOnepage, type RecordOnepageProps } from '../participants/[beneficiaryId]/programs/[supportCaseId]/records/new/record-onepage';
import { IntakeWizard } from '../participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-wizard';
import { ScheduleWizard, type ScheduleWizardCandidate } from '../schedules/new/schedule-wizard';
import { SessionPlanEditor } from '../schedules/[scheduleId]/plan/session-plan-editor';
import { RegisterForm } from '../participants/new/register-form';
import { PROGRAM_LABELS } from '../lib/labels';

// 라우터 훅은 정적 렌더에서도 본문이 돌기 때문에 막아 둔다. 실제 경로가 필요한 곳은
// 킷의 AdminSidebar 뿐이고, 어느 탭이 활성인지는 위계와 무관하다.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}));

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT_DIR = join(repoRoot, 'artifacts/hierarchy-harness');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const noop = async () => ({ status: 'saved' as const });

// ---------------------------------------------------------------------------
// 화면 픽스처. 각 화면의 기존 테스트가 쓰는 값과 같은 모양이다.
// ---------------------------------------------------------------------------

const briefingProps: BriefingCardsProps = {
  beneficiaryId: 'swallow-003',
  supportCaseId: CASE_ID,
  overallGoal: '월세 체납을 해소하고 안정적인 주거를 유지한다',
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
    { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', kind: 'regular', aiOneLiner: null, memoExcerpt: '구직 활동 근황과 지출 정리를 확인했다' },
    { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', kind: 'intake', aiOneLiner: null, memoExcerpt: '채무 현황과 정서적 어려움 확인' },
  ],
  discrepancies: [],
  pendingApprovalCount: 2,
  pendingReviewSessionIds: [],
  aiSuggestions: [{
    title: '최근 구직 활동은 어땠는지',
    reason: '지난 회차에서 면접 결과를 기다리고 있었다',
    sessionId: 's-2',
    heldAt: '2026-07-15T05:00:00Z',
  }],
  openActionItems: [{ id: 'a1', description: '서류 제출', owner: 'beneficiary', dueDate: '2026-07-20' }],
  flags: [],
  upcomingSchedule: {
    id: 's1',
    scheduledAt: '2026-07-20T05:00:00Z',
    sessionGoals: [{ body: '구직 상담', caseGoalId: 'g1', caseGoalTitle: '월세 체납 해소', caseGoalStatus: 'active' }],
    customQuestions: ['이번 달 지출은 정리됐는지'],
  },
};

const recordProps: RecordOnepageProps = {
  schedules: [],
  openActionItems: [{ id: 'a1', description: '서류 제출', owner: 'beneficiary', dueDate: '2026-07-20' }] as RecordOnepageProps['openActionItems'],
  latestLifeAreaSnapshot: [],
  sessionGoals: [{ body: '임대차 계약 확인', caseGoalTitle: '월세 체납 해소' }],
  customQuestions: ['이번 달 지출은 정리됐는지'],
  lastRecordSummary: null,
  briefingPath: `/participants/swallow-003/programs/${CASE_ID}/briefing`,
  actions: <><button type="button">돌아가기</button><button type="submit">저장</button></>,
};

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

/**
 * 재는 화면. 이름은 사람이 읽는 이름이고, 실측 보고서가 이 이름으로 나온다.
 *
 * kit 는 통제군이다 — 킷 페이지 맨 위 '고치기 전' 칸은 일부러 눌린 쌓임이므로, 하니스가
 * 저기서 아무것도 못 찾으면 그건 하니스가 고장 난 것이다(measure 쪽이 그 조건을 단언한다).
 */
interface Screen {
  id: string;
  label: string;
  /** 첫 화면 그대로 재는 경우. */
  node?: ReactElement;
  /**
   * 몇 걸음 들어가야 볼 것이 있는 경우. 위저드 1단계는 고르는 칸뿐이라 잴 줄이 없다 —
   * §2-2 가 이름을 댄 '상담 유형 / 기본 상담 / 안내문 / 버튼' 4줄은 2단계에 있다.
   */
  walk?: () => Promise<string>;
  /**
   * 이 화면이 최소 몇 줄이어야 하는가. "덜 렌더된 화면"을 잡는 문턱이다.
   *
   * 전역 하한 하나로 두지 않는 이유. 로딩 화면은 제목과 한 문장, 정말로 두 줄뿐이라
   * 공통 문턱에 걸린다. 거기 맞춰 전역을 2 로 낮추면 200줄짜리 상담 기록이 3줄로 나와도
   * 통과한다. 화면마다 적으면 문턱이 오히려 촘촘해진다.
   */
  minLines?: number;
}

const SCREENS: Screen[] = [
  { id: 'kit', label: '컴포넌트 킷 (반례 포함)', node: <KitPage /> },
  { id: 'briefing', label: '15초 페이지', node: <BriefingCards {...briefingProps} /> },
  // 로딩은 줄이 둘뿐이라 위계로 걸릴 것이 없지만, 한 줄이 카드를 통째로 채우는 유일한 화면이라
  // 세로 중앙 정렬이 여기서만 눈에 띈다(2026-08-10 Q 지적). 재는 자리에 두어야 다시 어긋날 때 걸린다.
  { id: 'loading', label: '로딩 화면', node: <PageLoading title="15초 페이지" />, minLines: 2 },
  { id: 'record-new', label: '상담 기록 작성', node: <RecordOnepage {...recordProps} /> },
  {
    id: 'intake',
    label: '인테이크 기록',
    node: <IntakeWizard
      beneficiaryId="swallow-003"
      supportCaseId={CASE_ID}
      submissionId="a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1"
      participant={{ name: '홍서희', phone: '010-1234-5678', email: null }}
      extendedPii={{ birthDate: '1984-03-11', region: '서울시 은평구', emergencyContact: null, gender: '여성' }}
      consent={{ privacy: true, recordingAi: true }}
      sessionSequence={1}
      recorderLabel="이지은"
      briefingHref={`/participants/swallow-003/programs/${CASE_ID}/briefing`}
      participantHref="/participants/swallow-003"
      basicInfoHref="/participants/swallow-003/edit"
      overallGoal={null}
      overallGoalErrorHref={`/participants/swallow-003/programs/${CASE_ID}/briefing`}
      schedule={null}
      submit={noop as never}
    />,
  },
  {
    id: 'schedule-new',
    label: '상담 일정 등록 (2단계)',
    walk: async () => {
      const view = render(<ScheduleWizard
        candidates={scheduleCandidates}
        loadContext={(async () => ({
          status: 'loaded',
          caseGoals: [{ id: 'g1', title: '월세 체납 해소' }],
          lastBriefing: null,
        })) as never}
        submit={noop as never}
      />);
      fireEvent.click(view.getByRole('button', { name: /홍서희/ }));
      fireEvent.change(view.getByLabelText('상담 일시 날짜'), { target: { value: '2026-07-20' } });
      fireEvent.change(view.getByLabelText('상담 일시 시각'), { target: { value: '13:00' } });
      fireEvent.click(view.getByRole('button', { name: /다음: 이번 상담의 목표/ }));
      await waitFor(() => expect(view.getByLabelText('세부 목표 연결')).not.toBeNull());
      const html = view.container.innerHTML;
      cleanup();
      return html;
    },
  },
  {
    id: 'session-plan',
    label: '세션 목표 수정',
    node: <SessionPlanEditor
      scheduleId="s1"
      beneficiaryId="swallow-003"
      supportCaseId={CASE_ID}
      version={1}
      scheduledAtLabel="2026년 7월 20일 오후 2시"
      initialGoals={[{ body: '구직 상담', caseGoalId: 'g1' }]}
      goalOptions={[{ id: 'g1', title: '월세 체납 해소', closed: false }]}
      submit={noop as never}
    />,
  },
  {
    id: 'register',
    label: '당사자 등록',
    node: <RegisterForm currentUser={{ name: '이지은', email: 'staff@example.test' } as never} action={noop as never} />,
  },
];

// ---------------------------------------------------------------------------
// 하니스 조립
// ---------------------------------------------------------------------------

async function buildHarness(): Promise<{ html: string; markup: Map<string, string> }> {
  const tokens = readFileSync(join(repoRoot, 'design/tokens.css'), 'utf8');
  // 셸·레거시 화면 CSS 는 layout.tsx 의 템플릿 리터럴에 있다. 검사와 같은 추출기를 쓴다.
  const layoutCss = extractCss(join(repoRoot, 'apps/web/app/layout.tsx'));

  // 렌더 결과를 따로 들고 있는다. 조립된 HTML 을 문자열로 되잘라 길이를 재려다 한 번
  // 속았다 — 화면 안에 <section> 이 중첩돼 있어 첫 닫는 태그에서 잘렸고, 킷 페이지 480줄이
  // 1,403자로 보였다. 자체 검사는 조립 전 값을 봐야 한다.
  const markup = new Map<string, string>();
  for (const screen of SCREENS) {
    markup.set(screen.id, screen.walk ? await screen.walk() : renderToStaticMarkup(screen.node!));
  }

  const sections = SCREENS.map(({ id, label }) =>
    `<div class="harness-screen" data-screen="${id}" data-label="${label}">\n${markup.get(id)}\n</div>`,
  ).join('\n');

  // 하니스 자신의 스타일은 최소로 둔다. 잰 값이 하니스 탓인지 앱 탓인지 헷갈리면 안 되므로
  // 글자에 닿는 선언은 하나도 두지 않는다 — 배경만 준다.
  //
  // **폭과 패딩을 주지 않는다**(2026-08-10 정정). 처음엔 `max-width:1280px;padding:24px` 을
  // 뒀는데, 화면 뿌리인 `.wire-container` 가 이미 자기 상한(--page-max)과 좌우 패딩
  // (--page-pad-x)을 갖는다. 겹쳐 주면 이중 래핑이 되어 390 에서 가로 넘침이 났고(실측:
  // 요소 16개가 뷰포트 밖), 더 나쁜 것은 **글 폭이 실제보다 48px 좁아져 줄바꿈이 이르게**
  // 일어난다는 점이다 — 좁은 폭 실측(CCC-86)이 재려는 것이 바로 그 줄바꿈이라 전제가 흔들린다.
  // 화면이 자기 폭을 정하게 두는 것이 곧 실제와 같게 재는 길이다.
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>위계 하니스</title>
<style>${tokens}</style>
<style>${layoutCss}</style>
<style>${wireStyles}</style>
<style>.harness-screen{background:var(--canvas)}</style>
</head><body>${sections}</body></html>`;
  return { html, markup };
}

describe('위계 하니스 생성기', () => {
  it('화면 전부를 담은 정적 HTML 을 만든다', async () => {
    const { html, markup } = await buildHarness();

    // 화면 하나라도 빈 껍데기로 나오면 실측이 조용히 0건이 된다. 그 상태와 "위반 없음"이
    // 보고서에서 구별되지 않으므로 여기서 막는다.
    //
    // 문턱은 화면마다 정한다(minLines, 기본 5). 이 단언이 잡을 것은 "덜 렌더된 화면"이지
    // "작은 화면"이 아니다. 처음엔 전역 10 이었다가 세션 목표 수정 화면이 걸려 5 로 내렸고,
    // 로딩 화면(정말로 두 줄)이 들어오면서 화면별로 갈랐다 — 전역을 2 로 내리면 200줄짜리
    // 상담 기록이 3줄로 나와도 통과한다. 실제 줄 수는 screens.json 에 그대로 적어 둔다.
    const counts = new Map<string, number>();
    for (const { id, minLines = 5 } of SCREENS) {
      const body = markup.get(id) ?? '';
      const textNodes = body.match(/>[^<>\s][^<>]*</g) ?? [];
      counts.set(id, textNodes.length);
      expect(textNodes.length, `${id} 화면이 덜 렌더됐다`).toBeGreaterThanOrEqual(minLines);
    }
    // 통제군 — 킷의 '고치기 전' 반례가 하니스에 들어와야 실측이 자기 검증을 할 수 있다.
    expect(markup.get('kit')).toContain('wire-kit-flat');
    expect(html).toContain('--text-md');

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'harness.html'), html);
    writeFileSync(
      join(OUT_DIR, 'screens.json'),
      `${JSON.stringify(
        SCREENS.map(({ id, label }) => ({ id, label, textLines: counts.get(id) ?? 0 })),
        null,
        2,
      )}\n`,
    );
  });
});
