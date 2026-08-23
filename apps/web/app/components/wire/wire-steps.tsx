/**
 * 단계 표시 부품 (CCC-81 · daisyUI Steps 계열) — 위저드의 진행 위치를 읽는 나열.
 *
 * 규칙:
 *   - 진행 상태는 계열 의미상 블루(시간·상태·진행)이고, 현재 단계는 채움 면, 완료 단계는
 *     블루 tint 면, 대기 단계는 무채색이다(D34 §1-5. 리스크 레드는 D9 전용).
 *   - 항목은 사각 마디 + 라벨이고, 마디 사이를 `--line` 이 잇는다.
 *   - aria-current="step" 으로 현재 단계를 알린다.
 */
export interface WireStepItem {
  label: string;
}

export function WireSteps({
  steps,
  current,
  className,
}: {
  steps: readonly WireStepItem[];
  /** 1부터 시작하는 현재 단계 번호. */
  current: number;
  className?: string;
}) {
  return (
    <ol className={className === undefined ? 'wire-steps' : `wire-steps ${className}`} aria-label="진행 단계">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const state = stepNumber === current ? 'current' : stepNumber < current ? 'done' : 'upcoming';
        return (
          <li key={step.label} className={`wire-step wire-step-${state}`} aria-current={stepNumber === current ? 'step' : undefined}>
            <span className="wire-step-marker">{stepNumber}</span>
            <span className="wire-step-label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}