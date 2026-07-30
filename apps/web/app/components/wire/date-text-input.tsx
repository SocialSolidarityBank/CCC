'use client';

import { useState } from 'react';

/**
 * 자리 표시자와 도움말 문구는 부품이 갖는다 — 날짜 칸이 여러 화면에 흩어져 있어
 * 화면마다 따로 쓰면 문구가 갈라진다(레인 D 착수 문서 §4).
 */
export const DATE_TEXT_PLACEHOLDER = 'YYYY-MM-DD';
/** KRDS: 자리 표시자는 입력을 시작하면 사라지므로 자릿수·예시는 **입력칸 아래 도움말**에 둔다. */
export const DATE_TEXT_HINT = '숫자 8자리를 적으면 하이픈이 자동으로 들어갑니다. 예: 1985-03-27';

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
   * `red` **초기값 전용이다 — 이 부품은 비제어다.**
   * 편집 중 값은 내부 상태가 갖고, 이 prop 은 마운트 때 **한 번만** 읽는다. 호출부가
   * 다시 그리면서 새 값을 주어도 화면은 바뀌지 않는다. 제어형(부모가 값을 쥐는 방식)이
   * 필요해지면 `value`+`onChange` 를 새로 만들어야 한다 — `defaultValue` 에 값을 계속
   * 흘려보내는 방식으로는 안 된다.
   */
  defaultValue?: string | undefined;
  required?: boolean | undefined;
  /** 도움말 문구의 id — KRDS '레이블·설명은 프로그래밍적으로 연결'. */
  describedBy?: string | undefined;
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
 * 생년월일처럼 **아는 값을 적는** 자리에만 쓴다. 요일이 중요하거나 먼 날짜를 고르는 자리는
 * 달력이 맞고(KRDS), 그 판단은 이 레인에서 하지 않는다(착수 문서 §5).
 *
 * 제출값은 네이티브와 **글자 그대로 같다**(`YYYY-MM-DD`) — 서버 액션·게이트웨이는 손대지 않는다.
 * 형식이 어긋난 값은 `pattern` 이 화면에서 막고, 서버도 같은 정규식으로 다시 막는다.
 */
export function DateTextInput({
  id,
  name,
  defaultValue = '',
  required = false,
  describedBy,
  onValueChange,
}: DateTextInputProps) {
  const [value, setValue] = useState(() => formatDateDigits(defaultValue));

  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="bday"
      placeholder={DATE_TEXT_PLACEHOLDER}
      maxLength={10}
      required={required}
      pattern="\d{4}-\d{2}-\d{2}"
      title={DATE_TEXT_HINT}
      aria-describedby={describedBy}
      value={value}
      onChange={(event) => {
        const next = formatDateDigits(event.currentTarget.value);
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}
