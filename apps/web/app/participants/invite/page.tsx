import { GridContainer } from '../../components/wire/grid-container';
import { ListRow } from '../../components/wire/list-row';
import { PageTitle } from '../../components/wire/page-title';
import { SearchInput } from '../../components/wire/search-input';
import { WireButton } from '../../components/wire/wire-button';
import { getDisplayLabels } from '../../lib/display-labels';

// 당사자 초대 화면(재개편 T7 · #37 · Figma 7:759 · D26).
// D26: 당사자 직접 접속(본인이 링크로 가입·로그인·동의 작성)은 동의서 법률 검토 후 구현한다.
// 이번 개편은 IA(메뉴 구조) 분리까지만 — 이 화면은 발송·저장이 없는 정적 스텁이다.
// 게이트웨이·D1·R1 접점이 전혀 없다(데이터 조회 없음).
export default async function ParticipantInvitePage() {
  // 초대 대상 표기도 온보딩 저장 이름을 되비춘다(CCC-32) — 미설정이면 하드코딩 폴백.
  const { orgLabel, programLabels } = await getDisplayLabels();
  return (
    <main className="page-content narrow">
      <GridContainer>
        <PageTitle>당사자 초대</PageTitle>

        <div className="wire-invite-stack">
          <section className="wire-invite-section" aria-label="초대 대상">
            <ListRow chevron="right">{orgLabel}</ListRow>
            <ListRow chevron="right">{programLabels.financial_support_v1}</ListRow>
          </section>

          <section className="wire-invite-section" aria-label="당사자 초대하기">
            <SearchInput label="당사자 초대하기" name="inviteEmail" placeholder="participant@example.com" />
          </section>

          {/* 발송은 D26 스텁: 비활성 버튼이라 눌러도 아무 일도 일어나지 않는다. 저장·발송 없음. */}
          <WireButton type="button" size="large" chevron disabled className="wire-register-submit">
            초대장 발송하기
          </WireButton>
          <p className="wire-invite-caption">동의서 법률 검토 후 제공 예정 (D26)</p>
        </div>
      </GridContainer>
    </main>
  );
}
