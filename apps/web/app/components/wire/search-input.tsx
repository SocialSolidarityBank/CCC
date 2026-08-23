'use client';

import { useId, type ReactNode } from 'react';
import { Chevron } from './chevron';
import { DATE_TEXT_HINT, DateTextInput } from './date-text-input';

export interface SearchSelectOption {
  value: string;
  label: string;
}

export interface SearchInputProps {
  /**
   * 상단 라벨(14/700 --sub). 문자열이 기본이지만 조각도 받는다 — 필수 별표(`wire-form-required`)
   * 처럼 라벨 안에서 색이 달라지는 부분이 있으면 문자열로는 표현할 수 없다(Y8).
   */
  label: ReactNode;
  /** text = 입력 박스(기본), select = 우측 체브론이 붙는 셀렉트. */
  variant?: 'text' | 'select';
  /**
   * text 변형의 input type. 생년월일 같은 날짜 칸에 'date' 를 준다(기본 'text').
   *
   * 'date' 는 **네이티브 날짜 칸이 아니다** — `DateTextInput`(글자 입력 + 자동 하이픈)으로
   * 그린다. 네이티브는 표기가 보는 사람의 브라우저 언어를 따라 팀원마다 달라진다(R6).
   * 이때 `placeholder` 는 무시되고 KRDS 도움말이 자동으로 붙는다.
   *
   * `yellow` **이 부품의 'date' 경로는 비제어다** — `value` 를 `defaultValue` 로 넘기므로
   * **초기값으로만** 쓰인다(다른 type 처럼 매 렌더 반영되지 않는다). 지금 호출부(등록 화면)는
   * 값을 주지 않아 드러나지 않는다. 값을 부모가 쥐어야 하면 `DateTextInput` 을 직접 쓰면
   * 된다 — 그쪽에는 D48 에서 제어형 경로(`value`)가 생겼다.
   */
  type?: 'text' | 'date' | 'email';
  /** 입력칸 아래 도움말. 'date' 는 주지 않아도 KRDS 문구가 기본으로 붙는다. */
  hint?: ReactNode;
  /** 해당 칸에서 고쳐야 할 오류. 도움말과 분리해 스크린 리더에 즉시 알린다. */
  error?: ReactNode;
  required?: boolean;
  name?: string;
  id?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** select 변형일 때 옵션 목록. */
  options?: SearchSelectOption[];
  className?: string;
}

/** 상단 라벨 + 라운드 입력 박스(높이 61). select 변형은 우측 체브론. */
export function SearchInput({
  label,
  variant = 'text',
  type = 'text',
  hint,
  error,
  required = false,
  name,
  id,
  placeholder,
  value,
  onChange,
  options = [],
  className,
}: SearchInputProps) {
  const generatedId = useId();
  const fieldId = id ?? name ?? generatedId;
  const classes = ['wire-search', className].filter(Boolean).join(' ');
  const resolvedHint = hint ?? (type === 'date' ? DATE_TEXT_HINT : undefined);
  // 도움말을 컨트롤에 이어야 스크린 리더가 형식 안내를 함께 읽는다(KRDS · WCAG 2.1 A).
  // 그러려면 도움말에 id 가 필요하고, id 는 필드 id 에서 파생한다.
  const hintId = resolvedHint === undefined ? undefined : `${fieldId}-hint`;
  const errorId = error === undefined ? undefined : `${fieldId}-error`;
  const describedBy = [errorId, hintId]
    .filter((item): item is string => item !== undefined)
    .join(' ') || undefined;

  return (
    <div className={classes}>
      <label className="wire-search-label" htmlFor={fieldId}>{label}</label>
      <span className="wire-search-box" data-invalid={error === undefined ? undefined : 'true'}>
        {variant === 'select' ? (
          <>
            {onChange ? (
              <select
                id={fieldId}
                name={name}
                value={value}
                required={required}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={describedBy}
                onChange={(event) => onChange(event.target.value)}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                id={fieldId}
                name={name}
                defaultValue={value}
                required={required}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={describedBy}
              >
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            <Chevron dir="down" />
          </>
        ) : type === 'date' ? (
          /* 날짜는 부품이 따로 있다 — placeholder·자동 하이픈·형식 검증을 한곳에 둔다.
             value 는 초기값으로만 쓴다(부품이 내부 상태로 편집을 관리한다). */
          <DateTextInput
            id={fieldId}
            name={name}
            defaultValue={value}
            required={required}
            invalid={error !== undefined}
            describedBy={describedBy}
            autoComplete="bday"
            onValueChange={onChange}
          />
        ) : (
          <input
            id={fieldId}
            name={name}
            type={type}
            placeholder={placeholder}
            value={value}
            required={required}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={describedBy}
            readOnly={value !== undefined && onChange === undefined}
            onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          />
        )}
      </span>
      {resolvedHint === undefined ? null : (
        <span className="wire-form-hint" id={hintId}>
          {resolvedHint}
        </span>
      )}
      {error === undefined ? null : (
        <span className="wire-field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
