'use client';

import { useState } from 'react';
import { createWorkerInviteAction } from '../../actions';
import { WireButton } from '../../components/wire/wire-button';
import { WireCard } from '../../components/wire/wire-card';
import { WireFormField } from '../../components/wire/wire-form-field';

// 실무자 초대 링크 발급(CCC-108 · CCC-33). 당사자 가입 링크 발급 화면
// (participants/invite/invite-issue.tsx)과 같은 구조 — 발급 결과를 복사용 링크로
// 보여 주고 전달은 관리자에게 맡긴다(메일 발송 기능 없음). QR·이메일 문안은 두지
// 않았다: 실무자 초대는 기관 안에서 건네는 링크라 웹 주소 하나면 충분하다.

type IssueState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error' }
  | { phase: 'created'; url: string };

/** 초대 링크 목적지. 가입 화면 라우트는 /join/worker/[token] (CCC-108). */
function joinUrl(token: string): string {
  return `${window.location.origin}/join/worker/${token}`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <WireButton
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      {copied ? '복사됨' : label}
    </WireButton>
  );
}

export function WorkerInviteIssue() {
  const [state, setState] = useState<IssueState>({ phase: 'idle' });

  const issue = () => {
    setState({ phase: 'working' });
    void createWorkerInviteAction().then((result) => {
      if (result.status === 'created') {
        setState({ phase: 'created', url: joinUrl(result.token) });
      } else {
        setState({ phase: 'error' });
      }
    });
  };

  if (state.phase !== 'created') {
    return (
      <WireCard title="초대 링크">
        <div className="wire-invite-stack">
          <p className="wire-invite-caption">
            링크를 받은 사람이 이름과 이메일을 입력하면 담당 실무자 계정이 만들어집니다.
            링크는 한 번만 쓸 수 있고, 가입한 사람은 사용자 목록에 나타납니다.
          </p>
          <WireButton variant="primary" disabled={state.phase === 'working'} onClick={issue}>
            {state.phase === 'working' ? '만드는 중' : '초대 링크 만들기'}
          </WireButton>
          {state.phase === 'error' ? (
            <p className="wire-field-error" role="alert">
              링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
          ) : null}
        </div>
      </WireCard>
    );
  }

  return (
    <WireCard title="초대 링크">
      <div className="wire-invite-stack">
        <p className="wire-invite-caption" role="status">
          링크를 만들었습니다. 복사해서 초대할 실무자에게 전달하세요.
        </p>

        <div className="wire-invite-section">
          {/* 64자 토큰이 한 줄 입력칸에서는 잘려 보인다 — 당사자 가입 링크 칸과 같은 처리. */}
          <WireFormField label="웹 링크 주소" htmlFor="worker-invite-url" control="textarea">
            <textarea
              id="worker-invite-url"
              readOnly
              rows={3}
              value={state.url}
              onFocus={(event) => event.currentTarget.select()}
            />
          </WireFormField>
          <CopyButton text={state.url} label="링크 복사" />
        </div>

        <WireButton variant="ghost" onClick={() => setState({ phase: 'idle' })}>
          새 링크 만들기
        </WireButton>
      </div>
    </WireCard>
  );
}
