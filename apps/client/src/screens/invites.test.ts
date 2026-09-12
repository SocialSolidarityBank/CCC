// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaffJoinScreen } from './invites';
import { PublicJoinApi } from '../business/invites';
import { PublicTransport } from '../business/transport';
import type { PublicSession } from '../business/session';
import { installation, json } from '../business/test-support';

const token = 'synthetic-staff-invite-token';
const invitedEmail = 'invited@example.invalid';
const password = 'synthetic-passphrase';

interface Call { label: string; body: string; authorization: string | null }

/** 초대 조회와 수락은 실제 전송기로 돌리고 네트워크 경계만 합성 서버로 바꾼다. */
async function harness(options: { accessToken?: string | null; accept?: Response } = {}) {
  const accessToken = options.accessToken === undefined ? 'synthetic-access-token' : options.accessToken;
  const verified = await installation();
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const { pathname } = new URL(request.url);
    const path = pathname.replace('/functions/v1/ccc', '');
    calls.push({
      label: `${request.method} ${path}`,
      body: await request.clone().text(),
      authorization: request.headers.get('authorization'),
    });
    if (path === `/staff-invites/token/${token}`) {
      return json({ orgName: '합성 기관', roles: ['practitioner'], expiresAt: '2026-12-31T00:00:00Z' });
    }
    if (path === `/staff-invites/token/${token}/accept`) {
      return options.accept ?? json({ userId: 'user-1', email: invitedEmail, roleWaiting: false });
    }
    return json({ error: 'not_found' }, 404);
  };
  const session: PublicSession = {
    publicJoin: new PublicJoinApi(new PublicTransport(verified, fetcher)),
    signUp: async (email, secret) => {
      calls.push({ label: 'signUp', body: JSON.stringify({ email, password: secret }), authorization: null });
      return { accessToken };
    },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const mounted = createRoot(container);
  roots.add({ mounted, container });
  await act(async () => {
    mounted.render(createElement(RouterProvider, {
      router: createMemoryRouter([{
        element: createElement(() => createElement(Outlet, { context: session })),
        children: [{ path: '/staff/join', element: createElement(StaffJoinScreen) }],
      }], { initialEntries: [`/staff/join#t=${token}`] }),
    }));
  });
  return { calls, container };
}

const roots = new Set<{ mounted: Root; container: HTMLElement }>();
afterEach(async () => {
  for (const { mounted, container } of roots) {
    await act(async () => { mounted.unmount(); });
    container.remove();
  }
  roots.clear();
  vi.unstubAllGlobals();
});

function fill(container: HTMLElement, values: Record<string, string>): Promise<void> {
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  return act(async () => {
    for (const [id, value] of Object.entries(values)) {
      const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
      native.call(input, value);
      // 제어 입력(이름·이메일)은 React 상태로 올라가야 하고, 비밀번호는 폼 값으로만 읽힌다.
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

const submit = (container: HTMLElement) => act(async () => {
  container.querySelector('form')!.requestSubmit();
});

describe('실무자 초대 수락과 첫 계정 생성', () => {
  it('계정을 먼저 만들고 그 자격으로 초대를 수락한다', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { calls, container } = await harness();
    await fill(container, {
      'staff-join-name': '합성 실무자',
      'staff-join-email': invitedEmail,
      'staff-join-password': password,
      'staff-join-password-confirm': password,
    });
    await submit(container);
    expect(calls.map((call) => call.label)).toEqual([
      `GET /staff-invites/token/${token}`,
      'signUp',
      `POST /staff-invites/token/${token}/accept`,
    ]);
    const accept = calls.find((call) => call.label.endsWith('/accept'))!;
    expect(accept.authorization).toBe('Bearer synthetic-access-token');
    expect(JSON.parse(accept.body)).toEqual({ name: '합성 실무자', email: invitedEmail });
    expect(JSON.parse(calls.find((call) => call.label === 'signUp')!.body)).toEqual({ email: invitedEmail, password });
    for (const call of calls.filter((candidate) => candidate.label !== 'signUp')) {
      expect(call.body).not.toContain(password);
    }
    expect(container.textContent).toContain('가입이 끝났습니다');
  });


  it('확인 값이 다르면 수락도 계정 생성도 하지 않는다', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { calls, container } = await harness();
    await fill(container, {
      'staff-join-name': '합성 실무자',
      'staff-join-email': invitedEmail,
      'staff-join-password': password,
      'staff-join-password-confirm': `${password}-다른값`,
    });
    await submit(container);
    expect(calls.map((call) => call.label)).toEqual([`GET /staff-invites/token/${token}`]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('같은 비밀번호');
  });

  it('세션 없이 만들어진 계정은 자격 없이 수락만 보낸다', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { calls, container } = await harness({ accessToken: null });
    await fill(container, {
      'staff-join-name': '합성 실무자',
      'staff-join-email': invitedEmail,
      'staff-join-password': password,
      'staff-join-password-confirm': password,
    });
    await submit(container);
    expect(calls.find((call) => call.label.endsWith('/accept'))!.authorization).toBeNull();
    expect(container.textContent).toContain('가입이 끝났습니다');
  });

  it('초대를 쓸 수 없으면 그대로 알린다', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const { container } = await harness({ accept: json({ error: 'not_found' }, 404) });
    await fill(container, {
      'staff-join-name': '합성 실무자',
      'staff-join-email': invitedEmail,
      'staff-join-password': password,
      'staff-join-password-confirm': password,
    });
    await submit(container);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('가입이 끝났습니다');
  });
});
