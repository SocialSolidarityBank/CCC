import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  DatePickerControl,
  DateTimePickerControl,
  formatDateOnly,
  isCompleteDateTime,
  parseDateOnly,
} from './date-picker-control';

// 레인 D 2군 — 달력(D48 · ADR-0020). 어서션은 전부 실제 위험에서 나왔다:
// 시간대 때문에 하루 어긋나는 것 · 달력이 입력칸을 대체해 키보드 입력을 막는 것 ·
// 폼 임시본이 이름 없는 칸을 못 되살리는 것.

afterEach(cleanup);

describe('parseDateOnly / formatDateOnly', () => {
  it('왕복해도 값이 그대로다', () => {
    const parsed = parseDateOnly('2026-08-12');
    expect(parsed).toBeInstanceOf(Date);
    expect(formatDateOnly(parsed as Date)).toBe('2026-08-12');
  });

  it('`red` toISOString 을 쓰지 않는다 — 자정 직후여도 날짜가 밀리지 않는다', () => {
    // 한국 시간(UTC+9) 자정 = UTC 로는 전날 15시다. toISOString 을 썼다면 하루 앞선 값이 나온다.
    const midnight = new Date(2026, 7, 12, 0, 0, 0);
    expect(formatDateOnly(midnight)).toBe('2026-08-12');
  });

  it('없는 날짜는 버린다 — Date 가 조용히 다음 달로 넘기는 것을 막는다', () => {
    expect(parseDateOnly('2026-02-31')).toBeUndefined();
    expect(parseDateOnly('2026-13-01')).toBeUndefined();
  });

  it('형식이 어긋나거나 비면 undefined 다', () => {
    expect(parseDateOnly('')).toBeUndefined();
    expect(parseDateOnly('2026-8-12')).toBeUndefined();
  });
});

