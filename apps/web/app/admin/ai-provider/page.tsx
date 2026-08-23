import { PageError } from '../../components/wire/page-error';
import { WireButton } from '../../components/wire/wire-button';
import { ApiError, getAiProviderStatus } from '../../lib/api';
import AiProviderControl from './ai-provider-control';

// CCC-44 AI 사업자 관리(기관 관리자) — /ai/provider/status·activate-runtime 의 화면.
// 서버 페이지는 조회만 하고, 컨트롤(폼·상태 표시)은 클라이언트 부품이 갖는다.

export default async function AdminAiProviderPage() {
  let status;
  try {
    status = await getAiProviderStatus();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <PageError
        title="AI 사업자"
        action={<WireButton variant="secondary" href="/settings">설정으로 돌아가기</WireButton>}
      >
        AI 사업자 상태를 확인할 수 없습니다. 기관 관리자 권한과 배포 설정을 확인하세요.
      </PageError>
    );
  }
  return <AiProviderControl status={status} />;
}