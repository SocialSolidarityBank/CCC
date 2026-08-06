import Link from 'next/link';
import { Chevron } from '../../components/wire/chevron';
import { ListRow } from '../../components/wire/list-row';
import { MetaRow } from '../../components/wire/meta-row';
import { PageTitle } from '../../components/wire/page-title';
import {
  ApiError,
  listCounselorAssignments,
  listOrgUsers,
  type CounselorAssignments,
  type DirectoryRole,
  type DirectoryUser,
} from '../../lib/api';
import { assignmentStatusLabel, assignmentSummaryItems, userLabel } from '../admin-format';

const roleLabel: Record<DirectoryRole, string> = {
  admin: '기관 관리자',
  counselor: '담당 실무자',
  service: '서비스 계정',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 관리자 영역 사용자 화면(재개편 T8, #38 · Figma 5:386). 좌열 실무자 목록(admin·counselor),
// 우열은 선택한 실무자의 담당 당사자(실명 포함, D24·ADR-0005). 선택은 ?selected= 쿼리로 유지해
// 서버 렌더만으로 마스터-디테일을 구성한다(클릭 → 링크 → 우열 서버 조회).
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const selected = queryValue(query, 'selected');

  let users: DirectoryUser[] = [];
  let usersError: string | null = null;
  try {
    users = (await listOrgUsers()).filter((user) => user.role === 'admin' || user.role === 'counselor');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    usersError = '실무자 목록을 지금 불러올 수 없습니다. 접근 권한을 확인하세요.';
  }

  const selectedUser = selected === undefined ? undefined : users.find((user) => user.id === selected);
  let assignments: CounselorAssignments | null = null;
  let assignmentsError: string | null = null;
  if (selectedUser !== undefined) {
    try {
      assignments = await listCounselorAssignments(selectedUser.id);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      assignmentsError = '담당 당사자를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
    }
  }

  return (
    <>
      <PageTitle>사용자</PageTitle>
      <div className="wire-admin-cols">
        <section aria-label="실무자 목록">
          {usersError !== null ? (
            <p className="wire-admin-empty" role="alert">{usersError}</p>
          ) : users.length === 0 ? (
            <p className="wire-admin-empty">등록된 실무자가 없습니다.</p>
          ) : (
            <div className="wire-admin-list">
              {users.map((user) => (
                <ListRow
                  key={user.id}
                  href={`/admin/users?selected=${encodeURIComponent(user.id)}`}
                  selected={user.id === selected}
                  chevron="right"
                >
                  <MetaRow items={[userLabel(user), roleLabel[user.role]]} />
                </ListRow>
              ))}
            </div>
          )}
        </section>

        <section aria-label="담당 당사자">
          {selectedUser === undefined ? (
            <p className="wire-admin-empty">실무자를 선택하면 담당 당사자가 표시됩니다.</p>
          ) : (
            <>
              <div className="wire-admin-detail-head">
                <p className="wire-admin-detail-name">{userLabel(selectedUser)}</p>
                <Link className="wire-header-link" href={`/admin/users/${encodeURIComponent(selectedUser.id)}`}>
                  상세 보기 <Chevron dir="right" />
                </Link>
              </div>
              {assignmentsError !== null ? (
                <p className="wire-admin-empty" role="alert">{assignmentsError}</p>
              ) : assignments === null || assignments.participants.length === 0 ? (
                <p className="wire-admin-empty">담당 당사자가 없습니다.</p>
              ) : (
                <div className="wire-admin-list">
                  {assignments.participants.map((participant) => (
                    <ListRow key={participant.supportCaseId}>
                      <MetaRow items={[...assignmentSummaryItems(participant), assignmentStatusLabel[participant.status]]} />
                    </ListRow>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
