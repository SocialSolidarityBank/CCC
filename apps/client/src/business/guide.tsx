import { WireButton, WireCallout, WireCard, WireCardSection, WireItem } from '@ccc/web/wire';
import type { HumanRole, MyIdentity } from './api';

type GuideRole = HumanRole;

export interface SettingsDestination {
  slug: string;
  title: string;
  description: string;
  owner: string;
  roles: readonly GuideRole[];
}

const ROLE_LABELS: Record<GuideRole, string> = {
  'institution-admin': '기관 관리자',
  'technical-admin': '기관 기술 관리자',
  supervisor: '실무 책임자',
  worker: '실무자',
};

export const SETTINGS_DESTINATIONS = [
  {
    slug: 'institution',
    title: '기관 정보',
    description: '기관 이름과 사업 도입에 필요한 기관 범위를 확인합니다. 저장 위치와 녹음·AI 처리 경로는 계약 조건을 확인한 뒤 정합니다.',
    owner: '기관 관리자',
    roles: ['institution-admin'],
  },
  {
    slug: 'programs',
    title: '사업 설정',
    description: '사업을 등록하고 사업별 저장 위치, 처리 경로, 확인 상태를 관리합니다. 모르면 나중에 정하기로 두며, 확인 전에는 당사자 등록·녹음·AI 처리가 열리지 않습니다.',
    owner: '기관 관리자',
    roles: ['institution-admin'],
  },
  {
    slug: 'accounts',
    title: '사용자와 역할',
    description: '기관 사용자의 역할, 팀과 감독 관계, 초대와 비활성화를 관리합니다. 역할은 합산되며 URL이나 화면의 설명만으로 권한을 만들지 않습니다.',
    owner: '기관 관리자 역할·배정, 기관 기술 관리자 계정 비활성화',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'consent',
    title: '동의서 설정',
    description: '기관의 여섯 동의 영역 문안과 버전, 게시 상태를 관리합니다. 사업·당사자 화면의 동의 기록과 기관 문안 정책을 혼동하지 않습니다.',
    owner: '기관 관리자',
    roles: ['institution-admin'],
  },
  {
    slug: 'retention',
    title: '보존 기간과 검토',
    description: '보존 검토와 파기 결정을 확인합니다. 보존 사유와 기한을 확인한 뒤 결정하며, 파기 서비스가 준비되지 않은 상태를 성공으로 표시하지 않습니다.',
    owner: '기관 관리자',
    roles: ['institution-admin'],
  },
  {
    slug: 'exports',
    title: '기록 내보내기',
    description: '담당 배정된 케이스의 공식 기록 범위를 내보냅니다. 활성 실무자 역할과 케이스 배정, 내보내기 범위와 감사 기록을 모두 확인해야 합니다.',
    owner: '담당 실무자',
    roles: ['worker'],
  },
  {
    slug: 'audit',
    title: '감사 기록',
    description: '기관의 안전한 메타데이터 감사 기록을 확인합니다. 상담 내용, 원본 개인정보, 복호화 값과 토큰은 표시하지 않습니다.',
    owner: '기관 관리자',
    roles: ['institution-admin'],
  },
  {
    slug: 'speech',
    title: '음성 인식',
    description: 'STT 선택과 준비 상태를 확인합니다. 설치 직후 STT는 꺼져 있고 승인된 엔진이 없으면 엔진 값은 없습니다. 기관 기술 관리자가 준비하고 기관 관리자가 정책과 최종 시작을 확인합니다.',
    owner: '기관 기술 관리자 준비, 기관 관리자 정책·최종 시작',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'ai',
    title: 'AI 연결',
    description: 'AI 처리 경로와 승인 상태를 확인합니다. 기관 기술 관리자는 연결을 준비하고 기관 관리자는 정책·키·최종 시작을 맡습니다. 현재 화면이 키를 저장하거나 연결 성공을 보장하지는 않습니다.',
    owner: '기관 기술 관리자 준비, 기관 관리자 정책·키·최종 시작',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'agent',
    title: '처리 장비',
    description: '현재 설치 방식과 서버가 기록한 처리 장비 연결 상태를 확인합니다. 장비 등록, 버전, 마지막 확인, 가림 처리 준비 정보와 등록 기능은 이 화면에 연결되어 있지 않습니다.',
    owner: '기관 기술 관리자 준비, 기관 관리자 읽기',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'memory',
    title: '기관 상담 기억',
    description: '기관 범위의 상담 기억 정책과 처리 상태를 확인합니다. 상담 내용, 이름, 케이스 식별자와 요약 원문은 이 메뉴에 표시하지 않습니다.',
    owner: '기관 관리자',
    roles: ['institution-admin'],
  },
  {
    slug: 'database',
    title: '데이터베이스',
    description: '현재 설치 방식만 확인합니다. 데이터베이스 연결 정보, 리전, 접근 권한, RLS, 기존 데이터, 설치 버전과 읽기 전용 점검 계획은 이 화면에 표시되지 않습니다.',
    owner: '기관 기술 관리자 준비, 기관 관리자 영향 승인',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'storage',
    title: '저장 위치와 사용량',
    description: '현재 설치 방식만 확인합니다. 실제 저장 위치, 사용량, 남은 용량, 원음 저장소 상태와 자료 이관 결과는 이 화면에 표시되지 않습니다.',
    owner: '기관 기술 관리자 준비, 기관 관리자 정책 승인',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'backup',
    title: '백업과 복원',
    description: '현재 설치 방식만 확인합니다. 백업 파일 생성, .cccx 가져오기, 복원 검증과 실행 기능은 아직 구현되어 있지 않습니다.',
    owner: '기관 관리자 승인, 기관 기술 관리자 실행',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'security',
    title: '보안 설정',
    description: '현재 설치 방식만 확인합니다. 현재 로그인의 인증 수단이나 보증 수준, 기관 보안 정책, 로컬 계정과 앱 잠금 상태는 이 화면에 표시되지 않습니다.',
    owner: '기관 기술 관리자 운영, 기관 관리자 정책 승인',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'system',
    title: '시스템 상태',
    description: '현재 설치 방식, 음성 인식과 AI 처리 선택, 서버가 기록한 처리 장비 상태를 확인합니다. 구성 요소별 관측 시각, 상세 장애 사유와 전체 시스템 점검 결과는 표시하지 않습니다.',
    owner: '기관 기술 관리자, 기관 관리자 읽기',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'updates',
    title: '업데이트와 복구',
    description: '현재 설치 방식만 확인합니다. 설치 버전, 서명 검증 결과, 업데이트와 롤백 상태는 이 화면에 표시되지 않으며 실행 기능도 아직 구현되어 있지 않습니다.',
    owner: '기관 기술 관리자 실행, 기관 관리자 영향 승인',
    roles: ['institution-admin', 'technical-admin'],
  },
  {
    slug: 'account',
    title: '내 정보',
    description: '내 계정, 기관과 역할 합, 배정 요청을 확인합니다. 표시된 역할은 권한의 근거이며 계정 정보 변경이나 역할 부여가 자동으로 이루어지지 않습니다.',
    owner: '본인 확인, 역할 부여는 기관 관리자',
    roles: ['institution-admin', 'technical-admin', 'supervisor', 'worker'],
  },
  {
    slug: 'guide',
    title: '사용 가이드',
    description: '초기 설정 순서, 역할 책임, 설정 목적지와 문제 해결을 읽습니다. 이 문서의 예시는 저장된 기관 상태나 완료 증거가 아닙니다.',
    owner: '모든 로그인 사용자',
    roles: ['institution-admin', 'technical-admin', 'supervisor', 'worker'],
  },
] as const satisfies readonly SettingsDestination[];

