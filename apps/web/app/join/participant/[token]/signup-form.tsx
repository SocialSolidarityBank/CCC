'use client';

import { useState } from 'react';
import { signupParticipantAction, type ParticipantSignupResult } from '../../../actions';
import { WireButton } from '../../../components/wire/wire-button';
import { SearchInput } from '../../../components/wire/search-input';

// 공개 참여자 가입 폼(CCC-28 · D39 · ADR-0016 #4). 인증 없는 공개 경로에서 동작하므로
// 서버 액션도 공개 API(signupParticipant)만 부른다. 성공 시 리다이렉트 없이 인라인
// "가입 완료" 패널을 보여준다 — 참여자는 브리핑 화면으로 갈 이유가 없다(상담사 화면이다).
//
// 입력칸은 SearchInput(등록 폼과 같은 부품), 동의는 consent-checkbox 라벨(등록 폼과 같은
// 마크업). WireFormField 는 children 으로 컨트롤을 받는 구조라 여기와 맞지 않는다.
// 필수(이름) 표시는 등록 폼과 마찬가지로 서버가 강제하고 시각 표지는 두지 않는다.

type SignupState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error'; message: string }
  | { phase: 'done' };

const ERROR_MESSAGES: Record<string, string> = {
  not_found: '이 링크는 사용할 수 없거나 이미 완료되었습니다.',
  validation_error: '입력한 정보를 확인해 주세요.',
  conflict: '이미 가입이 완료되었습니다.',
  service_unavailable: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
};

export function SignupForm({ token }: { token: string }) {
  const [state, setState] = useState<SignupState>({ phase: 'idle' });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setState({ phase: 'working' });
    const formData = new FormData(e.currentTarget);
    formData.set('token', token);
    const result: ParticipantSignupResult = await signupParticipantAction(formData);
    if (result.status === 'created') {
      setState({ phase: 'done' });
    } else {
      setState({ phase: 'error', message: ERROR_MESSAGES[result.status] ?? '알 수 없는 오류가 발생했습니다.' });
    }
  };

  if (state.phase === 'done') {
    return (
      <div className="wire-signup-done" role="status">
        <h2>가입이 완료되었습니다</h2>
        <p>담당 상담사가 확인 후 연락드리겠습니다.</p>
      </div>
    );
  }

  return (
    <form className="wire-register-form" onSubmit={handleSubmit}>
      <div className="wire-container" data-grid="true" style={{ padding: 0 }}>
        <div className="wire-col-6">
          <SearchInput label="이름" name="name" placeholder="참여자 이름" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="연락처" name="phone" placeholder="010-0000-0000" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="이메일" name="email" placeholder="participant@example.com" />
        </div>
      </div>

      <fieldset className="consent-fieldset">
        <legend>동의 (항목별, 기본 미동의)</legend>
        <p className="schedule-form-hint">
          동의는 오프라인(종이·구두)으로 받고, 시스템에는 체크·일시·기록자만 남깁니다.
          미동의여도 가입은 진행됩니다.
        </p>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentRecording" value="on" />
          <span>녹음·음성 분석 동의</span>
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentTextAi" value="on" />
          <span>텍스트 AI 정리 동의</span>
        </label>
      </fieldset>

      {state.phase === 'error' && (
        <p className="status risk" role="alert">{state.message}</p>
      )}

      <WireButton type="submit" size="large" chevron className="wire-register-submit" disabled={state.phase === 'working'}>
        {state.phase === 'working' ? '처리 중…' : '가입 완료'}
      </WireButton>
    </form>
  );
}
