'use client';

import { useState } from 'react';
import type { MemorySettingsInput, MemorySettingsView } from '@ccc/contracts/counseling-memory';
import { WireCard } from '../components/wire/wire-card';
import { WireCardSection } from '../components/wire/wire-section';
import { WireBadge } from '../components/wire/wire-badge';
import { WireChoice } from '../components/wire/wire-form-field';
import { WireButton } from '../components/wire/wire-button';
import { WireDataRow, WireDataRows } from '../components/wire/wire-data-rows';
import { WireError } from '../components/wire/wire-state';
import { Icon } from '../components/wire/wire-icon';
import { WireCallout } from '../components/wire/wire-callout';
import { formatKoreanDateTime } from '../lib/format-korean-date';

type SettingsResult = { ok: true; data: MemorySettingsView } | { ok: false; error: string };
export function MemorySettingsSection({ settings: initial, onSave, onRefresh }: { settings: MemorySettingsView; onSave: (input: MemorySettingsInput) => Promise<SettingsResult>; onRefresh: () => Promise<SettingsResult> }) {
  const [settings, setSettings] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return <div className="memory-page-stack"><WireCard title={<span className="wire-title-with-badge">자동 상담 기억<WireBadge>{settings.enabled ? '켜짐' : '꺼짐'}</WireBadge></span>}>
    <form className="memory-form" onSubmit={async (event) => {
      event.preventDefault(); if (pending) return;
      setPending(true); setError(null); setMessage(null);
      try {
        const result = await onSave({ enabled, expectedVersion: settings.version });
        if (result.ok) { setSettings(result.data); setEnabled(result.data.enabled); setMessage('기관 설정을 저장했습니다.'); }
        else setError(result.error === 'conflict' ? '다른 곳에서 기관 설정이 바뀌었습니다. 선택은 그대로 두었습니다. 최신 설정을 확인한 뒤 다시 저장해 주세요.' : '설정을 저장하지 못했습니다. 선택은 그대로 두었습니다. 기관 관리자 권한과 연결 상태를 확인해 주세요.');
      } catch { setError('설정을 저장하지 못했습니다. 선택은 그대로 두었습니다. 잠시 후 다시 시도해 주세요.'); }
      finally { setPending(false); }
    }}>
      <WireChoice type="checkbox" label="자동 생성과 갱신 사용" checked={enabled} disabled={pending} onChange={setEnabled} />
      <p className="wire-form-hint">켜면 기존 공식 기록도 자동으로 정리하며 처리 시간과 AI 비용이 발생할 수 있습니다. 끄면 새 생성과 갱신만 멈추고 이미 생성한 기억은 보존됩니다.</p>
      <div className="memory-reference-actions"><WireButton variant="primary" type="submit" icon={<Icon name="check" />} disabled={pending}>{pending ? '저장 중' : '설정 저장'}</WireButton></div>
      {error && <WireError>{error}</WireError>}
      {error && <WireButton variant="neutral" disabled={pending} onClick={async () => {
        setPending(true);
        try {
          const result = await onRefresh();
          if (!result.ok) { setError('최신 설정을 불러오지 못했습니다. 선택은 그대로 두었습니다.'); return; }
          setSettings(result.data);
          setError(null);
          setMessage(`기관의 현재 설정은 ${result.data.enabled ? '켜짐' : '꺼짐'}입니다. 선택한 값은 그대로입니다. 확인한 뒤 설정 저장을 눌러 주세요.`);
        } catch { setError('최신 설정을 불러오지 못했습니다. 선택은 그대로 두었습니다.'); }
        finally { setPending(false); }
      }}>선택을 유지하고 최신 설정 확인</WireButton>}
      {message && <p role="status" className="panel-meta">{message}</p>}
    </form>
    <WireCardSection title="처리 상태">
      <WireDataRows>
        <WireDataRow label="작동 조건" value="기관의 AI 연결과 케이스별 동의, 가림 처리가 준비되어야 합니다." />
        <WireDataRow label="처리 대기" value={<WireBadge tone="lavender">{settings.pendingCases}건</WireBadge>} />
        <WireDataRow label="조건 확인 대기" value={<WireBadge tone="lavender">{settings.blockedCases}건</WireBadge>} />
        <WireDataRow label="처리 실패" value={<WireBadge tone="lavender">{settings.failedCases}건</WireBadge>} />
        <WireDataRow label="마지막 성공" value={settings.lastSuccessAt === null ? '아직 처리 이력이 없습니다' : formatKoreanDateTime(settings.lastSuccessAt)} />
      </WireDataRows>
      <p className="panel-meta">이 설정은 AI 연결이나 당사자의 동의를 대신 켜지 않습니다. 동의 철회와 개인정보 파기는 기존 기억의 이용도 중단할 수 있습니다.</p>
    </WireCardSection>
  </WireCard>
    {settings.blockedCases > 0 && <WireCallout title="처리 조건 확인 대기" tone="lavender">AI 연결이나 처리 장비, 동의와 가림 처리 조건을 확인하고 있습니다. 기관의 켜짐 설정은 유지됩니다.</WireCallout>}
    {settings.failedCases > 0 && <WireCallout title="기억 처리 실패" tone="lavender">일부 케이스의 최근 기록을 반영하지 못했습니다. 상담 기록은 계속 이용할 수 있습니다.</WireCallout>}
  </div>;
}
