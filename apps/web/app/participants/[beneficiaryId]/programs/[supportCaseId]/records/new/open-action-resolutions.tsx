'use client';

import { WireBadge } from '../../../../../../components/wire/wire-badge';
import { TimeAxisBadge } from '../../../../../../components/wire/time-axis-badge';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { WireChoice, WireFormField } from '../../../../../../components/wire/wire-form-field';
import { WireEmpty } from '../../../../../../components/wire/wire-state';

export interface OpenActionResolutionItem {
  id: string;
  description: string;
  owner: 'counselor' | 'beneficiary' | 'org';
  dueDate: string | null;
}

const resolutionStatuses = [
  ['done', '완료'],
  ['in_progress', '진행 중'],
  ['not_done', '못 함'],
  ['hold', '보류'],
] as const;

const ownerLabels: Record<OpenActionResolutionItem['owner'], string> = {
  counselor: '실무자',
  beneficiary: '당사자',
  org: '기관',
};

/**
 * onResolutionChange(CCC-10): 상위 원페이지 화면이 "미해결 액션 처리" 채움 여부를 세기 위한
 * 선택 콜백. 빈 문자열은 '미처리'다. 폼 필드 이름·구조는 그대로다.
 */
export function OpenActionResolutions({
  actions,
  onResolutionChange,
}: {
  actions: OpenActionResolutionItem[];
  onResolutionChange?: (actionItemId: string, status: string) => void;
}) {
  if (actions.length === 0) {
    return <WireEmpty>처리할 미해결 액션이 없습니다. 이 항목은 건너뜁니다.</WireEmpty>;
  }
  // 액션 하나가 카드 하나다(2026-08-09 Q "액션은 카드화로 처리"). 구 구조는 fieldset 목록이라
  // 액션 셋이 이어지면 legend·보기 줄·메모가 12줄로 쌓여 어디까지가 한 액션인지 흐렸다.
  //
  // 담당·기한은 legend 안 괄호에서 **제 줄로 내렸다**(Q "당사자|기한 2026-06-10 부분은 행
  // 나눠서 잘 보이게"): 내용은 16/600 으로 위, 담당·기한은 배지 둘로 아래다. 배지 계열은
  // §5 계약을 그대로 따른다 — 담당 = 민트(사람·소속 축), 기한 = 블루(일정·시간 축).
  //
  // 상태 5종은 2열 그리드가 아니라 한 줄에 흐르는 선택지 행이다 — 2열에 넣으면
  // '완료'·'못 함' 같은 두세 글자가 화면 절반씩 차지한다(DESIGN.md §5 '선택지 행').
  return <div className="card-grid">{actions.map((action) => (
    <WireCard
      key={action.id}
      className="wire-form-card open-action-card"
      title={<>
        <p className="open-action-title">{action.description}</p>
        <p className="open-action-meta">
          <WireBadge tone="mint">{ownerLabels[action.owner]}</WireBadge>
          {action.dueDate === null ? null : <TimeAxisBadge>기한 {action.dueDate}</TimeAxisBadge>}
        </p>
      </>}
    >
      <input type="hidden" name="openActionItemId" value={action.id} />
      <fieldset className="wire-fieldset">
        <legend>처리 상태</legend>
        <div className="wire-choice-group">
          <WireChoice
            label="미처리"
            type="radio"
            name={`resolutionStatus_${action.id}`}
            value=""
            defaultChecked
            onChange={() => onResolutionChange?.(action.id, '')}
          />
          {resolutionStatuses.map(([value, label]) => <WireChoice
            key={value}
            label={label}
            type="radio"
            name={`resolutionStatus_${action.id}`}
            value={value}
            onChange={() => onResolutionChange?.(action.id, value)}
          />)}
        </div>
      </fieldset>
      {/* '처리 메모' → '메모'(2026-08-09 Q). 이 카드가 이미 처리 칸이라 '처리'가 겹쳤다. */}
      <WireFormField label="메모" note="(선택)" htmlFor={`resolutionNote_${action.id}`}>
        <input id={`resolutionNote_${action.id}`} name={`resolutionNote_${action.id}`} type="text" maxLength={200} />
      </WireFormField>
    </WireCard>
  ))}</div>;
}
