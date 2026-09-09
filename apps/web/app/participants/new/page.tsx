import { ApiError, getMyIdentity, getProgramOptions, type MyIdentity, type ProgramOption } from '../../lib/api';
import { createInitialParticipantProgramAction } from '../../actions';
import { GridContainer } from '../../components/wire/grid-container';
import { PageTitle } from '../../components/wire/page-title';
import { WireError } from '../../components/wire/wire-state';
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
  // 사업 확정 이후에도 관리자 변경과 경합할 수 있어, 서버 원문 대신 재확인 위치만 안내한다.
  program_admission_required: '관리자가 사업의 저장 위치와 처리 방식을 확인해야 등록할 수 있습니다. 설정에서 사업을 다시 확인해 주세요.',
  service_unavailable: '지금 당사자를 등록할 수 없습니다. 잠시 후 다시 시도하세요.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 새 당사자 생성 + 케이스 열기(인테이크) + 항목별 동의가 한 흐름(#19 · 재개편 T7 #37 · D21·D23).
// 동의는 항목별(녹음·텍스트 AI)로 분리하고 기본 미체크이며, 미동의여도 등록은 진행된다(D15).
// 폼은 와이어프레임(Figma 1:95)의 2×2 그리드로 교체하되 컴포넌트 킷(#31)만 쓴다.
export default async function NewParticipantPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const notice = queryValue(query, 'notice');
  const errorCode = queryValue(query, 'error');

  let me: MyIdentity;
  try {
    me = await getMyIdentity();
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

  let programOptions: ProgramOption[];
  try {
    programOptions = await getProgramOptions();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <main className="page-content">
        <GridContainer>
          <PageTitle>당사자 등록</PageTitle>
          <WireError>등록할 수 있는 사업 목록을 불러오지 못했습니다.</WireError>
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
          currentUser={{ name: me.name, email: me.email }}
          action={createInitialParticipantProgramAction}
          programOptions={programOptions}
        />
      </GridContainer>
    </main>
  );
}
