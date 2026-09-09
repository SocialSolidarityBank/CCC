import { GridContainer } from '../../components/wire/grid-container';
import { PageTitle } from '../../components/wire/page-title';
import { WireCard } from '../../components/wire/wire-card';
import { ApiError, getProgramOptions, type ProgramOption } from '../../lib/api';
import { WireError } from '../../components/wire/wire-state';
import { InviteIssue } from './invite-issue';

// 당사자 초대 화면(D39 · ADR-0016 · CCC-29 — 구 D26 정적 스텁 대체).
// 실무자가 당사자 가입 링크(사업+발급 실무자 묶음 토큰 URL)를 발급해 링크·QR·이메일
// 문안으로 전달한다. 발급·감사는 API 게이트웨이(R1·D14), 이메일 발송은 없다(D39).
export default async function ParticipantInvitePage() {
  let programOptions: ProgramOption[];
  try {
    programOptions = await getProgramOptions();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <main className="page-content">
        <GridContainer>
          <PageTitle>당사자 초대</PageTitle>
          <WireError>초대할 수 있는 사업 목록을 불러오지 못했습니다.</WireError>
        </GridContainer>
      </main>
    );
  }

  return (
    <main className="page-content">
      <GridContainer>
        <PageTitle>당사자 초대</PageTitle>

        <div className="wire-invite-stack">
          <WireCard title="초대 사업">
            <p className="wire-invite-caption">발급한 링크는 선택한 사업에 고정됩니다.</p>
          </WireCard>

          <InviteIssue programOptions={programOptions} />
        </div>
      </GridContainer>
    </main>
  );
}
