'use client';

import type { ReactNode } from 'react';
import { Chevron } from './chevron';

/** 입력칸 안에 들어가는 컨트롤 종류. select 는 꺽쇠를 직접 그리고, textarea 는 박스가 세로로 늘어난다. */
export type WireControl = 'input' | 'select' | 'textarea';

export interface WireFormFieldProps {
  /** 라벨. 항상 입력칸 위에 둔다 — 자리표시자가 라벨을 대신하지 않는다(DESIGN.md §5 '입력칸'). */
  label: ReactNode;
  /** 실제 컨트롤(input·select·textarea). 이름·검증·값은 호출부가 그대로 갖는다. */
  children: ReactNode;
  /** 필수 표시. 라벨 옆에 --risk 별표가 붙는다. */
  required?: boolean;
  /** 라벨 옆 보조 문구 — '(선택)' 처럼 필수 여부를 말로 덧붙일 때. */
  note?: ReactNode;
  /** 입력칸 아래 도움말. */
  hint?: ReactNode;
  /** 오류 메시지. 있으면 테두리가 1.5px --risk 로 바뀌고 메시지가 함께 나온다 — 색만으로 알리지 않는다. */
  error?: ReactNode;
  /**
   * 메시지는 호출부가 직접 그리면서 테두리만 오류 상태로 두고 싶을 때. 이미 aria-describedby 로
   * 컨트롤에 묶인 메시지가 있는 자리에서 쓴다 — error 로 넘기면 같은 문장이 두 번 읽힌다.
   */
  invalid?: boolean;
  control?: WireControl;
  /**
   * 라벨과 컨트롤을 htmlFor 로 잇는다. 없으면 label 이 컨트롤을 감싸 암묵적으로 연결된다.
   * 주면 hint 에 `${htmlFor}-hint` id 가 붙으므로 컨트롤에서 aria-describedby 로 가리킬 수 있다.
   */
  htmlFor?: string;
  className?: string;
}

/**
 * 폼 입력칸(DESIGN.md §5 '입력칸' 계약): 높이 40 · radius 6 · `--line-control` 1px ·
 * 라벨 항상 위 14/700. 검색칸(SearchInput)과 같은 계약이지만 폼이 필요로 하는
 * 필수 별표·도움말·오류 메시지 자리를 갖는다.
 *
 * 컨트롤을 children 으로 받는 이유: 화면마다 textarea rows, datetime-local, JSON 값을 담은
 * option 등 요구가 제각각이라 props 로 감싸면 부품이 화면 수만큼 늘어난다. 부품은 라벨·박스·
 * 오류라는 **모양 계약**만 갖고, 이름·검증·값은 호출부에 남긴다.
 */
export function WireFormField({
  label,
  children,
  required = false,
  note,
  hint,
  error,
  invalid = false,
  control = 'input',
  htmlFor,
  className,
}: WireFormFieldProps) {
  const classes = ['wire-form-field', className].filter(Boolean).join(' ');
  const hasError = error !== undefined && error !== null && error !== false;
  const showInvalid = invalid || hasError;
  // htmlFor 가 있으면 라벨만 <label> 로 내고 나머지는 형제로 둔다. 전체를 <label> 로 감싸면
  // 도움말·오류 문장이 컨트롤의 **이름**에 합쳐져 스크린 리더가 라벨 대신 문단을 읽는다.
  // htmlFor 가 없을 때만 <label> 이 컨트롤을 감싸 암묵적으로 연결한다.
  const Wrapper = htmlFor === undefined ? 'label' : 'div';

  const labelContent = (
    <>
      {label}
      {required ? (
        <span className="wire-form-required" aria-hidden="true">
          *
        </span>
      ) : null}
      {note === undefined ? null : <span className="wire-form-note">{note}</span>}
    </>
  );

  return (
    <Wrapper className={classes}>
      {htmlFor === undefined ? (
        <span className="wire-form-label">{labelContent}</span>
      ) : (
        <label className="wire-form-label" htmlFor={htmlFor}>
          {labelContent}
        </label>
      )}
      <span className="wire-input-box" data-control={control} data-invalid={showInvalid ? 'true' : undefined}>
        {children}
        {control === 'select' ? <Chevron dir="down" /> : null}
      </span>
      {hint === undefined ? null : (
        <span className="wire-form-hint" id={htmlFor === undefined ? undefined : `${htmlFor}-hint`}>
          {hint}
        </span>
      )}
      {hasError ? (
        <span className="wire-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </Wrapper>
  );
}

export interface WireChoiceProps {
  /** 선택지 라벨. 컨트롤과 **같은 줄**에 둔다. */
  label: ReactNode;
  type: 'radio' | 'checkbox';
  name?: string;
  value?: string;
  id?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
  /** 라벨 아래 설명 14/400. */
  desc?: ReactNode;
  /**
   * 컨트롤의 접근 이름을 라벨 텍스트 대신 직접 준다(2026-08-09). 같은 보기 낱말이 질문마다
   * 되풀이되는 자리에서 필요하다 — 인테이크의 '무응답' 체크박스가 한 화면에 여럿이라
   * 라벨 텍스트만으로는 어느 질문의 것인지 가려지지 않는다.
   */
  ariaLabel?: string;
  /** 리스크 변형 — 테두리만 --risk. 리스크 배너 안에서만 쓴다(D9). */
  tone?: 'risk';
  className?: string;
}

/**
 * 선택지 행(DESIGN.md §5 '선택지 행'): 동그라미/네모와 라벨이 같은 줄이고 누를 면적은
 * 컨트롤 높이(40)만큼 준다.
 *
 * 이 부품이 존재하는 이유는 실제 결함 때문이다(2026-07-26): 라디오·체크박스를 텍스트 입력칸
 * 규칙(`.field input` 의 `width:100%`)에 얹으면 동그라미가 칸을 가로질러 늘어나고 라벨이 아래
 * 줄로 밀려, 선택지가 세로로 한 글자씩 쪼개져 읽힌다.
 */
export function WireChoice({
  label,
  type,
  name,
  value,
  id,
  checked,
  defaultChecked,
  disabled = false,
  onChange,
  desc,
  tone,
  ariaLabel,
  className,
}: WireChoiceProps) {
  const classes = ['wire-choice', className].filter(Boolean).join(' ');

  return (
    <label className={classes} htmlFor={id}>
      <input
        className={type === 'radio' ? 'wire-radio' : 'wire-checkbox'}
        type={type}
        id={id}
        name={name}
        value={value}
        aria-label={ariaLabel}
        checked={checked}
        defaultChecked={defaultChecked}
        disabled={disabled}
        data-tone={tone}
        onChange={onChange ? (event) => onChange(event.currentTarget.checked) : undefined}
      />
      <span className="wire-choice-text">
        {label}
        {desc === undefined ? null : <span className="wire-choice-desc">{desc}</span>}
      </span>
    </label>
  );
}
