import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { wireStyles } from './wire-styles';
import { WireChoice, WireFormField } from './wire-form-field';

// 폼 입력칸·선택지 행 계약(DESIGN.md §5). 여기 걸린 어서션은 전부 실제 결함에서 나왔다 —
// 라벨이 도움말을 삼키는 접근성 문제, 라디오가 입력칸 규칙을 상속해 세로로 쪼개지던 렌더 결함.

afterEach(cleanup);


describe('WireFormField', () => {
  it('htmlFor 를 주면 라벨만 <label> 이고 도움말은 컨트롤 이름에 섞이지 않는다', () => {
    const { container } = render(
      <WireFormField label="수기 메모" htmlFor="memo" hint="도움말">
        <textarea id="memo" />
      </WireFormField>,
    );

    const label = container.querySelector('label');
    expect(label?.getAttribute('for')).toBe('memo');
    // 도움말이 라벨 안에 들어가면 스크린 리더가 라벨 대신 문단을 읽는다.
    expect(label?.textContent).toBe('수기 메모');
    // 컨트롤에서 가리킬 수 있도록 도움말에 id 를 만들어 준다.
    expect(container.querySelector('#memo-hint')?.textContent).toBe('도움말');
  });

  it('htmlFor 가 없으면 label 이 컨트롤을 감싸 암묵적으로 연결한다', () => {
    const { container } = render(
      <WireFormField label="이름">
        <input />
      </WireFormField>,
    );

    const label = container.querySelector('label.wire-form-field');
    expect(label).not.toBeNull();
    expect(label?.querySelector('input')).not.toBeNull();
  });

  it('필수는 라벨 옆 12/400 컴팩트 아웃라인 배지로, 오류는 테두리와 메시지를 함께 낸다', () => {
    const { container } = render(
      <WireFormField label="연락처" required htmlFor="phone" error="숫자만 입력하세요.">
        <input id="phone" />
      </WireFormField>,
    );

    const required = container.querySelector('.wire-form-label .wire-required-marker');
    expect(required?.textContent).toBe('필수');
    expect(required?.classList.contains('wire-badge')).toBe(true);
    expect(required?.getAttribute('data-tone')).toBe('lavender');
    expect(required?.getAttribute('data-size')).toBe('sm');
    expect(required?.getAttribute('style')).toBeNull();
    expect(wireStyles).toContain(
      '.wire-badge.wire-required-marker{--wire-outline-color:var(--lavender-deep);background:transparent;color:var(--lavender-deep)}',
    );
    expect(container.querySelector('.wire-input-box')?.getAttribute('data-invalid')).toBe('true');
    const message = container.querySelector('.wire-field-error');
    expect(message?.getAttribute('role')).toBe('alert');
    expect(message?.textContent).toBe('숫자만 입력하세요.');
  });

  it('체크박스 보기는 전역으로 아웃라인 알약을 쓴다', () => {
    // 2026-09-04 Q: 인테이크 여러 선택지 한 자리 규칙을 체크박스 보기 전체로 올렸다.
    expect(wireStyles).toContain(
      '.wire-choice:has(>.wire-checkbox){align-items:center;padding:0 var(--space-2-5);border:1px solid var(--line);border-radius:var(--radius-pill);background:var(--panel)}',
    );
    expect(wireStyles).toContain('.wire-choice:has(>.wire-checkbox)>input{margin:0}');
    // 라디오는 이 규칙 밖이다. 알약을 라디오까지 열면 원형 컨트롤 어휘가 사라진다.
    expect(wireStyles).not.toContain('.wire-choice:has(>.wire-radio){align-items:center;padding:0 var(--space-2-5)');
  });


  it('invalid 는 메시지 없이 테두리만 오류 상태로 둔다', () => {
    const { container } = render(
      <WireFormField label="할 일" htmlFor="todo" invalid>
        <input id="todo" />
      </WireFormField>,
    );

    expect(container.querySelector('.wire-input-box')?.getAttribute('data-invalid')).toBe('true');
    // 메시지를 호출부가 이미 그리고 있는 자리다 — 부품이 또 그리면 같은 문장을 두 번 읽는다.
    expect(container.querySelector('.wire-field-error')).toBeNull();
  });

  it('select 변형에만 꺽쇠를 그린다', () => {
    const { container: withSelect } = render(
      <WireFormField label="유형" control="select"><select /></WireFormField>,
    );
    const { container: withInput } = render(<WireFormField label="이름"><input /></WireFormField>);

    expect(withSelect.querySelector('.wire-chevron')).not.toBeNull();
    expect(withInput.querySelector('.wire-chevron')).toBeNull();
  });
});

describe('WireChoice', () => {
  it('라디오·체크박스는 입력칸이 아니라 선택지 규칙을 쓴다', () => {
    const { container } = render(<WireChoice label="완료" type="radio" name="status" value="done" />);

    const input = container.querySelector('input');
    expect(input?.getAttribute('type')).toBe('radio');
    // .wire-input-box 안에 들어가면 width:100% 를 상속해 동그라미가 칸을 가로지른다.
    expect(container.querySelector('.wire-input-box')).toBeNull();
    expect(input?.className).toBe('wire-radio');
    expect(container.querySelector('.wire-choice-text')?.textContent).toBe('완료');
  });

  it('체크박스 리스크 변형은 data-tone 으로만 갈린다', () => {
    const { container } = render(<WireChoice label="위기 발언" type="checkbox" tone="risk" />);

    const input = container.querySelector('input');
    expect(input?.className).toBe('wire-checkbox');
    expect(input?.getAttribute('data-tone')).toBe('risk');
  });
});
