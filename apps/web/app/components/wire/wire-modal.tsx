'use client';

import { useEffect, useId, type ReactNode } from 'react';

/**
 * 모달 부품 (CCC-83 · §5) — 폭 520 · radius 12 · 스크림 --scrim · --shadow-modal.
 * 닫기 2종: Esc(키보드)와 스크림 클릭. 하단 행동은 .wire-modal-actions(오른쪽 정렬)를 쓴다.
 * 이전에는 킷 데모에만 마크업이 있어 손 조립 복사가 벌어질 자리였다.
 */
export function WireModal({
  open,
  onClose,
  title,
  description,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** 하단 버튼 줄(오른쪽 정렬). 없으면 그리지 않는다. */
  actions?: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="wire-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
        className="wire-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="wire-modal-title" id={titleId}>{title}</h2>
        {description !== undefined && <p className="wire-modal-desc" id={descriptionId}>{description}</p>}
        <div className="wire-modal-body">{children}</div>
        {actions !== undefined && <div className="wire-modal-actions">{actions}</div>}
      </div>
    </div>
  );
}