export type SettingsDestinationSlug = (typeof SETTINGS_DESTINATIONS)[number]['slug'];

export const SETTINGS_NAVIGATION_GROUPS = [
  { id: 'institution', title: '기관', slugs: ['institution', 'programs', 'accounts'] },
  { id: 'records', title: '기록', slugs: ['consent', 'retention', 'exports', 'audit'] },
  { id: 'ai', title: 'AI', slugs: ['speech', 'ai', 'agent', 'memory'] },
  { id: 'storage', title: '저장', slugs: ['database', 'storage', 'backup'] },
  { id: 'system', title: '시스템', slugs: ['security', 'system', 'updates'] },
  { id: 'personal', title: '개인', slugs: ['account', 'guide'] },
] as const satisfies readonly {
  id: string;
  title: string;
  slugs: readonly SettingsDestinationSlug[];
}[];

export function canOpenSettingsDestination(
  destination: SettingsDestination,
  roles: readonly GuideRole[],
): boolean {
  if (destination.slug === 'account' || destination.slug === 'guide') return true;
  return roles.length > 0 && destination.roles.some((role) => roles.includes(role));
}

function DestinationAction({ destination, roles }: { destination: SettingsDestination; roles: readonly GuideRole[] }) {
  if (!canOpenSettingsDestination(destination, roles)) return undefined;
  return <WireButton variant="neutral" href={`/settings?module=${destination.slug}`}>메뉴 열기</WireButton>;
}

