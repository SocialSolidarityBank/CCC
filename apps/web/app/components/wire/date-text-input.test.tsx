import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DateTextInput, dateTextHint, formatDateDigits } from './date-text-input';
import { SearchInput } from './search-input';

// 레인 D — 날짜 입력. 여기 걸린 어서션은 전부 실제 결함(훑기 R6)과 KRDS 규격에서 나왔다:
// 네이티브 날짜 칸의 표기가 보는 사람의 브라우저 언어를 따라 팀원마다 달랐고, 그래서
// 글자 입력으로 갈아탔다. 제출값이 예전과 **글자 그대로 같아야** 서버를 안 건드린다.

afterEach(cleanup);

describe('formatDateDigits', () => {
  it('숫자를 연-월-일로 끊는다', () => {
    expect(formatDateDigits('1985')).toBe('1985');
    expect(formatDateDigits('198503')).toBe('1985-03');
    expect(formatDateDigits('19850327')).toBe('1985-03-27');
  });

  it('이미 하이픈이 있는 값을 다시 넣어도 그대로다 (기존 저장값 복원)', () => {
    expect(formatDateDigits('1985-03-27')).toBe('1985-03-27');
  });

  it('연도만 적은 상태에서 끝에 하이픈을 붙이지 않는다', () => {
    // 붙이면 지울 때 하이픈이 되돌아와 한 칸에서 맴돈다.
    expect(formatDateDigits('1985')).not.toMatch(/-$/);
  });

  it('점·슬래시로 적힌 값을 붙여넣어도 받는다', () => {
    // 한국 문서에서 흔한 표기다(KRDS 도 YYYY.MM.DD 를 예로 든다).
    expect(formatDateDigits('1985.03.27')).toBe('1985-03-27');
    expect(formatDateDigits('1985/03/27')).toBe('1985-03-27');
  });

  it('9자리째부터는 버린다', () => {
    expect(formatDateDigits('198503271')).toBe('1985-03-27');
  });

  it('`yellow` 자릿수가 안 맞는 붙여넣기는 바로잡지 않는다 — pattern 이 막는다', () => {
    // '1985년 3월 27일' → 숫자만 남기면 7자리라 월·일이 밀린다. 이 부품은 자릿수를 추측하지
    // 않는다(3월을 03월로 고쳐 주면 다른 오입력도 조용히 고쳐 틀린 값을 통과시킨다).
    expect(formatDateDigits('1985년 3월 27일')).toBe('1985-32-7');
  });

  it('빈 값은 빈 값이다 (미입력 허용)', () => {
    expect(formatDateDigits('')).toBe('');
  });
});

describe('DateTextInput', () => {
  it('네이티브 날짜 칸이 아니다 — 표기가 보는 사람 환경에 흔들리지 않는다', () => {
    const { container } = render(<DateTextInput name="birthDate" />);
    const input = container.querySelector('input');

    expect(input?.getAttribute('type')).toBe('text');
    // 숫자만 적는 값이라 모바일에서 숫자 자판이 떠야 한다.
    expect(input?.getAttribute('inputmode')).toBe('numeric');
    expect(input?.getAttribute('placeholder')).toBe('YYYY-MM-DD');
  });

  it('숫자만 쳐도 하이픈이 들어가고 제출값이 YYYY-MM-DD 다', () => {
    const { container } = render(<DateTextInput name="birthDate" />);
    const input = container.querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '19850327' } });

    // 서버 액션·게이트웨이가 이 형식을 그대로 검증한다(actions.ts \d{4}-\d{2}-\d{2}).
    expect(input.value).toBe('1985-03-27');
  });

  it('저장된 값을 그대로 되살린다', () => {
    const { container } = render(<DateTextInput name="birthDate" defaultValue="1984-03-11" />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('1984-03-11');
  });

  it('형식이 어긋난 값은 화면에서 막는다', () => {
    const { container } = render(<DateTextInput name="birthDate" />);
    const input = container.querySelector('input') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '1985' } });

    // pattern 이 있어야 브라우저가 제출을 막는다. 서버도 같은 정규식으로 다시 막는다.
    expect(input.getAttribute('pattern')).toBe('\\d{4}-\\d{2}-\\d{2}');
    expect(input.checkValidity()).toBe(false);
  });

  it('도움말을 aria-describedby 로 잇는다 (KRDS · 스크린 리더가 형식을 함께 읽는다)', () => {
    const { container } = render(<DateTextInput name="birthDate" describedBy="bd-hint" />);
    expect(container.querySelector('input')?.getAttribute('aria-describedby')).toBe('bd-hint');
  });
});

describe('SearchInput type="date"', () => {
  it('네이티브 날짜 칸 대신 글자 입력을 그린다', () => {
    const { container } = render(<SearchInput label="생년월일" type="date" name="birthDate" />);
    const input = container.querySelector('input');

    expect(input?.getAttribute('type')).toBe('text');
    expect(input?.getAttribute('name')).toBe('birthDate');
  });

  it('도움말이 자리 표시자 대신 칸 아래 남는다 (KRDS: 자리 표시자는 입력하면 사라진다)', () => {
    const { container } = render(<SearchInput label="생년월일" type="date" name="birthDate" />);

    const hint = container.querySelector('#birthDate-hint');
    expect(hint?.textContent).toBe(dateTextHint('1985-03-27'));
    expect(container.querySelector('input')?.getAttribute('aria-describedby')).toBe('birthDate-hint');
  });

  it('날짜가 아닌 칸은 예전 그대로다 — 이 변경이 다른 입력칸에 새지 않는다', () => {
    const { container } = render(<SearchInput label="이름" name="name" placeholder="당사자 이름" />);
    const input = container.querySelector('input');

    expect(input?.getAttribute('type')).toBe('text');
    expect(input?.getAttribute('inputmode')).toBeNull();
    expect(container.querySelector('#name-hint')).toBeNull();
  });
});
