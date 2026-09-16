// Screenshot-only static captures. Synthetic data only; no API, no runtime.
// Sources: apps/web/app/{admin,join,onboarding,participants/invite,settings,welcome,preview,kit}
// and apps/client (Relayer business client auth/institution/setup/request screens).
import React, { type ReactNode } from 'react';
import {
  Chevron,
  DisclosureChevron,
  Icon,
  ParticipantName,
  WireBadge,
  WireBullets,
  WireButton,
  WireCallout,
  WireCard,
  WireCardDetails,
  WireCardSection,
  WireChoice,
  WireDataRow,
  WireDataRows,
  WireEmpty,
  WireField,
  WireFormField,
  WireItem,
  WireQuote,
  WireRadioGroup,
  WireSourceQuotes,
} from '../../packages/wire/src/index';
import { SearchInput } from '../../apps/web/app/components/wire/search-input';
import { MetaRow } from '../../apps/web/app/components/wire/meta-row';
import { NavIcon } from '../../apps/web/app/components/wire/shell-icons';
import { QRCodeSVG } from 'qrcode.react';
import {
  CONSENT_DETAIL_DISCLAIMER,
  CONSENT_DETAIL_SECTIONS,
} from '../../packages/contracts/src/consent-notice';
import { CONSENT_COPY, CONSENT_DOMAINS } from '../../packages/contracts/src/consent';
import { PROGRAM_ADMISSION_COPY } from '../../packages/contracts/src/program-admission';

// ── Shared synthetic cast (contract) ─────────────────────────────────────────
const ORG = '사회연대은행';
const PROGRAM = '함께온기금 울타리대출';
const PARTICIPANT = '김하늘';
const PARTICIPANT_ID = 'crane-001';
const WORKER = '이서연';
const WORKER_EMAIL = 'seoyeon@example.com';
const ADMIN = '박도현';
const ADMIN_EMAIL = 'dohyun@example.com';
const JOIN_URL = 'https://ccc.example.org/join/participant/invite-token-9f3ac2d1';
const WORKER_JOIN_URL = 'https://ccc.example.org/join/worker/invite-token-7b41e0c8';
const BUILD_STAMP = '2026-09-14T02:10:11Z a1b2c3d';



/** ListRow (apps/web/app/components/wire/list-row.tsx) without next/link. */
function CaptureListRow({ children, align = 'left', chevron, selected = false, href, className }: {
  children: ReactNode;
  align?: 'left' | 'center';
  chevron?: 'up' | 'down' | 'left' | 'right';
  selected?: boolean;
  href?: string;
  className?: string;
}) {
  const classes = ['surface-card', 'wire-row', className].filter(Boolean).join(' ');
  const inner = (
    <>
      <span className="wire-row-text">{children}</span>
      {chevron !== undefined && <Chevron dir={chevron} />}
    </>
  );
  if (href !== undefined) {
    return <a className={classes} href={href} data-align={align} data-selected={selected ? 'true' : undefined}>{inner}</a>;
  }
  return <div className={classes} data-align={align} data-static="true" data-selected={selected ? 'true' : undefined}>{inner}</div>;
}

/** AdminSidebar (components/wire/admin-sidebar.tsx) as static tabs. */
function AdminTabs({ activePath }: { activePath: string }) {
  const items = [
    { label: '기관', href: '/admin' },
    { label: '배정', href: '/admin/assign' },
    { label: '사용자·역할', href: '/admin/users' },
    { label: '실무자 초대', href: '/admin/invite' },
    { label: 'AI·STT·연결', href: '/admin/ai-provider' },
  ];
  return (
    <div className="wire-admin-tabs-scroll">
      <nav aria-label="관리자 메뉴" className="wire-tabs wire-admin-tabs">
        {items.map((item) => {
          const active = item.href === '/admin'
            ? activePath === '/admin'
            : activePath === item.href || activePath.startsWith(`${item.href}/`);
          return (
            <a key={item.href} className="wire-tab" href={item.href}
              data-active={active ? 'true' : undefined}
              aria-current={active ? 'page' : undefined}>{item.label}</a>
          );
        })}
      </nav>
    </div>
  );
}

/** admin/layout.tsx frame: 가로 탭 + 콘텐츠. */
function AdminFrame({ activePath, children }: { activePath: string; children: ReactNode }) {
  return (
    <div className="wire-admin-layout">
      <AdminTabs activePath={activePath} />
      <div className="wire-admin-content">{children}</div>
    </div>
  );
}

