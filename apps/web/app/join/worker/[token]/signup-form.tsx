'use client';

import { useState } from 'react';
import { WireError } from '../../../components/wire/wire-state';
import { signupWorkerAction, type WorkerSignupResult } from '../../../actions';
import { WireButton } from '../../../components/wire/wire-button';
import { SearchInput } from '../../../components/wire/search-input';

// 공개 실무자 초대 가입 폼(CCC-108 · CCC-33). participant 가입 폼(signup-form.tsx)과 같은
// 구조 — 인증 없는 공개 경로라 서버 액션도 공개 API(signupWorker)만 부른다. 성공 시
// 리다이렉트 없이 인라인 완료 패널: 실무자는 여기서 끝나는 것이 아니라 **Cloudflare
// Access 로 로그인**해서 들어와야 하므로 그 다음 걸음을 완료 패널이 말해 준다.
//
// 동의 체크가 없는 이유: 당사자 가입의 동의 2종(D49)은 당사자 PII·녹취에 대한 것이고,
// 실무자는 시스템의 운영 주체다 — 등재는 관리자 초대(감사 전건)로 근거가 남는다.

type SignupState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; email: string };

const ERROR_MESSAGES: Record<string, string> = {
  not_found: '이 링크는 사용할 수 없거나 이미 완료되었습니다.',
  validation_error: '입력한 정보를 확인해 주세요.',
  invalid_request: '입력한 정보를 확인해 주세요.',
  conflict: '이미 등록된 이메일입니다. 기관 관리자에게 문의해 주세요.',
  service_unavailable: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
};

export function WorkerSignupForm({ token }: { token: string }) {
  const [state, setState] = useState<SignupState>({ phase: 'idle' });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState({ phase: 'working' });
    const formData = new FormData(e.currentTarget);
    formData.set('token', token);
    const result: WorkerSignupResult = await signupWorkerAction(formData);
    if (result.status === 'created') {
      setState({ phase: 'done', email: result.email });
    } else {
      setState({ phase: 'error', message: ERROR_MESSAGES[result.status] ?? '알 수 없는 오류가 발생했습니다.' });
    }
  };

  if (state.phase === 'done') {
    return (
      <div className="wire-signup-done" role="status">
        <h2>가입이 완료되었습니다</h2>
        <p>
          이제 <strong>Cloudflare Access</strong> 로 로그인할 수 있습니다. 시스템 주소로
          접속해 가입에 쓴 이메일(<strong>{state.email}</strong>)로 인증하면 바로 들어갑니다.
          별도 비밀번호는 없습니다.
        </p>
      </div>
    );
  }

  return (
    <form className="wire-register-form" onSubmit={handleSubmit}>
      <div className="wire-container" data-grid="true">
        <div className="wire-col-6">
          <SearchInput label="이름" name="name" placeholder="실무자 이름" />
        </div>
        <div className="wire-col-6">
          {/* 이메일은 Cloudflare Access 의 신원 키 — 이 주소로 로그인하게 되므로 필수다. */}
          <SearchInput label="이메일" name="email" placeholder="worker@example.org" />
        </div>
      </div>
      <p className="schedule-form-hint">
        입력한 이메일이 로그인 계정이 됩니다. 기관에서 실제로 쓰는 이메일을 입력해 주세요.
      </p>

      {state.phase === 'error' && (
        <WireError>{state.message}</WireError>
      )}

      <WireButton type="submit" size="large" chevron className="wire-register-submit" disabled={state.phase === 'working'}>
        {state.phase === 'working' ? '처리 중…' : '가입 완료'}
      </WireButton>
    </form>
  );
}
