import { WireEmpty, WireError } from '../../components/wire/wire-state';
import { PageTitle } from '../../components/wire/page-title';
import { SearchInput } from '../../components/wire/search-input';
import { WireButton } from '../../components/wire/wire-button';
import { WireCallout } from '../../components/wire/wire-callout';
import { registerCounselorAction } from '../../actions';
import { WorkerInviteIssue } from './worker-invite-issue';

const noticeMessages: Record<string, string> = {
  counselor_registered: '실무자를 등록했습니다.',
};

const errorMessages: Record<string, string> = {
  invalid_request: '이메일을 다시 확인하세요.',
  validation_error: '이메일을 다시 확인하세요.',
  access_denied: '실무자 등록은 기관 관리자만 할 수 있습니다.',
  forbidden: '실무자 등록은 기관 관리자만 할 수 있습니다.',
  conflict: '이미 등록된 사용자입니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 등록할 수 없습니다. 잠시 후 다시 시도하세요.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 관리자 영역 실무자 초대·등록(재개편 T8, #38 · Figma 7:576). 등록은 기존 POST /users(role=counselor)를
// 그대로 호출한다. 이메일 발송 방식의 '초대'는 Access 초대와 연동 예정이라 지금은 비활성 스텁이다.
export default async function AdminInvitePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const notice = queryValue(query, 'notice');
  const errorCode = queryValue(query, 'error');

  return (
    <>
      <PageTitle>실무자 초대</PageTitle>

      {notice !== undefined && noticeMessages[notice] !== undefined ? (
        <p className="wire-admin-notice" role="status" aria-live="polite">{noticeMessages[notice]}</p>
      ) : null}
      {errorCode !== undefined ? (
        <WireError>{errorMessages[errorCode] ?? '등록하지 못했습니다.'}</WireError>
      ) : null}

      <form className="wire-admin-form-row" action={registerCounselorAction}>
        <SearchInput label="실무자 등록하기" name="email" placeholder="이메일" />
        <WireButton type="submit">등록</WireButton>
      </form>

      {/* 초대 링크 발급(CCC-108) — 링크를 받은 사람이 스스로 이름·이메일을 입력해 가입한다.
          래퍼는 admin 영역 세로 스택 관례(.wire-admin-section margin-top 24)다 — 등록 폼
          행과 이 카드가 여백 0 으로 붙어 있었다(2026-08-29 결함 ⑦). */}
      <div className="wire-admin-section"><WorkerInviteIssue /></div>

      {/* 구 '실무자 초대' 폼(이메일 칸 + 영구 비활성 '초대 보내기')은 없앴다(CCC-63).
          지금 되는 길은 둘이다 — 위의 직접 등록과 초대 링크(CCC-108). 메일 자동 발송만
          아직 없으므로, 그 사실을 말로 적는다. */}
      <div className="wire-admin-section">
        <WireCallout tone="lavender" role="status" testId="admin-invite-note" title="초대 방법 두 가지">
          이메일을 아는 실무자는 위에서 바로 등록하고, 아니면 초대 링크를 만들어 전달하세요.
          링크를 받은 사람이 이름과 이메일을 입력해 가입하며, 두 경우 모두 Cloudflare Access 로
          로그인합니다. 메일을 자동으로 보내 주는 기능은 아직 없습니다. 링크는 직접 전달해야 합니다.
        </WireCallout>
      </div>
    </>
  );
}
