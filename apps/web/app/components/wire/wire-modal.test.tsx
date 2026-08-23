import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { WireModal } from './wire-modal';

afterEach(cleanup);

describe('WireModal (CCC-83)', () => {
  it('열려 있을 때만 렌더하고, Esc·스크림 클릭으로 닫는다', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(
      <WireModal open title="동의를 철회하시겠어요" onClose={onClose}>
        철회하면 지원이 중단될 수 있습니다.
      </WireModal>,
    );
    const dialog = container.querySelector('[role="dialog"][aria-modal="true"].wire-modal');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('.wire-modal-title')?.textContent).toContain('동의를 철회');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.querySelector('.wire-scrim')!);
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(<WireModal open={false} title="닫힘" onClose={onClose}>본문</WireModal>);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('모달 안 클릭은 닫힘으로 전파되지 않는다', () => {
    const onClose = vi.fn();
    const { container } = render(<WireModal open title="T" onClose={onClose}>본문</WireModal>);
    fireEvent.click(container.querySelector('.wire-modal')!);
    expect(onClose).not.toHaveBeenCalled();
  });
});