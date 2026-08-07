import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { BasicInfoForm } from './basic-info-form';
import type { ParticipantBasicInfo } from '../../../lib/api';

const noop = (): void => {};

const BASIC_INFO: ParticipantBasicInfo = {
  beneficiaryId: 'swallow-003',
  supportCaseContextId: '11111111-1111-4111-8111-111111111111',
  version: 3,
  name: '홍서희',
  phone: '010-1234-5678',
  email: 'hong@example.test',
  account: '국민 000-00-0000',
  birthDate: '1984-03-11',
  region: '서울시 은평구',
  gender: '여성',
};

// 레인 D: 이 파일에 afterEach(cleanup) 이 없었다. 없으면 파일이 끝난 뒤 jsdom 이 내려가는
// 동안 React 가 남은 작업을 돌려 `window is not defined` 가 터지고, **테스트가 전부 통과해도
// 종료코드가 1** 이 된다(CI 는 그 숫자만 본다). 이 레인이 이 파일을 만지므로 여기서 닫는다 —
// 남은 파일 9개는 STATUS 다음 할 일 3번이다.
afterEach(cleanup);

describe('BasicInfoForm (CCC-37 당사자 기본정보 수정)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('fills every one of the seven fields with the stored value', () => {
    const { container } = render(<BasicInfoForm basicInfo={BASIC_INFO} action={noop} />);
    const form = container.querySelector('form') as HTMLFormElement;
    const data = new FormData(form);
    expect(data.get('name')).toBe('홍서희');
    expect(data.get('phone')).toBe('010-1234-5678');
    expect(data.get('email')).toBe('hong@example.test');
    expect(data.get('account')).toBe('국민 000-00-0000');
    expect(data.get('birthDate')).toBe('1984-03-11');
    expect(data.get('region')).toBe('서울시 은평구');
    expect(data.get('gender')).toBe('여성');
  });

  it('carries the write context and the optimistic version untouched', () => {
    const { container } = render(<BasicInfoForm basicInfo={BASIC_INFO} action={noop} />);
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('beneficiaryId')).toBe('swallow-003');
    expect(data.get('supportCaseContextId')).toBe('11111111-1111-4111-8111-111111111111');
    expect(data.get('expectedVersion')).toBe('3');
  });

  it('sends an emptied field as an empty value so the server clears it', () => {
    const { container } = render(<BasicInfoForm basicInfo={BASIC_INFO} action={noop} />);
    const account = container.querySelector('input[name="account"]') as HTMLInputElement;
    fireEvent.change(account, { target: { value: '' } });
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('account')).toBe('');
  });

  it('shows every field of a participant whose vault is still empty', () => {
    const empty: ParticipantBasicInfo = {
      ...BASIC_INFO,
      name: null, phone: null, email: null, account: null, birthDate: null, region: null, gender: null,
    };
    const { container } = render(<BasicInfoForm basicInfo={empty} action={noop} />);
    for (const field of ['name', 'phone', 'email', 'account', 'birthDate', 'region']) {
      expect((container.querySelector(`input[name="${field}"]`) as HTMLInputElement).value).toBe('');
    }
    expect((container.querySelector('select[name="gender"]') as HTMLSelectElement).value).toBe('');
  });

  // R3: 금고 값은 브라우저 임시본에 담지 않는다 — 인테이크 임시본이 금고 값을 빼는 것과 같은 규율.
  it('never writes PII to browser storage', () => {
    const { container } = render(<BasicInfoForm basicInfo={BASIC_INFO} action={noop} />);
    fireEvent.change(container.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: '김보름' },
    });
    const stored = [window.localStorage, window.sessionStorage]
      .flatMap((store) => Object.keys(store).map((key) => `${key}:${store.getItem(key)}`))
      .join('|');
    expect(stored).not.toContain('홍서희');
    expect(stored).not.toContain('김보름');
    expect(stored).not.toContain('010-1234-5678');
    expect(stored).not.toContain('국민 000-00-0000');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

/** React 는 액션 폼의 submit 을 스스로 가로채므로(defaultPrevented 로는 판정 불가)
 *  게이트 판정은 **액션 호출 여부**로 한다. 액션은 transition 에서 비동기로 돌아
 *  한 틱 기다린 뒤 확인한다. */
async function flushActions() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// 2026-08-07 Q: 값이 있던 칸을 비운 채 저장하면 그 칸 아래 경고가 뜨고 제출이 한 번 막힌다.
// 같은 상태로 한 번 더 제출해야 통과한다 — 조용한 금고 삭제(빈칸 저장 = 항목 삭제) 방지 게이트다.
describe('기본정보 수정 폼 — 빈칸 저장 경고 게이트 (2026-08-07)', () => {
  it('값이 있던 칸을 비우면 첫 제출이 막히고 그 칸 아래 경고가 뜬다', async () => {
    const action = vi.fn();
    const { container } = render(<BasicInfoForm basicInfo={BASIC_INFO} action={action} />);
    const form = container.querySelector('#basic-info-form') as HTMLFormElement;
    const phone = container.querySelector('#basicInfoPhone') as HTMLInputElement;

    fireEvent.change(phone, { target: { value: '' } });
    fireEvent.submit(form);
    await flushActions();

    expect(action).not.toHaveBeenCalled(); // preventDefault — 서버 액션이 돌지 않는다.
    const warning = container.querySelector('.wire-field-error');
    expect(warning?.textContent).toContain('빈칸으로 저장하면 항목이 삭제됩니다');
    // 경고는 비운 칸(휴대전화)에만 붙는다.
    expect(container.querySelectorAll('.wire-field-error')).toHaveLength(1);
  });

  it('경고를 본 뒤 같은 상태로 한 번 더 제출하면 통과한다 (삭제 의사 확인)', async () => {
    const action = vi.fn();
    const { container } = render(<BasicInfoForm basicInfo={BASIC_INFO} action={action} />);
    const form = container.querySelector('#basic-info-form') as HTMLFormElement;
    const phone = container.querySelector('#basicInfoPhone') as HTMLInputElement;

    fireEvent.change(phone, { target: { value: '' } });
    fireEvent.submit(form);
    await flushActions();
    expect(action).not.toHaveBeenCalled();

    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1)); // 두 번째는 막지 않는다.
  });

  it('비운 칸을 되채우면 경고 게이트 없이 바로 제출된다', async () => {
    const action = vi.fn();
    const { container } = render(<BasicInfoForm basicInfo={BASIC_INFO} action={action} />);
    const form = container.querySelector('#basic-info-form') as HTMLFormElement;
    const phone = container.querySelector('#basicInfoPhone') as HTMLInputElement;

    fireEvent.change(phone, { target: { value: '' } });
    fireEvent.submit(form);
    await flushActions();
    expect(action).not.toHaveBeenCalled();

    fireEvent.change(phone, { target: { value: '010-9999-0000' } });
    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });

  it('처음부터 비어 있던 칸은 경고 대상이 아니다', async () => {
    const action = vi.fn();
    const empty: ParticipantBasicInfo = {
      ...BASIC_INFO,
      region: null,
      account: null,
    };
    const { container } = render(<BasicInfoForm basicInfo={empty} action={action} />);
    const form = container.querySelector('#basic-info-form') as HTMLFormElement;

    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(container.querySelectorAll('.wire-field-error')).toHaveLength(0);
  });
});
