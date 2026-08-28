'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createParticipantInviteAction } from '../../actions';
import { WireButton } from '../../components/wire/wire-button';
import { WireCard } from '../../components/wire/wire-card';
import { WireFormField } from '../../components/wire/wire-form-field';
import { PROGRAM_LABELS } from '../../lib/labels';

// 당사자 가입 링크 발급(D39 · ADR-0016 · CCC-29). 실제 이메일 발송이 없는 화면 흐름
// MVP 이므로 발급 결과를 세 형태(웹 주소·QR·이메일 문안)로 보여 주고 복사에 맡긴다.
// QR 은 qrcode.react 가 브라우저에서 SVG 로 그린다 — 외부 서비스 호출이 없어 토큰이
// 화면 밖으로 나가지 않는다(R3 과 같은 결의 이유).

type IssueState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error' }
  | { phase: 'created'; url: string };

/** 가입 링크 목적지. 가입 화면 라우트는 CCC-28 이 만든다 — 경로 계약만 여기서 정한다. */
function joinUrl(token: string): string {
  return `${window.location.origin}/join/participant/${token}`;
}

function emailDraft(url: string): string {
  return [
    '[사회연대은행] 당사자 가입 안내',
    '',
    '안녕하세요. 아래 링크를 열어 가입을 진행해 주세요.',
    '이름·이메일·연락처만 입력하면 되고, 링크는 본인 전용입니다.',
    '',
    url,
    '',
    '가입이 끝나면 담당 실무자가 확인 후 첫 상담 일정을 안내드립니다.',
  ].join('\n');
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

export function InviteIssue() {
  const [state, setState] = useState<IssueState>({ phase: 'idle' });

  const issue = () => {
    setState({ phase: 'working' });
    void createParticipantInviteAction().then((result) => {
      if (result.status === 'created') {
        setState({ phase: 'created', url: joinUrl(result.token) });
      } else {
        setState({ phase: 'error' });
      }
    });
  };

  // 카드 제목은 두 상태가 같다 — 발급 전후로 같은 자리에서 내용만 바뀌는 것이 눈에 보이게 한다.
  if (state.phase !== 'created') {
    return (
      <WireCard title="가입 링크">
        <div className="wire-invite-stack">
          <p className="wire-invite-caption">
            링크에는 사업({PROGRAM_LABELS.financial_support_v1})과 발급한 실무자가 함께 담깁니다.
            당사자가 가입을 마치면 내 당사자 목록에 나타납니다.
          </p>
          <WireButton variant="primary" disabled={state.phase === 'working'} onClick={issue}>
            {state.phase === 'working' ? '만드는 중' : '가입 링크 만들기'}
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

  const email = emailDraft(state.url);

  // 결과는 "링크 하나 + 그것을 건네는 세 가지 방법"이라 카드 하나로 묶는다. 각 방법은
  // 입력칸과 복사 버튼이 한 덩어리라서 wire-invite-section(gap 12)으로 붙여 둔다 —
  // 스택 기본 간격(24)에 낱개로 두면 버튼이 어느 칸의 것인지 흐려진다.
  return (
    <WireCard title="가입 링크">
      <div className="wire-invite-stack">
        {/* 상태 알림은 이 한 줄만 읽히게 둔다 — 카드 전체를 라이브 영역으로 만들면
            스크린 리더가 아래 이메일 문안 9줄까지 통째로 읽는다. */}
        <p className="wire-invite-caption" role="status">
          링크를 만들었습니다. 아래 세 가지 중 편한 방법으로 전달하세요.
        </p>

        <div className="wire-invite-section">
          {/* 1행 입력칸이다(2026-08-28 Q "넓은 창일 이유가 없다") — 긴 토큰은 가로로 흐르고
              전체는 복사 버튼이 담는다. 구 3줄 textarea 는 링크를 다 보여 주려던 것이었다. */}
          <WireFormField label="웹 링크 주소" htmlFor="invite-url" control="input">
            <input
              id="invite-url"
              type="text"
              readOnly
              value={state.url}
              onFocus={(event) => event.currentTarget.select()}
            />
          </WireFormField>
          <CopyButton text={state.url} label="링크 복사" />
        </div>

        {/* QR 은 높이 40 입력칸 계약에 맞지 않아 WireFormField 를 쓰지 않고 라벨·힌트 구조만 빌린다. */}
        <div className="wire-form-field">
          <span className="wire-form-label">QR 코드</span>
          <span className="wire-invite-qr">
            {/* 색은 토큰에서만 온다(§7-1). SVG 표현 속성에는 var() 를 못 쓰므로 상속된
                --ink 를 currentColor 로 받고, 배경은 흰 패널이 그대로 비치게 둔다. */}
            <QRCodeSVG value={state.url} size={160} fgColor="currentColor" bgColor="transparent" marginSize={2} />
          </span>
          <span className="wire-form-hint">화면을 보여 주고 당사자 휴대전화 카메라로 찍게 하면 됩니다.</span>
        </div>

        <div className="wire-invite-section">
          <WireFormField
            label="이메일 문안"
            htmlFor="invite-email-draft"
            control="textarea"
            hint="발송 기능은 없습니다. 복사해서 이메일이나 문자로 보내는 문안입니다."
          >
            <textarea id="invite-email-draft" readOnly rows={9} value={email} />
          </WireFormField>
          <CopyButton text={email} label="문안 복사" />
        </div>

        <WireButton variant="ghost" onClick={() => setState({ phase: 'idle' })}>
          새 링크 만들기
        </WireButton>
      </div>
    </WireCard>
  );
}
