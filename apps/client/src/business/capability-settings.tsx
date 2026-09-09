import type { AgentStatus, CapabilityDisabledReason, CapabilityManifest, DeploymentMode } from '@ccc/contracts/runtime';
import { WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows } from '@ccc/web/wire';

export const CAPABILITY_SETTINGS = {
  speech: '음성 인식', ai: 'AI 연결', agent: '처리 장비', database: '데이터베이스',
  storage: '저장 위치와 사용량', backup: '백업과 복원', security: '보안', system: '시스템 상태', updates: '업데이트와 복구',
} as const;
export type CapabilitySetting = keyof typeof CAPABILITY_SETTINGS;
export function isCapabilitySetting(value: string): value is CapabilitySetting {
  return Object.hasOwn(CAPABILITY_SETTINGS, value);
}
const MODE_LABELS: Record<DeploymentMode, string> = {
  'community-cloud': '기관 클라우드', 'local-single': '개인 PC', 'local-office': '기관 내부망',
};
const AGENT_LABELS: Record<AgentStatus, string> = {
  connected: '연결됨', delayed: '응답 지연', authentication_error: '장비 인증 확인 필요',
  quota_exceeded: '처리 한도 확인 필요', inactive: '연결되지 않음',
};
const DISABLED_LABELS: Record<Exclude<CapabilityDisabledReason, null>, string> = {
  unverified: '사용 가능 여부 확인 전', missing_key: '키 없음', unsupported: '현재 설치 방식에서 지원하지 않음',
};
const STT_LABELS = { off: '꺼짐', local: '기관 안에서 처리', azure: 'Azure 음성 인식' } as const;
const LLM_LABELS = { off: '꺼짐', openai: 'OpenAI' } as const;
function agentTone(status: AgentStatus): 'mint' | 'lavender' | 'neutral' {
  if (status === 'connected') return 'mint';
  if (status === 'delayed' || status === 'authentication_error' || status === 'quota_exceeded') return 'lavender';
  return 'neutral';
}
function optionAvailability(enabled: boolean, reason: CapabilityDisabledReason) {
  if (enabled) return <WireBadge tone="mint">설치 조건 충족</WireBadge>;
  if (reason === null) return <WireBadge tone="lavender">상세 사유가 제공되지 않음</WireBadge>;
  return <WireBadge tone={reason === 'unsupported' ? 'neutral' : 'lavender'}>{DISABLED_LABELS[reason]}</WireBadge>;
}
const LIMITATIONS: Record<CapabilitySetting, string> = {
  speech: '음성 인식 방식 변경과 엔진 승인 결과를 반영하는 설치 기능이 아직 연결되지 않았습니다. 이 화면에서는 현재 상태만 확인할 수 있습니다. 승인된 엔진이 없으면 녹음 없이 수기로 기록합니다.',
  ai: '이 화면에서 키를 저장하거나 AI를 켜는 기능은 아직 연결되지 않았습니다. 키 등록과 최종 사용 승인은 기관 관리자, 연결 준비는 기관 기술 관리자의 일입니다. 사업에서 외부 처리를 허용해도 설치에서 꺼져 있으면 사용할 수 없습니다.',
  agent: '처리 장비의 연결 상태는 서버가 기록한 값입니다. 장비 설치와 연결 등록 기능은 아직 이 화면에 연결되지 않았습니다. 연결됨 표시는 음성 인식 승인이나 AI 활성화 완료를 뜻하지 않습니다.',
  database: '이 화면을 여는 데 필요한 업무 조회에는 응답을 받았습니다. 전체 데이터베이스의 점검 결과는 아닙니다. 서울 리전, 접근 권한, RLS, 기존 데이터와 설치 버전의 사전 점검은 별도 설치 도구의 읽기 전용 점검이 필요합니다. 이 화면에서는 점검이나 이전을 실행하지 않습니다.',
  storage: '저장 방식은 서버가 확인한 설치 값입니다. 실제 저장 지역, 사용량, 남은 용량과 원음 저장소 점검 결과는 아직 이 화면에 연결되지 않았습니다. 알 수 없는 사용량을 0으로 표시하지 않습니다. 저장 위치를 바꾸거나 자료를 옮기는 기능도 아직 사용할 수 없습니다.',
  backup: '백업 파일 생성, .cccx 가져오기, 복원 검증과 승인 후 실행을 담당할 기능이 아직 없습니다. 이 화면에서 백업, 가져오기, 복원을 실행하지 않으며, 백업이 존재하거나 복구할 수 있다고 표시하지 않습니다.',
  security: '이 화면에는 현재 설치 방식만 표시합니다. 다른 직원의 추가 인증 초기화, 기관 보안 정책 변경, 로컬 계정과 앱 잠금 관리는 아직 이 화면에 연결되지 않았습니다. 표시된 설치 방식만으로 현재 로그인의 인증 수준이나 기관 전체의 보안 상태를 판단할 수 없습니다.',
  system: '아래 값은 이번에 서버가 응답한 설치 방식, 음성 인식과 AI 처리 선택, 처리 장비 상태입니다. 데이터베이스 전체, 저장소, 예약 작업과 외부 업체를 각각 점검한 결과는 아닙니다. 구성 요소별 정밀 점검은 아직 연결되지 않았습니다.',
  updates: '이 화면에는 현재 설치 방식만 표시합니다. 설치 버전과 서명 검증 결과를 읽거나, 업데이트 전 백업, 적용과 실패 후 복구를 실행하는 기능은 아직 없습니다. 이 화면에서는 업데이트를 실행하거나 최신 버전이라고 판정하지 않습니다.',
};

