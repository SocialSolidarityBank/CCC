'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { observeRadioLayout } from './wire-radio-layout';

/** Layout only: names, labels, selection and keyboard behavior belong to native radios. */
export function WireRadioGroup({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) return observeRadioLayout(ref.current);
  }, []);
  return <div ref={ref} className="wire-choice-group" data-radio-layout="">{children}</div>;
}
