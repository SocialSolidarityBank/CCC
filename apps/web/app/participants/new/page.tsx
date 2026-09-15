import {
  GridContainer,
  PageTitle,
  WireError,
} from '@ccc/wire';
import type { ConsentDisclosureSnapshot } from '@ccc/contracts/consent';
import {
  ApiError,
  getMyIdentity,
  issueRegistrationConsentDisclosures,
  listProgramOptions,
  type MyIdentity,
} from '../../lib/api';
import { getDisplayLabels } from '../../lib/display-labels';
import { createInitialParticipantProgramAction } from '../../actions';
import { RegisterForm } from './register-form';

const noticeMessages: Record<string, string> = {
  program_created: '당사자를 등록했습니다.',
};

const errorMessages: Record<string, string> = {
  invalid_request: '입력한 정보를 다시 확인하세요.',
  validation_error: '입력한 정보를 다시 확인하세요.',
  access_denied: '당사자를 등록할 권한이 없습니다.',
  forbidden: '당사자를 등록할 권한이 없습니다.',
  conflict: '이미 처리된 요청입니다. 다시 확인하세요.',
  // G1: 게이트에 걸린 두 경우는 원인을 그대로 짚어 준다 — "다시 확인하세요"로 뭉치면
  // 화면에서 원인 없는 실패로 보인다(게이트 문서 §2 G1).
  privacy_consent_required: '개인정보 수집·이용 동의를 체크해야 등록할 수 있습니다. 동의를 먼저 받을 수 없다면 긴급 등록을 선택하세요.',
  emergency_reason_required: '긴급 등록에는 사유를 적어야 합니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 당사자를 등록할 수 없습니다. 잠시 후 다시 시도하세요.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 새 당사자 생성, 케이스 열기, 여섯 영역 동의가 한 흐름이다.
// 페이지와 액션이 같은 단일 금융지원 사업을 확인하고, 페이지는 그 사업에 묶인 고지를 폼에 넘긴다.
// 개인정보 수집·이용 거절은 긴급 등록 사유가 있을 때만 서버가 예외로 판정한다.
export default async function NewParticipantPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const notice = queryValue(query, 'notice');
  const errorCode = queryValue(query, 'error');

  let me: MyIdentity;
  let programLabel: string;
  let disclosures: ConsentDisclosureSnapshot[];
  try {
    const [identity, labels, options] = await Promise.all([
      getMyIdentity(),
      getDisplayLabels(),
      listProgramOptions(),
    ]);
    const candidates = options.filter((option) => option.programType === 'financial_support_v1');
    if (candidates.length !== 1) {
      return (
        <main className="page-content">
          <GridContainer>
            <PageTitle>당사자 등록</PageTitle>
            <WireError>등록 가능한 금융지원 사업이 하나일 때만 당사자를 등록할 수 있습니다.</WireError>
          </GridContainer>
        </main>
      );
    }
    const program = candidates[0]!;
    me = identity;
    programLabel = program.displayName ?? labels.programLabels.financial_support_v1;
    disclosures = await issueRegistrationConsentDisclosures(program.id);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <main className="page-content">
        <GridContainer>
          <PageTitle>당사자 등록</PageTitle>
          <WireError>지금 당사자 등록 화면을 열 수 없습니다. 접근 권한을 확인하세요.</WireError>
        </GridContainer>
      </main>
    );
  }

  // 등록자=담당 실무자(D7): 담당 실무자 지정 select 를 없앴다. 서버 액션이 admin 은 본인을 배정하고
  // counselor 는 게이트웨이 자동 본인 배정에 맡긴다. 폼엔 현재 사용자만 읽기 전용으로 넘긴다.
  return (
    <main className="page-content">
      <GridContainer>
        <PageTitle>당사자 등록</PageTitle>

        {notice !== undefined && noticeMessages[notice] !== undefined ? (
          <p className="schedule-form-notice" role="status" aria-live="polite">{noticeMessages[notice]}</p>
        ) : null}
        {errorCode !== undefined ? (
          <WireError>{errorMessages[errorCode] ?? '당사자를 등록하지 못했습니다.'}</WireError>
        ) : null}

        <RegisterForm
          key={disclosures.map((snapshot) => snapshot.snapshotId).join(':')}
          currentUser={{ name: me.name, email: me.email }}
          action={createInitialParticipantProgramAction}
          programLabel={programLabel}
          disclosures={disclosures}
        />
      </GridContainer>
    </main>
  );
}
