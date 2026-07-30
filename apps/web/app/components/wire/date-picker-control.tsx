'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { ko } from 'react-day-picker/locale';
import { DateTextInput } from './date-text-input';

/**
 * `YYYY-MM-DD` → 로컬 Date. 형식이 어긋나거나 없는 날짜면 undefined.
 *
 * `new Date('2026-02-31')` 은 조용히 3월 3일이 된다. 되짚어 보고 다르면 버린다 —
 * 달력이 엉뚱한 달을 펴고 그 날짜가 선택된 것처럼 보이는 것을 막는다.
 */
export function parseDateOnly(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}

/**
 * Date → `YYYY-MM-DD`.
 *
 * `toISOString()` 을 쓰지 않는다 — UTC 로 바꾸면서 한국 시간 오전 9시 이전이 **전날**이 된다.
 * 달력에서 고른 날과 칸에 적히는 날이 하루 어긋나는 고전적인 버그다.
 */
export function formatDateOnly(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export interface DatePickerControlProps {
  id?: string | undefined;
  name?: string | undefined;
  /** `YYYY-MM-DD` 또는 빈 문자열. 이 부품은 **제어형이다** — 값은 호출부가 쥔다. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean | undefined;
  describedBy?: string | undefined;
  /** 보이는 라벨이 없는 자리에서 입력칸에 붙일 접근성 이름. */
  ariaLabel?: string | undefined;
  /**
   * 항목 이름. 달력 버튼과 팝오버의 **접근성 이름**에 들어간다 — 한 화면에 날짜 칸이 여럿일 때
   * 스크린 리더가 "달력 열기"만 여러 번 읽지 않도록 한다.
   */
  fieldLabel: string;
}

/**
 * 날짜 입력칸 + 달력(D48 · ADR-0020).
 *
 * **달력은 입력칸을 대체하지 않는다.** KRDS 가 *"날짜 선택기를 사용하는 경우에도 입력 필드를
 * 사용 불가나 읽기전용 상태로 변경하지 않고 키보드를 이용하여 사용자가 직접 날짜를 입력할 수
 * 있도록 한다"* 를 요구한다. 그래서 본체는 1군의 `DateTextInput`(숫자만 치면 하이픈 자동)이고
 * 달력은 오른쪽에 붙는 보조 장치다.
 *
 * 달력 알맹이는 `react-day-picker`(MIT) 다 — 직접 만들지 않는 이유는 **키보드 방향키 이동과
 * 스크린 리더 낭독**이 손으로 만들 때 가장 조용히 틀리는 영역이기 때문이다(ADR-0020 §2).
 * 겉모습은 D34 토큰 조합으로만 정의한다(`wire-styles.ts` '날짜 선택').
 */
export function DatePickerControl({
  id,
  name,
  value,
  onChange,
  required = false,
  describedBy,
  ariaLabel,
  fieldLabel,
}: DatePickerControlProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const selected = parseDateOnly(value);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    // Escape 는 닫고 **초점을 버튼으로 되돌린다** — 안 되돌리면 키보드 사용자가 화면 맨 위로 튄다.
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <span className="wire-date-control" ref={rootRef}>
      <DateTextInput
        id={id}
        name={name}
        value={value}
        onValueChange={onChange}
        required={required}
        describedBy={describedBy}
        ariaLabel={ariaLabel}
      />
      <button
        type="button"
        ref={buttonRef}
        className="wire-date-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${fieldLabel} 달력 ${open ? '닫기' : '열기'}`}
        onClick={() => setOpen((previous) => !previous)}
      >
        <CalendarGlyph />
      </button>
      {open ? (
        <span className="wire-date-popover" id={dialogId} role="dialog" aria-label={`${fieldLabel} 날짜 선택`}>
          <DayPicker
            mode="single"
            locale={ko}
            selected={selected}
            // 값이 없으면 defaultMonth 를 아예 넘기지 않는다 — 이 레포는 exactOptionalPropertyTypes
            // 라서 undefined 를 넘기는 것과 생략하는 것이 다르다. 생략하면 이번 달이 열린다.
            {...(selected === undefined ? {} : { defaultMonth: selected })}
            autoFocus
            onSelect={(date) => {
              if (date === undefined) return;
              onChange(formatDateOnly(date));
              setOpen(false);
              buttonRef.current?.focus();
            }}
          />
        </span>
      ) : null}
    </span>
  );
}

