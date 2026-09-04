'use client';

import type { ReactNode } from 'react';
import { STEP_NAV_TITLES, STEP_TITLES } from './intake-questions';

export type IntakeStepState = 'current' | 'done' | 'waiting' | 'missing';

export interface IntakeStepRailItem {
  countLabel: string;
  ariaCount: string;
  state: IntakeStepState;
}

export interface IntakeStepRailProps {
  currentStep: number;
  items: readonly IntakeStepRailItem[];
  onSelect: (step: number) => void;
  headerAccessory?: ReactNode;
  footer?: ReactNode;
}

export function IntakeStepRail({ currentStep, items, onSelect, headerAccessory, footer }: IntakeStepRailProps) {
  return (
    <nav className="intake-step-nav" aria-label="인테이크 단계" data-testid="intake-step-rail">
      <div className="intake-step-nav-head">
        <h2 className="wire-card-title">인테이크 4단계</h2>
        {headerAccessory}
      </div>
      {STEP_TITLES.map((title, index) => {
        const number = index + 1;
        const item = items[index]!;
        return (
          <button
            key={title}
            type="button"
            className="intake-step"
            aria-label={`${number}. ${title}, ${item.ariaCount}`}
            aria-current={currentStep === number ? 'step' : undefined}
            data-step-state={item.state}
            onClick={() => onSelect(number)}
          >
            <span className="intake-step-index" aria-hidden="true">{number}.</span>
            <span className="intake-step-label" aria-hidden="true">{STEP_NAV_TITLES[index]}</span>
            <span className="intake-step-count" aria-hidden="true">{item.countLabel}</span>
          </button>
        );
      })}
      {footer}
    </nav>
  );
}
