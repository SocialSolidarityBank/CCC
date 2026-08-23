'use client';

import { WireBadge } from '../../../../../../components/wire/wire-badge';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { WireFormField } from '../../../../../../components/wire/wire-form-field';
import type { LifeAreaKey, LifeAreaSnapshotEntry } from '../../../../../../lib/api';
import { lifeAreaOrder, lifeAreaStatusLabels, lifeAreaStatusOptions } from '../../../../../../lib/life-area-labels';

const statusOptions = lifeAreaStatusOptions;

const statusLabels = lifeAreaStatusLabels;

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
  // 2026-08-09 Q "6영역 섹션 타이틀의 폰트 크기가 애매하다": 원인은 크기가 아니라 **단이
  // 하나 더 필요했던 것**이다. 구 구조는 카드(생활 6영역 변화 확인) 안에 fieldset 이 있고
  // 그 안에 입력 라벨이 있어 세 단이 필요했는데, 영역 이름 14/600 --ink 와 입력 라벨
  // 14/600 --sub 가 색만 다른 같은 값이라 위계가 서지 않았다.
  //
  // §2-2 규칙 3 은 카드 안 위계를 4단으로 닫고 "다섯 번째 단을 만들지 않는다"고 정한다.
  // 그래서 **영역 하나가 카드 하나**가 된다 — 영역 이름은 카드 제목(16/600 --ink), 안의
  // 입력 라벨은 구획 라벨(14/600 --sub)로 제자리를 찾는다. 미해결 액션 카드화와 같은 결론이고,
  // 손 fieldset 머리 줄(legend float 보정 포함)이 함께 사라진다.
  return <div className="card-grid">{lifeAreaOrder.map(([areaKey, label]) => {
    const prior = priorByArea.get(areaKey);
    return <WireCard
      key={areaKey}
      className="wire-form-card life-area-card"
      title={<>
        <p className="life-area-name">{label}</p>
        <p className="life-area-prior">
          <span className="life-area-prior-label">직전 상태</span>
          {/* '미기록'은 아직 값이 오지 않은 **대기** 상태다 — 라벤더가 그 축이다(§5 계열 의미,
              2026-08-09 Q "미기록 뱃지는 컬러가 들어가야지 않을까"). 구 무채색 배지는 옆
              계열 배지들 사이에서 "값이 없다"가 아니라 "덜 중요하다"로 읽혔다. */}
          {prior === undefined
            ? <WireBadge tone="lavender">미기록</WireBadge>
            : <WireBadge tone={prior.status === 'crisis' ? 'risk' : 'mint'}>{statusLabels[prior.status]}</WireBadge>}
        </p>
      </>}
    >
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
    </WireCard>;
  })}</div>;
}

export const LIFE_AREA_ORDER = lifeAreaOrder;
