import Link from 'next/link';
import { ApiError, getMyIdentity, listOrgUsers, type DirectoryRole, type DirectoryUser, type MyIdentity } from '../lib/api';
import { PageTitle } from '../components/wire/page-title';
import { WireError } from '../components/wire/wire-state';
import { WireBadge } from '../components/wire/wire-badge';
import { WireButton } from '../components/wire/wire-button';
import { WireCard } from '../components/wire/wire-card';
import { adminMenu, userLabel } from '../admin/admin-format';

// 역할 화면 라벨 — CONTEXT.md 용어집 준수(기관 관리자·담당 실무자). service는 처리 장비(Mac Mini) 계정.
const roleLabel: Record<DirectoryRole, string> = {
  admin: '기관 관리자',
  counselor: '담당 실무자',
  service: '서비스 계정',
};

function settingsErrorMessage(error: ApiError): string | null {
  switch (error.code) {
    case 'authentication_required':
      return '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 설정을 확인하세요.';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return '설정 정보를 확인할 수 없습니다. 접근 권한을 확인하세요.';
    case 'service_unavailable':
      return '설정을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
    default:
      return null;
  }
}

function AccountSection({ name, email, role }: { name: string | null; email: string; role: DirectoryRole }) {
  return (
    // 설정 구획은 카드다(2026-08-05 Q 카드화 · ADR-0030 — 구 D59 플랫 대체).
    <WireCard as="section" className="settings-section" labelledBy="settings-account-heading" title={<h2 id="settings-account-heading">내 계정</h2>}>
      <dl className="settings-account">
        {/* 이름 미등록 계정(관리자·테스터)은 행 자체를 생략 — '미입력' 표기는 소음이다. */}
        {name === null ? null : (
          <div className="settings-field">
            <dt>이름</dt>
            <dd>{name}</dd>
          </div>
        )}
        <div className="settings-field">
          <dt>이메일</dt>
          <dd>{email}</dd>
        </div>
        <div className="settings-field">
          <dt>역할</dt>
          <dd>{roleLabel[role]}</dd>
        </div>
      </dl>
    </WireCard>
  );
}

async function DirectorySection() {
  let directory: DirectoryUser[];
  try {
    // 실무자 목록이므로 처리 장비 서비스 계정은 제외한다(내부 시스템 신원 — 화면 소음).
    directory = (await listOrgUsers()).filter((user) => user.role !== 'service');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // 목록 조회가 실패해도 '내 계정' 섹션은 그대로 두고, 목록 자리에만 오류를 표시한다.
    return (
      <WireCard as="section" className="settings-section" labelledBy="settings-directory-heading" title={<h2 id="settings-directory-heading">기관 실무자 목록</h2>}>
        <WireError>실무자 목록을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.</WireError>
      </WireCard>
    );
  }

  return (
    <WireCard as="section" className="settings-section" labelledBy="settings-directory-heading" title={<h2 id="settings-directory-heading">기관 실무자 목록</h2>}>
      {directory.length === 0 ? (
        <p className="empty" aria-live="polite">등록된 계정이 없습니다.</p>
      ) : (
        <ul className="settings-user-list">
          {directory.map((user) => (
            <li className="settings-user-row" key={user.id} data-active={user.active ? undefined : 'false'}>
              <span className="settings-user-email">{userLabel(user)}</span>
              <span className="settings-user-role">{roleLabel[user.role]}</span>
              <WireBadge>{user.active ? '활성' : '비활성'}</WireBadge>
            </li>
          ))}
        </ul>
      )}
    </WireCard>
  );
}

// 관리자 구역 — 설정 화면 안에서 관리자 화면 4개로 들어가는 진입구(CCC-21, 스펙 #76).
// 링크 목록은 adminMenu 를 그대로 쓴다. 구 '/admin/settings' 걸러내기는 CCC-55 로 사라졌다.
// 그 주소가 이 화면을 관리자 레이아웃 안에 다시 그리는 중복이었고, 지금은 라우트도 메뉴 항목도
// 없어서 자기 자신을 가리키는 링크가 애초에 생기지 않는다.
export function AdminSection() {
  return (
    <WireCard as="section" className="settings-section" labelledBy="settings-admin-heading" title={<h2 id="settings-admin-heading">관리자</h2>}>
      <ul className="settings-user-list">
        {adminMenu.map((item) => (
          <li key={item.href} className="settings-user-row">
            <WireButton variant="secondary" height="sm" href={item.href}>{item.label}</WireButton>
          </li>
        ))}
      </ul>
    </WireCard>
  );
}

export default async function SettingsPage() {
  let me: MyIdentity;
  try {
    me = await getMyIdentity();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const message = settingsErrorMessage(error);
    if (message === null) throw error;
    return (
      <main className="page-content settings-page">
        <PageTitle>설정</PageTitle>
        <WireError>{message}</WireError>
      </main>
    );
  }

  return (
    <main className="page-content settings-page">
      <PageTitle>설정</PageTitle>
      <AccountSection name={me.name} email={me.email} role={me.role} />
      {/* 기관 실무자 목록은 기관 관리자 역할에게만 노출한다(비관리자는 내 계정만). */}
      {me.role === 'admin' ? <DirectorySection /> : null}
      {me.role === 'admin' ? <AdminSection /> : null}
    </main>
  );
}
