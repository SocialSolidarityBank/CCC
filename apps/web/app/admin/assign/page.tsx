import { WireEmpty, WireError } from '../../components/wire/wire-state';
import { ListRow } from '../../components/wire/list-row';
import { WireCardSection, WireItem } from '../../components/wire/wire-section';
import { WireBadge } from '../../components/wire/wire-badge';
import { PageTitle } from '../../components/wire/page-title';
import { SearchInput, type SearchSelectOption } from '../../components/wire/search-input';
import { WireButton } from '../../components/wire/wire-button';
import {
  ApiError,
  listOrgUsers,
  listScheduleCandidates,
  listSupportCaseAssignees,
  type DirectoryUser,
  type ScheduleCandidate,
  type SupportCaseAssignee,
} from '../../lib/api';
import { addSupportCaseAssigneeAction } from '../../actions';
import { getDisplayLabels } from '../../lib/display-labels';
import { userLabel } from '../admin-format';

const assigneeRoleLabel: Record<SupportCaseAssignee['role'], string> = {
  primary: '주 담당',
  secondary: '공동 담당',
};

const noticeMessages: Record<string, string> = {
  assignee_added: '실무자를 배정했습니다.',
};

const errorMessages: Record<string, string> = {
  invalid_request: '입력한 정보를 다시 확인하세요.',
  validation_error: '입력한 정보를 다시 확인하세요.',
  access_denied: '배정은 기관 관리자만 할 수 있습니다.',
  forbidden: '배정은 기관 관리자만 할 수 있습니다.',
  not_found: '선택한 케이스를 찾을 수 없습니다.',
  conflict: '이미 배정된 실무자입니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 배정할 수 없습니다. 잠시 후 다시 시도하세요.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 관리자 영역 배정 화면(재개편 T8, #38 · Figma 5:441). 와이어프레임의 '사업 단위' UI에 케이스
// 선택 한 단계를 더해 실제 모델(케이스 단위 배정, D7)로 현실화한다: 기관·사업 → 케이스 선택
// → 실무자 추가(공동 담당). 하단에 현재 배정된 실무자 목록. 권한·감사는 게이트웨이가 강제(R1).
export default async function AdminAssignPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const { programLabels } = await getDisplayLabels();
  const selected = queryValue(query, 'supportCaseId');
  const notice = queryValue(query, 'notice');
  const errorCode = queryValue(query, 'error');

  let candidates: ScheduleCandidate[] = [];
  let users: DirectoryUser[] = [];
  let loadError: string | null = null;
  try {
    [candidates, users] = await Promise.all([
      listScheduleCandidates(),
      listOrgUsers(),
    ]);
    users = users.filter((user) => user.role === 'admin' || user.role === 'counselor');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    loadError = '배정 대상 목록을 지금 불러올 수 없습니다. 접근 권한을 확인하세요.';
  }

  const selectedCandidate = selected === undefined
    ? undefined
    : candidates.find((candidate) => candidate.supportCaseId === selected);

  // D31·D24: 당사자 선택은 역할 기준 실명·연락처·이메일로 표기한다(사업명 대신). 실명 미기입은
  // 가명 슬러그로 폴백하고 비어 있는 필드는 생략한다.
  const caseOptions: SearchSelectOption[] = [
    { value: '', label: '당사자(케이스)를 선택하세요' },
    ...candidates.map((candidate) => ({
      value: candidate.supportCaseId,
      label: [
        candidate.participantName ?? candidate.beneficiaryId,
        candidate.participantPhone,
        candidate.participantEmail,
        // option 은 노드를 담을 수 없어 간격으로 띄우는 방식을 쓸 수 없다. DESIGN.md §10 이
        // 이런 자리에 지정한 대체 부호는 쉼표다(구분자 가운뎃점 금지).
      ].filter((part): part is string => typeof part === 'string' && part.length > 0).join(', '),
    })),
  ];
  const counselorOptions: SearchSelectOption[] = users.map((user) => ({ value: user.id, label: userLabel(user) }));
  const labelById = new Map(users.map((user): [string, string] => [user.id, userLabel(user)]));

  let assignees: SupportCaseAssignee[] = [];
  let assigneesError: string | null = null;
  if (selectedCandidate !== undefined) {
    try {
      assignees = await listSupportCaseAssignees(selectedCandidate.supportCaseId);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      assigneesError = '현재 배정 상태를 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
    }
  }

  return (
    <>
      <PageTitle>배정</PageTitle>

      {notice !== undefined && noticeMessages[notice] !== undefined ? (
        <p className="wire-admin-notice" role="status" aria-live="polite">{noticeMessages[notice]}</p>
      ) : null}
      {errorCode !== undefined ? (
        <WireError>{errorMessages[errorCode] ?? '배정하지 못했습니다.'}</WireError>
      ) : null}

      <div className="wire-admin-list">
        <ListRow>{programLabels.financial_support_v1}</ListRow>
      </div>

      {loadError !== null ? (
        <WireError>{loadError}</WireError>
      ) : (
        <>
          <form className="wire-admin-form-row" method="get">
            <SearchInput
              label="당사자(케이스) 선택"
              variant="select"
              name="supportCaseId"
              value={selected ?? ''}
              options={caseOptions}
            />
            <WireButton type="submit">선택</WireButton>
          </form>

          {selected !== undefined && selectedCandidate === undefined ? (
            <WireEmpty>활성 케이스를 선택하세요.</WireEmpty>
          ) : selectedCandidate !== undefined ? (
            <WireCardSection title={`${selectedCandidate.participantName ?? selectedCandidate.beneficiaryId} 배정`}>
              {counselorOptions.length === 0 ? (
                <WireEmpty>추가할 실무자가 없습니다. 먼저 실무자를 등록하세요.</WireEmpty>
              ) : (
                <form className="wire-admin-form-row" action={addSupportCaseAssigneeAction}>
                  <input type="hidden" name="supportCaseId" value={selectedCandidate.supportCaseId} />
                  <SearchInput label="실무자" variant="select" name="userId" options={counselorOptions} />
                  <WireButton type="submit">추가하기</WireButton>
                </form>
              )}

              {/* CCC-90: 중첩 구획 제목을 부품 라벨 단으로(구 h2 두 벌이 같은 옷이던 자리). */}
              <WireCardSection title="현재 배정된 실무자">
                {assigneesError !== null ? (
                  <WireError>{assigneesError}</WireError>
                ) : assignees.length === 0 ? (
                  <WireEmpty>배정된 실무자가 없습니다.</WireEmpty>
                ) : (
                  assignees.map((assignee) => (
                    // CCC-90: 담당 유형은 status 슬롯(배지)로 — 실무자 이름과 같은 옷이던 것을 구분한다.
                    <WireItem
                      key={assignee.id}
                      title={labelById.get(assignee.userId) ?? assignee.userId}
                      status={<WireBadge tone="mint">{assigneeRoleLabel[assignee.role]}</WireBadge>}
                    />
                  ))
                )}
              </WireCardSection>
            </WireCardSection>
          ) : null}
        </>
      )}
    </>
  );
}
