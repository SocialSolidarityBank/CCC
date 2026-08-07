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
    // 머리 줄은 가로선 없는 한 줄이다(2026-08-08 Q — 구 .wire-fieldset 의 border-top 위에
    // legend 가 걸터앉아 '경제·생계' 글줄이 선과 어긋나 보였다). 영역 이름과 직전 상태
    // 배지를 flex 로 갈라 세로 중앙에 나란히 세운다. 영역 사이는 격자 gap 이 띄운다.
    return <fieldset className="wire-fieldset life-area-fieldset" key={areaKey}>
      <legend className="life-area-legend">
        <span className="life-area-name">{label}</span>
        <span className="life-area-prior">직전 상태</span>
        {prior === undefined
          ? <span className="wire-badge">미기록</span>
          : <span className="wire-badge" data-tone={prior.status === 'crisis' ? 'risk' : undefined}>{statusLabels[prior.status]}</span>}
      </legend>
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
