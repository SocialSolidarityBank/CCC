'use client';

import { MetaRow } from '../../../../../../components/wire/meta-row';
import { WireChoice, WireFormField } from '../../../../../../components/wire/wire-form-field';

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
    return <p className="empty"><span>처리할 미해결 액션이 없습니다. 이 항목은 건너뜁니다.</span></p>;
  }
  // 상태 5종은 2열 그리드가 아니라 한 줄에 흐르는 선택지 행이다 — 2열에 넣으면
  // '완료'·'못 함' 같은 두세 글자가 화면 절반씩 차지한다(DESIGN.md §5 '선택지 행').
  return <div className="wire-fieldset-list">{actions.map((action) => <fieldset key={action.id} className="wire-fieldset">
    <input type="hidden" name="openActionItemId" value={action.id} />
    <legend>{action.description} <small>(<MetaRow items={[ownerLabels[action.owner], action.dueDate === null ? null : `기한 ${action.dueDate}`]} />)</small></legend>
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
    <WireFormField label="처리 메모" note="(선택)" htmlFor={`resolutionNote_${action.id}`}>
      <input id={`resolutionNote_${action.id}`} name={`resolutionNote_${action.id}`} type="text" maxLength={200} />
    </WireFormField>
  </fieldset>)}</div>;
}
