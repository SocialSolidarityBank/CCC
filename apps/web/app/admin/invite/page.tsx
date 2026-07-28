import { PageTitle } from '../../components/wire/page-title';
import { SearchInput } from '../../components/wire/search-input';
import { WireButton } from '../../components/wire/wire-button';
import { registerCounselorAction } from '../../actions';

const noticeMessages: Record<string, string> = {
  counselor_registered: '상담사를 등록했습니다.',
};

const errorMessages: Record<string, string> = {
  invalid_request: '이메일을 다시 확인하세요.',
  validation_error: '이메일을 다시 확인하세요.',
  access_denied: '상담사 등록은 시스템 관리자만 할 수 있습니다.',
  forbidden: '상담사 등록은 시스템 관리자만 할 수 있습니다.',
  conflict: '이미 등록된 사용자입니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 등록할 수 없습니다. 잠시 후 다시 시도하세요.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 관리자 영역 상담사 초대·등록(재개편 T8, #38 · Figma 7:576). 등록은 기존 POST /users(role=counselor)를
// 그대로 호출한다. 이메일 발송 방식의 '초대'는 Access 초대와 연동 예정이라 지금은 비활성 스텁이다.
export default async function AdminInvitePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const notice = queryValue(query, 'notice');
  const errorCode = queryValue(query, 'error');

  return (
    <>
      <PageTitle>상담사 초대</PageTitle>

      {notice !== undefined && noticeMessages[notice] !== undefined ? (
        <p className="wire-admin-notice" role="status" aria-live="polite">{noticeMessages[notice]}</p>
      ) : null}
      {errorCode !== undefined ? (
        <p className="wire-admin-error" role="alert">{errorMessages[errorCode] ?? '등록하지 못했습니다.'}</p>
      ) : null}

      <form className="wire-admin-form-row" action={registerCounselorAction}>
        <SearchInput label="상담사 등록하기" name="email" placeholder="이메일" />
        <WireButton type="submit">등록</WireButton>
      </form>

      <section className="wire-admin-section" aria-label="상담사 초대">
        <div className="wire-admin-form-row">
          <SearchInput label="상담사 초대" name="inviteEmail" placeholder="이메일" />
          <WireButton disabled>초대 보내기</WireButton>
        </div>
        <p className="wire-admin-caption">Access 초대와 연동 예정</p>
      </section>
    </>
  );
}
