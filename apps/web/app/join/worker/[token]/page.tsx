import { notFound } from 'next/navigation';
import { WireCard } from '../../../components/wire/wire-card';
import { getPublicWorkerInviteInfo } from '../../../lib/api';
import { WorkerSignupForm } from './signup-form';

// 공개 실무자 초대 수락 화면(CCC-108 · CCC-33). 토큰이 유효하면 폼을, 무효·이미 소비면
// 404 를 렌더한다(participant 가입 화면과 같은 규약 — 무엇이 틀렸는지 구분해 주면 열거
// 단서가 된다). 인증 불필요 — middleware.ts 가 /join/ 접두 경로를 셸·게이트에서 제외한다.
export default async function JoinWorkerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let orgName: string | null;
  try {
    const info = await getPublicWorkerInviteInfo(token);
    orgName = info.orgName;
  } catch {
    notFound();
  }

  return (
    <main className="page-content">
      <WireCard>
        <h1>실무자 초대</h1>
        <p className="wire-invite-caption">
          {orgName === null
            ? '기관의 실무자로 초대받았습니다. 아래 정보를 입력해 주세요.'
            : `${orgName} 의 실무자로 초대받았습니다. 아래 정보를 입력해 주세요.`}
        </p>
        <WorkerSignupForm token={token} />
      </WireCard>
    </main>
  );
}
