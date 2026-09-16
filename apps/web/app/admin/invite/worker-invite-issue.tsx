'use client';

import {
  WireButton,
  WireCard,
  WireChoice,
  WireFormField,
} from '@ccc/wire';
import { useState } from 'react';
import { createStaffInviteAction } from '../../actions';
import type { StaffInviteRole } from '../../lib/api';
import { accountRoleLabel } from '../admin-format';
import { NavIcon } from '../../components/wire/shell-icons';
import { formatKoreanDateTime } from '../../lib/format-korean-date';
import { SearchInput } from '../../components/wire/search-input';

// 실무자 초대 링크 발급(D86 · POST /staff-invites). 당사자 가입 링크 발급 화면
// (participants/invite/invite-issue.tsx)과 같은 구조 — 발급 결과를 복사용 링크로
// 보여 주고 전달은 관리자에게 맡긴다(메일 발송 기능 없음). QR·이메일 문안은 두지
// 않았다: 실무자 초대는 기관 안에서 건네는 링크라 웹 주소 하나면 충분하다.
//
// 초대는 수신 이메일에 묶인다 — 링크를 받은 사람이 그 이메일로 가입·로그인해야
// 수락되고, 다른 이메일이면 서버가 링크 무효와 같은 404 로 거절한다(D90).

type IssueState =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'error' }
  | { phase: 'created'; url: string; email: string; expiresAt: string };

/** 초대 링크 목적지. 수락 화면 라우트는 /join/worker/[token] (D86). */
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

// 초대에 담을 수 있는 역할과 순서 — 서버 저장 이름이다(POST /staff-invites 계약).
// 화면 라벨은 공개 이름(accountRoleLabel)으로 매핑한다.
const inviteRoleOptions: ReadonlyArray<{ value: StaffInviteRole; label: string }> = [
  { value: 'practitioner', label: accountRoleLabel.worker },
  { value: 'institution_admin', label: accountRoleLabel['institution-admin'] },
  { value: 'institution_technical_admin', label: accountRoleLabel['technical-admin'] },
];

export function WorkerInviteIssue({ canGrantRoles }: { canGrantRoles: boolean }) {
  const [state, setState] = useState<IssueState>({ phase: 'idle' });
  const [email, setEmail] = useState('');
  // 기관 관리자는 업무 역할을 반드시 골라야 한다(D86 결정 3) — 실무자를 기본으로 켠다.
  const [roles, setRoles] = useState<StaffInviteRole[]>(['practitioner']);

  const issue = () => {
    if (email.trim().length === 0) return;
    if (canGrantRoles && roles.length === 0) return;
    setState({ phase: 'working' });
    const formData = new FormData();
    formData.set('email', email.trim());
    // 기술 관리자만 있는 사람은 역할 없는(역할 대기) 초대만 만들 수 있다 — 칸을
    // 아예 보여주지 않고 빈 roles 로 보낸다. 범위 강제는 서버 몫이다.
    if (canGrantRoles) for (const role of roles) formData.append('roles', role);
    void createStaffInviteAction(formData).then((result) => {
      if (result.status === 'created') {
        setState({ phase: 'created', url: joinUrl(result.token), email: result.email, expiresAt: result.expiresAt });
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
            초대할 실무자의 이메일을 적고 링크를 만들어 전달하세요. 링크를 받은 사람이
            그 이메일로 가입하면 계정이 만들어집니다. 링크는 한 번만 쓸 수 있고
            일주일 뒤에 만료됩니다.
          </p>
          {canGrantRoles ? (
            <div className="wire-invite-section">
              {inviteRoleOptions.map((option) => (
                <WireChoice
                  key={option.value}
                  type="checkbox"
                  label={option.label}
                  checked={roles.includes(option.value)}
                  disabled={state.phase === 'working'}
                  onChange={(checked) =>
                    setRoles((current) =>
                      checked ? [...current, option.value] : current.filter((role) => role !== option.value),
                    )
                  }
                  desc={option.value === 'practitioner' ? '실무자 역할이 없으면 상담 기록을 쓸 수 없습니다.' : undefined}
                />
              ))}
              <p className="wire-form-hint">고른 역할이 가입 즉시 부여됩니다. 하나 이상 골라야 합니다.</p>
            </div>
          ) : (
            <p className="wire-invite-caption">
              기관 기술 관리자는 역할 없는 초대 링크만 만들 수 있습니다. 가입한 사람은
              역할 대기 상태가 되고, 기관 관리자가 사용자·역할 화면에서 역할을 주면 업무가 열립니다.
            </p>
          )}
          <SearchInput
            label="초대할 실무자 이메일"
            name="invite-email"
            type="email"
            placeholder="worker@example.org"
            value={email}
            onChange={setEmail}
          />
          <WireButton
            variant="primary"
            disabled={state.phase === 'working' || email.trim().length === 0 || (canGrantRoles && roles.length === 0)}
            onClick={issue}
            icon={<NavIcon name="invite" />}
          >
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
          {state.email} 님의 초대 링크를 만들었습니다. 복사해서 직접 전달하세요.
          이 링크는 한 번만 쓸 수 있고 {formatKoreanDateTime(state.expiresAt)}에 만료됩니다.
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

        <p className="wire-invite-caption">
          링크는 이 화면에서 한 번만 보입니다. 지금 복사해 두세요. 나중에 다시 확인할 수 없고,
          잃어버리면 새 링크를 만들어야 합니다.
        </p>

        <WireButton variant="ghost" onClick={() => { setState({ phase: 'idle' }); setEmail(''); }}>
          새 링크 만들기
        </WireButton>
      </div>
    </WireCard>
  );
}
