import {
  Chevron,
  PageTitle,
  WireBadge,
  WireCardSection,
  WireEmpty,
  WireError,
  WireItem,
} from '@ccc/wire';
import Link from 'next/link';
import {
  ApiError,
  getMyIdentity,
  listCounselorAssignments,
  listDirectoryAccounts,
  type CounselorAssignments,
  type DirectoryAccount,
} from '../../lib/api';
import { accountLabel, accountRoleLabel, assignmentStatusLabel, assignmentSummaryItems } from '../admin-format';
import { UserRolesEditor } from './user-roles-editor';

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 관리자 영역 사용자·역할 화면(재개편 T8, #38 · Figma 5:386). 좌열 계정 목록,
// 우열은 선택한 계정의 역할 편집 + 담당 당사자(실명 포함, D24·ADR-0005). 선택은
// ?selected= 쿼리로 유지해 서버 렌더만으로 마스터-디테일을 구성한다.
//
// 목록은 GET /settings/accounts(역할 합 디렉터리)다 — 구 GET /users 의
// admin·counselor 필터는 역할 대기(역할 없음) 계정을 숨겨, 초대받아 가입한 사람에게
// 역할을 줄 수 없었다. 역할 변경은 PATCH .../roles 가 담당하고 권한·낙관적 동시성은
// 서버가 강제한다 — 화면은 canManageRoles 로 편집기를 여닫는 안내일 뿐이다.
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const selected = queryValue(query, 'selected');

  let accounts: DirectoryAccount[] = [];
  let canManageRoles = false;
  let meId: string | null = null;
  let usersError: string | null = null;
  try {
    const [directory, me] = await Promise.all([listDirectoryAccounts(), getMyIdentity()]);
    accounts = directory.accounts;
    canManageRoles = directory.permissions.canManageRoles;
    meId = me.id;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    usersError = '사용자 목록을 지금 불러올 수 없습니다. 접근 권한을 확인하세요.';
  }

  const selectedAccount = selected === undefined ? undefined : accounts.find((account) => account.id === selected);
  let assignments: CounselorAssignments | null = null;
  let assignmentsError: string | null = null;
  if (selectedAccount !== undefined) {
    try {
      assignments = await listCounselorAssignments(selectedAccount.id);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      assignmentsError = '담당 당사자를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
    }
  }

  return (
    <>
      <PageTitle>사용자·역할</PageTitle>
      <div className="wire-admin-cols">
        <WireCardSection title="사용자 목록">
          {usersError !== null ? (
            <WireError>{usersError}</WireError>
          ) : accounts.length === 0 ? (
            <WireEmpty>등록된 사용자가 없습니다.</WireEmpty>
          ) : (
            accounts.map((account) => (
              // CCC-90: 역할 낱말은 제목과 같은 옷이 아니라 status 슬롯(배지)로 구분한다.
              // 역할이 없으면 '역할 대기' — 초대받아 가입했지만 아무 역할도 못 받은 상태다.
              <WireItem
                key={account.id}
                title={accountLabel(account)}
                tone={account.id === selected ? 'mint' : 'plain'}
                status={
                  <>
                    {account.roles.length === 0
                      ? <WireBadge tone="lavender">역할 대기</WireBadge>
                      : account.roles.map((role) => <WireBadge key={role} tone="mint">{accountRoleLabel[role]}</WireBadge>)}
                    {account.active ? null : <WireBadge>비활성</WireBadge>}
                  </>
                }
                action={<Link href={`/admin/users?selected=${encodeURIComponent(account.id)}`}>선택</Link>}
              />
            ))
          )}
        </WireCardSection>

        {/* 우열은 구획 둘(역할 + 담당 당사자)을 세로로 쌓는다 — wire-admin-list 의
            grid gap 이 간격을 주고, 형제 구획 사이 가로선은 WireCardSection 이 자동으로 붙인다. */}
        <div className="wire-admin-list">
          {selectedAccount === undefined ? (
            <WireCardSection title="역할">
              <WireEmpty>사용자를 선택하면 역할과 담당 당사자가 표시됩니다.</WireEmpty>
            </WireCardSection>
          ) : (
            <>
              <div className="wire-admin-detail-head">
                <p className="wire-admin-detail-name">{accountLabel(selectedAccount)}</p>
                <Link className="wire-header-link" href={`/admin/users/${encodeURIComponent(selectedAccount.id)}`}>
                  상세 보기 <Chevron dir="right" />
                </Link>
              </div>
              <WireCardSection title="역할">
                <UserRolesEditor
                  key={`${selectedAccount.id}:${selectedAccount.roles.join(',')}`}
                  account={selectedAccount}
                  canManageRoles={canManageRoles}
                  isSelf={selectedAccount.id === meId}
                />
              </WireCardSection>
              <WireCardSection title="담당 당사자">
                {assignmentsError !== null ? (
                  <WireError>{assignmentsError}</WireError>
                ) : assignments === null || assignments.participants.length === 0 ? (
                  <WireEmpty>담당 당사자가 없습니다.</WireEmpty>
                ) : (
                  <div className="wire-admin-list">
                    {assignments.participants.map((participant) => (
                      // CCC-90: 배정 상태 낱말은 status 슬롯(배지)로 구분한다.
                      <WireItem
                        key={participant.supportCaseId}
                        title={assignmentSummaryItems(participant).join(' ')}
                        status={<WireBadge tone="mint">{assignmentStatusLabel[participant.status]}</WireBadge>}
                      />
                    ))}
                  </div>
                )}
                {/* 배정을 바꾸는 곳은 '배정' 화면 하나다(CCC-62, 2026-08-08 Q 결정). 이 화면은
                    같은 정보를 실무자 축으로 읽기만 한다. 그런데 그 사실을 말해 주지 않아
                    "여기서 바꾸는 건가"를 물을 곳이 없었다. 실무자 상세 화면(/admin/users/[id])은
                    이미 같은 버튼을 갖고 있어, 목록에도 같은 규칙을 맞춘다. */}
                {assignmentsError === null ? (
                  <WireEmpty testId="admin-users-assign-hint">
                    담당을 바꾸려면 <Link className="wire-header-link" href="/admin/assign">배정 화면</Link>에서 당사자를 고르세요.
                  </WireEmpty>
                ) : null}
              </WireCardSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}
