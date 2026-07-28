import Link from 'next/link';
import { ListRow } from '../../../components/wire/list-row';
import { MetaRow } from '../../../components/wire/meta-row';
import { PageTitle } from '../../../components/wire/page-title';
import { SearchInput } from '../../../components/wire/search-input';
import { WireButton } from '../../../components/wire/wire-button';
import {
  ApiError,
  listCounselorAssignments,
  listOrgUsers,
  type CounselorAssignments,
  type DirectoryRole,
  type DirectoryUser,
} from '../../../lib/api';
import { assignmentStatusLabel, assignmentSummary } from '../../admin-format';

const roleLabel: Record<DirectoryRole, string> = {
  admin: '기관 관리자',
  counselor: '담당 실무자',
  service: '서비스 계정',
};

// 관리자 영역 실무자 상세(재개편 T8, #38 · Figma 7:876). 이메일·역할·기관을 읽기 전용으로
// 보여주고, 담당 당사자 목록과 배정 화면으로 잇는 '배정하기' 버튼을 둔다.
// users에 별도 전화 컬럼 없음 — 추가는 보류 결정(2026-07-18).
export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = decodeURIComponent(id);

  let user: DirectoryUser | undefined;
  let directoryError: string | null = null;
  try {
    user = (await listOrgUsers()).find((candidate) => candidate.id === userId);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    directoryError = '실무자 정보를 지금 불러올 수 없습니다. 접근 권한을 확인하세요.';
  }

  if (directoryError !== null) {
    return (
      <>
        <PageTitle>실무자 상세</PageTitle>
        <p className="wire-admin-empty" role="alert">{directoryError}</p>
      </>
    );
  }
  if (user === undefined) {
    return (
      <>
        <div className="wire-admin-back"><Link href="/admin/users">← 사용자 목록으로</Link></div>
        <PageTitle>실무자 상세</PageTitle>
        <p className="wire-admin-empty" role="alert">해당 실무자를 찾을 수 없습니다.</p>
      </>
    );
  }

  let assignments: CounselorAssignments | null = null;
  let assignmentsError: string | null = null;
  try {
    assignments = await listCounselorAssignments(user.id);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    assignmentsError = '담당 당사자를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
  }

  return (
    <>
      <div className="wire-admin-back"><Link href="/admin/users">← 사용자 목록으로</Link></div>
      <PageTitle>실무자 상세</PageTitle>

      <div className="wire-admin-form">
        <SearchInput label="이름" name="name" value={user.name ?? '미입력'} />
        <SearchInput label="이메일" name="email" value={user.email} />
        <SearchInput label="역할" name="role" value={roleLabel[user.role]} />
        <SearchInput label="기관" name="org" value={user.orgId} />
      </div>

      <section className="wire-admin-section" aria-label="담당 당사자">
        <h2>담당 당사자</h2>
        {assignmentsError !== null ? (
          <p className="wire-admin-empty" role="alert">{assignmentsError}</p>
        ) : assignments === null || assignments.participants.length === 0 ? (
          <p className="wire-admin-empty">담당 당사자가 없습니다.</p>
        ) : (
          <div className="wire-admin-list">
            {assignments.participants.map((participant) => (
              <ListRow key={participant.supportCaseId}>
                <MetaRow items={[assignmentSummary(participant), assignmentStatusLabel[participant.status]]} />
              </ListRow>
            ))}
          </div>
        )}
      </section>

      <div className="wire-admin-section">
        <WireButton href="/admin/assign" size="large" align="center" chevron>배정하기</WireButton>
      </div>
    </>
  );
}
