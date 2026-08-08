import { ApiError, getMyIdentity, getOrganizationProfile, type OrganizationProfile } from '../lib/api';
import { completeOrganizationOnboardingAction } from '../actions';
import { GridContainer } from '../components/wire/grid-container';
import { PageTitle } from '../components/wire/page-title';
import { WireError } from '../components/wire/wire-state';
import { WireButton } from '../components/wire/wire-button';
import { OnboardingWizard } from './onboarding-wizard';

const errorMessages: Record<string, string> = {
  invalid_request: '입력한 이름을 다시 확인하세요. 기관 이름은 80자, 사업 이름은 120자까지입니다.',
  validation_error: '입력한 이름을 다시 확인하세요. 기관 이름은 80자, 사업 이름은 120자까지입니다.',
  access_denied: '온보딩은 기관 관리자만 할 수 있습니다.',
  forbidden: '온보딩은 기관 관리자만 할 수 있습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 저장할 수 없습니다. 잠시 후 다시 시도하세요.',
};

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

/** 저장 직후의 완료 안내 — 다음 걸음(실무자 초대)으로 손을 이어 준다 (스펙 #78 흐름). */
function OnboardingDone({ profile }: { profile: OrganizationProfile }) {
  return (
    <article className="surface-card onboarding-card" aria-label="온보딩 완료">
      <h2>준비가 끝났습니다</h2>
      <p className="onboarding-help">
        {profile.orgName ?? '기관'}의 워크스페이스가 {profile.programDisplayName ?? '첫 사업'} 이름으로 준비됐습니다.
        입력한 이름은 사이드바와 화면 전체에 바로 표시됩니다.
      </p>
      <p className="onboarding-help">다음 걸음은 함께 일할 실무자를 초대하는 것입니다.</p>
      <div className="onboarding-actions">
        <WireButton variant="secondary" align="center" href="/onboarding?edit=1">이름 다시 고치기</WireButton>
        <WireButton variant="primary" align="center" href="/admin/invite">실무자 초대로 이동</WireButton>
      </div>
    </article>
  );
}

// 관리자 온보딩 2단계 (CCC-32 · 스펙 #78 US 1·2, D39/ADR-0016). 조직 이름·첫 사업 표시
// 이름만 진짜 저장한다(programs 테이블 없음). 접근은 admin 만 — 게이트웨이가 다시 강제한다(R1).
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const notice = queryValue(query, 'notice');
  const errorCode = queryValue(query, 'error');
  const editing = queryValue(query, 'edit') === '1';

  let role: string | null = null;
  let profile: OrganizationProfile | null = null;
  let unavailable = false;
  try {
    [{ role }, profile] = await Promise.all([getMyIdentity(), getOrganizationProfile()]);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    unavailable = true;
  }

  if (role !== 'admin') {
    return (
      <main className="page-content">
        <GridContainer>
          <PageTitle>기관 온보딩</PageTitle>
          <WireError>
            {unavailable
              ? '온보딩 화면을 열 수 없습니다. 다시 로그인한 뒤 시도하세요.'
              : '이 화면은 기관 관리자만 접근할 수 있습니다.'}
          </WireError>
        </GridContainer>
      </main>
    );
  }

  const saved = notice === 'onboarding_saved' && !editing;

  return (
    <main className="page-content">
      <GridContainer>
        <PageTitle>기관 온보딩</PageTitle>

        {errorCode !== undefined ? (
          <WireError>{errorMessages[errorCode] ?? '저장하지 못했습니다.'}</WireError>
        ) : null}

        {saved && profile !== null ? (
          <OnboardingDone profile={profile} />
        ) : (
          <OnboardingWizard
            action={completeOrganizationOnboardingAction}
            initialOrgName={profile?.orgName ?? ''}
            initialProgramName={profile?.programDisplayName ?? ''}
          />
        )}
      </GridContainer>
    </main>
  );
}
