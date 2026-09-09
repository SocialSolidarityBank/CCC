import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext, type RouteObject } from 'react-router';
import {
  GridContainer, PageTitle, WireButton, WireCallout, WireCard, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireLinkProvider, type WireLinkProps,
} from '@ccc/web/wire';
import type { CapabilityManifest } from '@ccc/contracts/runtime';
import { CloudAuth } from './business/auth';
import { AuthView } from './business/auth-view';
import { SettingsApi, type MyIdentity, type OrganizationProfile } from './business/api';
import { BusinessError, safeError } from './business/errors';
import { loadInstallation, type VerifiedInstallation } from './business/installation';
import { canOpenDestination, destinationAt, visibleDestinations } from './business/navigation';
import { AccountModule } from './business/settings-modules';
import { BusinessTransport } from './business/transport';
import { SttTrialPage } from './stt-trial/stt-trial-page';

interface Runtime { installation: VerifiedInstallation; auth: CloudAuth }
interface Session {
  auth: CloudAuth;
  api: SettingsApi;
  me: MyIdentity;
  capabilities: CapabilityManifest;
}
let runtimePromise: Promise<Runtime> | undefined;

function RouterLink({ href, ...props }: WireLinkProps) {
  const target = new URL(href, window.location.origin);
  if (target.origin !== window.location.origin) return <a {...props} href={href} />;
  return <Link {...props} to={`${target.pathname}${target.search}${target.hash}`} />;
}

function RouterRoot() {
  const location = useLocation();
  useEffect(() => {
    document.title = location.pathname === '/' ? 'STT 내부 시험'
      : `${destinationAt(location.pathname, location.search)?.title ?? 'CCC'} | CCC`;
    // Trial entry retains its original focus behavior.
    if (location.pathname === '/') return;
    const heading = document.querySelector('h1');
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [location.pathname, location.search]);
  return <WireLinkProvider renderer={RouterLink}><Outlet /></WireLinkProvider>;
}

function RuntimeBoundary() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  useEffect(() => {
    let live = true;
    let owned: Runtime | undefined;
    // Keep the existing one-installation/one-Auth lifecycle across StrictMode effects.
    runtimePromise ??= loadInstallation(window.location.origin, import.meta.env.VITE_CCC_INSTALL_SIGNING_KEYS)
      .then((installation) => ({ installation, auth: new CloudAuth(installation) }));
    void runtimePromise.then((value) => {
      if (live) { owned = value; setRuntime(value); }
    }).catch((cause: unknown) => { if (live) setError(safeError(cause)); });
    return () => {
      live = false;
      // Public/trial routes must not retain a background refresh session.
      if (owned) void owned.auth.signOut();
    };
  }, []);
  if (runtime) return <Outlet context={runtime} />;
  return <GridContainer as="main" className="page-content">
    <PageTitle>설치 정보 확인</PageTitle>
    <WireCard>{error ? <>
      <WireError>{error.message}</WireError>
      <WireButton variant="neutral" onClick={() => window.location.reload()}>다시 확인</WireButton>
    </> : <WireEmpty live reserve>서명된 설치 정보를 확인하고 있습니다.</WireEmpty>}</WireCard>
  </GridContainer>;
}

function handleAuthFailure(auth: CloudAuth, error: BusinessError): void {
  if (error.status === 401) void auth.signOut(error);
  else if (error.code === 'mfa_required') auth.recheck(true);
}

function AuthBoundary() {
  const runtime = useOutletContext<Runtime>();
  const snapshot = useSyncExternalStore(runtime.auth.subscribe, runtime.auth.getSnapshot, runtime.auth.getSnapshot);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') runtime.auth.recordActivity(); };
    window.addEventListener('pointerdown', runtime.auth.recordActivity, { passive: true });
    window.addEventListener('keydown', runtime.auth.recordActivity);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('pointerdown', runtime.auth.recordActivity);
      window.removeEventListener('keydown', runtime.auth.recordActivity);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [runtime.auth]);
  if (snapshot.phase !== 'ready') return <GridContainer as="main" className="page-content">
    <PageTitle>로그인</PageTitle>
    <AuthView key={snapshot.revision} auth={runtime.auth} snapshot={snapshot} />
  </GridContainer>;
  // Replacing the revision removes the previous identity before effects/loaders run.
  return <VerifiedSession key={snapshot.revision} runtime={runtime} revision={snapshot.revision} />;
}

