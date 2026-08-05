import { GridContainer } from '../../components/wire/grid-container';
import { PageTitle } from '../../components/wire/page-title';
import { WireCard, WireField } from '../../components/wire/wire-card';
import { getDisplayLabels } from '../../lib/display-labels';
import { InviteIssue } from './invite-issue';

// 당사자 초대 화면(D39 · ADR-0016 · CCC-29 — 구 D26 정적 스텁 대체).
// 실무자가 당사자 가입 링크(사업+발급 실무자 묶음 토큰 URL)를 발급해 링크·QR·이메일
// 문안으로 전달한다. 발급·감사는 API 게이트웨이(R1·D14), 이메일 발송은 없다(D39).
export default async function ParticipantInvitePage() {
  // 초대 대상 표기도 온보딩 저장 이름을 되비춘다(CCC-32) — 미설정이면 하드코딩 폴백.
  const { orgLabel, programLabels } = await getDisplayLabels();

  return (
    <main className="page-content">
      <GridContainer>
        <PageTitle>당사자 초대</PageTitle>

        <div className="wire-invite-stack">
          {/* 이동하는 행이 아니라 "이 링크가 무엇에 묶이는가"라는 정보라서 리스트 행이 아니라
              정보 필드 계약(라벨 14/700 민트 deep + 값 16 --ink)을 쓴다(DESIGN.md §5). */}
          <WireCard title="초대 대상">
            <WireField label="기관">{orgLabel}</WireField>
            <WireField label="사업">{programLabels.financial_support_v1}</WireField>
          </WireCard>

          <InviteIssue />
        </div>
      </GridContainer>
    </main>
  );
}
