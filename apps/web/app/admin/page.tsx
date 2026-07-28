import { ListRow } from '../components/wire/list-row';
import { PageTitle } from '../components/wire/page-title';
import { ApiError, getMyIdentity } from '../lib/api';

// 관리자 영역 조직 화면(재개편 T8, #38 · Figma 5:350). 내부 전용 단일 조직이므로 목록은 1행
// 자리만 둔다(멀티테넌트 확장 여지, D1·D27). 조직 상세는 이후 티켓 소관.
export default async function AdminOrganizationPage() {
  let orgId: string | null = null;
  try {
    orgId = (await getMyIdentity()).orgId;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    orgId = null;
  }

  return (
    <>
      <PageTitle>조직</PageTitle>
      <div className="wire-admin-list">
        {orgId === null ? (
          <p className="wire-admin-empty" role="alert">조직 정보를 확인할 수 없습니다.</p>
        ) : (
          <ListRow chevron="right">{orgId}</ListRow>
        )}
      </div>
    </>
  );
}
