import {
  PageTitle,
  WireCallout,
  WireCard,
  WireError,
} from '@ccc/wire';
import {
  ApiError,
  getOrganizationProfile,
  listOrgUsers,
  listPrograms,
  type DirectoryUser,
  type OrganizationProfile,
} from '../lib/api';
import type { ProgramListResponse } from '@ccc/contracts/program-admission';
import { updateProgramAdmissionAction } from '../actions';
import { ProgramAdmissionForm } from './program-admission-form';

// 관리자 영역 기관 화면(재개편 T8, #38 · Figma 5:350).
//
// CCC-59 로 내용을 채웠다. 그전에는 제목 '기관' 아래 기관 ID 한 줄이 전부였고, 그 줄에 꺽쇠가
// 달렸는데 눌러도 가는 곳이 없었다(기관 상세 화면은 없다). 관리자 탭의 첫 칸이 빈 화면이었다.
//
// **당사자 수는 일부러 없다.** 지금 당사자를 세는 유일한 조회(listAssignedParticipants)가
// 당사자 전원의 이름·연락처를 복호화하고 read_participant_pii 감사를 한 행 남긴다. 이 화면을
// 열 때마다 그 행이 쌓이면 "이 실무자가 이 당사자를 몇 번 열람했나"(D24 · ADR-0005)가 숫자
// 하나 때문에 부풀어 못 쓰게 된다. 세기 전용 조회가 생기면 그때 넣는다.
// 이 화면의 조회(기관 이름·계정 목록·사업 도입 확인)에는 금고 값이 없다.

interface UserCounts {
  admins: number;
  counselors: number;
  inactive: number;
}

function countUsers(users: DirectoryUser[]): UserCounts {
  // 처리 장비 서비스 계정은 사람이 아니라 내부 신원이라 세지 않는다(설정 화면과 같은 규칙).
  const people = users.filter((user) => user.role !== 'service');
  return {
    admins: people.filter((user) => user.role === 'admin' && user.active).length,
    counselors: people.filter((user) => user.role === 'counselor' && user.active).length,
    inactive: people.filter((user) => !user.active).length,
  };
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;


const admissionErrorMessages: Record<string, string> = {
  invalid_request: '선택과 관리자 확인을 다시 확인하세요.',
  access_denied: '사업 도입 확인은 기관 관리자만 저장할 수 있습니다.',
  forbidden: '사업 도입 확인은 기관 관리자만 저장할 수 있습니다.',
  conflict: '사업 설정이 바뀌었습니다. 화면을 새로 고친 뒤 다시 확인하세요.',
  service_unavailable: '사업 설정을 지금 저장할 수 없습니다. 잠시 후 다시 시도하세요.',
};

export default async function AdminOrganizationPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
} = {}) {
  const query: SearchParams = searchParams === undefined ? {} : await searchParams;
  const notice = typeof query.notice === 'string' ? query.notice : undefined;
  const errorCode = typeof query.error === 'string' ? query.error : undefined;
  let profile: OrganizationProfile | null = null;
  let users: DirectoryUser[] | null = null;
  let programContext: ProgramListResponse | null = null;
  try {
    [profile, users, programContext] = await Promise.all([
      getOrganizationProfile(),
      listOrgUsers(),
      listPrograms(),
    ]);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  if (profile === null || users === null || programContext === null) {
    return (
      <>
        <PageTitle>기관</PageTitle>
        <WireError>기관 정보를 확인할 수 없습니다. 잠시 후 다시 시도하세요.</WireError>
      </>
    );
  }

  const counts = countUsers(users);

  return (
    <>
      <PageTitle>기관</PageTitle>
      {notice === 'program_admission_saved' ? (
        <WireCallout title="사업 도입 확인을 저장했습니다" role="status">
          확인된 사업은 당사자 등록을 시작할 수 있습니다.
        </WireCallout>
      ) : null}
      {errorCode === undefined ? null : (
        <WireError>{admissionErrorMessages[errorCode] ?? '사업 도입 확인을 저장하지 못했습니다.'}</WireError>
      )}

      <WireCard as="section" className="settings-section" labelledBy="admin-org-heading" title={<h2 id="admin-org-heading">기관 정보</h2>}>
        <dl className="settings-account">
          <StatRow label="기관 이름" value={profile.orgName ?? '설정 전'} />
          <StatRow label="사업 이름" value={profile.programDisplayName ?? '설정 전'} />
        </dl>
        {profile.orgName === null || profile.programDisplayName === null ? (
          <WireCallout tone="lavender" role="status" testId="admin-org-naming" title="이름이 아직 설정 전입니다">
            설정 화면의 &apos;기관·사업 이름&apos;에서 정하면 사이드바와 화면 전체에 바로 표시됩니다.
          </WireCallout>
        ) : null}
      </WireCard>

      {programContext.programs.length === 0 ? (
        <WireError>확인할 사업이 없습니다.</WireError>
      ) : programContext.programs.map((program) => (
        <ProgramAdmissionForm
          key={[
            program.id,
            program.version,
            programContext.admissionCopy.hash,
            programContext.installation.configHash,
            programContext.installation.policyVersion,
          ].join(':')}
          program={program}
          admissionCopy={programContext.admissionCopy}
          installation={programContext.installation}
          action={updateProgramAdmissionAction}
        />
      ))}

      <WireCard as="section" className="settings-section" labelledBy="admin-people-heading" title={<h2 id="admin-people-heading">계정</h2>}>
        <dl className="settings-account" data-testid="admin-user-counts">
          <StatRow label="기관 관리자" value={`${counts.admins}명`} />
          <StatRow label="담당 실무자" value={`${counts.counselors}명`} />
          {/* 비활성은 0이면 줄을 만들지 않는다. '0명'은 읽는 사람에게 아무 일도 시키지 않는다. */}
          {counts.inactive === 0 ? null : <StatRow label="비활성 계정" value={`${counts.inactive}명`} />}
        </dl>
      </WireCard>
    </>
  );
}