/** RiskBanner (briefing/risk-banner.tsx) — same markup, static flags. */
function CaptureRiskBanner() {
  const flags = [
    { id: 'kit-1', label: '부채 악화', source: '승인된 AI 제안', quote: '이자를 석 달째 내지 못했다.' },
    { id: 'kit-2', label: '연락 두절 위험', source: '실무자 기록', quote: null },
  ];
  return (
    <aside className="risk-banner" role="alert" aria-label="확인된 리스크 경고">
      <div className="risk-banner-head">
        <svg className="risk-banner-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 9.5v5" />
          <path d="M12 17.5h.01" />
        </svg>
        <p className="risk-banner-title">확인된 리스크 {flags.length}건</p>
      </div>
      <ul className="risk-banner-list">
        {flags.map((flag) => (
          <li key={flag.id}>
            <div className="risk-banner-item-head">
              <MetaRow items={[
                <span key="type" className="risk-banner-flag">{flag.label}</span>,
                <span key="source" className="panel-meta">{flag.source}</span>,
              ]} />
            </div>
            {flag.quote !== null && (
              <WireSourceQuotes quotes={[flag.quote]} sourceHref="#record-kit-session" />
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ── Relayer client shell (apps/client/src/app.tsx BusinessShell) ─────────────
const CLIENT_NAV: { id: string; title: string; href: string }[] = [
  { id: 'account', title: '내 정보', href: '/settings' },
  { id: 'schedule', title: '일정', href: '/schedule' },
  { id: 'schedule-register', title: '상담 일정 등록', href: '/schedules/new' },
  { id: 'participants', title: '당사자 목록', href: '/participants' },
  { id: 'participant-register', title: '당사자 등록', href: '/participants/new' },
  { id: 'participant-invite', title: '당사자 초대', href: '/participants/invite' },
  { id: 'staff-invites', title: '실무자 초대', href: '/staff-invites' },
  { id: 'onboarding', title: '기관 준비', href: '/onboarding' },
  { id: 'system', title: '연결 상태', href: '/settings?module=system' },
  { id: 'institution-profile', title: '기관 정보', href: '/settings?module=institution-profile' },
  { id: 'accounts', title: '사용자와 역할', href: '/settings?module=accounts' },
  { id: 'assignments', title: '담당 배정 요청', href: '/settings?module=assignments' },
  { id: 'memory', title: '기관 상담 기억', href: '/settings?module=memory' },
  { id: 'audit', title: '감사 기록', href: '/settings?module=audit' },
  { id: 'retention-policy', title: '개인정보 보유기간', href: '/settings?module=retention-policy' },
  { id: 'retention', title: '개인정보 보존 검토', href: '/settings?module=retention' },
];

function ClientShell({ activeId, children }: { activeId: string; children: ReactNode }) {
  return (
    <div className="settings-layout">
      <WireCard as="nav" className="settings-navigation" labelledBy="business-navigation"
        title={<h2 id="business-navigation">업무 메뉴</h2>}>
        <ul className="settings-navigation-list">
          {CLIENT_NAV.map((item) => (
            <li key={item.id}>
              <a className="navigation-link" href={item.href}
                aria-current={item.id === activeId ? 'page' : undefined}
                data-current={item.id === activeId ? 'true' : 'false'}>{item.title}</a>
            </li>
          ))}
        </ul>
      </WireCard>
      <div className="settings-content">{children}</div>
    </div>
  );
}

// ── Page bodies ──────────────────────────────────────────────────────────────

// apps/web/app/admin/page.tsx — 기관
const adminOrg = (
  <AdminFrame activePath="/admin">
    <WireCard as="section" className="settings-section" labelledBy="admin-org-heading"
      title={<h2 id="admin-org-heading">기관 정보</h2>}>
      <dl className="settings-account">
        <div className="settings-field"><dt>기관 이름</dt><dd>{ORG}</dd></div>
        <div className="settings-field"><dt>사업 이름</dt><dd>{PROGRAM}</dd></div>
      </dl>
    </WireCard>
    <WireCard as="section" className="settings-section" labelledBy="admin-people-heading"
      title={<h2 id="admin-people-heading">계정</h2>}>
      <dl className="settings-account" data-testid="admin-user-counts">
        <div className="settings-field"><dt>기관 관리자</dt><dd>1명</dd></div>
        <div className="settings-field"><dt>담당 실무자</dt><dd>2명</dd></div>
      </dl>
    </WireCard>
  </AdminFrame>
);

// apps/web/app/admin/ai-provider/page.tsx — AI 사업자 + STT
const adminAiProvider = (
  <AdminFrame activePath="/admin/ai-provider">
    <WireCard as="section" className="settings-section" labelledBy="ai-status-heading"
      title={<h2 id="ai-status-heading">AI 사업자</h2>}>
      <dl className="settings-account">
        <div className="settings-field">
          <dt>활성 상태</dt>
          <dd className="settings-value-row">
            <WireBadge tone="mint">활성</WireBadge>
            <span>openai-gpt5 v2026-08</span>
            <span>설정 해시 <code title="9f3ac2d1e8b7a4c5f6d2">9f3ac2d1e8…</code></span>
          </dd>
        </div>
        <div className="settings-field">
          <dt>배포 런타임</dt>
          <dd className="settings-value-row">
            <span>openai-gpt5 v2026-08</span>
            <WireBadge tone="mint">일치</WireBadge>
          </dd>
        </div>
      </dl>
      <form className="onboarding-form" aria-label="배포 런타임 활성화">
        <label htmlFor="approvalRef">승인 참조 (D66: 키 등급·약관 확인 기록)</label>
        <input id="approvalRef" name="approvalRef" type="text"
          placeholder="예: 2026-08-15 약관 확인(사업자 계정 이메일)" required />
        <button type="button" className="wire-button" disabled>배포 런타임 활성화</button>
      </form>
    </WireCard>
    <WireCard as="section" className="settings-section" labelledBy="stt-status-heading"
      title={<h2 id="stt-status-heading">STT</h2>}>
      <dl className="settings-account">
        <div className="settings-field">
          <dt>현재 처리</dt>
          <dd className="settings-value-row">
            <WireBadge tone="mint">기관 안 처리</WireBadge>
            <span>whisper-local</span>
          </dd>
        </div>
        <div className="settings-field">
          <dt>처리 장비</dt>
          <dd className="settings-value-row"><WireBadge tone="mint">연결됨</WireBadge></dd>
        </div>
      </dl>
      <WireCardSection title="엔진별 상태">
        <div className="capture-item-grid">
          <WireItem title="사용 안 함" description="지금 고를 수 있는 처리입니다."
            status={<WireBadge tone="mint">사용 가능</WireBadge>} />
          <WireItem title="기관 안 처리" description="지금 고를 수 있는 처리입니다."
            status={<WireBadge tone="mint">사용 가능</WireBadge>} />
          <WireItem title="Azure 외부 처리" description="처리 장비에 이 엔진의 자격이 없습니다."
            status={<WireBadge tone="lavender">자격 없음</WireBadge>} />
        </div>
      </WireCardSection>
    </WireCard>
  </AdminFrame>
);

// apps/web/app/admin/assign/page.tsx — 배정 (케이스 선택됨 상태)
const adminAssign = (
  <AdminFrame activePath="/admin/assign">
    <div className="wire-admin-list">
      <CaptureListRow>{PROGRAM}</CaptureListRow>
    </div>
    <form className="wire-admin-form-row" method="get">
      <SearchInput
        label="당사자(케이스) 선택"
        variant="select"
        name="supportCaseId"
        value="case-001"
        options={[
          { value: '', label: '당사자(케이스)를 선택하세요' },
          { value: 'case-001', label: `${PARTICIPANT}, 010-0000-1042, haneul@example.com` },
          { value: 'case-002', label: '윤재민, 010-0000-2211' },
        ]}
      />
      <WireButton type="submit">선택</WireButton>
    </form>
    <WireCardSection title={`${PARTICIPANT} 배정`}>
      <form className="wire-admin-form-row">
        <SearchInput
          label="실무자"
          variant="select"
          name="userId"
          options={[
            { value: 'u-admin', label: ADMIN },
            { value: 'u-worker', label: WORKER },
            { value: 'u-worker2', label: '최지우' },
          ]}
        />
        <WireButton type="submit">추가하기</WireButton>
      </form>
      <WireCardSection title="현재 배정된 실무자">
        <div className="capture-item-grid">
          <WireItem title={WORKER} status={<WireBadge tone="mint">주 담당</WireBadge>} />
          <WireItem title="최지우" status={<WireBadge tone="mint">공동 담당</WireBadge>} />
        </div>
      </WireCardSection>
    </WireCardSection>
  </AdminFrame>
);

// apps/web/app/admin/invite/page.tsx — 실무자 초대 (링크 발급 완료 상태)
const adminInvite = (
  <AdminFrame activePath="/admin/invite">
    <form className="wire-admin-form-row">
      <SearchInput label="실무자 등록하기" name="email" placeholder="이메일" />
      <WireButton type="submit">등록</WireButton>
    </form>
    <div className="wire-admin-section">
      <WireCard title="초대 링크">
        <div className="wire-invite-stack">
          <p className="wire-invite-caption" role="status">
            링크를 만들었습니다. 복사해서 초대할 실무자에게 전달하세요.
          </p>
          <div className="wire-invite-section">
            <WireFormField label="웹 링크 주소" htmlFor="worker-invite-url" control="textarea">
              <textarea id="worker-invite-url" readOnly rows={3} value={WORKER_JOIN_URL} />
            </WireFormField>
            <WireButton variant="secondary" type="button">링크 복사</WireButton>
          </div>
          <WireButton variant="ghost" type="button">새 링크 만들기</WireButton>
        </div>
      </WireCard>
    </div>
    <div className="wire-admin-section">
      <WireCallout tone="lavender" role="status" testId="admin-invite-note" title="초대 방법 두 가지">
        이메일을 아는 실무자는 위에서 바로 등록하고, 아니면 초대 링크를 만들어 전달하세요.
        링크를 받은 사람이 이름과 이메일을 입력해 가입하며, 두 경우 모두 Cloudflare Access 로
        로그인합니다. 메일을 자동으로 보내 주는 기능은 아직 없습니다. 링크는 직접 전달해야 합니다.
      </WireCallout>
    </div>
  </AdminFrame>
);

// apps/web/app/admin/users/page.tsx — 사용자 (이서연 선택됨)
const adminUsers = (
  <AdminFrame activePath="/admin/users">
    <div className="wire-admin-cols">
      <WireCardSection title="실무자 목록">
        <div className="capture-item-grid">
          <WireItem title={ADMIN} status={<WireBadge tone="mint">기관 관리자</WireBadge>}
            action={<a href="#admin-users">선택</a>} />
          <WireItem title={WORKER} tone="mint" status={<WireBadge tone="mint">담당 실무자</WireBadge>}
            action={<a href="#admin-users">선택</a>} />
          <WireItem title="최지우" status={<WireBadge tone="mint">담당 실무자</WireBadge>}
            action={<a href="#admin-users">선택</a>} />
        </div>
      </WireCardSection>
      <WireCardSection title="담당 당사자">
        <div className="wire-admin-detail-head">
          <p className="wire-admin-detail-name">{WORKER}</p>
          <a className="wire-header-link" href="#admin-user-detail">
            상세 보기 <Chevron dir="right" />
          </a>
        </div>
        <div className="capture-item-grid">
          <WireItem title={`${PARTICIPANT} 010-0000-1042`}
            status={<WireBadge tone="mint">진행 중</WireBadge>} />
          <WireItem title="윤재민 010-0000-2211"
            status={<WireBadge tone="mint">상환 중</WireBadge>} />
          <WireItem title="강다은 010-0000-3398"
            status={<WireBadge tone="mint">종결</WireBadge>} />
        </div>
        <WireEmpty testId="admin-users-assign-hint">
          담당을 바꾸려면 <a className="wire-header-link" href="#admin-assign">배정 화면</a>에서 당사자를 고르세요.
        </WireEmpty>
      </WireCardSection>
    </div>
  </AdminFrame>
);

// apps/web/app/admin/users/[id]/page.tsx — 실무자 상세
const adminUserDetail = (
  <AdminFrame activePath="/admin/users">
    <div className="wire-admin-back">
      <WireButton variant="ghost" href="#admin-users">사용자 목록으로</WireButton>
    </div>
    <div className="wire-admin-form">
      <SearchInput label="이름" name="name" value={WORKER} />
      <SearchInput label="이메일" name="email" value={WORKER_EMAIL} />
      <SearchInput label="역할" name="role" value="담당 실무자" />
      <SearchInput label="기관" name="org" value={ORG} />
    </div>
    <section className="wire-admin-section" aria-label="담당 당사자">
      <h2>담당 당사자</h2>
      <div className="wire-admin-list">
        <CaptureListRow>
          <MetaRow items={[`${PARTICIPANT}`, '010-0000-1042', '진행 중']} />
        </CaptureListRow>
        <CaptureListRow>
          <MetaRow items={['윤재민', '010-0000-2211', '상환 중']} />
        </CaptureListRow>
        <CaptureListRow>
          <MetaRow items={['강다은', '010-0000-3398', '종결']} />
        </CaptureListRow>
      </div>
    </section>
    <div className="wire-admin-section">
      <WireButton href="#admin-assign" variant="neutral" chevron>배정하기</WireButton>
    </div>
  </AdminFrame>
);

// apps/web/app/settings/page.tsx — 설정 (기관 관리자 시점, 배정 요청 1건)
const settings = (
  <>
    <WireCard as="section" className="settings-section" labelledBy="settings-account-heading"
      title={<h2 id="settings-account-heading">내 계정</h2>}>
      <dl className="settings-account">
        <div className="settings-field"><dt>이름</dt><dd>{ADMIN}</dd></div>
        <div className="settings-field"><dt>이메일</dt><dd>{ADMIN_EMAIL}</dd></div>
        <div className="settings-field"><dt>역할</dt><dd>기관 관리자</dd></div>
      </dl>
    </WireCard>

    <WireCard as="section" className="settings-section" labelledBy="settings-assignment-requests-heading"
      title={<h2 id="settings-assignment-requests-heading">배정 요청</h2>}>
      <ul className="settings-user-list">
        <li className="settings-user-row">
          <div>
            <p className="settings-user-email">{PARTICIPANT}</p>
            <p className="settings-user-role">{PROGRAM}</p>
          </div>
          <WireBadge tone="mint">공동 담당</WireBadge>
          <form><WireButton type="submit" variant="primary">수락</WireButton></form>
        </li>
      </ul>
    </WireCard>

    <div className="memory-page-stack">
      <WireCard title={<span className="wire-title-with-badge">자동 상담 기억<WireBadge>켜짐</WireBadge></span>}>
        <form className="memory-form">
          <WireChoice type="checkbox" label="자동 생성과 갱신 사용" checked onChange={() => undefined} />
          <p className="wire-form-hint">켜면 기존 공식 기록도 자동으로 정리하며 처리 시간과 AI 비용이 발생할 수 있습니다. 끄면 새 생성과 갱신만 멈추고 이미 생성한 기억은 보존됩니다.</p>
          <div className="memory-reference-actions">
            <WireButton variant="primary" type="submit" icon={<Icon name="check" />}>설정 저장</WireButton>
          </div>
        </form>
        <WireCardSection title="처리 상태">
          <WireDataRows>
            <WireDataRow label="작동 조건" value="기관의 AI 연결과 케이스별 동의, 가림 처리가 준비되어야 합니다." />
            <WireDataRow label="처리 대기" value={<WireBadge tone="lavender">2건</WireBadge>} />
            <WireDataRow label="조건 확인 대기" value={<WireBadge tone="lavender">1건</WireBadge>} />
            <WireDataRow label="처리 실패" value={<WireBadge tone="lavender">0건</WireBadge>} />
            <WireDataRow label="마지막 성공" value="2026년 9월 12일 오후 3:24" />
          </WireDataRows>
          <p className="panel-meta">이 설정은 AI 연결이나 당사자의 동의를 대신 켜지 않습니다. 동의 철회와 개인정보 파기는 기존 기억의 이용도 중단할 수 있습니다.</p>
        </WireCardSection>
      </WireCard>
      <WireCallout title="처리 조건 확인 대기" tone="lavender">
        AI 연결이나 처리 장비, 동의와 가림 처리 조건을 확인하고 있습니다. 기관의 켜짐 설정은 유지됩니다.
      </WireCallout>
    </div>

    <WireCard as="section" className="settings-section" labelledBy="settings-directory-heading"
      title={<h2 id="settings-directory-heading">기관 실무자 목록</h2>}>
      <ul className="settings-user-list">
        <li className="settings-user-row">
          <span className="settings-user-email">{ADMIN}</span>
          <span className="settings-user-role">기관 관리자</span>
          <WireBadge>활성</WireBadge>
        </li>
        <li className="settings-user-row">
          <span className="settings-user-email">{WORKER}</span>
          <span className="settings-user-role">담당 실무자</span>
          <WireBadge>활성</WireBadge>
        </li>
        <li className="settings-user-row">
          <span className="settings-user-email">최지우</span>
          <span className="settings-user-role">담당 실무자</span>
          <WireBadge>활성</WireBadge>
        </li>
        <li className="settings-user-row" data-active="false">
          <span className="settings-user-email">한소리</span>
          <span className="settings-user-role">담당 실무자</span>
          <WireBadge>비활성</WireBadge>
        </li>
      </ul>
    </WireCard>

    <WireCard as="section" className="settings-section" labelledBy="settings-admin-heading"
      title={<h2 id="settings-admin-heading">관리자 설정</h2>}>
      <ul className="settings-user-list">
        <li className="settings-user-row"><WireButton variant="neutral" href="#admin">기관</WireButton></li>
        <li className="settings-user-row"><WireButton variant="neutral" href="#admin-assign">배정</WireButton></li>
        <li className="settings-user-row"><WireButton variant="neutral" href="#admin-users">사용자·역할</WireButton></li>
        <li className="settings-user-row"><WireButton variant="neutral" href="#admin-invite">실무자 초대</WireButton></li>
        <li className="settings-user-row"><WireButton variant="neutral" href="#onboarding">기관·사업 이름</WireButton></li>
      </ul>
    </WireCard>
  </>
);

// apps/web/app/participants/invite/page.tsx — 당사자 초대 (링크 발급 완료 상태)
const inviteEmailDraft = [
  `[${ORG}] ${PROGRAM} 상담 가입 안내`,
  '',
  '안녕하세요. 함께온기금 울타리대출 상담을 시작하기 전에 아래 링크를 열어 가입을 진행해 주세요.',
  '이름·이메일·연락처만 입력하면 되고, 링크는 본인 전용입니다.',
  '',
  JOIN_URL,
  '',
  '가입이 끝나면 담당 실무자가 확인 후 첫 상담 일정을 안내드립니다.',
].join('\n');

const participantInvite = (
  <div className="wire-invite-stack">
    <WireCard title="초대 사업">
      <WireField label="기관">{ORG}</WireField>
      <WireField label="사업">{PROGRAM}</WireField>
    </WireCard>
    <WireCard title="가입 링크">
      <div className="wire-invite-stack participant-invite-stack">
        <p className="wire-invite-caption" role="status">
          링크를 만들었습니다. 아래에서 편한 방법으로 전달하세요.
        </p>
        <div className="wire-invite-section">
          <WireFormField label="웹 링크 주소" htmlFor="invite-url" control="input">
            <input id="invite-url" type="text" readOnly value={JOIN_URL} />
          </WireFormField>
          <div className="wizard-actions">
            <WireButton variant="secondary" type="button">링크 복사</WireButton>
            <WireButton variant="secondary" type="button" icon={<NavIcon name="share" />}>공유하기</WireButton>
          </div>
        </div>
        <div className="wire-form-field">
          <span className="wire-form-label">QR 코드</span>
          <span className="wire-invite-qr">
            <QRCodeSVG value={JOIN_URL} size={160} fgColor="currentColor" bgColor="transparent" marginSize={2} />
          </span>
          <span className="wire-form-hint">화면을 보여 주고 당사자 휴대전화 카메라로 찍게 하면 됩니다.</span>
        </div>
        <div className="wire-invite-section">
          <WireFormField label="이메일 문안" htmlFor="invite-email-draft" control="textarea"
            hint="발송 기능은 없습니다. 복사해서 이메일이나 문자로 보내는 문안입니다.">
            <textarea id="invite-email-draft" readOnly rows={9} value={inviteEmailDraft} />
          </WireFormField>
          <WireButton variant="secondary" type="button">이메일 문안 복사</WireButton>
        </div>
        <WireButton variant="ghost" type="button">새 링크 만들기</WireButton>
      </div>
    </WireCard>
  </div>
);

// apps/web/app/join/participant/[token]/page.tsx — 공개 당사자 가입
const joinParticipant = (
  <WireCard>
    <p className="wire-invite-caption">
      {PROGRAM} 상담에 참여하기 위해 아래 정보를 입력해 주세요.
    </p>
    <form className="wire-register-form">
      <div className="wire-container" data-grid="true">
        <div className="wire-col-6">
          <SearchInput label="이름" name="name" placeholder="당사자 이름" value={PARTICIPANT} />
        </div>
        <div className="wire-col-6">
          <SearchInput label="연락처" name="phone" placeholder="010-0000-0000" value="010-0000-1042" />
        </div>
        <div className="wire-col-6">
          <SearchInput label="이메일" name="email" placeholder="participant@example.com" value="haneul@example.com" />
        </div>
      </div>
      <fieldset className="consent-fieldset">
        <legend>동의</legend>
        <p className="schedule-form-hint">
          동의하신 항목과 일시가 기록됩니다. 개인정보 수집·이용 동의는 가입에 반드시 필요하고,
          AI를 활용한 녹취기록은 동의하지 않아도 가입이 진행됩니다.
        </p>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentPrivacy" value="on" required defaultChecked />
          <span>개인정보 수집·이용 동의 (필수)</span>
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" name="consentRecordingAi" value="on" />
          <span>AI를 활용한 녹취기록 동의</span>
        </label>
        <details className="consent-detail">
          <summary className="consent-detail-summary">
            <span>자세히 읽어보기</span>
            <DisclosureChevron variant="plain" />
          </summary>
          <div className="consent-detail-body">
            <p className="consent-detail-disclaimer">{CONSENT_DETAIL_DISCLAIMER}</p>
            {CONSENT_DETAIL_SECTIONS.map((section) => (
              <div className="consent-detail-section" key={section.heading}>
                <h3>{section.heading}</h3>
                {section.paragraphs?.map((paragraph) => <p className="consent-detail-paragraph" key={paragraph}>{paragraph}</p>)}
                {section.items === undefined ? null : (
                  <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
                )}
              </div>
            ))}
          </div>
        </details>
      </fieldset>
      <WireButton type="submit" size="large" className="wire-register-submit">가입 완료</WireButton>
    </form>
  </WireCard>
);

// apps/web/app/join/worker/[token]/page.tsx — 공개 실무자 초대 수락
const joinWorker = (
  <WireCard>
    <p className="wire-invite-caption">
      {ORG} 의 실무자로 초대받았습니다. 아래 정보를 입력해 주세요.
    </p>
    <form className="wire-register-form">
      <div className="wire-container" data-grid="true">
        <div className="wire-col-6">
          <SearchInput label="이름" name="name" placeholder="실무자 이름" value={WORKER} />
        </div>
        <div className="wire-col-6">
          <SearchInput label="이메일" name="email" placeholder="worker@example.org" value={WORKER_EMAIL} />
        </div>
      </div>
      <p className="schedule-form-hint">
        입력한 이메일이 로그인 계정이 됩니다. 기관에서 실제로 쓰는 이메일을 입력해 주세요.
      </p>
      <WireButton type="submit" size="large" className="wire-register-submit">가입 완료</WireButton>
    </form>
  </WireCard>
);

// apps/web/app/onboarding/page.tsx + onboarding-wizard.tsx — 1단계
const onboarding = (
  <form className="onboarding-form" aria-label="기관 온보딩">
    <article className="surface-card onboarding-card">
      <h2 className="wire-title-with-badge">기관 이름을 입력하세요<WireBadge>1단계 / 2단계</WireBadge></h2>
      <p className="onboarding-help">사이드바와 화면 전체에 이 이름이 표시됩니다.</p>
      <SearchInput label="기관 이름" name="orgName" placeholder="예: 사회연대은행" value={ORG} />
      <div className="onboarding-actions">
        <WireButton type="button" variant="primary" align="center">다음</WireButton>
      </div>
    </article>
  </form>
);

// apps/web/app/onboarding/onboarding-wizard.tsx — 2단계 (첫 사업 이름)
const onboardingStep2 = (
  <form className="onboarding-form" aria-label="기관 온보딩">
    <article className="surface-card onboarding-card">
      <h2 className="wire-title-with-badge">첫 사업 이름을 입력하세요<WireBadge>2단계 / 2단계</WireBadge></h2>
      <p className="onboarding-help">
        {ORG}에서 운영할 첫 사업의 표시 이름입니다. 저장하면 사업 전환기와 등록 화면에 보입니다.
      </p>
      <input type="hidden" name="orgName" value={ORG} />
      <SearchInput
        label="첫 사업 이름"
        name="programDisplayName"
        placeholder="예: 자립준비청년 소액대출 지원"
        value={PROGRAM}
      />
      <div className="onboarding-actions">
        <WireButton type="button" variant="secondary" align="center">이전</WireButton>
        <WireButton type="submit" variant="primary" align="center">저장하고 시작하기</WireButton>
      </div>
    </article>
  </form>
);

// apps/web/app/onboarding/page.tsx OnboardingDone — 저장 직후 완료 안내
const onboardingDone = (
  <article className="surface-card onboarding-card" aria-label="온보딩 완료">
    <h2>준비가 끝났습니다</h2>
    <p className="onboarding-help">
      {ORG}의 워크스페이스가 {PROGRAM} 이름으로 준비됐습니다.
      입력한 이름은 사이드바와 화면 전체에 바로 표시됩니다.
    </p>
    <p className="onboarding-help">다음 걸음은 함께 일할 실무자를 초대하는 것입니다.</p>
    <div className="onboarding-actions">
      <WireButton variant="secondary" align="center" href="#onboarding">이름 다시 고치기</WireButton>
      <WireButton variant="primary" align="center" href="#admin-invite">실무자 초대로 이동</WireButton>
    </div>
  </article>
);

// apps/web/app/welcome/page.tsx — 공개 입구
const welcome = (
  <>
    <div className="preview-gate-head">
      <p>
        자립준비청년 소액대출 상담을 인테이크부터 종결까지 기록하고,
        상담 5분 전 브리핑 한 화면으로 보여주는 내부 도구입니다.
      </p>
    </div>
    <WireCard as="section" title="15초 브리핑" className="preview-gate-card">
      <p>상담 5분 전에 열어 15초 안에 훑는 한 화면에 담기는 것:</p>
      <WireBullets
        items={[
          '오늘 만나기 전 꼭 기억할 것',
          '상담 내용 회차별 정리',
          '내용 불일치: 기록 사이에 어긋나는 서술을 나란히',
        ]}
      />
    </WireCard>
    <WireCard as="section" title="시작하기" className="preview-gate-card">
      <WireButton variant="primary" href="#onboarding" className="preview-gate-submit">
        기관 등록 시작
      </WireButton>
      <WireButton variant="secondary" href="#home" className="preview-gate-submit">
        실무자 로그인
      </WireButton>
      <p className="note-inline">
        실무자 로그인은 Cloudflare Access 로 진행됩니다. 기관에 등록된 이메일로 인증하면
        작업 화면으로 이동합니다.
      </p>
    </WireCard>
  </>
);

// apps/web/app/preview/preview-gate-form.tsx — 코드 게이트 (실무자/관리자)
function previewGate(admin: boolean) {
  return (
    <>
      <div className="preview-gate-head">
        <p>
          {admin
            ? '기관 관리자 화면을 확인하려면 관리자용 코드를 입력하세요.'
            : '개발 중인 서비스를 미리 보려면 전달받은 코드를 입력하세요.'}
        </p>
      </div>
      <form className="surface-card preview-gate-card" method="post">
        <WireFormField label="접속 코드" required htmlFor={admin ? 'preview-code-admin' : 'preview-code'}>
          <input id={admin ? 'preview-code-admin' : 'preview-code'} type="password" name="code"
            autoComplete="off" required defaultValue="preview-2026" />
        </WireFormField>
        <WireButton type="submit" variant="primary" className="preview-gate-submit">
          {admin ? '기관 관리자로 입장' : '실무자로 입장'}
        </WireButton>
        <WireButton variant="secondary" href={admin ? '#preview' : '#preview-admin'}
          className="preview-gate-submit">
          {admin ? '실무자 미리보기' : '기관 관리자 미리보기'}
        </WireButton>
        <p className="note-inline">
          이 미리보기는 가상 시드 데이터만 담고 있으며 실제 당사자 정보와 연결되어 있지 않습니다.
        </p>
        <p className="note-inline" data-testid="preview-build-stamp">빌드 {BUILD_STAMP}</p>
      </form>
    </>
  );
}

// ── Relayer client screens ───────────────────────────────────────────────────

// apps/client/src/business/auth-view.tsx — 기관 계정 로그인 (password step)
const clientLogin = (
  <WireCard as="section" labelledBy="auth-title" title={<h2 id="auth-title">기관 계정 로그인</h2>}>
    <form className="business-form">
      <WireFormField label="이메일" htmlFor="login-email" required>
        <input id="login-email" name="email" type="email" autoComplete="username" required
          defaultValue={WORKER_EMAIL} />
      </WireFormField>
      <WireFormField label="비밀번호" htmlFor="login-password" required>
        <input id="login-password" name="password" type="password" autoComplete="current-password"
          required defaultValue="synthetic-password" />
      </WireFormField>
      <WireButton type="submit" variant="primary">로그인</WireButton>
    </form>
  </WireCard>
);

// apps/client/src/app.tsx PublicScreen kind="welcome"
const clientWelcome = (
  <WireCard>
    <WireCallout tone="info" title="기관 계정으로 시작">
      서명된 설치 정보를 확인한 뒤 기관 계정과 추가 인증으로 로그인합니다.
    </WireCallout>
    <WireButton variant="neutral" href="#client-login">로그인으로 이동</WireButton>
  </WireCard>
);

// apps/client/src/app.tsx PublicScreen kind="institution" (/k/:code)
const clientInstitutionCode = (
  <WireCard>
    <WireCallout tone="info" title="연결 준비 중">
      기관 코드를 설치 정보와 연결하는 계약이 아직 준비되지 않았습니다. 코드로 임의의 서버 주소를 만들지 않습니다.
    </WireCallout>
  </WireCard>
);

// apps/client/src/screens/institution.tsx — 기관 준비 (초기 설정 + 사업 도입 확인)
const admissionCopy = PROGRAM_ADMISSION_COPY;
const clientInstitution = (
  <ClientShell activeId="onboarding">
    <WireCard title="기관 준비 상태">
      <WireDataRows>
        <WireDataRow label="기관 이름" value={ORG} />
        <WireDataRow label="초기 설정" value="완료" />
        <WireDataRow label="첫 사업 도입 확인" value="확인 전" />
        <WireDataRow label="첫 사업" value={`${PROGRAM}: 관리자 확인이 아직 없습니다.`} />
        <WireDataRow label="설치 정보" value="읽을 수 있음" />
        <WireDataRow label="관리자 연결" value="연결됨" />
        <WireDataRow label="보유 기간 설정" value="저장됨" />
        <WireDataRow label="동의 문안" value="여섯 영역 모두 발행 가능 (consent-six-domains-v1)" />
      </WireDataRows>
      <WireCallout tone="info" title="이 값이 뜻하는 것">
        서버가 저장된 상태를 관측한 결과입니다. 실제 인증이나 외부 연결이 준비됐다는 뜻은 아닙니다.
      </WireCallout>
    </WireCard>
    <WireCard title="초기 설정과 사업 도입 확인">
      <WireCardSection title="기관 초기 설정">
        <form className="business-form">
          <WireFormField label="기관 이름" htmlFor="setup-org" required>
            <input id="setup-org" defaultValue={ORG} required />
          </WireFormField>
          <WireFormField label="첫 사업 이름" htmlFor="setup-program" required>
            <input id="setup-program" defaultValue={PROGRAM} required />
          </WireFormField>
          <div className="business-actions">
            <WireButton type="submit" variant="primary">초기 설정 저장</WireButton>
          </div>
        </form>
      </WireCardSection>
      <WireCardSection title={PROGRAM}
        action={<WireBadge tone="neutral">관리자 확인이 아직 없습니다.</WireBadge>}>
        <WireDataRows>
          <WireDataRow label="사업 상태" value="진행 중" />
          <WireDataRow label="마지막 확인" value="확인 기록 없음" />
        </WireDataRows>
        <WireCardSection title={admissionCopy.storage.heading}>
          <p className="wire-section-value">{admissionCopy.storage.installationNotice}</p>
          <WireChoice type="radio" name="storage-program-1" label={admissionCopy.storage.options.supabase_seoul.label}
            desc={admissionCopy.storage.options.supabase_seoul.description} checked onChange={() => undefined} />
          <WireChoice type="radio" name="storage-program-1" label={admissionCopy.storage.options.naver_public.label}
            desc={admissionCopy.storage.options.naver_public.disabledNotice} disabled onChange={() => undefined} />
          <WireChoice type="radio" name="storage-program-1" label={admissionCopy.storage.options.undecided.label}
            desc={admissionCopy.storage.options.undecided.description} onChange={() => undefined} />
        </WireCardSection>
        <WireCardSection title={admissionCopy.processing.heading}>
          <WireChoice type="radio" name="processing-program-1" label={admissionCopy.processing.options.external_allowed.label}
            desc={admissionCopy.processing.options.external_allowed.description} onChange={() => undefined} />
          <p className="wire-section-value">{admissionCopy.processing.options.external_allowed.aiNotice}</p>
          <p className="wire-section-value">{admissionCopy.processing.options.external_allowed.speechNotice}</p>
          <WireChoice type="radio" name="processing-program-1" label={admissionCopy.processing.options.internal_only.label}
            desc={admissionCopy.processing.options.internal_only.description} checked onChange={() => undefined} />
          <p className="wire-section-value">{admissionCopy.processing.options.internal_only.notice}</p>
          <WireChoice type="radio" name="processing-program-1" label={admissionCopy.processing.options.undecided.label}
            desc={admissionCopy.processing.options.undecided.description} onChange={() => undefined} />
        </WireCardSection>
        <WireCardSection title="관리자 확인">
          <p className="wire-section-value">{admissionCopy.footerNotice}</p>
          <WireChoice type="checkbox" label={admissionCopy.confirmation} onChange={() => undefined} />
          <div className="business-actions">
            <WireButton variant="primary" disabled>확인 저장</WireButton>
          </div>
        </WireCardSection>
      </WireCardSection>
    </WireCard>
  </ClientShell>
);

// apps/client/src/screens/invites.tsx StaffInviteScreen — 실무자 초대 (관리자 시점)
const clientStaffInvites = (
  <ClientShell activeId="staff-invites">
    <WireCard title="실무자 초대">
      <WireCallout tone="info" title="이메일 하나에 묶인 1회용 초대입니다">
        기관 관리자는 줄 역할을 반드시 고릅니다. 링크는 한 번만 쓸 수 있고 서버가 정한 기한이 지나면 만료됩니다.
      </WireCallout>
      <WireCallout tone="info" title="초대 링크를 한 번만 보여 줍니다">
        <p className="wire-section-value capture-break">https://relayer.example.org/staff/join#t=invite-token-7b41e0c8</p>
        <div className="business-actions">
          <WireButton variant="neutral" type="button">복사</WireButton>
        </div>
      </WireCallout>
      <form className="business-form">
        <WireFormField label="초대할 이메일" htmlFor="invite-email" required hint="이 이메일로만 가입할 수 있습니다">
          <input id="invite-email" type="email" defaultValue="jiwoo@example.com" required />
        </WireFormField>
        <WireChoice type="checkbox" label="기관 관리자" onChange={() => undefined} />
        <WireChoice type="checkbox" label="기관 기술 관리자" onChange={() => undefined} />
        <WireChoice type="checkbox" label="실무 책임자" onChange={() => undefined} />
        <WireChoice type="checkbox" label="실무자" checked onChange={() => undefined} />
        <div className="business-actions">
          <WireButton type="submit" variant="primary">초대 만들기</WireButton>
        </div>
      </form>
      <div className="capture-item-grid">
        <WireItem title={WORKER_EMAIL} description="실무자, 만료 2026-09-21"
          status={<WireBadge tone="mint">보냄</WireBadge>}
          action={<WireButton variant="neutral" type="button">취소</WireButton>} />
        <WireItem title="sori@example.com" description="실무 책임자, 만료 2026-09-10"
          status={<WireBadge tone="neutral">가입 완료</WireBadge>} />
      </div>
    </WireCard>
  </ClientShell>
);

// apps/client/src/screens/invites.tsx ParticipantInviteScreen — 당사자 초대 (요청 링크)
const clientParticipantInvite = (
  <ClientShell activeId="participant-invite">
    <WireCard title="당사자 초대">
      <WireCallout tone="info" title="링크 하나에 목적 하나입니다">
        링크는 한 번만 쓸 수 있고 서버가 정한 기한이 지나면 만료됩니다. 링크를 어디로 보낼지는 기관이 정합니다.
      </WireCallout>
      <WireCallout tone="info" title="요청 링크를 한 번만 보여 줍니다">
        <p className="wire-section-value capture-break">https://relayer.example.org/join#t=request-token-4d92f7a1</p>
        <div className="business-actions">
          <WireButton variant="neutral" type="button">복사</WireButton>
        </div>
      </WireCallout>
      <form className="business-form">
        <WireFormField label="참여 사업" htmlFor="request-link-program" control="select" required>
          <select id="request-link-program" defaultValue="program-1" required>
            <option value="">사업을 고르세요</option>
            <option value="program-1">{PROGRAM}</option>
          </select>
        </WireFormField>
        <div className="business-actions">
          <WireButton type="submit" variant="primary">요청 링크 만들기</WireButton>
        </div>
      </form>
    </WireCard>
  </ClientShell>
);

// apps/client/src/screens/invites.tsx StaffJoinScreen — 실무자 초대 수락 (공개)
const clientStaffJoin = (
  <WireCard title="실무자 초대">
    <WireDataRows>
      <WireDataRow label="기관" value={ORG} />
      <WireDataRow label="받을 역할" value="실무자" />
      <WireDataRow label="만료" value="2026-09-21" />
    </WireDataRows>
    <form className="business-form">
      <WireFormField label="이름" htmlFor="staff-join-name" required>
        <input id="staff-join-name" defaultValue={WORKER} required />
      </WireFormField>
      <WireFormField label="이메일" htmlFor="staff-join-email" required hint="초대받은 이메일과 같아야 합니다">
        <input id="staff-join-email" type="email" defaultValue={WORKER_EMAIL} required />
      </WireFormField>
      <WireFormField label="비밀번호" htmlFor="staff-join-password" required hint="여덟 자 이상으로 정해 주세요">
        <input id="staff-join-password" name="password" type="password" autoComplete="new-password"
          minLength={8} required defaultValue="synthetic-password" />
      </WireFormField>
      <WireFormField label="비밀번호 확인" htmlFor="staff-join-password-confirm" required>
        <input id="staff-join-password-confirm" name="passwordConfirm" type="password"
          autoComplete="new-password" minLength={8} required defaultValue="synthetic-password" />
      </WireFormField>
      <div className="business-actions">
        <WireButton type="submit" variant="primary">초대 수락</WireButton>
      </div>
    </form>
  </WireCard>
);

// apps/client/src/screens/invites.tsx ParticipantJoinScreen — 당사자 요청 링크 완료 (공개)
const CONSENT_RECIPIENT: Record<string, string> = {
  personal_data_collection_use: ORG,
  sensitive_information_processing: ORG,
  counseling_recording: `${ORG} 녹음 장비`,
  external_stt_processing: 'Microsoft Azure',
  external_llm_cross_border_processing: 'OpenAI',
  voice_original_retention_period: `${ORG} 저장 장비`,
};
const CONSENT_COUNTRY: Record<string, string> = {
  external_stt_processing: '한국',
  external_llm_cross_border_processing: '미국',
};

const clientParticipantJoin = (
  <WireCard title="당사자 등록">
    <WireDataRows>
      <WireDataRow label="기관" value={ORG} />
      <WireDataRow label="만료" value="2026-09-21" />
    </WireDataRows>
    <form className="business-form">
      <WireFormField label="이름" htmlFor="join-name" required>
        <input id="join-name" defaultValue={PARTICIPANT} required />
      </WireFormField>
      <WireFormField label="연락처" htmlFor="join-phone">
        <input id="join-phone" inputMode="tel" defaultValue="010-0000-1042" />
      </WireFormField>
      <WireFormField label="이메일" htmlFor="join-email">
        <input id="join-email" type="email" defaultValue="haneul@example.com" />
      </WireFormField>
      <WireCallout tone="info" title="여섯 영역을 각각 고릅니다">
        아래 문안은 서버가 발행한 그대로입니다. 고른 결과는 문안 버전과 확인값까지 함께 기록됩니다.
        모두 동의한 뒤에도 영역마다 다시 고를 수 있습니다.
      </WireCallout>
      <div className="business-actions">
        <WireButton type="button" variant="neutral">모두 동의</WireButton>
      </div>
      {CONSENT_DOMAINS.map((domain) => (
        <WireCardSection key={domain} title={CONSENT_COPY[domain].label}>
          <p className="wire-section-value">{CONSENT_COPY[domain].copy}</p>
          <WireDataRows>
            <WireDataRow label="받는 곳" value={CONSENT_RECIPIENT[domain] ?? '기관 안'} />
            <WireDataRow label="처리 국가" value={CONSENT_COUNTRY[domain] ?? '국내'} />
          </WireDataRows>
          <WireChoice type="radio" name={`consent-${domain}`} label="동의함" value="grant"
            id={`consent-${domain}-grant`} checked={domain === 'personal_data_collection_use'}
            onChange={() => undefined} />
          <WireChoice type="radio" name={`consent-${domain}`} label="동의하지 않음" value="decline"
            id={`consent-${domain}-decline`} checked={domain !== 'personal_data_collection_use'}
            onChange={() => undefined} />
        </WireCardSection>
      ))}
      <div className="business-actions">
        <WireButton type="submit" variant="primary" disabled>등록 보내기</WireButton>
      </div>
    </form>
  </WireCard>
);

// apps/client/src/screens/settings.tsx AssignmentsModule — 담당 배정 요청 (첫 케이스 펼침)
const clientAssignments = (
  <ClientShell activeId="assignments">
    <WireCard title="담당 배정 요청">
      <WireCallout tone="info" title="승인은 공동 담당이나 이관 중 하나입니다">
        실무자가 보낸 요청을 여기서 결정합니다. 승인 전에는 상담 내용과 개인정보가 그 실무자에게 열리지 않습니다.
      </WireCallout>
      <WireCardSection title={<ParticipantName name={PARTICIPANT} beneficiaryId={PARTICIPANT_ID} />}
        action={<WireButton variant="neutral" type="button">접기</WireButton>}>
        <WireDataRows>
          <WireDataRow label="사업" value={PROGRAM} />
          <WireDataRow label="상태" value="진행 중" />
        </WireDataRows>
        <div className="capture-item-grid">
          <WireItem title={WORKER}
            description="주 담당, 2026-09-01"
            status={<WireBadge tone="mint">담당 중</WireBadge>} />
          <WireItem title="최지우"
            description="공동 담당, 2026-09-12, 사유: 담당자 휴가 기간 상담 지원"
            status={<WireBadge tone="lavender">요청 중</WireBadge>}
            action={<>
              <WireButton variant="primary" type="button">공동 담당</WireButton>
              <WireButton variant="neutral" type="button">이관</WireButton>
              <WireButton variant="neutral" type="button" disabled>반려</WireButton>
            </>} />
        </div>
        <WireFormField label="반려 사유" htmlFor="reject-case-001" hint="반려할 때만 필요합니다">
          <input id="reject-case-001" defaultValue="" />
        </WireFormField>
      </WireCardSection>
      <WireCardSection title={<ParticipantName name="윤재민" beneficiaryId="heron-014" />}
        action={<WireButton variant="neutral" type="button">담당 보기</WireButton>}>
        <WireDataRows>
          <WireDataRow label="사업" value={PROGRAM} />
          <WireDataRow label="상태" value="진행 중" />
        </WireDataRows>
      </WireCardSection>
    </WireCard>
  </ClientShell>
);

// apps/client/src/stt-trial/stt-trial-page.tsx — STT 내부 시험 (완료 상태, 가상 전사)
const sttTrial = (
  <>
    <WireCallout tone="info" title="내부 기능 시험 화면입니다">
      운영 승인 전 화면입니다. 본인의 비민감 시험 녹음만 올리고 실제 당사자 자료와 다른 사람 목소리는 쓰지 않습니다.
    </WireCallout>

    <WireCard as="section" labelledBy="stt-submit-heading" title={<h2 id="stt-submit-heading">시험 녹음 제출</h2>}>
      <WireCardSection title="녹음 파일">
        <input hidden type="file" accept="audio/wav,audio/mpeg" />
        <WireButton variant="secondary" type="button">파일 고르기</WireButton>
        <WireDataRows>
          <WireDataRow label="고른 파일" value="trial-recording-0912.wav" />
          <WireDataRow label="크기" value="4.2MB" />
          <WireDataRow label="형식" value="audio/wav" />
          <WireDataRow label="허용 크기" value="25MB" />
        </WireDataRows>
      </WireCardSection>
      <WireCardSection title="엔진">
        <WireChoice type="radio" name="stt-engine" id="stt-engine-local" label="로컬 qwen3-asr"
          desc="qwen3-asr-1.7b rev-2026-08, 정렬 ctc-aligner r3, 장치 mps"
          checked onChange={() => undefined} />
        <WireChoice type="radio" name="stt-engine" id="stt-engine-azure" label="Azure"
          desc="koreacentral, 2025-10-15. 원본 파일이 외부로 나갑니다."
          onChange={() => undefined} />
      </WireCardSection>
      <WireCardSection title="확인">
        <WireChoice type="checkbox" id="stt-owned" label="본인의 비민감 시험 녹음입니다"
          desc="실제 당사자 자료와 다른 사람 목소리는 올리지 않습니다."
          checked onChange={() => undefined} />
      </WireCardSection>
      <WireCardSection title="실행">
        <WireButton variant="primary" type="button">시험 실행</WireButton>
      </WireCardSection>
    </WireCard>

    <WireCard as="section" labelledBy="stt-status-heading" title={<h2 id="stt-status-heading">처리 상태</h2>}>
      <WireDataRows>
        <WireDataRow label="상태" value={<WireBadge tone="mint">완료</WireBadge>} />
        <WireDataRow label="엔진" value="로컬 qwen3-asr" />
        <WireDataRow label="엔진 구성" value="qwen3-asr-1.7b rev-2026-08, 장치 mps" />
        <WireDataRow label="외부 전송" value="없음" />
        <WireDataRow label="구간 수" value="14" />
        <WireDataRow label="반복 경고" value="1" />
        <WireDataRow label="운영 활성화" value="아니오" />
        <WireDataRow label="시험 ID" value="trial-2026-0912-01" />
      </WireDataRows>
      <WireButton variant="neutral" type="button">시험 기록 지우기</WireButton>
    </WireCard>

    <WireCard as="section" labelledBy="stt-result-heading" title={<h2 id="stt-result-heading">전사 결과</h2>}>
      <WireCardSection title="발화 구간">
        <WireDataRows>
          <WireDataRow label="00:00.0 - 00:04.2" value={<><span className="panel-meta">S1</span> 안녕하세요, 오늘 소액대출 상담 시작하겠습니다.</>} />
          <WireDataRow label="00:04.5 - 00:09.8" value={<><span className="panel-meta">S2</span> 네, 지난주에 말씀드린 서류는 다 챙겨 왔어요.</>} />
          <WireDataRow label="00:10.1 - 00:15.6" value={<><span className="panel-meta">S1</span> 잘하셨습니다. 대출 목적과 상환 계획부터 같이 확인해 볼까요.</>} />
          <WireDataRow label="00:16.0 - 00:21.3" value={<><span className="panel-meta">S2</span> 월세 보증금이 조금 모자라서 300만 원 정도 생각하고 있습니다.</>} />
        </WireDataRows>
      </WireCardSection>
      <WireCardSection title="화자 ID">파일별 익명 ID 로 제공됨</WireCardSection>
      <WireCardSection title="반복 경고" tone="lavender">
        <WireDataRows>
          <WireDataRow label="00:32.0 - 00:36.4" value="반복 3회" />
        </WireDataRows>
      </WireCardSection>
      <WireCardSection title="무음 경계 분할">2회</WireCardSection>
      <WireCardSection title="품질 평가">후속 단계입니다.</WireCardSection>
    </WireCard>
  </>
);

// ── Kit page (apps/web/app/kit/page.tsx) — full component demo ───────────────
const kit = (
  <>
    <section className="wire-kit-section" aria-labelledby="kit-hierarchy">
      <h2 className="wire-kit-heading" id="kit-hierarchy">위계 부품 2종: 눌린 쌓임과 나열</h2>
      <p className="wire-kit-caption">
        눌린 쌓임은 중요도가 다른 값들이 같은 옷을 입고 세로로 쌓인 것이고, 고쳐야 한다.
        나열은 원래 대등한 것들이 나란히 있는 것이고, 정상이다. 아래 왼쪽이 눌린 쌓임,
        오른쪽이 부품으로 조립한 같은 내용이다. 왼쪽도 색과 크기는 전부 토큰이라
        기계 검사(guard:tokens)를 그대로 통과한다.
      </p>
      <div className="wire-kit-compare">
        <div className="wire-kit-stack">
          <p className="wire-kit-compare-label">고치기 전 (손으로 쌓은 것)</p>
          <WireCard title="오늘 만나기 전 꼭 기억할 것">
            <div className="wire-kit-stack">
              <p>세션 목표</p>
              <p>대출 실행 전 상환 계획을 함께 짠다</p>
              <p>맞춤형 질문</p>
              <p>이번 달 상환액은 준비됐는지</p>
              <p>AI 제안</p>
              <div className="wire-kit-flat">
                <p>최근 구직 활동은 어땠는지</p>
                <p className="is-reason">지난 회차에서 면접 결과를 기다리고 있었다</p>
                <a href="#kit-hierarchy">근거 회차 보기 (2026년 7월 15일)</a>
              </div>
            </div>
          </WireCard>
        </div>
        <div className="wire-kit-stack">
          <p className="wire-kit-compare-label">고친 후 (부품으로 조립한 것)</p>
          <WireCard title="오늘 만나기 전 꼭 기억할 것">
            <WireCardSection title="세션 목표" tone="mint">
              <WireBullets items={['대출 실행 전 상환 계획을 함께 짠다']} />
            </WireCardSection>
            <WireCardSection title="맞춤형 질문" tone="mint">
              <WireBullets items={['이번 달 상환액은 준비됐는지']} />
            </WireCardSection>
            <WireCardSection title="AI 제안" tone="lavender">
              <WireItem
                tone="lavender"
                title="최근 구직 활동은 어땠는지"
                description="지난 회차에서 면접 결과를 기다리고 있었다"
                action={<a href="#kit-hierarchy">근거 회차 보기 (2026년 7월 15일)</a>}
              />
            </WireCardSection>
          </WireCard>
        </div>
      </div>
      <p className="wire-kit-caption">
        달라진 것은 셋이다. 구획마다 계열 라벨이 서고, 구획이 이어지면 가로선이 저절로
        붙고, AI 제안의 이유와 링크가 제목보다 한 단 물러선다. 화면이 판단하는 자리가 없다.
        {' '}
        이유와 링크는 14 다(2026-08-10 Q 확정). 2026-08-06 의 "아코디언 안 읽는 글은 전부
        16" 지시와 부딪혔던 자리이고, 나중에 생긴 위계 4단 계약을 살리는 쪽으로 정해졌다.
      </p>
      <div className="wire-kit-compare">
        <div className="wire-kit-stack">
          <p className="wire-kit-compare-label">상태 낱말 (고치기 전)</p>
          <WireCard>
            <div className="wire-kit-flat">
              <p>2026년 7월 15일 상담</p>
              <p className="is-reason">미기록, 3회차</p>
            </div>
          </WireCard>
        </div>
        <div className="wire-kit-stack">
          <p className="wire-kit-compare-label">상태 낱말 (고친 후)</p>
          <WireCard>
            <WireItem
              title="2026년 7월 15일 상담"
              status={<>
                <WireBadge tone="lavender">미기록</WireBadge>
                <WireBadge tone="blue">오늘</WireBadge>
              </>}
            />
          </WireCard>
        </div>
      </div>
      <p className="wire-kit-caption">
        분류와 상태를 나타내는 낱말은 본문 글자로 두지 않고 배지로 올린다. 배지는 자기 면과
        테두리를 가지므로 이웃한 줄과 저절로 구분된다.
      </p>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-tokens">
      <h2 className="wire-kit-heading" id="kit-tokens">레이아웃과 색 토큰</h2>
      <p className="wire-kit-caption">
        콘텐츠 컬럼 1280, 좌우 여백 40(767 미만 16), 섹션 간격 24. 값은 design/tokens.css 의
        --page-max, --page-pad-x, --section-gap 하나뿐이고 화면이 폭을 따로 정하지 않는다 (DESIGN.md 4-1).
        좁은 폭 960(.narrow)은 2026-08-05 에 폐지됐다
      </p>
      <div className="wire-container" data-grid="true">
        <div className="wire-col-6 wire-kit-swatch">col-6</div>
        <div className="wire-col-6 wire-kit-swatch">col-6</div>
        <div className="wire-col-4 wire-kit-swatch">col-4</div>
        <div className="wire-col-4 wire-kit-swatch">col-4</div>
        <div className="wire-col-4 wire-kit-swatch">col-4</div>
        <div className="wire-col-8 wire-kit-swatch">col-8</div>
        <div className="wire-col-4 wire-kit-swatch">col-4</div>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-cardgrid">
      <h2 className="wire-kit-heading" id="kit-cardgrid">카드 목록 (.card-grid)</h2>
      <p className="wire-kit-caption">
        카드가 1장이면 폭 전체, 늘어나면 --grid-min(420) 기준으로 열이 갈린다. auto-fit 이라 빈 칸을 남기지 않는다
      </p>
      <div className="card-grid">
        <div className="wire-kit-swatch">카드 1</div>
        <div className="wire-kit-swatch">카드 2</div>
        <div className="wire-kit-swatch">카드 3</div>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-listrow">
      <h2 className="wire-kit-heading" id="kit-listrow">ListRow</h2>
      <p className="wire-kit-caption">체브론 down, right, none, selected(그라데이션 채움, 체크박스 켬과 같은 어휘), 아코디언 토글, 링크</p>
      <div className="wire-kit-stack">
        <CaptureListRow chevron="down">체브론 down (펼침)</CaptureListRow>
        <CaptureListRow chevron="right">체브론 right (이동/접힘)</CaptureListRow>
        <CaptureListRow>체브론 없음</CaptureListRow>
        <CaptureListRow align="center">중앙 정렬</CaptureListRow>
        <CaptureListRow selected>선택 가능 로우 A (selected)</CaptureListRow>
        <CaptureListRow>선택 가능 로우 B</CaptureListRow>
        <CaptureListRow href="#kit" chevron="right">링크 로우 (/kit)</CaptureListRow>
      </div>
      <p className="wire-kit-caption">
        아코디언 변형은 2026-08-10 에 뺐다. 접히고 펼쳐지는 어휘는 아래 WireCardDetails
        하나이고, 이 부품은 누르면 이동하거나 고르는 한 줄이다.
      </p>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-card">
      <h2 className="wire-kit-heading" id="kit-card">WireCard (2열)</h2>
      <div className="wire-container" data-grid="true">
        <div className="wire-col-6">
          <WireCard title="개인정보">
            <WireField label="이름">김서준</WireField>
            <WireField label="연락처">010-0000-1234</WireField>
            <WireField label="계좌">사회연대은행 000000-00-000000</WireField>
          </WireCard>
        </div>
        <div className="wire-col-6">
          <WireCard title="오늘 확인할 질문">
            <WireBullets items={['지난주 구직 활동은 어땠는지', '대출 상환일은 확인했는지']} />
          </WireCard>
        </div>
      </div>
      <WireCard>타이틀 없는 카드, 본문만.</WireCard>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-search">
      <h2 className="wire-kit-heading" id="kit-search">SearchInput</h2>
      <div className="wire-kit-stack">
        <SearchInput label="당사자 검색" name="kit-search" placeholder="가명 ID 또는 이름" value="" />
        <SearchInput
          label="참여 사업"
          variant="select"
          name="kit-program"
          value="financial_support_v1"
          options={[
            { value: 'financial_support_v1', label: PROGRAM },
            { value: 'all', label: '전체' },
          ]}
        />
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-form-field">
      <h2 className="wire-kit-heading" id="kit-form-field">WireFormField와 WireChoice</h2>
      <p className="wire-kit-caption">
        검색칸과 같은 입력칸 계약(높이 40, radius 6, --line-control 1px)을 폼에서 쓰는 형태다.
        라벨은 항상 위, 필수는 별표, 오류는 테두리 1.5px --risk + 메시지를 함께 낸다.
        선택지 행은 동그라미와 라벨이 같은 줄이고 입력칸 규칙을 상속하지 않는다.
      </p>
      <div className="wire-kit-stack">
        <WireFormField label="이름" required htmlFor="kit-name">
          <input id="kit-name" type="text" placeholder="예: 김미영" />
        </WireFormField>
        <WireFormField label="상담 유형" control="select" htmlFor="kit-kind">
          <select id="kit-kind" defaultValue="regular">
            <option value="intake">인테이크</option>
            <option value="regular">정기 상담</option>
          </select>
        </WireFormField>
        <WireFormField label="수기 메모" control="textarea" htmlFor="kit-memo" hint="도움말은 입력칸 아래에 둔다.">
          <textarea id="kit-memo" rows={3} />
        </WireFormField>
        <WireFormField label="연락처" htmlFor="kit-phone" error="숫자만 입력하세요.">
          <input id="kit-phone" type="text" defaultValue="연락처" />
        </WireFormField>
        <fieldset className="wire-fieldset">
          <legend>처리 상태 <small>(선택지 행)</small></legend>
          <WireRadioGroup>
            <WireChoice label="미처리" type="radio" name="kit-resolution" defaultChecked />
            <WireChoice label="완료" type="radio" name="kit-resolution" />
            <WireChoice label="진행 중" type="radio" name="kit-resolution" />
            <WireChoice label="보류" type="radio" name="kit-resolution" disabled />
          </WireRadioGroup>
          <div className="wire-choice-group" data-layout="stack">
            <WireChoice label="녹음 동의" type="checkbox" desc="음성 분석에 사용합니다." />
            <WireChoice label="위기 발언" type="checkbox" tone="risk" />
          </div>
        </fieldset>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-button">
      <h2 className="wire-kit-heading" id="kit-button">버튼 5종 × 크기 2단</h2>
      <p className="wire-kit-caption">
        종류는 색과 테두리만 가른다. 높이는 전 버튼 32 단일(2026-08-28 Q, 구 md 40 / sm 32
        2단 폐지), 라벨 14/600. 2026-07-26 Q 결정.
      </p>
      <p className="wire-kit-caption">
        2026-08-25: 형태는 <strong>알약</strong>이다(구 직사각 radius 6 대체). 2026-08-26:
        아웃라인 버튼(세컨더리, 일반)은 그라데이션 1px 로, 아웃라인 없는 버튼은
        면(프라이머리 그라데이션, 고스트 muted)으로 선다. 위험만 리스크색 아웃라인이다.
        마우스를 올리면 잉크 워시가 깔리고, 누르면 1px 내려간다.
      </p>
      <div className="wire-kit-row">
        <WireButton variant="primary" align="center">프라이머리</WireButton>
        <WireButton variant="secondary" align="center">세컨더리</WireButton>
        <WireButton variant="neutral" align="center">일반</WireButton>
        <WireButton variant="ghost" align="center">고스트</WireButton>
        <WireButton variant="danger" align="center">위험</WireButton>
        <WireButton disabled align="center">비활성</WireButton>
      </div>
      <div className="wire-kit-row">
        <WireButton variant="primary" align="center">프라이머리 32</WireButton>
        <WireButton variant="secondary" align="center">기록에 추가</WireButton>
        <WireButton variant="ghost" align="center">넘어가기</WireButton>
        <WireButton variant="danger" align="center">삭제</WireButton>
      </div>
      <div className="wire-kit-stack">
        <WireButton size="large" chevron>대형 + 체브론 (프라이머리로 해석)</WireButton>
        <WireButton href="#kit" chevron>링크 버튼 (/kit)</WireButton>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-badge">
      <h2 className="wire-kit-heading" id="kit-badge">배지와 상태 태그</h2>
      <p className="wire-kit-caption">
        배지는 WireBadge 하나가 전부다(2026-08-07 통합, 구 화면별 레시피 8종 대체). 기본형은
        색 없이 테두리로만 선다. 블루 배지는 오늘, 날짜, 주차, 기한 전용이고,
        민트=진행과 담당, 라벤더=AI와 대기,
        리스크=확인된 위험과 오류 전용이다. 상담 유형은 기본 상담=민트, 인테이크=라벤더다.
        추가 5색은 여러 형제 배지를 구분할 때만 쓰고, 기본 배정 순서는 민트, 라벤더, 코랄, 시안,
        라이트마젠타이며 라임과 앰버는 최후순위 폴리백이다.
      </p>
      <div className="wire-kit-row">
        <WireBadge>공식 기록</WireBadge>
        <WireBadge tone="mint">마이크로크레딧</WireBadge>
        <WireBadge tone="lavender">승인 대기 2건</WireBadge>
        <WireBadge tone="blue">오늘</WireBadge>
        <WireBadge tone="coral">코랄</WireBadge>
        <WireBadge tone="cyan">시안</WireBadge>
        <WireBadge tone="light-magenta">라이트마젠타</WireBadge>
        <WireBadge tone="lime">라임</WireBadge>
        <WireBadge tone="amber">앰버</WireBadge>
        <WireBadge tone="risk">확인 필요</WireBadge>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-checkbox">
      <h2 className="wire-kit-heading" id="kit-checkbox">체크박스</h2>
      <p className="wire-kit-caption">
        기본은 민트에서 라벤더로 흐르는 deep 그라데이션 테두리다. 리스크 변형은 테두리만 바꾼다. 2026-07-26 Q 결정.
      </p>
      <p className="wire-kit-caption">
        2026-07-31: <strong>켜면 면이 칠해진다</strong>. 예전에는 12px 체크 표시 하나로만 갈려서
        훑을 때 켜짐과 꺼짐이 구분되지 않았다. 채움은 프라이머리 버튼과 같은 그라데이션이고,
        리스크 변형도 채움은 같고 테두리만 리스크 색이다. 아래 네 칸을 나란히 두고 비교한다.
      </p>
      <div className="wire-kit-stack">
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" defaultChecked />
          AI를 활용한 녹취기록 동의 (켬)
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" />
          개인정보 수집·이용 동의 (끔)
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" data-tone="risk" defaultChecked />
          부채 악화 (리스크 변형, 켬)
        </label>
        <label className="consent-checkbox">
          <input type="checkbox" className="wire-checkbox" data-tone="risk" />
          연락 두절 위험 (리스크 변형, 끔)
        </label>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-gradient-surfaces">
      <h2 className="wire-kit-heading" id="kit-gradient-surfaces">그라데이션 테두리 3종</h2>
      <p className="wire-kit-caption">
        리스크 배너(1.5px, 전용 tint 채움), 펼친 회차 카드(1px, 흰 면 채움), 위기 아코디언(리스크 1.5px).
        셋 다 <code>border-image</code> 가 아니라 배경 2겹으로 만든다. <code>border-image</code> 는
        브라우저가 <code>border-radius</code> 를 무시해 모서리가 각진다.
      </p>
      <div className="wire-kit-stack">
        <CaptureRiskBanner />
        <details className="surface-card" open>
          <summary className="record-summary">
            <span className="record-ordinal">3회차</span>
            <span className="record-held-at">3월 12일</span>
            <WireBadge tone="mint">기본상담</WireBadge>
            <span className="record-one-liner">상환 계획을 다시 짰고 다음 달 임대료 납부일을 확인했다.</span>
          </summary>
          <div className="record-body">
            <div className="record-session-goal">
              <span className="record-session-goal-label">이번 상담의 목표</span>
              <p>임대료 연체를 막을 방법을 함께 정한다.</p>
            </div>
          </div>
        </details>
        <WireCardDetails className="is-crisis" open title="위기·안전 확인">
          <p className="wire-kit-caption">확인된 리스크와 같은 축이라 리스크 균일 테두리 + 배경 틴트로 표시한다(D9).</p>
        </WireCardDetails>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-tabs">
      <h2 className="wire-kit-heading" id="kit-tabs">탭</h2>
      <p className="wire-kit-caption">활성은 색이 아니라 대비로 구분한다. 검토와 승인 화면에서 쓴다.</p>
      <div className="wire-tabs" role="tablist">
        <button type="button" className="wire-tab" role="tab" aria-selected="true">전사 대조</button>
        <button type="button" className="wire-tab" role="tab" aria-selected="false">화자 매핑</button>
        <button type="button" className="wire-tab" role="tab" aria-selected="false">GAS 근거</button>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-quote">
      <h2 className="wire-kit-heading" id="kit-quote">인용 블록 (WireQuote)</h2>
      <p className="wire-kit-caption">
        AI 제안의 근거 발언 전용이다. 세로선은 브랜드 그라데이션이고 회색 세로선을 쓰지 않는다.
      </p>
      <WireQuote time="12:04">
        이번 달은 상환액을 맞췄는데 다음 달이 걱정이라고 하셨어요.
      </WireQuote>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-callout">
      <h2 className="wire-kit-heading" id="kit-callout">콜아웃 (WireCallout)</h2>
      <p className="wire-kit-caption">
        제목 16/600, 본문 14/400, 행동 줄 순서의 안내 카드다. 톤은 계열 의미를 따른다:
        info(블루 tint, 배지 아님)=시간과 상태 안내, mint=사람과 소속, lavender=주의와 대기. 리스크 어휘는
        배너 전용이라 콜아웃에 없다(D9).
      </p>
      <div className="wire-kit-stack">
        <WireCallout tone="info" title="인테이크 기록을 저장했습니다"
          actions={<WireButton variant="secondary">다음 상담 등록</WireButton>}>
          다음 상담을 등록해 두면 상담 일정과 상담 기록하기로 바로 이어갈 수 있습니다.
        </WireCallout>
        <WireCallout tone="mint" title="담당 실무자가 바뀌었습니다">
          이관 기록은 참여 사업 카드에서 확인할 수 있습니다.
        </WireCallout>
        <WireCallout tone="lavender" title="이 당사자는 인테이크를 이미 마쳤습니다">
          그대로 진행하면 인테이크가 두 번이 됩니다.
        </WireCallout>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-empty">
      <h2 className="wire-kit-heading" id="kit-empty">빈 상태</h2>
      <p className="wire-kit-caption">무채색만 쓴다. 라인 아이콘, 제목, 설명, 다음 행동 버튼 순.</p>
      <WireCard>
        <div className="wire-empty">
          <svg className="wire-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M8 3v4M16 3v4M3 11h18" />
          </svg>
          <p className="wire-empty-title">예정된 상담이 없습니다</p>
          <p className="wire-empty-desc">상담을 등록하면 이 자리에 날짜별로 모입니다.</p>
          <WireButton variant="secondary" align="center" href="#kit">상담 등록</WireButton>
        </div>
      </WireCard>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-modal">
      <h2 className="wire-kit-heading" id="kit-modal">모달</h2>
      <p className="wire-kit-caption">
        폭 520. 하단은 오른쪽 정렬이고 세컨더리가 왼쪽, 프라이머리가 오른쪽 끝이다. 스크림 없이 형태만 보여준다.
      </p>
      <div className="wire-modal">
        <p className="wire-modal-title">이 기록을 공식 기록으로 승인할까요?</p>
        <p className="wire-modal-desc">승인하면 브리핑과 통계에 반영됩니다.</p>
        <div className="wire-modal-body">
          <p className="wire-kit-caption">대조 결과 3종을 모두 확인했습니다.</p>
        </div>
        <div className="wire-modal-actions">
          <WireButton variant="secondary" align="center">돌아가기</WireButton>
          <WireButton variant="primary" align="center">승인</WireButton>
        </div>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-input-states">
      <h2 className="wire-kit-heading" id="kit-input-states">입력칸 3상태</h2>
      <p className="wire-kit-caption">
        라벨은 항상 위에 둔다. 오류는 테두리 색과 메시지 텍스트를 함께 둔다.
      </p>
      <div className="wire-kit-stack">
        <div className="wire-search">
          <span className="wire-search-label">이름</span>
          <div className="wire-search-box">
            <input readOnly value="김서준" aria-label="이름 기본 상태" />
          </div>
        </div>
        <div className="wire-search">
          <span className="wire-search-label">연락처</span>
          <div className="wire-search-box" data-invalid="true">
            <input readOnly value="010-000" aria-label="연락처 오류 상태" aria-invalid="true" />
          </div>
          <p className="wire-field-error">연락처를 11자리로 입력하세요.</p>
        </div>
      </div>
    </section>

    <section className="wire-kit-section" aria-labelledby="kit-admin">
      <h2 className="wire-kit-heading" id="kit-admin">AdminSidebar</h2>
      <p className="wire-kit-caption">관리자 2차 내비는 가로 탭이다. 활성 탭은 그라데이션 밑줄.</p>
      <AdminTabs activePath="/admin/users" />
    </section>
  </>
);


// ── pages export ─────────────────────────────────────────────────────────────
export const pages = [
  { slug: 'admin-org', title: '기관', group: '관리자', source: 'apps/web/app/admin/page.tsx', content: adminOrg, public: false },
  { slug: 'admin-assign', title: '배정', group: '관리자', source: 'apps/web/app/admin/assign/page.tsx', content: adminAssign, public: false },
  { slug: 'admin-users', title: '사용자·역할', group: '관리자', source: 'apps/web/app/admin/users/page.tsx', content: adminUsers, public: false },
  { slug: 'admin-user-detail', title: '실무자 상세', group: '관리자', source: 'apps/web/app/admin/users/[id]/page.tsx', content: adminUserDetail, public: false },
  { slug: 'admin-invite', title: '실무자 초대', group: '관리자', source: 'apps/web/app/admin/invite/page.tsx', content: adminInvite, public: false },
  { slug: 'admin-ai-provider', title: 'AI·STT·연결', group: '관리자', source: 'apps/web/app/admin/ai-provider/page.tsx', content: adminAiProvider, public: false },
  { slug: 'settings', title: '설정', group: '설정', source: 'apps/web/app/settings/page.tsx', content: settings, public: false },
  { slug: 'participant-invite', title: '당사자 초대', group: '당사자', source: 'apps/web/app/participants/invite/page.tsx', content: participantInvite, public: false },
  { slug: 'onboarding', title: '기관 온보딩', group: '공개·온보딩', source: 'apps/web/app/onboarding/page.tsx', content: onboarding, public: false },
  { slug: 'welcome', title: 'CCC 사례관리', group: '공개·온보딩', source: 'apps/web/app/welcome/page.tsx', content: welcome, public: true },
  { slug: 'join-participant', title: '당사자 가입', group: '공개·온보딩', source: 'apps/web/app/join/participant/[token]/page.tsx', content: joinParticipant, public: true },
  { slug: 'join-worker', title: '실무자 초대 가입', group: '공개·온보딩', source: 'apps/web/app/join/worker/[token]/page.tsx', content: joinWorker, public: true },
  { slug: 'preview', title: '미리보기 접속', group: '공개·온보딩', source: 'apps/web/app/preview/page.tsx', content: previewGate(false), public: true },
  { slug: 'preview-admin', title: '기관 관리자 미리보기 접속', group: '공개·온보딩', source: 'apps/web/app/preview/admin/page.tsx', content: previewGate(true), public: true },
  { slug: 'client-login', title: '기관 계정 로그인', group: 'Relayer 클라이언트', source: 'apps/client/src/business/auth-view.tsx', content: clientLogin, public: true },
  { slug: 'client-welcome', title: 'Relayer 시작', group: 'Relayer 클라이언트', source: 'apps/client/src/app.tsx PublicScreen welcome', content: clientWelcome, public: true },
  { slug: 'client-institution-code', title: '기관 확인', group: 'Relayer 클라이언트', source: 'apps/client/src/app.tsx PublicScreen institution (/k/:code)', content: clientInstitutionCode, public: true },
  { slug: 'client-staff-join', title: '실무자 초대 수락', group: 'Relayer 클라이언트', source: 'apps/client/src/screens/invites.tsx StaffJoinScreen', content: clientStaffJoin, public: true },
  { slug: 'client-participant-join', title: '당사자 등록 요청', group: 'Relayer 클라이언트', source: 'apps/client/src/screens/invites.tsx ParticipantJoinScreen', content: clientParticipantJoin, public: true },
  { slug: 'client-institution', title: '기관 준비', group: 'Relayer 클라이언트', source: 'apps/client/src/screens/institution.tsx', content: clientInstitution, public: true },
  { slug: 'client-staff-invites', title: '실무자 초대', group: 'Relayer 클라이언트', source: 'apps/client/src/screens/invites.tsx StaffInviteScreen', content: clientStaffInvites, public: true },
  { slug: 'client-participant-invite', title: '당사자 초대 링크', group: 'Relayer 클라이언트', source: 'apps/client/src/screens/invites.tsx ParticipantInviteScreen', content: clientParticipantInvite, public: true },
  { slug: 'client-assignments', title: '담당 배정 요청', group: 'Relayer 클라이언트', source: 'apps/client/src/screens/settings.tsx AssignmentsModule', content: clientAssignments, public: true },
  { slug: 'onboarding-2', title: '기관 온보딩 2단계', group: '공개·온보딩', source: 'apps/web/app/onboarding/onboarding-wizard.tsx step 2', content: onboardingStep2, public: false },
  { slug: 'onboarding-done', title: '기관 온보딩 완료', group: '공개·온보딩', source: 'apps/web/app/onboarding/page.tsx OnboardingDone', content: onboardingDone, public: false },
  { slug: 'client-stt-trial', title: 'STT 내부 시험', group: 'Relayer 클라이언트', source: 'apps/client/src/stt-trial/stt-trial-page.tsx', content: sttTrial, public: true },
  { slug: 'kit', title: '컴포넌트 킷', group: '컴포넌트 킷', source: 'apps/web/app/kit/page.tsx', content: kit, public: false },
];

// Client business screens use apps/client/src/business/business.css, which the
// shared composeSharedCss does not include. Only the layout classes those
// screens need are copied here (values unchanged).
export const css = `
.business-form{display:grid;gap:var(--space-5);min-width:0}
.business-actions{display:flex;flex-wrap:wrap;gap:var(--space-3)}
.settings-layout{display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr);gap:var(--section-gap);align-items:start;min-width:0}
.settings-content{display:grid;gap:var(--section-gap);min-width:0}
.settings-navigation-list{display:grid;gap:var(--space-0-5);padding:0;margin:0;list-style:none}
.settings-navigation-list .navigation-link{display:flex;align-items:center;text-decoration:none}
@media (max-width:767px){
  .settings-layout{grid-template-columns:minmax(0,1fr)}
  .settings-navigation>.wire-card-body{grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4)}
  .settings-navigation .wire-card-section+.wire-card-section{margin-inline:0;padding-top:0;padding-inline:0;border-top:0}
}

/* Capture-scoped overflow fixes (measured at 390px): long unbreakable invite URLs and
   flex/grid children without min-width:0 pushed cards past the viewport. Selectors stay
   under classes only this module emits (.settings-content, .wire-admin-cols) so the
   shared stylesheet is untouched for other modules. */
.capture-break{overflow-wrap:anywhere;min-width:0}
.settings-content>*{min-width:0}
.settings-content .wire-card-body>*{min-width:0}
.wire-admin-detail-head>*{min-width:0}
.wire-admin-cols .wire-item-title{overflow-wrap:anywhere}
/* §4-9 같은 종류끼리 묶는 계약: 같은 종류의 WireItem 반복은 한 격자에 넣고, 열 수는
   항목 수가 아니라 폭이 정한다. 칸 최소 240이라 좁은 컨테이너(관리자 2열 안)에서는
   저절로 2열이나 1열로 떨어져 이름이 꺾이지 않는다. */
.capture-item-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--space-4)}
@media (min-width:768px){
  .capture-item-grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}
}
/* admin-users: WireCardSection used as a grid column still gets the in-card sibling
   divider's negative inline margins (-24px), which is the measured 390->414 overflow. */
@media (max-width:767px){
  .wire-admin-cols>.wire-card-section+.wire-card-section{margin-inline:0;padding-inline:0}
}
`;