/**
 * `YYYY-MM-DDTHH:mm` 이 **온전히** 채워졌는가.
 *
 * `red` 칸이 둘로 나뉘면서 예전에 없던 상태가 생겼다 — 날짜만 채우면 값이 `2026-08-12T` 가 된다.
 * 한 칸짜리 `datetime-local` 은 둘 다 채워야 값을 내줬으므로 `길이 > 0` 검사로 충분했지만
 * 이제는 아니다. **폼 밖에서(자바스크립트로) 제출하는 화면은 이 함수로 검사해야 한다** —
 * 폼으로 제출하는 화면은 두 칸의 `required`·`pattern` 이 대신 막는다.
 */
export function isCompleteDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && parseDateOnly(value.slice(0, 10)) !== undefined;
}

export interface DateTimePickerControlProps {
  id?: string | undefined;
  /** 폼 제출 이름. 주면 합쳐진 값(`YYYY-MM-DDTHH:mm`)을 숨은 칸으로 낸다. */
  name?: string | undefined;
  /** `YYYY-MM-DDTHH:mm` 또는 빈 문자열. 제어형이다. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean | undefined;
  describedBy?: string | undefined;
  fieldLabel: string;
}

/**
 * 날짜 + 시각(D48 · ADR-0020). 상담 일시처럼 `datetime-local` 이던 자리를 대신한다.
 *
 * 달력에는 시간이 없으므로 **칸이 둘**이다. 제출값은 예전과 같은 `YYYY-MM-DDTHH:mm` 한 덩어리라
 * 서버 액션·게이트웨이는 손대지 않는다.
 *
 * 시각은 네이티브 `<input type="time">` 을 그대로 쓴다. 표기가 12시간제/24시간제로 갈리긴 하지만
 * **`2:30 PM` 과 `14:30` 은 둘 다 뜻이 하나**다 — R6 이 문제였던 이유는 편차가 아니라 `03/04/2026`
 * 처럼 **뜻이 둘**(3월 4일/4월 3일)이었기 때문이다. 시각에는 그 모호함이 없다(ADR-0020 §4).
 */
export function DateTimePickerControl({
  id,
  name,
  value,
  onChange,
  required = false,
  describedBy,
  fieldLabel,
}: DateTimePickerControlProps) {
  const separator = value.indexOf('T');
  const datePart = separator === -1 ? value : value.slice(0, separator);
  const timePart = separator === -1 ? '' : value.slice(separator + 1);
  // 둘 다 비면 빈 값을 낸다 — `T14:30` 같은 반쪽 값이 서버로 가지 않게 한다.
  const emit = (nextDate: string, nextTime: string): void => {
    onChange(nextDate === '' && nextTime === '' ? '' : `${nextDate}T${nextTime}`);
  };

  return (
    <span className="wire-datetime-control">
      <DatePickerControl
        id={id}
        name={name === undefined ? undefined : `${name}Date`}
        value={datePart}
        onChange={(next) => emit(next, timePart)}
        required={required}
        describedBy={describedBy}
        fieldLabel={fieldLabel}
        ariaLabel={`${fieldLabel} 날짜`}
      />
      <input
        className="wire-time-input"
        type="time"
        name={name === undefined ? undefined : `${name}Time`}
        aria-label={`${fieldLabel} 시각`}
        value={timePart}
        required={required}
        onChange={(event) => emit(datePart, event.currentTarget.value)}
      />
      {/* 서버가 읽는 값은 이 숨은 칸 하나다. 숨은 칸은 HTML 규칙상 제약 검증에서 빠지므로
          필수 검사는 위 두 칸이 맡는다.

          `yellow` 보이는 두 칸에도 이름(`<name>Date`·`<name>Time`)을 준다. 폼 임시본
          (`useDomDraft`)이 **이름 있는 칸만** 저장·복원하기 때문이다 — 이름을 빼면 임시본이
          숨은 칸만 되돌리는데 그 값은 리액트가 즉시 덮어써서 상담 일시가 조용히 사라진다.
          제출 시 이 두 키가 함께 가지만 서버 액션은 읽는 키만 꺼내 쓴다(무시된다). */}
      {name === undefined ? null : <input type="hidden" name={name} value={value} />}
    </span>
  );
}
