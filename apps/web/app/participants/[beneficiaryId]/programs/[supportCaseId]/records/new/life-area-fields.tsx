'use client';

import { WireFormField } from '../../../../../../components/wire/wire-form-field';
import type { LifeAreaKey, LifeAreaSnapshotEntry, LifeAreaStatus } from '../../../../../../lib/api';

// 6영역 표시 순서·라벨(CCC-8). 근거: docs/intake/CCC-intake-required-vs-optional-questions.md §D.
const lifeAreaOrder: ReadonlyArray<readonly [LifeAreaKey, string]> = [
  ['economy', '경제·생계'],
  ['housing', '주거'],
  ['employment', '일·고용·학업'],
  ['health', '건강'],
  ['mental_health', '심리·정서'],
  ['family', '가족·관계·돌봄'],
];

const statusOptions: ReadonlyArray<readonly [LifeAreaStatus, string]> = [
  ['okay', '괜찮음'],
  ['strained', '긴장'],
  ['crisis', '위기'],
  ['not_applicable', '해당없음'],
  ['declined', '답변거부'],
];

const statusLabels: Record<LifeAreaStatus, string> = {
  okay: '괜찮음',
  strained: '긴장',
  crisis: '위기',
  not_applicable: '해당없음',
  declined: '답변거부',
};

/**
 * onStatusChange(CCC-10): 상위 원페이지 화면이 '위기' 선택을 알아채 위기·안전 아코디언을
 * 자동으로 펼치기 위한 선택 콜백. 폼 필드 이름·구조는 그대로다.
 */
export function LifeAreaFields({
  latest,
  onStatusChange,
}: {
  latest: LifeAreaSnapshotEntry[];
  onStatusChange?: (areaKey: LifeAreaKey, status: string) => void;
}) {
  const priorByArea = new Map(latest.map((entry) => [entry.areaKey, entry] as const));
  return <div className="wire-form-grid">{lifeAreaOrder.map(([areaKey, label]) => {
    const prior = priorByArea.get(areaKey);
    return <fieldset className="wire-fieldset" key={areaKey}>
      <legend>{label} <small>직전 상태: {prior === undefined
        ? <span className="status">미기록</span>
        : <span className={prior.status === 'crisis' ? 'status risk' : 'status'}>{statusLabels[prior.status]}</span>}</small></legend>
      <WireFormField
        label="이번 회차 상태"
        note="(기본: 변화 없음)"
        control="select"
        htmlFor={`lifeAreaStatus_${areaKey}`}
      >
        <select
          id={`lifeAreaStatus_${areaKey}`}
          name={`lifeAreaStatus_${areaKey}`}
          defaultValue=""
          onChange={(event) => onStatusChange?.(areaKey, event.currentTarget.value)}
        >
          <option value="">변화 없음</option>
          {statusOptions.map(([value, statusLabel]) => <option key={value} value={value}>{statusLabel}</option>)}
        </select>
      </WireFormField>
      <WireFormField label="한 줄 메모" note="(선택)" htmlFor={`lifeAreaNote_${areaKey}`}>
        <input id={`lifeAreaNote_${areaKey}`} name={`lifeAreaNote_${areaKey}`} type="text" maxLength={200} />
      </WireFormField>
    </fieldset>;
  })}</div>;
}

export const LIFE_AREA_ORDER = lifeAreaOrder;