function VerifiedSession({ runtime, revision }: { runtime: Runtime; revision: number }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  useEffect(() => {
    const transport = new BusinessTransport(runtime.installation, runtime.auth.getToken);
    const api = new SettingsApi(transport);
    let live = true;
    const unsubscribe = runtime.auth.subscribe(() => {
      if (runtime.auth.getSnapshot().revision !== revision) {
        live = false;
        transport.dispose();
      }
    });
    void (async () => {
      try {
        const capabilities = await transport.initialize();
        const me = await api.me();
        if (live) setSession({ auth: runtime.auth, api, me, capabilities });
      } catch (cause) {
        if (!live) return;
        const failure = safeError(cause);
        handleAuthFailure(runtime.auth, failure);
        setError(failure);
      }
    })();
    return () => { live = false; unsubscribe(); transport.dispose(); };
  }, [runtime, revision]);
  if (session && session.me.roles.length > 0) return <Outlet context={session} />;
  return <GridContainer as="main" className="page-content">
    <div className="page-header">
      <PageTitle>{session ? '역할 배정 대기' : '서버 연결 확인'}</PageTitle>
      <WireButton variant="neutral" onClick={() => { void runtime.auth.signOut(); }}>로그아웃</WireButton>
    </div>
    <WireCard>{error ? <>
      <WireError>{error.message}</WireError>
      <WireButton variant="neutral" onClick={() => runtime.auth.recheck()}>연결 다시 확인</WireButton>
    </> : session ? <WireCallout tone="info" title="업무 역할이 필요합니다">
      기관 관리자가 역할을 배정하기 전에는 업무 메뉴를 사용할 수 없습니다.
    </WireCallout> : <WireEmpty live reserve>설치 능력과 내 계정을 확인하고 있습니다.</WireEmpty>}</WireCard>
  </GridContainer>;
}

function BusinessShell() {
  const session = useOutletContext<Session>();
  const location = useLocation();
  const destination = destinationAt(location.pathname, location.search);
  return <GridContainer as="main" className="page-content">
    <div className="page-header">
      <PageTitle>{destination?.title ?? '페이지 확인'}</PageTitle>
      <div className="page-actions">
        <WireButton variant="neutral" onClick={() => { void session.auth.signOut(); }}>로그아웃</WireButton>
      </div>
    </div>
    <div className="settings-layout">
      <WireCard as="nav" className="settings-navigation" labelledBy="business-navigation"
        title={<h2 id="business-navigation">업무 메뉴</h2>}>
        <ul className="settings-navigation-list">
          {visibleDestinations(session.me.roles).map((item) => {
            const active = destination?.id === item.id;
            return <li key={item.id}><Link className="navigation-link" to={item.href}
              aria-current={active ? 'page' : undefined} data-current={active ? 'true' : 'false'}>{item.title}</Link></li>;
          })}
        </ul>
      </WireCard>
      <div className="settings-content">
        {destination === null ? <WireCard><WireError>요청한 페이지가 없습니다.</WireError></WireCard>
          : !canOpenDestination(destination, session.me.roles)
            ? <WireCard><WireError>현재 역할에는 이 페이지를 볼 권한이 없습니다.</WireError></WireCard>
            : <Outlet context={session} />}
      </div>
    </div>
  </GridContainer>;
}

function SettingsScreen() {
  const session = useOutletContext<Session>();
  const location = useLocation();
  if (destinationAt(location.pathname, location.search)?.id === 'system') {
    const cap = session.capabilities;
    return <WireCard title="서버가 확인한 연결 상태">
      <WireDataRows>
        <WireDataRow label="설치 방식" value={cap.mode} />
        <WireDataRow label="음성 인식" value={cap.sttMode === 'off' ? '꺼짐' : cap.sttMode} />
        <WireDataRow label="지정된 엔진" value={cap.sttEngine ?? '승인된 엔진 없음'} />
        <WireDataRow label="AI 처리" value={cap.llmMode === 'off' ? '꺼짐' : cap.llmMode} />
        <WireDataRow label="처리 장비" value={cap.agentStatus} />
      </WireDataRows>
      <WireCallout tone="info" title="확인 범위">서버가 응답한 설치 값입니다. 실제 인증, 장비 준비나 제품 활성화가 모두 완료됐다는 뜻은 아닙니다.</WireCallout>
      <div className="business-actions"><WireButton variant="neutral" onClick={() => session.auth.recheck()}>상태 다시 확인</WireButton></div>
    </WireCard>;
  }
  return <AccountModule me={session.me} api={session.api} onFailure={(error) => handleAuthFailure(session.auth, error)} />;
}

