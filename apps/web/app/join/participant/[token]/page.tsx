import { notFound } from 'next/navigation';
import { WireCard } from '../../../components/wire/wire-card';
import { PROGRAM_LABELS } from '../../../lib/labels';
import { getPublicInviteInfo } from '../../../lib/api';
import { SignupForm } from './signup-form';

// 공개 당사자 가입 화면(CCC-28 · D39 · ADR-0016 #4 → ADR-0044 D86 ④). 토큰이 유효하면 폼을,
// 그 밖(무효·소비·타인·실무자용)은 404 "사용할 수 없는 링크"다. API 가 네 경우를 일부러 같은
// 404 로 뭉치므로(토큰 유효성 누설 금지) 화면도 가르지 않는다. 구 CCC-27 자기 확인 분기(소비된
// 링크 재방문 = 본인 정보)는 2026-09-06 D86 ④ 로 폐기했다. "사용이 끝났습니다 + 담당 실무자
// 이름" 상태는 공개 조회 계약을 바꾸는 일이라 당사자 초대 티켓 몫이다. 인증 불필요,
// middleware.ts 가 /join 경로를 게이트에서 제외한다.
export default async function JoinParticipantPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  try {
    const info = await getPublicInviteInfo(token);
    const programLabel = PROGRAM_LABELS[info.programType as keyof typeof PROGRAM_LABELS] ?? info.programType;

    return (
      <main className="page-content">
        <WireCard>
          <h1>당사자 가입</h1>
          <p className="wire-invite-caption">
            {programLabel} 사업에 참여하기 위해 아래 정보를 입력해 주세요.
          </p>
          <SignupForm token={token} />
        </WireCard>
      </main>
    );
  } catch {
    notFound();
  }
}
