import { Suspense } from 'react';
import { ApiError, getParticipantBasicInfo, type ParticipantBasicInfo } from '../../../lib/api';
import { isBeneficiaryId } from '../../../../../../db/animal-slugs';
import { GridContainer } from '../../../components/wire/grid-container';
import { PageLoading } from '../../../components/wire/page-loading';
import { ParticipantName } from '../../../components/wire/participant-name';
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
        {/* 이름·저장 줄은 **카드 밖 페이지 제목 줄**이다(2026-08-07 Q 5차 — 구 '카드 한 장에
            합침'을 같은 날 재개정. 전체 일정의 제목+행동 줄과 같은 문법). 폼은 아래에서
            기본 정보·추가 정보 **카드 2장**으로 갈린다. D38(공통 HERO 부품)의 화면 단위
            예외인 것은 그대로다(DESIGN.md §5 기록). '저장'은 폼 밖이라 form 속성으로 잇는다. */}
        {/* 이름 옆 가명 ID(2026-08-07 Q 6차 — 허브 HERO 와 같은 옅은 그레이 대조값).
            이름·ID·저장이 한 줄 세로 중앙에 선다: 제목 묶음은 .participant-hero-title(flex
            center), 줄 전체는 .page-header(align-items:center)가 맞춘다.
            이름 폴백이 이미 ID 인 경우(무응답·파기)는 같은 값을 두 번 적지 않는다. */}
        <div className="page-header">
          <h1 className="participant-hero-title">
            <ParticipantName name={basicInfo.name} beneficiaryId={basicInfo.beneficiaryId} size="hero" />
            {basicInfo.name !== null && basicInfo.name.length > 0 && (
              <span className="participant-hero-id">{basicInfo.beneficiaryId}</span>
            )}
          </h1>
          <div className="page-actions">
            <WireButton type="submit" variant="primary" form="basic-info-form">저장</WireButton>
          </div>
        </div>
        {noticeText === undefined ? null : <p className="wire-badge" data-tone="blue" role="status">{noticeText}</p>}
        {errorText === undefined ? null : <p className="wire-badge" data-tone="risk" role="alert">{errorText}</p>}
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
