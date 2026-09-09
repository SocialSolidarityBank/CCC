import { WireBadge } from '../../components/wire/wire-badge';
import { WireCallout } from '../../components/wire/wire-callout';
import { WireCard } from '../../components/wire/wire-card';
import { WireCardSection, WireItem } from '../../components/wire/wire-section';
import type { SttCapabilities } from '../../lib/api';

// STT 설정 상태(D77 · S2 §2.8). 읽기 전용이다 — STT 모드를 쓰는 엔드포인트가 없고,
// 설치 사실은 signed install manifest 와 배포 env 가 정한다. 화면이 운영 플래그를 직접
// 켜지 않는 것이 계약이므로 여기에는 폼도 버튼도 두지 않는다.

const modeLabel: Record<SttCapabilities['sttMode'], string> = {
  off: '사용 안 함',
  local: '기관 안 처리',
  azure: 'Azure 외부 처리',
};

const agentStatusLabel: Record<SttCapabilities['agentStatus'], string> = {
  connected: '연결됨',
  delayed: '지연',
  authentication_error: '인증 오류',
  quota_exceeded: '한도 초과',
  inactive: '연결 없음',
};

/** 고정 3종(`packages/contracts/src/capabilities.ts`). 화면이 새 사유를 만들지 않는다. */
const disabledLabel = {
  unverified: '승인 전',
  unsupported: '설치에 없음',
  missing_key: '자격 없음',
} as const;

const disabledDetail = {
  unverified: '품질 승인 전에는 고를 수 없습니다.',
  unsupported: '설치에 승인된 엔진이 없거나 처리 장비가 연결되지 않았습니다.',
  missing_key: '처리 장비에 이 엔진의 자격이 없습니다.',
} as const;

const heading = <h2 id="stt-status-heading">STT</h2>;

export default function SttStatus({ capabilities }: { capabilities: SttCapabilities | null }) {
  if (capabilities === null) {
    return (
      <WireCard as="section" className="settings-section" labelledBy="stt-status-heading" title={heading}>
        <WireCallout title="확인 필요" tone="lavender">
          설치 정보를 읽을 수 없어 STT 상태를 표시하지 못했습니다. 서명된 설치 정보와 배포 설정을 확인하세요.
        </WireCallout>
      </WireCard>
    );
  }

  const on = capabilities.sttMode !== 'off';
  return (
    <WireCard as="section" className="settings-section" labelledBy="stt-status-heading" title={heading}>
      <dl className="settings-account">
        <div className="settings-field">
          <dt>현재 처리</dt>
          <dd className="settings-value-row">
            <WireBadge {...(on ? { tone: 'mint' as const } : {})}>{modeLabel[capabilities.sttMode]}</WireBadge>
            <span>{capabilities.sttEngine ?? '지정된 엔진 없음'}</span>
          </dd>
        </div>
        <div className="settings-field">
          <dt>처리 장비</dt>
          <dd className="settings-value-row">
            <WireBadge {...(capabilities.agentStatus === 'connected' ? { tone: 'mint' as const } : {})}>
              {agentStatusLabel[capabilities.agentStatus]}
            </WireBadge>
          </dd>
        </div>
      </dl>

      <WireCardSection title="엔진별 상태">
        {capabilities.options.map((option) => (
          <WireItem
            key={option.mode}
            title={modeLabel[option.mode]}
            description={
              option.disabledReason === null
                ? '지금 고를 수 있는 처리입니다.'
                : disabledDetail[option.disabledReason]
            }
            status={
              <WireBadge tone={option.enabled ? 'mint' : 'lavender'}>
                {option.disabledReason === null ? '사용 가능' : disabledLabel[option.disabledReason]}
              </WireBadge>
            }
          />
        ))}
      </WireCardSection>

      {!on && (
        <WireCallout title="안내" tone="lavender">
          STT 를 사용하지 않는 동안 상담 기록은 수기 경로로 남깁니다. 켜는 것은 화면이 아니라 설치 설정과 승인된 엔진 목록이 정합니다.
        </WireCallout>
      )}
    </WireCard>
  );
}