export function CapabilitySettingsModule({ setting, capabilities, onRefresh }: {
  setting: CapabilitySetting; capabilities: CapabilityManifest; onRefresh: () => void;
}) {
  const showSpeech = setting === 'speech' || setting === 'system';
  const showAi = setting === 'ai' || setting === 'system';
  const showAgent = setting === 'agent' || setting === 'system' || setting === 'speech' || setting === 'ai';
  return <WireCard as="section" labelledBy="capability-settings-title" title={<h2 id="capability-settings-title">{CAPABILITY_SETTINGS[setting]}</h2>}>
    <WireDataRows>
      <WireDataRow label="설치 방식" value={<WireBadge tone="neutral">{MODE_LABELS[capabilities.mode]}</WireBadge>} />
      {showSpeech && <WireDataRow label="현재 음성 인식"
        value={<WireBadge tone={capabilities.sttMode === 'off' ? 'neutral' : 'mint'}>{STT_LABELS[capabilities.sttMode]}</WireBadge>} />}
      {showSpeech && <WireDataRow label="음성 인식 엔진"
        value={<WireBadge tone={capabilities.sttEngine === null ? 'lavender' : 'mint'}>
          {capabilities.sttEngine === null ? '승인된 엔진 없음' : capabilities.sttEngine}
        </WireBadge>} />}
      {showAi && <WireDataRow label="현재 AI 처리"
        value={<WireBadge tone={capabilities.llmMode === 'off' ? 'neutral' : 'mint'}>{LLM_LABELS[capabilities.llmMode]}</WireBadge>} />}
      {showAgent && <WireDataRow label="처리 장비"
        value={<WireBadge tone={agentTone(capabilities.agentStatus)}>{AGENT_LABELS[capabilities.agentStatus]}</WireBadge>} />}
    </WireDataRows>
    {setting === 'speech' && <WireCardSection title="설치에서 확인된 선택지">
      <WireDataRows>{capabilities.sttOptions.map((option) => <WireDataRow key={option.mode} label={STT_LABELS[option.mode]}
        value={optionAvailability(option.enabled, option.disabledReason)} />)}</WireDataRows>
      <p className="wire-section-value">설치 조건은 사업의 처리 경로, 당사자의 동의와 최종 사용 승인을 대신하지 않습니다.</p>
    </WireCardSection>}
    {setting === 'ai' && <WireCardSection title="설치에서 확인된 선택지">
      <WireDataRows>{capabilities.llmOptions.map((option) => <WireDataRow key={option.mode} label={LLM_LABELS[option.mode]}
        value={optionAvailability(option.enabled, option.disabledReason)} />)}</WireDataRows>
      <p className="wire-section-value">OpenAI에는 가림 처리를 마친 글만 보냅니다. Azure 음성 인식은 가림 전 원음이 나가는 별도 경로입니다.</p>
    </WireCardSection>}
    <WireCallout tone="info" title="확인할 수 있는 범위">{LIMITATIONS[setting]}</WireCallout>
    <div className="business-actions">
      <WireButton variant="neutral" onClick={onRefresh}>상태 다시 확인</WireButton>
      <WireButton variant="neutral" href="/settings?module=guide">사용 가이드</WireButton>
    </div>
  </WireCard>;
}

export function ConsentSettingsModule() {
  return <WireCard as="section" labelledBy="consent-settings-title" title={<h2 id="consent-settings-title">동의서 설정</h2>}>
    <WireCallout tone="info" title="문안 설정 준비 전">여섯 영역의 기관별 문안과 버전을 실제 동의 기록에 연결하는 기능은 아직 준비되지 않았습니다. 지금은 문안을 저장하거나 적용할 수 없습니다. 기존 녹음 동의나 텍스트 AI 동의를 새 여섯 영역의 동의로 자동 바꾸지 않습니다.</WireCallout>
    <WireCardSection title="분리해서 받아야 하는 동의">
      <WireDataRows>
        <WireDataRow label="개인정보 수집과 이용" value="기관 정책에 따라 등록 범위를 정합니다." />
        <WireDataRow label="민감정보 처리" value="동의한 민감정보만 입력하고 처리합니다." />
        <WireDataRow label="상담 녹음" value="동의하지 않으면 녹음 없이 수기로 기록합니다." />
        <WireDataRow label="외부 음성 인식" value="가림 전 원음이 외부로 나가는 경로입니다. 별도 동의가 필요합니다." />
        <WireDataRow label="외부 AI와 국외 처리" value="가림 처리한 글의 외부 전송에 대한 동의입니다." />
        <WireDataRow label="음성 원본 보유기간" value="기본 임시 처리와 삭제 기한을 고지합니다. 장기 보관을 여는 설정은 아닙니다." />
      </WireDataRows>
    </WireCardSection>
    <WireCardSection title="이 화면의 범위"
      action={<WireButton variant="neutral" href="/settings?module=guide">사용 가이드</WireButton>}>
      <p className="wire-section-value">위 목록은 받아야 할 동의의 설명입니다. 우리 기관에 저장된 문안이나 당사자의 동의 현황이 아닙니다. 문안 설정만으로 처리 권한이 생기지 않습니다.</p>
    </WireCardSection>
  </WireCard>;
}
