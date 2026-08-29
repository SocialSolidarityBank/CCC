'use client';

import { useState } from 'react';

/**
 * 자리 표시자와 도움말 문구는 부품이 갖는다 — 날짜 칸이 여러 화면에 흩어져 있어
 * 화면마다 따로 쓰면 문구가 갈라진다(레인 D 착수 문서 §4).
 */
export const DATE_TEXT_PLACEHOLDER = 'YYYY-MM-DD';
/** KRDS: 자리 표시자는 입력을 시작하면 사라지므로 자릿수·예시는 **입력칸 아래 도움말**에 둔다.
 *  예시 날짜는 칸의 맥락이 정한다(2026-08-29 — 상담 일시·기한 칸에 생년월일 예시 1985-03-27
 *  이 그대로 서 있었다). 생년월일은 1985-03-27, 상담·기한 칸은 2026-08-05 를 쓴다. */
const DATE_TEXT_FORMAT = '숫자 8자리를 적으면 하이픈이 자동으로 들어갑니다.';
export function dateTextHint(example: string): string {
  return `${DATE_TEXT_FORMAT} 예: ${example}`;
}

/**
 * 입력 중 자동 하이픈. 숫자만 남기고 연(4)·월(2)·일(2)로 끊는다.
 * 끝에 하이픈을 붙이지 않는다 — `1985` 다음에 `1985-` 가 되면 지울 때 한 칸이 되돌아온다.
 */
export function formatDateDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/**
 * 옵셔널 속성에 `| undefined` 를 붙여 둔다 — 이 레포는 `exactOptionalPropertyTypes` 라서
 * `id?: string` 은 "생략" 만 허용하고 "undefined 를 넘김" 은 막는다. SearchInput 이 값을
 * 그대로 흘려보내므로 후자가 필요하다.
 */
export interface DateTextInputProps {
  id?: string | undefined;
  name?: string | undefined;
  /**
   * 비제어 모드의 초기값. 마운트 때 한 번만 읽는다. `value` 를 함께 주면 무시된다.
   */
  defaultValue?: string | undefined;
  /**
   * 제어 모드. 주면 부모가 값을 쥐고, 이 부품은 내부 상태를 쓰지 않는다.
   * 달력이 값을 밀어 넣는 자리(`DatePickerControl`)가 이 경로를 쓴다 — 사용자가 친 글자와
   * 달력이 고른 날짜가 **같은 하나의 값**이어야 하기 때문이다.
   */
  value?: string | undefined;
  required?: boolean | undefined;
  /** 호출부가 판정한 오류 상태. 오류 문구는 `describedBy` 로 별도 연결한다. */
  invalid?: boolean | undefined;
  /** 도움말 문구의 id — KRDS '레이블·설명은 프로그래밍적으로 연결'. */
  describedBy?: string | undefined;
  /**
   * 보이는 라벨이 없는 자리(위저드의 인라인 폼)에서 쓰는 접근성 이름. 라벨이 `htmlFor` 로
   * 이어져 있으면 주지 않는다 — 주면 화면의 라벨과 낭독되는 이름이 갈린다.
   */
  ariaLabel?: string | undefined;
  /**
   * 브라우저 자동완성. 생년월일 칸만 `bday` 를 준다(KRDS: 개인정보 칸에 자동완성 지원) —
   * 상담 일시에 생일을 채워 넣으면 안 되므로 기본값은 끔이다.
   */
  autoComplete?: string | undefined;
  /** 값이 바뀔 때 호출부에 알린다(폼 제출값은 input 이 직접 갖는다). */
  onValueChange?: ((value: string) => void) | undefined;
}

/**
 * 날짜를 **글자로 적는** 입력칸(KRDS '날짜 입력 필드' 단일 입력 필드 방식).
 *
 * 네이티브 `<input type="date">` 를 쓰지 않는 이유는 표기가 **보는 사람의 브라우저 UI 언어**를
 * 따르고 페이지 로케일을 무시하기 때문이다 — 같은 화면이 팀원마다 `mm/dd/yyyy` 로도,
 * `YYYY. MM. DD.` 로도 보인다(훑기 결함 R6). 글자 입력칸에는 그 편차가 아예 없다.
 *
 * 생년월일처럼 **아는 값을 적는** 자리에서는 이 부품만 쓴다(달력 없음). 요일이 중요하거나 먼
 * 날짜를 고르는 자리(상담 일시·기한)는 이 부품을 본체로 두고 달력을 옆에 붙인다
 * (`DatePickerControl`, D48 · ADR-0020) — KRDS 가 그 두 자리를 다르게 지정한다.
 *
 * 제출값은 네이티브와 **글자 그대로 같다**(`YYYY-MM-DD`) — 서버 액션·게이트웨이는 손대지 않는다.
 * 형식이 어긋난 값은 `pattern` 이 화면에서 막고, 서버도 같은 정규식으로 다시 막는다.
 */
export function DateTextInput({
  id,
  name,
  defaultValue = '',
  value: controlledValue,
  required = false,
  invalid = false,
  describedBy,
  ariaLabel,
  autoComplete = 'off',
  onValueChange,
}: DateTextInputProps) {
  const [internalValue, setInternalValue] = useState(() => formatDateDigits(defaultValue));
  // 제어 모드면 부모가 쥔 값을 그대로 그린다. 내부 상태는 그대로 두되 쓰지 않는다 —
  // 훅 개수를 조건부로 바꿀 수 없기 때문이다(리액트 규칙).
  const value = controlledValue === undefined ? internalValue : formatDateDigits(controlledValue);

  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete={autoComplete}
      placeholder={DATE_TEXT_PLACEHOLDER}
      maxLength={10}
      required={required}
      aria-invalid={invalid || undefined}
      pattern="\d{4}-\d{2}-\d{2}"
      title={DATE_TEXT_FORMAT}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => {
        const next = formatDateDigits(event.currentTarget.value);
        if (controlledValue === undefined) setInternalValue(next);
        onValueChange?.(next);
      }}
    />
  );
}