export function GuideModule({ roles }: { roles: MyIdentity['roles'] }) {
  const roleText = roles.length === 0
    ? '역할이 아직 지정되지 않았습니다.'
    : roles.map((role) => ROLE_LABELS[role]).join(', ');

  return <WireCard as="section" labelledBy="guide-title" title={<h2 id="guide-title">사용 가이드</h2>}>
    <WireCallout tone="info" title="이 안내의 범위">
      이 화면은 정적인 사용 안내입니다. 설정을 저장하거나 연결 성공을 확인하지 않으며, 아래 예시는 저장된 기관 상태가 아닙니다. 각 메뉴가 명시적으로 표시하는 실제 값과 처리 결과만 확인하세요.
    </WireCallout>

    <WireCardSection title="현재 역할">
      <WireItem
        title={roleText}
        description={roles.length === 0
          ? '역할이 지정되기 전에는 보호된 설정 메뉴 링크를 제공하지 않습니다. 기관 관리자에게 역할 지정을 요청하세요.'
          : '역할은 합산됩니다. 기관 관리자와 기관 기술 관리자의 책임은 겸임할 수 있어도 정책 승인과 기술 준비를 한 단계로 건너뛰지 않습니다.'}
      />
    </WireCardSection>

    <WireCardSection title="초기 설정 순서">
      <WireItem title="1. 기관과 사업의 조건 확인" description="기관 관리자가 계약서, 개인정보 처리위탁과 국외 이전 조건을 확인합니다. 저장 위치와 녹음·AI 처리 경로는 기본 선택 없이 정하며, 모르면 나중에 정하기로 둡니다." action={<DestinationAction destination={SETTINGS_DESTINATIONS[0]} roles={roles} />} />
      <WireItem title="2. 역할과 팀 지정" description="기관 관리자가 기관 관리자, 기관 기술 관리자, 실무 책임자, 실무자 역할과 감독 관계를 지정합니다. 역할이 없으면 보호된 설정에 접근하지 않습니다." action={<DestinationAction destination={SETTINGS_DESTINATIONS[2]} roles={roles} />} />
      <WireItem title="3. 동의 문안과 보관 정책 확인" description="기관 관리자가 게시할 동의 문안과 보존 검토 정책을 확인합니다. 당사자별 동의 기록과 기관 문안 정책은 서로 다른 층입니다." action={<DestinationAction destination={SETTINGS_DESTINATIONS[3]} roles={roles} />} />
      <WireItem title="4. 기술 연결과 장치 준비" description="기관 기술 관리자가 데이터베이스, 저장 위치, 보안, 음성·AI 연결과 로컬 에이전트를 준비합니다. 준비만으로 연결 성공이나 운영 가능을 뜻하지 않습니다." action={<DestinationAction destination={SETTINGS_DESTINATIONS[7]} roles={roles} />} />
      <WireItem title="5. 기관 관리자의 최종 정책 확인" description="기관 관리자가 키와 처리 정책, 사업별 외부 처리 조건을 확인하고 AI 시작을 최종 결정합니다. 기관 기술 관리자가 정책 승인이나 최종 시작을 대신하지 않습니다." action={<DestinationAction destination={SETTINGS_DESTINATIONS[8]} roles={roles} />} />
      <WireItem title="6. 백업 계획 승인과 실행 분리" description="기관 관리자가 백업·가져오기·복원 계획을 승인하고 기관 기술 관리자가 실행합니다. 현재 백업 생성, .cccx 가져오기와 복원 엔진은 구현되어 있지 않으므로 완료로 표시하지 않습니다." action={<DestinationAction destination={SETTINGS_DESTINATIONS[13]} roles={roles} />} />
    </WireCardSection>

    <WireCardSection title="역할별 책임">
      <WireItem title="기관 관리자" description="기관 범위, 사업 도입, 역할과 감독 관계, 동의·보관 정책을 정합니다. AI 처리 정책과 키, 최종 AI 시작을 맡으며 감사와 보호된 기관 설정을 확인합니다." />
      <WireItem title="기관 기술 관리자" description="직원 계정의 기술 측면, 인증·연결·처리 장치와 진단을 준비합니다. 정책을 정하거나 키와 AI 최종 시작을 기관 관리자 대신 결정하지 않습니다." />
      <WireItem title="실무 책임자" description="기관 관리자가 지정한 팀의 케이스를 읽기 전용으로 감독하고 열람이 감사됩니다. 기관 관리자용 설정·계정·기술 메뉴를 받지 않습니다." />
      <WireItem title="실무자" description="배정된 케이스를 상담하고 기록합니다. 내보내기는 활성 실무자 역할과 케이스 배정, 실제 서비스 허가가 모두 필요하며 기관 관리자용 설정 메뉴를 받지 않습니다." />
    </WireCardSection>

    {SETTINGS_NAVIGATION_GROUPS.map((group) => (
      <WireCardSection key={group.id} title={group.title}>
        {group.slugs.map((slug) => {
          const destination = SETTINGS_DESTINATIONS.find((candidate) => candidate.slug === slug);
          if (destination === undefined) return null;
          return <WireItem
            key={destination.slug}
            title={destination.title}
            description={`${destination.description} 담당: ${destination.owner}.`}
            action={<DestinationAction destination={destination} roles={roles} />}
          />;
        })}
      </WireCardSection>
    ))}

    <WireCardSection title="문제 해결">
      <WireItem title="보호된 메뉴가 보이지 않음" description="현재 역할에 맞지 않는 메뉴는 숨깁니다. 역할이 비어 있으면 역할 대기 상태이므로 URL에 module 값을 넣어도 권한이 생기지 않습니다. 기관 관리자에게 역할과 감독 관계를 확인하세요." />
      <WireItem title="STT가 꺼져 있거나 엔진이 없음" description="정상적인 초기 상태일 수 있습니다. 승인된 엔진이 정해지기 전에는 STT를 켤 수 없고, 현재는 음성 인식 엔진을 승인된 운영 기능으로 안내하지 않습니다. 수기 기록 경로를 사용하세요." />
      <WireItem title="AI 또는 로컬 에이전트가 준비되지 않음" description="에이전트 준비와 AI 사업자 연결은 서로 다른 단계입니다. 가림 처리와 처리 장치 상태를 실제로 확인하기 전에는 연결 성공이나 AI 결과를 주장하지 않습니다." />
      <WireItem title="백업·가져오기·복원, 업데이트, 로컬 인증, 시크릿 저장이 필요함" description="백업 생성, .cccx 가져오기, 복원, 업데이트와 나머지 기반 서비스는 아직 구현되지 않았습니다. 이 가이드는 실행 완료를 만들지 않으며, 브라우저 저장소·URL·화면에 키와 토큰을 넣지 않습니다." />
      <WireItem title="사업의 저장 위치나 외부 처리 조건을 판단하기 어려움" description="계약서와 과업지시서, 개인정보 보호 담당자의 확인을 먼저 받으세요. 판단이 서지 않으면 나중에 정하기로 두고, 기관 기술 설정이 사업 선택을 대신한다고 보지 않습니다." />
    </WireCardSection>

  </WireCard>;
}
