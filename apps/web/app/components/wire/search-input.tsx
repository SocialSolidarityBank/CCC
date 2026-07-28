'use client';

import { Chevron } from './chevron';

export interface SearchSelectOption {
  value: string;
  label: string;
}

export interface SearchInputProps {
  /** 상단 라벨(14/700 --sub). */
  label: string;
  /** text = 입력 박스(기본), select = 우측 체브론이 붙는 셀렉트. */
  variant?: 'text' | 'select';
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
  name,
  id,
  placeholder,
  value,
  onChange,
  options = [],
  className,
}: SearchInputProps) {
  const fieldId = id ?? name;
  const classes = ['wire-search', className].filter(Boolean).join(' ');

  return (
    <label className={classes} htmlFor={fieldId}>
      <span className="wire-search-label">{label}</span>
      <span className="wire-search-box">
        {variant === 'select' ? (
          <>
            {onChange ? (
              <select id={fieldId} name={name} value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <select id={fieldId} name={name} defaultValue={value}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            <Chevron dir="down" />
          </>
        ) : (
          <input
            id={fieldId}
            name={name}
            type="text"
            placeholder={placeholder}
            value={value}
            readOnly={value !== undefined && onChange === undefined}
            onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          />
        )}
      </span>
    </label>
  );
}
