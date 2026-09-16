import type { Metadata } from 'next';
import { WireButton, WireFormField } from '@ccc/wire';
import { safeNextPath } from '../lib/safe-next';

export const metadata: Metadata = { title: 'CCC 사례관리 로그인' };

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

const errorMessages: Record<string, string> = {
  // 이메일이 없는 것과 비밀번호가 틀린 것을 가르지 않는다 — 계정 존재 여부가 새지 않게
  // 모든 자격 실패를 한 문구로 뭉친다.
  login_failed: '이메일 또는 비밀번호가 올바르지 않습니다.',
  confirm_email: '가입 확인 메일을 먼저 확인해 주세요. 메일의 링크를 누른 뒤 다시 로그인하세요.',
  service_unavailable: '지금 로그인할 수 없습니다. 잠시 후 다시 시도하세요.',
};


/**
 * 직접 로그인 화면. 이메일·비밀번호를 Supabase Auth 로 교환하고, 받은 access token 을
 * HttpOnly 쿠키(ccc_auth)로 심는다 — 쿠키는 서버가 쓰므로 첫 렌더부터 신원이 맞다.
 *
 * 셸 없는 공개 화면이라 middleware 가 x-ccc-public 을 세우고, 문법은 같은 셸 없는 공개
 * 화면인 /preview 의 게이트 문법(preview-gate 계열 클래스)을 그대로 빌린다.
 * 서버 액션이 아니라 일반 POST + 303 을 쓰는 이유도 /preview/unlock 과 같다 — 서버 액션
 * redirect 는 셸 없는 레이아웃을 재사용해 로그인 직후 사이드바가 사라지는 결함이 있었다.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const errorCode = queryValue(query, 'error');
  const next = safeNextPath(queryValue(query, 'next'));

  return (
    <main className="page-content preview-gate">
      <div className="preview-gate-head">
        <h1>로그인</h1>
        <p>기관에 등록된 이메일과 비밀번호로 로그인하세요.</p>
      </div>

      {errorCode !== undefined ? (
        <p role="alert" className="wire-field-error">
          {errorMessages[errorCode] ?? '로그인하지 못했습니다.'}
        </p>
      ) : null}

      <form className="surface-card preview-gate-card" method="post" action="/login/unlock">
        <input type="hidden" name="next" value={next} />
        <WireFormField label="이메일" required htmlFor="login-email">
          <input id="login-email" type="email" name="email" autoComplete="email" autoFocus required />
        </WireFormField>
        <WireFormField label="비밀번호" required htmlFor="login-password">
          <input id="login-password" type="password" name="password" autoComplete="current-password" required />
        </WireFormField>
        <WireButton type="submit" variant="primary" className="preview-gate-submit">
          로그인
        </WireButton>
        <p className="note-inline">
          비밀번호를 잊었거나 계정이 없으면 기관 관리자에게 문의하세요.
        </p>
      </form>
    </main>
  );
}
