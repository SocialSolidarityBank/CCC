'use client';

import { useState } from 'react';
import { WireFormField } from '../../../../../../components/wire/wire-form-field';

const owners = [
  ['counselor', '실무자'],
  ['beneficiary', '당사자'],
  ['org', '기관'],
] as const;

export function ActionItemFields({ index }: { index: number }) {
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const descriptionId = `action-description-${index}`;
  const errorId = `action-description-error-${index}`;
  const requiresDescription = dueDate.length > 0;
  const showError = requiresDescription && description.trim().length === 0;

  return <fieldset className="wire-fieldset">
    <legend>액션 아이템 {index + 1}</legend>
    {/* 오류는 WireFormField 의 error 가 아니라 여기서 낸다 — aria-describedby 로 이미 컨트롤에
        묶여 있어, 부품이 한 번 더 그리면 스크린 리더가 같은 문장을 두 번 읽는다. */}
    <WireFormField label="할 일" htmlFor={descriptionId} invalid={showError}>
      <input
        aria-describedby={showError ? errorId : undefined}
        aria-invalid={showError}
        id={descriptionId}
        name={`actionDescription${index}`}
        onChange={(event) => setDescription(event.currentTarget.value)}
        required={requiresDescription}
        value={description}
      />
    </WireFormField>
    {showError ? <p className="wire-field-error" id={errorId} role="alert">기한을 지정하려면 액션 아이템 내용을 입력하세요.</p> : null}
    <div className="wire-form-grid">
      <WireFormField label="담당" control="select" htmlFor={`action-owner-${index}`}>
        <select id={`action-owner-${index}`} name={`actionOwner${index}`} defaultValue="counselor">
          {owners.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </WireFormField>
      <WireFormField label="기한" note="(선택)" htmlFor={`action-due-date-${index}`}>
        <input
          id={`action-due-date-${index}`}
          name={`actionDueDate${index}`}
          onChange={(event) => setDueDate(event.currentTarget.value)}
          type="date"
          value={dueDate}
        />
      </WireFormField>
    </div>
  </fieldset>;
}
