'use client';

import type { CSSProperties } from 'react';
import { draftRetentionLabel } from '../../lib/form-draft';

// 로컬 임시본(CCC-12)의 화면 2종. 인테이크 위저드와 정기 기록지가 같은 것을 쓴다.
// 새 색을 만들지 않는다 — 자동 저장은 시간·상태 축이라 블루 계열이다(D34 · DESIGN.md §1-5).

const noticeStyle: CSSProperties = {
  display: 'grid', gap: 12, padding: 16,
  background: 'var(--blue-tint)', border: '1px solid var(--line)',
  borderRadius: 'var(--radius-card)',
};

// 배너 면만 블루 tint 로 두고 글자는 --ink 다. --blue-deep 은 tint 위 2.11 이라 제목에 쓰면
// DESIGN.md §9 의 접근성 예외가 하나 늘어난다 — 새 예외를 만들지 않는다.
const titleStyle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink)' };
const bodyStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--sub)' };
const actionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };
const statusStyle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--sub)' };

const buttonStyle: CSSProperties = {
  minHeight: 32, padding: '0 14px', borderRadius: 'var(--radius-control)',
  border: '1px solid var(--line-control)', background: 'var(--panel)',
  color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
};

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
    <section style={noticeStyle} role="status" data-testid="draft-restore-prompt" aria-labelledby="draft-restore-title">
      <p id="draft-restore-title" style={titleStyle}>
        {uncertain ? '저장 여부를 확인하지 못한 기록이 있습니다' : '작성하던 기록이 있습니다'}
      </p>
      <p style={bodyStyle}>
        {uncertain
          ? `${clockLabel(savedAt)}에 저장을 시도한 내용이 이 브라우저에 남아 있습니다. 기록이 이미 저장됐다면 새로 시작하고, 저장되지 않았다면 이어서 쓰세요.`
          : `이 브라우저에 ${clockLabel(savedAt)}까지 입력한 내용이 남아 있습니다. 이어서 쓰거나 새로 시작할 수 있습니다.`}
      </p>
      <div style={actionsStyle}>
        {/* 파스텔은 면·테두리로만 쓴다 — --blue-deep 을 흰 위 글자로 쓰면 2.47 이라 §9 예외가 하나 늘어난다. */}
        <button type="button" onClick={onResume} style={{ ...buttonStyle, border: '1.5px solid var(--blue)' }}>
          이어쓰기
        </button>
        <button type="button" onClick={onDiscard} style={buttonStyle}>새로 시작</button>
      </div>
    </section>
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
  return <p style={statusStyle} role="status" aria-live="polite" data-testid="draft-status">{text}</p>;
}

/** 임시본을 어디에 얼마나 두는지 입력칸 옆에서 밝힌다. 화면 문구와 보관 규율을 한 곳에서 맞춘다. */
export function DraftRetentionNote() {
  return (
    <>작성 중 내용은 이 브라우저에만 {draftRetentionLabel()} 임시 보관하며, 서버 저장에 성공하면 지웁니다.</>
  );
}
