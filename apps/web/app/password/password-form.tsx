'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { WireButton, WireFormField } from '@ccc/wire';

/**
 * 비밀번호 설정 화면의 클라이언트 절반.
 *
 * Supabase 가 recovery 링크를 검증한 뒤 redirect_to 로 보낼 때 자격은 URL fragment
 * (#access_token=…&type=recovery)에 온다. fragment 는 서버에 전달되지 않으므로 이 값을
 * 읽는 것은 반드시 클라이언트다 — 서버 컴포넌트에서 읽으려 하면 빈 값이다.
 *
 * 토큰은 메모리(useRef)에만 두고 한 번의 PUT /auth/v1/user 에만 쓴다. 우리 서버로
 * 보내지 않고 쿠키에도 담지 않는다 — 비밀번호 설정 한 번에 쓰고 버리는 자격이다.
 * 비밀번호도 같은 규칙이다: Supabase 로만 가고 우리 서버·로그에 남지 않는다.
 *
 * site_url 이 루트로 떨어지거나 /login 으로 넘어온 fragment 도 같은 화면이 받는다
 * (/login 의 RecoveryFragmentForwarder 가 fragment 채로 여기로 보낸다).
 */

type TokenState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unsupported'; type: string }
  | { kind: 'missing' };

const GENERIC_INVALID = '링크가 만료되었거나 이미 사용되었습니다. 로그인 화면에서 재설정 메일을 다시 요청하세요.';

function readTokenState(): TokenState {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (hash.length === 0) {
    // 해시 없이 온 경우 쿼리의 token_hash(이메일 클라이언트가 #을 잘라 먹는 경우)를 본다.
    const query = new URLSearchParams(window.location.search);
    if (query.get('token_hash') !== null) {
      return { kind: 'invalid', message: '링크 형식이 달라 이 화면에서 처리할 수 없습니다. 로그인 화면에서 재설정 메일을 다시 요청하세요.' };
    }
    return { kind: 'missing' };
  }
  const params = new URLSearchParams(hash);
  const errorCode = params.get('error_code') ?? params.get('error');
  if (errorCode !== null) {
    return { kind: 'invalid', message: GENERIC_INVALID };
  }
  const type = params.get('type') ?? '';
  const accessToken = params.get('access_token') ?? '';
  if (type !== 'recovery') {
    return { kind: 'unsupported', type: type.length > 0 ? type : 'unknown' };
  }
  if (accessToken.length === 0) return { kind: 'invalid', message: GENERIC_INVALID };
  return { kind: 'ready' };
}

export function PasswordSetForm({ authOrigin, publishableKey }: { authOrigin: string; publishableKey: string }) {
  const [tokenState, setTokenState] = useState<TokenState>({ kind: 'checking' });
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(false);
  const tokenRef = useRef('');

  useEffect(() => {
    const hash = window.location.hash;
    const state = readTokenState();
    if (state.kind === 'ready') {
      tokenRef.current = new URLSearchParams(hash.slice(1)).get('access_token') ?? '';
    }
    // 자격이 URL·히스토리에 남지 않게 즉시 지운다. 화면 상태는 이미 읽었다.
    if (hash.length > 0) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    setTokenState(state);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const confirm = (form.elements.namedItem('password_confirm') as HTMLInputElement).value;
    if (password.length < 8) {
      setError('비밀번호는 8자 이상으로 정하세요.');
      return;
    }
    if (password !== confirm) {
      setError('두 번 입력한 비밀번호가 서로 다릅니다.');
      return;
    }
    setError(null);
    setWorking(true);
    try {
      const response = await fetch(`${authOrigin}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json; charset=utf-8',
          apikey: publishableKey,
          authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        tokenRef.current = '';
        setDone(true);
        return;
      }
      const payload: unknown = await response.json().catch(() => null);
      const code = payload !== null && typeof payload === 'object'
        ? String((payload as Record<string, unknown>).error_code ?? (payload as Record<string, unknown>).code ?? '')
        : '';
      if (code === 'weak_password') {
        setError('더 길거나 추측하기 어려운 비밀번호를 정하세요.');
      } else if (response.status === 401 || response.status === 403 || code === 'bad_jwt' || code === 'session_expired') {
        tokenRef.current = '';
        setTokenState({ kind: 'invalid', message: GENERIC_INVALID });
      } else {
        setError('비밀번호를 설정하지 못했습니다. 잠시 후 다시 시도하세요.');
      }
    } catch {
      setError('비밀번호를 설정하지 못했습니다. 잠시 후 다시 시도하세요.');
    } finally {
      setWorking(false);
    }
  }

  if (tokenState.kind === 'checking') {
    return <p className="note-inline">링크를 확인하고 있습니다…</p>;
  }

  if (tokenState.kind === 'missing') {
    return (
      <>
        <p role="alert" className="wire-field-error">
          비밀번호 설정 링크 없이 열린 화면입니다. 메일의 링크로 다시 들어오세요.
        </p>
        <p className="note-inline">
          메일이 없으면 <a href="/login">로그인 화면</a>에서 재설정 메일을 요청하세요.
        </p>
      </>
    );
  }

  if (tokenState.kind === 'invalid') {
    return (
      <>
        <p role="alert" className="wire-field-error">{tokenState.message}</p>
        <p className="note-inline">
          <a href="/login">로그인 화면</a>에서 재설정 메일을 다시 요청할 수 있습니다.
        </p>
      </>
    );
  }

  if (tokenState.kind === 'unsupported') {
    return (
      <>
        <p role="alert" className="wire-field-error">
          이 링크는 이 화면에서 처리할 수 없는 종류입니다.
        </p>
        <p className="note-inline">
          초대·가입 링크라면 메일의 안내를 따르고, 그래도 안 되면 기관 관리자에게 문의하세요.
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <p className="note-inline">비밀번호를 설정했습니다. 새 비밀번호로 다시 로그인하세요.</p>
        <WireButton href="/login" variant="primary" className="preview-gate-submit">
          로그인으로 이동
        </WireButton>
      </>
    );
  }

  return (
    <form className="surface-card preview-gate-card" onSubmit={submit}>
      {error !== null ? (
        <p role="alert" className="wire-field-error">{error}</p>
      ) : null}
      <WireFormField label="새 비밀번호" required htmlFor="password-new" hint="8자 이상으로 정하세요.">
        <input id="password-new" type="password" name="password" autoComplete="new-password" required />
      </WireFormField>
      <WireFormField label="새 비밀번호 확인" required htmlFor="password-confirm">
        <input id="password-confirm" type="password" name="password_confirm" autoComplete="new-password" required />
      </WireFormField>
      <WireButton type="submit" variant="primary" className="preview-gate-submit" disabled={working}>
        {working ? '설정하는 중…' : '비밀번호 설정'}
      </WireButton>
    </form>
  );
}
