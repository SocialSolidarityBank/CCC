import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext, type RouteObject } from 'react-router';
import {
  GridContainer, PageTitle, WireButton, WireCallout, WireCard, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireLinkProvider, type WireLinkProps,
} from '@ccc/web/wire';
import type { CapabilityManifest } from '@ccc/contracts/runtime';

import { CloudAuth } from './business/auth';
import { AuthView } from './business/auth-view';
import { SettingsApi, type MyIdentity } from './business/api';
import { InstitutionApi } from './business/institution';
import { ParticipantsApi } from './business/participants';
import { AiReviewApi } from './business/ai-review';
import { ConsentApi } from './business/consent';
import { IntakeApi } from './business/intake';
import { CaseWorkApi, RecordsApi } from './business/records';
import { SchedulesApi } from './business/schedules';
import type { Session } from './business/session';
import {
  ParticipantBasicInfoScreen, ParticipantHubScreen, ParticipantListScreen, ParticipantRegisterScreen,
} from './screens/participants';
import { InstitutionScreen } from './screens/institution';
import {
  BriefingScreen, ScheduleCreateScreen, SchedulePlanScreen, ScheduleScreen,
} from './screens/schedules';
import { RecordCreateScreen, RecordListScreen, RecordReviewScreen } from './screens/records';
import { IntakeScreen } from './screens/intake';
import { ConsentScreen } from './screens/consent';
import { SettingsScreen } from './screens/settings';
import { BusinessError, safeError } from './business/errors';
import { loadInstallation, type VerifiedInstallation } from './business/installation';
import { canOpenDestination, destinationAt, visibleDestinations } from './business/navigation';
import { BusinessTransport } from './business/transport';
import { SttTrialPage } from './stt-trial/stt-trial-page';

interface Runtime { installation: VerifiedInstallation; auth: CloudAuth }
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
  // 초기 설정과 도입 확인을 저장하면 /me의 준비 관측값을 다시 읽는다.
  const [identityNonce, setIdentityNonce] = useState(0);
  useEffect(() => {
    const transport = new BusinessTransport(runtime.installation, runtime.auth.getToken);
    const api = new SettingsApi(transport);
    const participants = new ParticipantsApi(transport);
    const institution = new InstitutionApi(transport);
    const schedules = new SchedulesApi(transport);
    const records = new RecordsApi(transport);
    const caseWork = new CaseWorkApi(transport);
    const intake = new IntakeApi(transport);
    const consent = new ConsentApi(transport);
    const aiReview = new AiReviewApi(transport);
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
        if (live) {
          setSession({
            auth: runtime.auth, api, participants, institution, schedules, records, caseWork, intake, consent, aiReview, me, capabilities,
            reloadIdentity: () => setIdentityNonce((current) => current + 1),
          });
        }
      } catch (cause) {
        if (!live) return;
        const failure = safeError(cause);
        handleAuthFailure(runtime.auth, failure);
        setError(failure);
      }
    })();
    return () => { live = false; unsubscribe(); transport.dispose(); };
  }, [runtime, revision, identityNonce]);
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
          { path: 'participants', element: <ParticipantListScreen /> },
          { path: 'participants/new', element: <ParticipantRegisterScreen /> },
          { path: 'participants/:beneficiaryId', element: <ParticipantHubScreen /> },
          { path: 'participants/:beneficiaryId/edit', element: <ParticipantBasicInfoScreen /> },
          { path: 'participants/:beneficiaryId/programs/:supportCaseId/briefing', element: <BriefingScreen /> },
          { path: 'participants/:beneficiaryId/programs/:supportCaseId/records', element: <RecordListScreen /> },
          { path: 'participants/:beneficiaryId/programs/:supportCaseId/records/new', element: <RecordCreateScreen /> },
          { path: 'participants/:beneficiaryId/programs/:supportCaseId/records/intake', element: <IntakeScreen /> },
          { path: 'participants/:beneficiaryId/programs/:supportCaseId/consent', element: <ConsentScreen /> },
          { path: 'participants/:beneficiaryId/programs/:supportCaseId/records/:sessionId/review', element: <RecordReviewScreen /> },
          { path: 'schedule', element: <ScheduleScreen /> },
          { path: 'schedules/new', element: <ScheduleCreateScreen /> },
          { path: 'schedules/:scheduleId/plan', element: <SchedulePlanScreen /> },
        ] },
      ] },
    ] },
    { path: '*', element: <PublicScreen kind="missing" /> },
  ],
}];
