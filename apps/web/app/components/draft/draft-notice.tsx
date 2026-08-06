'use client';

import { WireButton } from '../wire/wire-button';
import { WireCallout } from '../wire/wire-callout';
import { draftRetentionLabel } from '../../lib/form-draft';

// 로컬 임시본(CCC-12)의 화면 2종. 인테이크 위저드와 정기 기록지가 같은 것을 쓴다.
// 안내줄은 카드다(D59 ② · 2026-08-05 컴포넌트화 — 구 인라인 스타일 손 카드 대체).
// 새 색을 만들지 않는다 — 자동 저장은 시간·상태 축이라 블루 tint(WireCallout tone="info")다
// (D34 · DESIGN.md §1-5). 버튼도 킷(WireButton)으로 통일했다.

function clockLabel(savedAt: number): string {
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(savedAt));
}

/**
 * 작성하던 임시본이 있을 때만 뜬다. 실무자가 고르기 전에는 아무것도 덮어쓰지 않는다.
 *
 * uncertain — 제출까지 갔는데 저장 여부를 화면이 확인하지 못한 임시본이다. 대개는 저장에
 * 성공한 뒤라 '새로 시작'이 맞지만, 서버 장애로 저장이 안 됐을 수도 있어 지우지 않고 묻는다.
 */
export function DraftRestorePrompt({
  savedAt,
  uncertain = false,
  onResume,
  onDiscard,
}: {
  savedAt: number;
  uncertain?: boolean;
  onResume: () => void;
  onDiscard: () => void;
}) {
  return (
    <WireCallout tone="info" role="status" testId="draft-restore-prompt" labelledBy="draft-restore-title" titleId="draft-restore-title"
      title={uncertain ? '저장 여부를 확인하지 못한 기록이 있습니다' : '작성하던 기록이 있습니다'}
      actions={
        /* 이어쓰기가 우선 행동이라 세컨더리(그라데이션 아웃라인), 새로 시작은 고스트다.
           프라이머리는 화면 주 행동(HERO·폼 제출) 몫이라 안내줄에서는 쓰지 않는다(§4-5). */
        <>
          <WireButton variant="secondary" height="sm" onClick={onResume}>이어쓰기</WireButton>
          <WireButton variant="ghost" height="sm" onClick={onDiscard}>새로 시작</WireButton>
        </>
      }>
      {uncertain
        ? `${clockLabel(savedAt)}에 저장을 시도한 내용이 이 브라우저에 남아 있습니다. 기록이 이미 저장됐다면 새로 시작하고, 저장되지 않았다면 이어서 쓰세요.`
        : `이 브라우저에 ${clockLabel(savedAt)}까지 입력한 내용이 남아 있습니다. 이어서 쓰거나 새로 시작할 수 있습니다.`}
    </WireCallout>
  );
}

/**
 * 자동 저장 상태는 상시 표시한다 — 별도 임시 저장 버튼이 없으므로, 이 표시가 없으면
 * 실무자는 저장되고 있는지 알 방법이 없다.
 */
export function DraftStatus({ savedAt, available }: { savedAt: number | null; available: boolean }) {
  const text = !available
    ? '이 브라우저에는 자동 저장할 수 없습니다'
    : savedAt === null
      ? '자동 저장 대기'
      : `자동 저장됨 ${clockLabel(savedAt)}`;
  return <p className="notice-status" role="status" aria-live="polite" data-testid="draft-status">{text}</p>;
}

/** 임시본을 어디에 얼마나 두는지 입력칸 옆에서 밝힌다. 화면 문구와 보관 규율을 한 곳에서 맞춘다. */
export function DraftRetentionNote() {
  return (
    <>작성 중 내용은 이 브라우저에만 {draftRetentionLabel()} 임시 보관하며, 서버 저장에 성공하면 지웁니다.</>
  );
}
