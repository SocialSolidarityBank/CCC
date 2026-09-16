'use client';

import {
  WireButton,
  WireError,
} from '@ccc/wire';
import { useState } from 'react';
import { acceptStaffInviteAction, type StaffInviteAcceptResult } from '../../../actions';
import { SearchInput } from '../../../components/wire/search-input';

// 공개 실무자 초대 수락 폼(D86 · D90). participant 가입 폼과 같은 구조지만 한 단계가
// 더 있다: 서버가 수락에 검증된 Supabase 신원(authSubject)을 요구하므로, 이 폼은
// 먼저 Supabase 에 계정을 만들거나 로그인한 뒤 그 access token 으로 수락을 요청한다.
// 성공하면 서버 액션이 ccc_auth 쿠키까지 심으므로 완료 패널에서 곧바로 들어갈 수 있다.
//
// 동의 체크가 없는 이유: 당사자 가입의 동의 2종(D49)은 당사자 PII·녹취에 대한 것이고,
// 실무자는 시스템의 운영 주체다 — 등재는 관리자 초대(감사 전건)로 근거가 남는다.

type AcceptState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error'; message: string }
  | { phase: 'confirm_email' }
  | { phase: 'done'; email: string; roleWaiting: boolean };

const ERROR_MESSAGES: Record<string, string> = {
  // 토큰 무효·이메일 불일치·이미 소비는 서버가 같은 404 로 뭉친다 — 화면도 한 문구다.
  not_found: '이 링크는 사용할 수 없거나 이미 완료되었습니다. 초대받은 이메일인지 확인해 주세요.',
  validation_error: '입력한 정보를 확인해 주세요.',
  invalid_request: '입력한 정보를 확인해 주세요. 이미 계정이 있다면 그 비밀번호를 입력하세요.',
  conflict: '이미 등록된 이메일입니다. 기관 관리자에게 문의해 주세요.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 시도해 주세요.',
  service_unavailable: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
};

export function StaffInviteAcceptForm({ token }: { token: string }) {
  const [state, setState] = useState<AcceptState>({ phase: 'idle' });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState({ phase: 'working' });
    const formData = new FormData(e.currentTarget);
    formData.set('token', token);
    const result: StaffInviteAcceptResult = await acceptStaffInviteAction(formData);
    if (result.status === 'created') {
      setState({ phase: 'done', email: result.email, roleWaiting: result.roleWaiting });
    } else if (result.status === 'confirm_email') {
      setState({ phase: 'confirm_email' });
    } else {
      setState({ phase: 'error', message: ERROR_MESSAGES[result.status] ?? '알 수 없는 오류가 발생했습니다.' });
    }
  };

  if (state.phase === 'done') {
    return (
      <div className="wire-signup-done" role="status">
        <h2>가입이 완료되었습니다</h2>
        <p>
          {state.roleWaiting
            ? '계정이 만들어졌습니다. 기관 관리자가 역할을 배정하면 업무 화면이 열립니다.'
            : '이제 바로 업무 화면으로 들어갈 수 있습니다.'}
          {' '}다음부터는 로그인 화면에서 이메일(<strong>{state.email}</strong>)과
          방금 만든 비밀번호로 들어옵니다.
        </p>
        <WireButton variant="primary" href="/">
          업무 화면으로 이동
        </WireButton>
      </div>
    );
  }

  if (state.phase === 'confirm_email') {
    return (
      <div className="wire-signup-done" role="status">
        <h2>확인 메일을 보냈습니다</h2>
        <p>
          입력한 이메일로 가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 이 화면으로
          돌아와 아래 버튼을 누르고 같은 정보를 입력하면 가입이 완료됩니다.
        </p>
        <WireButton variant="primary" onClick={() => setState({ phase: 'idle' })}>
          이메일 확인 뒤 계속하기
        </WireButton>
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
          {/* 이메일은 초대에 묶인 주소와 같아야 한다 — 다르면 서버가 링크 무효와 같은
              404 로 거절한다(D90). 로그인 계정이 되는 주소이기도 하다. */}
          <SearchInput label="이메일" name="email" type="email" placeholder="worker@example.org" />
        </div>
      </div>
      <SearchInput
        label="비밀번호"
        name="password"
        type="password"
        hint="로그인에 쓸 비밀번호입니다. 이미 계정이 있다면 그 비밀번호를 입력하세요."
      />
      <p className="schedule-form-hint">
        초대받은 이메일을 입력해 주세요. 다른 이메일이면 수락되지 않습니다.
      </p>

      {state.phase === 'error' && (
        <WireError>{state.message}</WireError>
      )}

      <WireButton type="submit" size="large" className="wire-register-submit" disabled={state.phase === 'working'}>
        {state.phase === 'working' ? '처리 중…' : '가입 완료'}
      </WireButton>
    </form>
  );
}
