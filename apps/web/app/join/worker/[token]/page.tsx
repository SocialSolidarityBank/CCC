import {
  WireCard,
} from '@ccc/wire';
import { notFound } from 'next/navigation';
import { getStaffInvitePublicInfo } from '../../../lib/api';
import { formatKoreanDateTime } from '../../../lib/format-korean-date';
import { StaffInviteAcceptForm } from './accept-form';

// 공개 실무자 초대 수락 화면(D86). 토큰이 유효하면 폼을, 무효·소비·회수·만료면 404 를
// 렌더한다(participant 가입 화면과 같은 규약 — 무엇이 틀렸는지 구분해 주면 열거 단서가
// 된다). 인증 불필요 — middleware.ts 가 /join/ 접두 경로를 셸·게이트에서 제외한다.
export default async function JoinWorkerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let orgName: string | null;
  let expiresAt: string;
  try {
    const info = await getStaffInvitePublicInfo(token);
    orgName = info.orgName;
    expiresAt = info.expiresAt;
  } catch {
    notFound();
  }

  return (
    <main className="page-content">
      <WireCard>
        <h1>실무자 초대</h1>
        <p className="wire-invite-caption">
          {orgName === null
            ? '기관의 실무자로 초대받았습니다.'
            : `${orgName} 의 실무자로 초대받았습니다.`}
          {' '}이 링크는 한 번만 쓸 수 있고 {formatKoreanDateTime(expiresAt)}에 만료됩니다.
        </p>
        <StaffInviteAcceptForm token={token} />
      </WireCard>
    </main>
  );
}
