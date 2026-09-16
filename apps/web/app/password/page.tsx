import type { Metadata } from 'next';
import { PasswordSetForm } from './password-form';

export const metadata: Metadata = { title: 'CCC 사례관리 비밀번호 설정' };

/**
 * 비밀번호 설정 화면. Supabase recovery·초대 메일의 링크가 착지하는 곳이다.
 *
 * 자격(access_token)은 URL fragment 로 오므로 서버가 볼 수 없다 — 읽고 쓰는 것은
 * 전부 클라이언트(password-form)다. 이 서버 컴포넌트가 하는 일은 Supabase 주소와
 * publishable 키를 넘기는 것뿐이다. 둘 다 공개 가능한 값이다(브라우저가 Supabase 와
 * 직접 통신해야 하므로 번들에 실리는 것이 설계다 — anon/publishable 키는 원래 공개다).
 *
 * env 가 없으면 표면을 닫는다 — supabase-auth.ts 의 '없음이 곧 닫힘' 규약과 같다.
 */
export default function PasswordPage() {
  const authOrigin = process.env.CCC_SUPABASE_AUTH_ORIGIN?.trim().replace(/\/+$/, '');
  const publishableKey = process.env.CCC_SUPABASE_PUBLISHABLE_KEY?.trim();

  return (
    <main className="page-content preview-gate">
      <div className="preview-gate-head">
        <h1>비밀번호 설정</h1>
        <p>메일의 링크로 들어온 사람이 새 비밀번호를 정하는 화면입니다.</p>
      </div>
      {authOrigin !== undefined && authOrigin.length > 0 && publishableKey !== undefined && publishableKey.length > 0 ? (
        <PasswordSetForm authOrigin={authOrigin} publishableKey={publishableKey} />
      ) : (
        <p role="alert" className="wire-field-error">
          지금 비밀번호를 설정할 수 없습니다. 기관 관리자에게 문의하세요.
        </p>
      )}
    </main>
  );
}