function InstitutionScreen() {
  const session = useOutletContext<Session>();
  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  useEffect(() => {
    let live = true;
    void session.api.getProfile().then((value) => { if (live) setProfile(value); }).catch((cause: unknown) => {
      if (!live) return;
      const failure = safeError(cause);
      handleAuthFailure(session.auth, failure);
      setError(failure);
    });
    return () => { live = false; };
  }, [session.api, session.auth]);
  return <WireCard title="기관 준비 확인">
    {error && <WireError>{error.message}</WireError>}
    {!profile && !error && <WireEmpty live>기관 정보를 확인하고 있습니다.</WireEmpty>}
    {profile && <WireDataRows>
      <WireDataRow label="기관 이름" value={profile.orgName ?? '등록되지 않음'} />
      <WireDataRow label="사업 표시 이름" value={profile.programDisplayName ?? '등록되지 않음'} />
    </WireDataRows>}
    <WireCallout tone="info" title="준비 상태 확인 대기">
      초기 설정 완료 여부와 첫 사업을 확인하는 응답 계약이 아직 연결되지 않았습니다. 표시 이름만으로 업무 준비가 끝났다고 판단하지 않습니다.
    </WireCallout>
  </WireCard>;
}

function ParticipantEntry() {
  return <WireCard title="업무 진입 확인">
    <WireCallout tone="info" title="기관 준비 상태 확인 대기">
      초기 설정과 첫 사업의 확인 상태를 알 수 없어 당사자 업무를 아직 열지 않습니다. 당사자 등록이나 조회가 완료된 상태가 아닙니다.
    </WireCallout>
  </WireCard>;
}

function PublicScreen({ kind }: { kind: 'welcome' | 'join' | 'institution' | 'missing' }) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    // Pending public-link implementation must not retain a token in visible history.
    if (kind === 'join' && location.hash) {
      void navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
    }
  }, [kind, location.hash, location.pathname, location.search, navigate]);
  const title = kind === 'welcome' ? 'CCC' : kind === 'join' ? '요청 링크' : kind === 'institution' ? '기관 확인' : '페이지 확인';
  return <GridContainer as="main" className="page-content">
    <PageTitle>{title}</PageTitle>
    <WireCard>{kind === 'welcome' ? <>
      <WireCallout tone="info" title="기관 계정으로 시작">서명된 설치 정보를 확인한 뒤 기관 계정과 추가 인증으로 로그인합니다.</WireCallout>
      <WireButton variant="neutral" href="/login">로그인으로 이동</WireButton>
    </> : kind === 'missing' ? <WireError>요청한 페이지가 없습니다.</WireError>
      : <WireCallout tone="info" title="연결 준비 중">{kind === 'join'
        ? '요청 링크 교환과 제출 기능이 아직 연결되지 않았습니다. 링크를 사용하거나 제출이 완료된 것으로 처리하지 않습니다.'
        : '기관 코드를 설치 정보와 연결하는 계약이 아직 준비되지 않았습니다. 코드로 임의의 서버 주소를 만들지 않습니다.'}</WireCallout>}
    </WireCard>
  </GridContainer>;
}

function RouteFailure() {
  return <GridContainer as="main" className="page-content">
    <PageTitle>화면을 열 수 없습니다</PageTitle>
    <WireCard><WireError>페이지를 다시 열어 주세요. 입력이나 처리가 완료됐다고 판단하지 않습니다.</WireError></WireCard>
  </GridContainer>;
}

export const appRoutes: RouteObject[] = [{
  path: '/', element: <RouterRoot />, errorElement: <RouteFailure />, children: [
    { index: true, element: <SttTrialPage /> },
    { path: 'welcome', element: <PublicScreen kind="welcome" /> },
    { path: 'join', element: <PublicScreen kind="join" /> },
    { path: 'k/:code', element: <PublicScreen kind="institution" /> },
    { element: <RuntimeBoundary />, children: [
      { element: <AuthBoundary />, children: [
        { path: 'login', element: <Navigate to="/settings" replace /> },
        { element: <BusinessShell />, children: [
          { path: 'settings', element: <SettingsScreen /> },
          { path: 'onboarding', element: <InstitutionScreen /> },
          { path: 'participants', element: <ParticipantEntry /> },
        ] },
      ] },
    ] },
    { path: '*', element: <PublicScreen kind="missing" /> },
  ],
}];
