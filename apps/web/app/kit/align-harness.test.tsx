import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractCss } from '../../../../scripts/design/hierarchy-audit.mjs';
import { wireStyles } from '../components/wire/wire-styles';
import { BriefingCards, type BriefingCardsProps } from '../participants/[beneficiaryId]/programs/[supportCaseId]/briefing/briefing-cards';
import { RegisterForm } from '../participants/new/register-form';
import { PROGRAM_LABELS } from '../lib/labels';

// 정렬 실측 하니스 (2026-08-30 Q — align-check 스킬 계약을 레포 게이트로).
//
// 위계 하니스(hierarchy-harness.test.tsx)와 같은 원칙이다: **실제 부품으로** 렌더한 정적
// HTML 을 만들고, 브라우저 실측(scripts/design/align-check.py)이 그 파일을 잰다. 마크업을
// 손으로 옮겨 적으면 부품이 바뀌어도 옛 모양을 재고 초록불이 거짓이 된다.
//
// 위계 하니스와 따로 두는 이유: 재는 물음이 다르다. 그쪽은 이웃 줄의 옷과 기하 결함이고,
// 이쪽은 **선언된 정렬 단언**(scripts/design/align-assertions.json — 중심 공유·여백 대칭·
// 항목 리듬·불릿 중앙)이다.
//
// **변형 둘을 함께 낸다**(2026-08-30 Q 3차). AI 제안 구획의 가로선은 위·아래 여백이 서로
// 같기만 해서는 부족하고 **제안 목록의 항목 리듬과도 같아야** 한다 — 그 어긋남은 제안이
// 생성된 상태에서만 보인다. 그래서 `#align-empty`(제안 없음)와 `#align-content`(제안 2건)를
// 한 페이지에 나란히 렌더한다. 두 변형은 같은 부품이라 카드 id 가 겹치는데, 단언 셀렉터가
// 래퍼 id 로 범위를 좁히므로 실측에는 영향이 없다(이 파일은 배포물이 아니라 측정 산출물이다).

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT_DIR = join(repoRoot, 'artifacts/align-harness');

const CASE_ID = '11111111-1111-4111-8111-111111111111';

// 전체 목표 미설정(overallGoal: null) — AI 제안 라벨 행의 안내 문구(AiGoalHint)가 첫 렌더부터
// 서고, 그 행이 아래 가로선을 갖는다. 세부 목표 2개는 불릿 목록이 서는 조건이다.
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
    { sessionId: 's-2', heldAt: '2026-07-15T05:00:00Z', kind: 'regular', aiOneLiner: null, memoExcerpt: '구직 활동 근황과 지출 정리를 확인했다' },
    { sessionId: 's-1', heldAt: '2026-07-01T05:00:00Z', kind: 'intake', aiOneLiner: null, memoExcerpt: '채무 현황과 정서적 어려움 확인' },
  ],
  discrepancies: [],
  pendingApprovalCount: 0,
  pendingReviewSessionIds: [],
  aiSuggestions: [],
  openActionItems: [],
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
  it('브리핑 두 변형 + 등록 동의 상자 접힘·펼침의 정적 HTML 을 만든다', () => {
    const empty = renderToStaticMarkup(<BriefingCards {...baseProps} />);
    const content = renderToStaticMarkup(<BriefingCards {...contentProps} />);
    const register = renderToStaticMarkup(
      <RegisterForm
        currentUser={{ name: '홍길동', email: 'worker@example.test' }}
        action={() => {}}
        programLabel={PROGRAM_LABELS.financial_support_v1}
      />,
    );
    // 펼친 상태는 **생성된 마크업에 open 속성만 얹어** 만든다 — 마크업을 손으로 옮겨 적으면
    // 부품이 바뀌어도 옛 모양을 재게 된다(위계 하니스와 같은 이유). 여는 방법은 이 한 줄뿐이다:
    // details 는 서버 렌더에서 열 수 있는 프롭이 RegisterForm 에 없고, 실측 대상은 열린 상자다.
    const registerOpen = register.replace('<details class="consent-detail', '<details open class="consent-detail');

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

    const tokens = readFileSync(join(repoRoot, 'design/tokens.css'), 'utf8');
    const layoutCss = extractCss(join(repoRoot, 'apps/web/app/layout.tsx'));
    const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>정렬 하니스</title>
<style>${tokens}</style>
<style>${layoutCss}</style>
<style>${wireStyles}</style>
<style>body{background:var(--canvas)}</style>
</head><body>
<div id="align-empty">${empty}</div>
<div id="align-content">${content}</div>
<div id="align-register">${register}</div>
<div id="align-register-open">${registerOpen}</div>
</body></html>`;

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'align.html'), html);
    expect(html).toContain('--text-sm');
  });
});
