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
 * 상담 시간대(07:00~21:00, 30분 간격). 이 앱의 일정은 전부 이 범위 안에 있고, 벗어나는
 * 시각은 시각 칸에 직접 적으면 된다 — 목록은 **빠른 길**이지 유일한 길이 아니다.
 */
const timeSlots: string[] = Array.from({ length: 29 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
});

/**
 * 날짜 + 시각(D48 · ADR-0020, 2026-07-31 Q 재구성).
 *
 * **한 덩어리로 보이고 한 패널에서 고른다.** 이전에는 날짜칸·달력버튼·시각칸이 각자 테두리를
 * 가진 세 부품으로 나란히 서 있어서 하나의 값을 적는 자리로 읽히지 않았고, 달력을 열어도 시각은
 * 따로 쳐야 했다. 이제 두 칸은 테두리 하나를 공유하고, 팝오버 하나에 달력과 시각 목록이 함께 있다.
 *
 * **바뀌지 않은 것**(전부 의도적이다):
 *  * 두 칸 다 키보드로 직접 칠 수 있다 — KRDS 가 "날짜 선택기를 써도 입력 필드를 읽기전용으로
 *    만들지 말라"를 요구한다. 팝오버는 대체가 아니라 지름길이다.
 *  * 달력 알맹이는 `react-day-picker`(MIT) 그대로다. 키보드 격자 이동·스크린 리더 낭독은 손으로
 *    만들 때 가장 조용히 틀리는 영역이다(ADR-0020 §2). shadcn/ui 의 날짜 선택기도 같은 조합
 *    (react-day-picker + 팝오버)이라 부품을 갈아끼울 일이 아니라 팝오버를 다시 그릴 일이었다.
 *  * 보이는 두 칸의 이름(`<name>Date`·`<name>Time`)과 숨은 칸의 제출값(`YYYY-MM-DDTHH:mm`).
 *    이름을 빼면 폼 임시본(`useDomDraft`)이 **이름 있는 칸만** 복원하므로 상담 일시가 조용히
 *    사라진다. 제출값이 그대로라 서버 액션·게이트웨이·마이그레이션은 변경 0이다.
 *  * 시각은 네이티브 `<input type="time">` 이다. 12/24시간제로 표기가 갈리지만 `2:30 PM` 과
 *    `14:30` 은 뜻이 하나다 — R6 이 문제였던 이유는 편차가 아니라 `03/04/2026` 처럼 뜻이
 *    둘이었기 때문이다(ADR-0020 §4).
 *
 * 팝오버는 날짜를 골라도 닫지 않는다 — 아직 시각이 남아 있다. 닫는 길은 세 개다:
 * `완료` 버튼, Escape, 바깥 누르기. 셋 다 초점을 여는 버튼으로 되돌린다.
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const separator = value.indexOf('T');
  const datePart = separator === -1 ? value : value.slice(0, separator);
  const timePart = separator === -1 ? '' : value.slice(separator + 1);
  const selected = parseDateOnly(datePart);
  // 둘 다 비면 빈 값을 낸다 — `T14:30` 같은 반쪽 값이 서버로 가지 않게 한다.
  const emit = (nextDate: string, nextTime: string): void => {
    onChange(nextDate === '' && nextTime === '' ? '' : `${nextDate}T${nextTime}`);
  };

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

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
    <span className="wire-datetime-control" ref={rootRef}>
      {/* 테두리는 이 껍데기 하나가 갖는다. 안의 두 칸은 테두리를 벗고 세로선으로만 나뉜다 —
          하나의 값을 적는 자리이므로 하나의 상자로 보여야 한다. */}
      <span className="wire-datetime-fields">
        <DateTextInput
          id={id}
          name={name === undefined ? undefined : `${name}Date`}
          value={datePart}
          onValueChange={(next) => emit(next, timePart)}
          required={required}
          describedBy={describedBy}
          ariaLabel={`${fieldLabel} 날짜`}
        />
        <input
          className="wire-datetime-time"
          type="time"
          name={name === undefined ? undefined : `${name}Time`}
          aria-label={`${fieldLabel} 시각`}
          value={timePart}
          required={required}
          onChange={(event) => emit(datePart, event.currentTarget.value)}
        />
      </span>
      <button
        type="button"
        ref={buttonRef}
        className="wire-date-toggle"
        aria-haspopup="dialog"
        aria-expanded={open}
        // 패널에 시각까지 들어 있으므로 이름도 '달력'이 아니라 '날짜·시각'이다.
        aria-label={`${fieldLabel} 날짜·시각 선택 ${open ? '닫기' : '열기'}`}
        onClick={() => setOpen((previous) => !previous)}
      >
        <CalendarGlyph />
      </button>
      {open ? (
        <span className="wire-date-popover wire-datetime-popover" role="dialog" aria-label={`${fieldLabel} 날짜·시각 선택`}>
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
              emit(formatDateOnly(date), timePart);
            }}
          />
          {/* 시각 목록은 라디오 그룹이 아니라 **버튼 목록**이다 — 고른 값은 위 시각 칸에 그대로
              보이고, 여기서 고르지 않고 직접 쳐도 된다. aria-pressed 로 현재 값만 알린다. */}
          <span className="wire-time-list" role="group" aria-label={`${fieldLabel} 시각 목록`}>
            {timeSlots.map((slot) => (
              <button
                key={slot}
                type="button"
                className="wire-time-slot"
                aria-pressed={slot === timePart}
                // 목록은 07:00 부터라 이미 고른 시각이 스크롤 아래 숨는다. 열 때 그 줄로 감는다.
                // scrollIntoView 를 쓰지 않는다 — 안쪽 목록만이 아니라 **페이지까지** 함께 감아서
                // 팝오버를 여는 것만으로 화면이 튄다. 부모의 scrollTop 만 직접 옮긴다.
                ref={slot === timePart ? (node) => {
                  const list = node?.parentElement;
                  if (node == null || list == null) return;
                  list.scrollTop = node.offsetTop - list.clientHeight / 2 + node.offsetHeight / 2;
                } : undefined}
                onClick={() => emit(datePart, slot)}
              >
                {slot}
              </button>
            ))}
          </span>
          <span className="wire-datetime-popover-foot">
            <button type="button" className="wire-datetime-done" onClick={close}>완료</button>
          </span>
        </span>
      ) : null}
      {/* 서버가 읽는 값은 이 숨은 칸 하나다. 숨은 칸은 HTML 규칙상 제약 검증에서 빠지므로
          필수 검사는 보이는 두 칸이 맡는다. */}
      {name === undefined ? null : <input type="hidden" name={name} value={value} />}
    </span>
  );
}