describe('DatePickerControl', () => {
  it('달력이 입력칸을 대체하지 않는다 — 글자로도 칠 수 있다 (KRDS)', () => {
    const onChange = vi.fn();
    const { container } = render(
      <DatePickerControl value="" onChange={onChange} fieldLabel="기한" ariaLabel="기한" />,
    );
    const input = screen.getByLabelText('기한') as HTMLInputElement;

    expect(input.readOnly).toBe(false);
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: '20260812' } });

    // 자동 하이픈은 1군 부품이 그대로 담당한다.
    expect(onChange).toHaveBeenCalledWith('2026-08-12');
    expect(container.querySelector('.wire-date-toggle')).not.toBeNull();
  });

  it('달력은 닫힌 채 시작하고 버튼이 상태를 알린다', () => {
    render(<DatePickerControl value="" onChange={vi.fn()} fieldLabel="기한" />);
    const toggle = screen.getByRole('button', { name: '기한 달력 열기' });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('버튼을 누르면 달력이 열리고 날짜를 고르면 값이 되며 다시 닫힌다', () => {
    const onChange = vi.fn();
    render(<DatePickerControl value="2026-08-12" onChange={onChange} fieldLabel="기한" />);

    fireEvent.click(screen.getByRole('button', { name: '기한 달력 열기' }));
    const dialog = screen.getByRole('dialog', { name: '기한 날짜 선택' });
    expect(dialog).not.toBeNull();

    // 열린 달은 값이 정한다 — 값이 있는데 이번 달이 열리면 고르러 넘겨야 한다.
    // 날짜 버튼의 접근성 이름은 라이브러리가 로케일로 만든 긴 문장이라(예: '2026년 8월 20일 목요일')
    // 숫자로 찾지 않고 격자에서 그 날짜 칸을 집는다.
    const day20 = Array.from(dialog.querySelectorAll('.rdp-day_button'))
      .find((button) => button.textContent?.trim() === '20');
    expect(day20).not.toBeUndefined();
    fireEvent.click(day20 as HTMLElement);

    expect(onChange).toHaveBeenCalledWith('2026-08-20');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape 로 닫으면 초점이 버튼으로 돌아온다', () => {
    render(<DatePickerControl value="" onChange={vi.fn()} fieldLabel="기한" />);
    const toggle = screen.getByRole('button', { name: '기한 달력 열기' });

    fireEvent.click(toggle);
    expect(screen.getByRole('dialog')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    // 안 되돌리면 키보드 사용자가 화면 맨 위로 튄다.
    expect(document.activeElement).toBe(toggle);
  });

  it('월·요일이 한국어다 (KRDS 달력 표기)', () => {
    render(<DatePickerControl value="2026-08-12" onChange={vi.fn()} fieldLabel="기한" />);
    fireEvent.click(screen.getByRole('button', { name: '기한 달력 열기' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('2026');
    expect(dialog.textContent).toContain('8월');
  });
});

describe('DateTimePickerControl', () => {
  it('칸이 둘이고 각각 이름이 있다 — 하나만 "상담 일시"로 읽히지 않는다', () => {
    render(<DateTimePickerControl value="" onChange={vi.fn()} fieldLabel="상담 일시" />);

    expect(screen.getByLabelText('상담 일시 날짜')).not.toBeNull();
    expect(screen.getByLabelText('상담 일시 시각')).not.toBeNull();
  });

  it('두 칸을 합쳐 예전과 같은 제출값을 만든다', () => {
    const onChange = vi.fn();
    render(<DateTimePickerControl value="2026-08-12T" onChange={onChange} fieldLabel="상담 일시" />);

    fireEvent.change(screen.getByLabelText('상담 일시 시각'), { target: { value: '14:30' } });

    // 서버 액션은 이 형식을 그대로 읽는다 — 바뀌면 서버까지 손대야 한다.
    expect(onChange).toHaveBeenCalledWith('2026-08-12T14:30');
  });

  it('저장된 값을 두 칸으로 나눠 되살린다', () => {
    render(<DateTimePickerControl value="2026-08-12T14:30" onChange={vi.fn()} fieldLabel="상담 일시" />);

    expect((screen.getByLabelText('상담 일시 날짜') as HTMLInputElement).value).toBe('2026-08-12');
    expect((screen.getByLabelText('상담 일시 시각') as HTMLInputElement).value).toBe('14:30');
  });

  it('둘 다 비면 빈 값을 낸다 — `T14:30` 같은 반쪽 값이 서버로 가지 않는다', () => {
    const onChange = vi.fn();
    render(<DateTimePickerControl value="2026-08-12T" onChange={onChange} fieldLabel="상담 일시" />);

    fireEvent.change(screen.getByLabelText('상담 일시 날짜'), { target: { value: '' } });

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('이름을 주면 합친 값은 숨은 칸이, 임시본 복원용 이름은 보이는 두 칸이 갖는다', () => {
    const { container } = render(
      <DateTimePickerControl name="heldAt" value="2026-08-12T14:30" onChange={vi.fn()} fieldLabel="상담 일시" />,
    );

    const hidden = container.querySelector('input[type="hidden"][name="heldAt"]') as HTMLInputElement;
    expect(hidden.value).toBe('2026-08-12T14:30');
    // 이름이 없으면 폼 임시본(useDomDraft)이 되살리지 못해 상담 일시가 조용히 사라진다.
    expect(container.querySelector('input[name="heldAtDate"]')).not.toBeNull();
    expect(container.querySelector('input[name="heldAtTime"]')).not.toBeNull();
  });

  it('이름을 안 주면 숨은 칸도 없다 — 자바스크립트로 제출하는 위저드용', () => {
    const { container } = render(
      <DateTimePickerControl value="2026-08-12T14:30" onChange={vi.fn()} fieldLabel="상담 일시" />,
    );

    expect(container.querySelector('input[type="hidden"]')).toBeNull();
  });

  // 2026-07-31 Q 재구성: 팝오버 하나에서 날짜와 시각을 함께 고른다.
  it('팝오버 안에서 시각을 고르면 날짜와 합쳐진 값이 된다', () => {
    const onChange = vi.fn();
    render(<DateTimePickerControl value="2026-08-12T" onChange={onChange} fieldLabel="상담 일시" />);

    fireEvent.click(screen.getByRole('button', { name: '상담 일시 날짜·시각 선택 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '14:30' }));

    expect(onChange).toHaveBeenCalledWith('2026-08-12T14:30');
  });

  it('날짜를 골라도 팝오버가 닫히지 않는다 — 시각이 아직 남아 있다', () => {
    render(<DateTimePickerControl value="2026-08-12T14:30" onChange={vi.fn()} fieldLabel="상담 일시" />);

    fireEvent.click(screen.getByRole('button', { name: '상담 일시 날짜·시각 선택 열기' }));
    const dialog = screen.getByRole('dialog', { name: '상담 일시 날짜·시각 선택' });
    // 날짜 버튼의 접근성 이름은 라이브러리가 로케일로 만든 긴 문장이라 격자에서 칸을 집는다.
    const day20 = Array.from(dialog.querySelectorAll('.rdp-day_button'))
      .find((button) => button.textContent?.trim() === '20');
    fireEvent.click(day20 as HTMLElement);

    expect(screen.getByRole('dialog', { name: '상담 일시 날짜·시각 선택' })).not.toBeNull();
  });

  it('완료를 누르면 닫히고 초점이 여는 버튼으로 돌아온다', () => {
    render(<DateTimePickerControl value="2026-08-12T14:30" onChange={vi.fn()} fieldLabel="상담 일시" />);

    const toggle = screen.getByRole('button', { name: '상담 일시 날짜·시각 선택 열기' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '완료' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '상담 일시 날짜·시각 선택 열기' }));
  });
});

describe('isCompleteDateTime', () => {
  it('`red` 날짜만 채운 반쪽 값을 걸러낸다 — 칸이 둘로 나뉘며 새로 생긴 상태다', () => {
    // 예전 한 칸짜리 datetime-local 은 둘 다 채워야 값을 내줘서 '비어 있지 않다'로 충분했다.
    // 이제는 날짜만 치면 `2026-08-12T` 가 되고 그 검사를 통과해 버린다.
    expect('2026-08-12T'.trim().length === 0).toBe(false);
    expect(isCompleteDateTime('2026-08-12T')).toBe(false);
  });

  it('시각만 채운 값도 걸러낸다', () => {
    expect(isCompleteDateTime('T14:30')).toBe(false);
  });

  it('없는 날짜는 온전한 형식이어도 걸러낸다', () => {
    expect(isCompleteDateTime('2026-02-31T14:30')).toBe(false);
  });

  it('둘 다 채워야 통과한다', () => {
    expect(isCompleteDateTime('')).toBe(false);
    expect(isCompleteDateTime('2026-08-12T14:30')).toBe(true);
  });
});
