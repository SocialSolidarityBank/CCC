'use client';

import { useActionState } from 'react';
import { WireCallout } from '../../components/wire/wire-callout';
import { WireBadge } from '../../components/wire/wire-badge';
import { WireCard } from '../../components/wire/wire-card';
import {
  activateAiProviderRuntimeAction,
} from '../../actions';
import type { AiProviderStatus } from '../../lib/api';

// CCC-44 AI 사업자 관리 — 기관 관리자 전용. 활성 설정과 배포 런타임을 대조해 보여주고,
// 배포된 런타임을 활성화한다(등록·활성화를 한 번에, 승인 참조 필수 — D66).
// 관리자로 메뉴에 노출되며, 라우트·게이트웨이가 권한을 다시 강제한다(R1).

function TruncatedHash({ value }: { value: string | null }) {
  if (value === null) return <code>없음</code>;
  return <code title={value}>{value.slice(0, 10)}…</code>;
}

export default function AiProviderControl({ status }: { status: AiProviderStatus }) {
  const [state, formAction, pending] = useActionState<{ status: string } | null, FormData>(
    (_previous, formData) => activateAiProviderRuntimeAction(formData),
    null,
  );

  const mismatchReason =
    !status.enabled ? '활성화되지 않음. 활성화 버튼으로 배포 런타임을 등록하세요.'
    : !status.runtime.configured ? '배포 런타임이 설정되지 않음. 배포 환경(env)을 확인하세요.'
    : status.runtime.matches === false ? '활성 설정이 배포 런타임과 어긋남. 초안 생성이 막혀 있습니다(fail closed).'
    : null;

  return <WireCard as="section" className="settings-section" labelledBy="ai-status-heading" title={<h2 id="ai-status-heading">AI 사업자</h2>}>
    <dl className="settings-account">
      <div className="settings-field">
        <dt>활성 상태</dt>
        <dd className="settings-value-row">
          <WireBadge {...(status.enabled ? { tone: 'mint' } : {})}>
            {status.enabled ? '활성' : '비활성'}
          </WireBadge>
          {status.adapterId !== null && <span>{status.adapterId} {status.adapterVersion}</span>}
          {status.configHash !== null && <span>설정 해시 <TruncatedHash value={status.configHash} /></span>}
        </dd>
      </div>
      <div className="settings-field">
        <dt>배포 런타임</dt>
        <dd className="settings-value-row">
          {status.runtime.configured
            ? <span>{status.runtime.adapterId} {status.runtime.adapterVersion}</span>
            : <span>설정 안 됨</span>}
          {status.runtime.matches === true && <WireBadge tone="mint">일치</WireBadge>}
          {status.runtime.matches === false && <WireBadge tone="lavender">불일치</WireBadge>}
        </dd>
      </div>
    </dl>
    {mismatchReason !== null && <WireCallout title="확인 필요" tone="lavender">{mismatchReason}</WireCallout>}

    <form action={formAction} className="onboarding-form" aria-label="배포 런타임 활성화">
      <label htmlFor="approvalRef">승인 참조 (D66: 키 등급·약관 확인 기록)</label>
      <input
        id="approvalRef"
        name="approvalRef"
        type="text"
        placeholder="예: 2026-08-15 약관 확인(사업자 계정 이메일)"
        required
      />
      <button type="submit" className="wire-button" disabled={pending || status.runtime.matches === true}>
        {pending ? '처리 중…' : '배포 런타임 활성화'}
      </button>
    </form>
    {state !== null && state.status !== 'activated' && (
      <WireCallout title="활성화 실패" tone="lavender">{state.status}</WireCallout>
    )}
    {state !== null && state.status === 'activated' && (
      <WireCallout title="완료" tone="mint">활성화됐습니다. 페이지를 새로고침해 상태를 확인하세요.</WireCallout>
    )}
  </WireCard>;
}