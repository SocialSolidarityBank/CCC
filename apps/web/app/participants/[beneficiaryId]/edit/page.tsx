import { WireBadge } from '../../../components/wire/wire-badge';
import { WireError } from '../../../components/wire/wire-state';
import { Suspense } from 'react';
import { ApiError, getParticipantBasicInfo, type ParticipantBasicInfo } from '../../../lib/api';
import { isBeneficiaryId } from '@ccc/contracts/animal-slugs';
import { GridContainer } from '../../../components/wire/grid-container';
import { PageLoading } from '../../../components/wire/page-loading';
import { ParticipantHeroCard } from '../../../components/wire/participant-hero-card';
import { PageTitle } from '../../../components/wire/page-title';
import { WireButton } from '../../../components/wire/wire-button';
import { updateParticipantBasicInfoAction } from '../../../actions';
import { ErrorState, type ErrorKind } from '../error-state';
import { BasicInfoForm } from './basic-info-form';

// 당사자 기본정보 수정 (CCC-37 · D41 1-1 · D42 ①).
//
// 등록 화면이 받는 7종(이름·휴대전화·이메일·계좌·생년월일·주소/거주지역·성별)을 등록 뒤에
// 고치는 자리다. 인테이크 1단계는 이 값을 읽어 표시만 하므로 거기 '당사자 등록 정보에서
// 수정' 링크가 이 화면을 가리킨다.
//
// 허브(../page.tsx)와 같은 전제 게이트를 쓴다: 그 당사자의 케이스를 1건도 담당하지 않으면
// 서버가 막는다(D36). 쓰기는 활성 참여 사업 컨텍스트를 요구하므로(게이트웨이 계약) 서버가
// 그 컨텍스트까지 함께 내려준다 — 화면이 참여 사업을 고르지 않는다.
//
// 감사는 서버에 이미 있다(화면 조회당 1건, D24). 여기서 새로 남기지 않는다.
//
// D44 동의 수정은 허브의 참여 사업 카드가 맡는다 — 이 화면과 얽지 않는다(저장 단위가 다르다:
// 기본정보는 당사자 금고 1건, 동의는 참여 사업마다 1건).

function expectedApiErrorKind(error: ApiError): ErrorKind | null {
  switch (error.code) {
    case 'authentication_required':
      return 'authentication_required';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return 'access_or_not_found';
    case 'service_unavailable':
      return 'service_unavailable';
    default:
      return null;
  }
}

/** 저장 결과 안내. PII 는 주소에 싣지 않는다 — 오가는 것은 코드뿐이다(R3). */
const NOTICES: Record<string, string> = {
  basic_info_updated: '기본정보를 저장했습니다.',
};

const ERRORS: Record<string, string> = {
  invalid_request: '입력값을 확인하세요. 생년월일은 YYYY-MM-DD 형식입니다.',
  validation_error: '입력값을 확인하세요. 생년월일은 YYYY-MM-DD 형식입니다.',
  conflict: '다른 사람이 먼저 저장했습니다. 화면을 새로 고친 뒤 다시 시도하세요.',
  access_denied: '이 당사자의 기본정보를 고칠 권한이 없습니다.',
  forbidden: '이 당사자의 기본정보를 고칠 권한이 없습니다.',
  not_found: '요청한 당사자를 찾을 수 없습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도하세요.',
  service_unavailable: '지금은 저장할 수 없습니다. 잠시 후 다시 시도하세요.',
};

// 공용 로딩 부품(2026-08-09 Q "전역 로딩 화면 통일").
function LoadingState() {
  return <PageLoading title="기본정보 수정" message="기본정보를 불러오는 중입니다." />;
}

function EditScreen({
  basicInfo,
  notice,
  error,
}: {
  basicInfo: ParticipantBasicInfo;
  notice: string | undefined;
  error: string | undefined;
}) {
  const noticeText = notice === undefined ? undefined : NOTICES[notice];
  const errorText = error === undefined ? undefined : ERRORS[error] ?? ERRORS.service_unavailable;

  return (
    <main className="page-content">
      <GridContainer>
        {/* 공통 HERO 부품이다(2026-09-04 Q "HERO 다른 페이지에서도 같은 디자인으로" — 구
            2026-08-07 Q 5차의 화면 단위 예외 폐기). `/participants/:id/**` 는 전부 같은 머리를
            단다는 D38 계약으로 돌아온다. 함께 닫히는 것 둘:
             * 이 화면만 `PageTitle` 이 없어 당사자 이름이 h1 이었다 — 2026-09-03 Q 의
               "PageTitle 이 화면의 유일한 h1, 당사자 이름은 그 아래 h2" 를 어기고 있었다.
             * 가로선 없는 맨 제목 줄이라 여백 계약(구획 위아래 24)이 이 화면만 달랐다.
            가명 ID 는 허브와 같은 정보 격자 첫 항목이다(D59 2026-09-02 개정). 연락처·이메일은
            아래 폼이 이미 고칠 수 있는 값으로 보여 주므로 격자에 겹쳐 싣지 않는다.
            '저장'은 폼 밖이라 form 속성으로 잇는다. */}
        <div className="page-header"><PageTitle>기본정보 수정</PageTitle></div>
        <ParticipantHeroCard
          name={basicInfo.name}
          beneficiaryId={basicInfo.beneficiaryId}
          nameSize="hub"
          details={[{ label: '당사자 ID', value: basicInfo.beneficiaryId }]}
          actions={<WireButton type="submit" variant="primary" form="basic-info-form">저장</WireButton>}
        />
        {noticeText === undefined ? null : <WireBadge role="status">{noticeText}</WireBadge>}
        {errorText === undefined ? null : <WireError>{errorText}</WireError>}
        <BasicInfoForm basicInfo={basicInfo} action={updateParticipantBasicInfoAction} />
      </GridContainer>
    </main>
  );
}

async function EditContent({
  beneficiaryId,
  notice,
  error,
}: {
  beneficiaryId: string;
  notice: string | undefined;
  error: string | undefined;
}) {
  if (!isBeneficiaryId(beneficiaryId)) return <ErrorState kind="access_or_not_found" />;

  try {
    const basicInfo = await getParticipantBasicInfo(beneficiaryId);
    if (basicInfo.beneficiaryId !== beneficiaryId) {
      throw new Error('Participant basic information response did not match the requested participant.');
    }
    return <EditScreen basicInfo={basicInfo} notice={notice} error={error} />;
  } catch (caught) {
    const kind = caught instanceof ApiError ? expectedApiErrorKind(caught) : null;
    if (kind === null) throw caught;
    return <ErrorState kind={kind} />;
  }
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ParticipantBasicInfoEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ beneficiaryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ beneficiaryId }, query] = await Promise.all([params, searchParams]);
  return (
    <Suspense fallback={<LoadingState />}>
      <EditContent
        beneficiaryId={beneficiaryId}
        notice={firstParam(query.notice)}
        error={firstParam(query.error)}
      />
    </Suspense>
  );
}
