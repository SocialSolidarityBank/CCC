'use client';

import { useState } from 'react';
import { signupParticipantAction, type ParticipantSignupResult } from '../../../actions';
import { WireButton } from '../../../components/wire/wire-button';
import { SearchInput } from '../../../components/wire/search-input';
import { CONSENT_DETAIL_DISCLAIMER, CONSENT_DETAIL_SECTIONS } from '../../../participants/new/consent-copy';

// 공개 당사자 가입 폼(CCC-28 · D39 · ADR-0016 #4). 인증 없는 공개 경로에서 동작하므로
// 서버 액션도 공개 API(signupParticipant)만 부른다. 성공 시 리다이렉트 없이 인라인
// "가입 완료" 패널을 보여준다 — 당사자는 브리핑 화면으로 갈 이유가 없다(실무자 화면이다).
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
  // G1: ① 은 가입의 하드 게이트다. 자기 가입에는 긴급 등록 예외가 없다(실무자가 판단·기록하는 예외).
  privacy_consent_required: '개인정보 수집·이용 동의에 체크해야 가입할 수 있습니다.',
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
        <p>담당 실무자가 확인 후 연락드리겠습니다.</p>
      </div>
    );
  }

  return (
    <form className="wire-register-form" onSubmit={handleSubmit}>
      <div className="wire-container" data-grid="true" style={{ padding: 0 }}>
        <div className="wire-col-6">
          <SearchInput label="이름" name="name" placeholder="당사자 이름" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="연락처" name="phone" placeholder="010-0000-0000" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="이메일" name="email" placeholder="participant@example.com" />
        </div>
      </div>

      {/* 동의 2종(D49) — 자기 가입이 곧 등록이므로 등록 화면(register-form.tsx)과 같은
          2체크·같은 이름·같은 순서를 쓴다. 여기서는 기록자가 본인이라('self') 문안도
          본인이 직접 읽는다. 미동의여도 가입은 진행된다(D15 미동의 경로). */}
      <fieldset className="consent-fieldset">
        {/* 괄호 보충은 뺐다(2026-08-07 Q — 등록 화면과 같은 개정). 아래 안내문이 대신 말한다. */}
        <legend>동의</legend>
        <p className="schedule-form-hint">
          동의하신 항목과 일시가 기록됩니다. 개인정보 수집·이용 동의는 가입에 반드시 필요하고,
          AI를 활용한 녹취기록은 동의하지 않아도 가입이 진행됩니다.
        </p>
        {/* G1: ① 개인정보 수집·이용 동의는 가입의 하드 게이트다(등록 화면과 같은 규칙).
            긴급 등록 예외는 여기에 두지 않는다 — 사유를 적고 책임질 실무자가 이 화면에 없다. */}
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentPrivacy" value="on" required />
          <span>개인정보 수집·이용 동의 (필수)</span>
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentRecordingAi" value="on" />
          <span>AI를 활용한 녹취기록 동의</span>
        </label>

        {/* 등록 화면과 같은 문안 상수를 쓴다 — 대행 입력일 때와 본인 입력일 때 읽는 글이
            갈라지면 동의의 근거가 화면마다 달라진다. 마크업도 같은 아코디언 계약. */}
        <details className="consent-detail">
          <summary className="consent-detail-summary">
            <span>자세히 읽어보기</span>
            <span aria-hidden="true" className="briefing-card-arrow" />
          </summary>
          <div className="consent-detail-body">
            <p className="consent-detail-disclaimer">{CONSENT_DETAIL_DISCLAIMER}</p>
            {CONSENT_DETAIL_SECTIONS.map((section) => (
              <div className="consent-detail-section" key={section.heading}>
                <h3>{section.heading}</h3>
                {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                {section.items === undefined ? null : (
                  <ul>
                    {section.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
      </fieldset>

      {state.phase === 'error' && (
        <p className="wire-badge" data-tone="risk" role="alert">{state.message}</p>
      )}

      <WireButton type="submit" size="large" chevron className="wire-register-submit" disabled={state.phase === 'working'}>
        {state.phase === 'working' ? '처리 중…' : '가입 완료'}
      </WireButton>
    </form>
  );
}
