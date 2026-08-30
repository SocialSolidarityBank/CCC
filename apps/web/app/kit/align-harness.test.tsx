import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractCss } from '../../../../scripts/design/hierarchy-audit.mjs';
import { wireStyles } from '../components/wire/wire-styles';
import { BriefingCards, type BriefingCardsProps } from '../participants/[beneficiaryId]/programs/[supportCaseId]/briefing/briefing-cards';
import { PROGRAM_LABELS } from '../lib/labels';

// 정렬 실측 하니스 (2026-08-30 Q — align-check 스킬 계약을 레포 게이트로).
//
// 위계 하니스(hierarchy-harness.test.tsx)와 같은 원칙이다: **실제 부품으로** 렌더한 정적
// HTML 을 만들고, 브라우저 실측(scripts/design/align-check.py)이 그 파일을 잰다. 마크업을
// 손으로 옮겨 적으면 부품이 바뀌어도 옛 모양을 재고 초록불이 거짓이 된다.
//
// 위계 하니스와 따로 두는 이유: 재는 물음이 다르다. 그쪽은 이웃 줄의 옷과 기하 결함이고,
// 이쪽은 **선언된 정렬 단언**(scripts/design/align-assertions.json — 중심 공유·여백 대칭·
// 불릿 중앙)이다. fixture 도 다르다 — 전체 목표 미설정(overallGoal: null)이어야 AI 제안
// 안내 행이 서고, 제안이 비어야(aiSuggestions: []) 가로선 아래 빈 상태 줄이 선다.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT_DIR = join(repoRoot, 'artifacts/align-harness');

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const props: BriefingCardsProps = {
  beneficiaryId: 'swallow-003',
  supportCaseId: CASE_ID,
  // 전체 목표 미설정 — AI 제안 라벨 행의 안내 문구(AiGoalHint)가 첫 렌더부터 선다.
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
  // 제안 없음 — 안내 행 가로선 아래에 빈 상태 한 줄이 서야 gap-y 단언이 성립한다.
  aiSuggestions: [],
  openActionItems: [],
  flags: [],
  upcomingSchedule: null,
};

describe('정렬 하니스 생성기', () => {
  it('안내 행·가로선·불릿이 선 15초 페이지 정적 HTML 을 만든다', () => {
    const markup = renderToStaticMarkup(<BriefingCards {...props} />);

    // 단언 대상이 실제로 렌더에 서야 실측이 성립한다. 빈 껍데기면 실측이 "요소 없음"으로
    // 늦게 죽는 대신 여기서 원인(어느 fixture 가 비었나)을 말하며 막는다.
    expect(markup, 'AI 제안 안내 행이 정적 렌더에 없다').toContain('briefing-ai-goal-hint');
    expect(markup, '세부 목표 불릿 목록이 정적 렌더에 없다').toContain('briefing-subgoal-rows wire-bullets');
    expect(markup, 'AI 제안 빈 상태 줄이 정적 렌더에 없다').toContain('승인된 상담 기록이 쌓이면');

    const tokens = readFileSync(join(repoRoot, 'design/tokens.css'), 'utf8');
    const layoutCss = extractCss(join(repoRoot, 'apps/web/app/layout.tsx'));
    const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>정렬 하니스</title>
<style>${tokens}</style>
<style>${layoutCss}</style>
<style>${wireStyles}</style>
<style>body{background:var(--canvas)}</style>
</head><body>${markup}</body></html>`;

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, 'align.html'), html);
    expect(html).toContain('--text-sm');
  });
});
