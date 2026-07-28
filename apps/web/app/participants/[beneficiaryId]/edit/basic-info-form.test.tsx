import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
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
