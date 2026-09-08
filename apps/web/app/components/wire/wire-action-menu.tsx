'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { DisclosureChevron } from './chevron';

export function WireActionMenu({ items, triggerRef }: { items: readonly { label: string; onSelect: () => void }[]; triggerRef?: RefObject<HTMLButtonElement | null> }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const ownTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? ownTrigger;
  const menu = useRef<HTMLDivElement>(null);
  const initialIndex = useRef(0);
  useEffect(() => {
    if (!open) return;
    const buttons = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    buttons?.[initialIndex.current]?.focus();
    const outside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('click', outside);
    return () => document.removeEventListener('click', outside);
  }, [open, trigger]);
  if (items.length === 0) return null;
  return <div className="wire-action-menu" ref={root}>
    <button ref={trigger} type="button" className="wire-button" data-variant="neutral" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialIndex.current = 0; setOpen(!open); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); initialIndex.current = event.key === 'ArrowUp' ? items.length - 1 : 0; setOpen(true);
        }
      }}>더 보기 <DisclosureChevron variant="plain" /></button>
    {open && <div id={id} role="menu" aria-label="더 보기" className="wire-action-menu-panel" ref={menu}
      onKeyDown={(event) => {
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const index = buttons.findIndex((button) => button === document.activeElement);
        if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
        else if (event.key === 'Tab') { setOpen(false); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }
      }}>
      {items.map((item) => <button type="button" role="menuitem" tabIndex={-1} key={item.label} className="wire-button" data-variant="neutral" onClick={() => {
        setOpen(false); trigger.current?.focus(); item.onSelect();
      }}>{item.label}</button>)}
    </div>}
  </div>;
}
