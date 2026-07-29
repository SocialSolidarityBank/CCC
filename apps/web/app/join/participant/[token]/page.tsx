import { notFound } from 'next/navigation';
import { WireCard } from '../../../components/wire/wire-card';
import { PROGRAM_LABELS } from '../../../lib/labels';
import { getPublicInviteInfo } from '../../../lib/api';
import { SignupForm } from './signup-form';

// 공개 당사자 가입 화면(CCC-28 · D39 · ADR-0016 #4). 토큰이 유효하면 폼을,
// 무효·이미 소비면 "사용할 수 없는 링크" 안내를 렌더한다. 인증 불필요 —
// middleware.ts 가 /join 경로를 게이트에서 제외한다.
export default async function JoinParticipantPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let programType: string;
  try {
    const info = await getPublicInviteInfo(token);
    programType = info.programType;
  } catch {
    // 토큰 무효·이미 소비 → 404. CCC-27(자기 확인)이 이 분기를 나중에 대체한다.
    notFound();
  }

  const programLabel = PROGRAM_LABELS[programType as keyof typeof PROGRAM_LABELS] ?? programType;

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
}
