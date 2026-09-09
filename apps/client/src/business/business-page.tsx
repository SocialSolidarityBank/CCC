import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { CapabilityManifest } from '@ccc/contracts/runtime';
import {
  GridContainer, PageTitle, WireButton, WireCard, WireCardSection, WireEmpty, WireError, WireLinkProvider,
  type WireLinkProps,
} from '@ccc/web/wire';
import { CloudAuth } from './auth';
import { AuthView } from './auth-view';
import { SettingsApi, type MyIdentity } from './api';
import { BusinessError, safeError } from './errors';
import { loadInstallation, type VerifiedInstallation } from './installation';
import { AccountModule, InstitutionModule, MemoryModule } from './settings-modules';
import { AuditModule, RetentionModule } from './audit-retention-modules';
import { ProgramsApi, ProgramsModule } from './programs';
import { ExportsApi, ExportsModule } from './exports';
import { AccountsApi, AccountsModule } from './accounts';
import { RetentionPolicyApi, RetentionPolicyModule } from './retention-policy';
import {
  canOpenSettingsDestination, GuideModule, SETTINGS_DESTINATIONS, SETTINGS_NAVIGATION_GROUPS,
} from './guide';
import { CapabilitySettingsModule, ConsentSettingsModule, isCapabilitySetting } from './capability-settings';
import { BusinessTransport } from './transport';
import './business.css';

interface BusinessRuntime { installation: VerifiedInstallation; auth: CloudAuth }
type SettingsLinkProps = Omit<WireLinkProps, 'data-variant' | 'data-justify'> & {
  'data-variant'?: WireLinkProps['data-variant'];
  'data-justify'?: WireLinkProps['data-justify'];
};
let runtimePromise: Promise<BusinessRuntime> | undefined;

function runtime(): Promise<BusinessRuntime> {
  // StrictMode의 effect 재실행으로 설치 확인이나 SDK 인스턴스가 중복되지 않는다.
  runtimePromise ??= loadInstallation(window.location.origin, import.meta.env.VITE_CCC_INSTALL_SIGNING_KEYS)
    .then((installation) => ({ installation, auth: new CloudAuth(installation) }));
  return runtimePromise;
}

function SettingsLink({ href, children, ...props }: SettingsLinkProps) {
  const target = new URL(href, window.location.origin);
  const current = window.location.pathname === target.pathname
    && (new URL(window.location.href).searchParams.get('module') ?? 'account') === (target.searchParams.get('module') ?? 'account');
  return <a {...props} href={href} aria-current={current ? 'page' : undefined}
    data-current={current ? 'true' : undefined} onClick={(event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || target.origin !== window.location.origin || target.pathname !== '/settings') return;
      event.preventDefault();
      window.history.pushState(null, '', `${target.pathname}${target.search}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }}>{children}</a>;
}

function SettingsNavigation({ roles }: { roles: MyIdentity['roles'] }) {
  return <WireCard as="nav" className="settings-navigation" labelledBy="settings-navigation"
    title={<h2 id="settings-navigation">설정 메뉴</h2>}>
    {SETTINGS_NAVIGATION_GROUPS.map((group) => {
      const destinations = group.slugs.flatMap((slug) => {
        const destination = SETTINGS_DESTINATIONS.find((candidate) => candidate.slug === slug);
        return destination !== undefined && canOpenSettingsDestination(destination, roles) ? [destination] : [];
      });
      if (destinations.length === 0) return null;
      const titleId = `settings-navigation-${group.id}`;
      return <WireCardSection key={group.id} title={group.title} titleId={titleId}>
        <ul className="settings-navigation-list" aria-labelledby={titleId}>
          {destinations.map((destination) => <li key={destination.slug}>
            <SettingsLink className="navigation-link" href={`/settings?module=${destination.slug}`}>
              <span>{destination.title}</span>
            </SettingsLink>
          </li>)}
        </ul>
      </WireCardSection>;
    })}
  </WireCard>;
}

function SignedInSettings({ installation, auth, route }: BusinessRuntime & { route: string }) {
  const [loaded, setLoaded] = useState<{ api: SettingsApi; programs: ProgramsApi; exports: ExportsApi; accounts: AccountsApi; retentionPolicy: RetentionPolicyApi; capabilities: CapabilityManifest; me: MyIdentity } | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const onFailure = useCallback((failure: BusinessError) => {
    if (failure.status === 401) void auth.signOut(failure);
    else if (failure.code === 'mfa_required') auth.recheck(true);
  }, [auth]);

  useEffect(() => {
    const revision = auth.getSnapshot().revision;
    if (auth.getSnapshot().phase !== 'ready') return;
    const transport = new BusinessTransport(installation, auth.getToken);
    const programs = new ProgramsApi(transport);
    const exports = new ExportsApi(transport);
    const accounts = new AccountsApi(transport);
    const retentionPolicy = new RetentionPolicyApi(transport);
    const api = new SettingsApi(transport);
    let live = true;
    const unsubscribe = auth.subscribe(() => {
      if (auth.getSnapshot().revision !== revision) {
        live = false;
        transport.dispose();
      }
    });
    void (async () => {
      try {
        const capabilities = await transport.initialize();
        const me = await api.me();
        if (live) setLoaded({ api, programs, exports, accounts, retentionPolicy, capabilities, me });
      } catch (cause) {
        if (!live) return;
        const failure = safeError(cause);
        onFailure(failure);
        setError(failure);
      }
    })();
    return () => { live = false; unsubscribe(); transport.dispose(); };
  }, [installation, auth, onFailure]);

  const module = new URL(route, window.location.origin).searchParams.get('module') ?? 'account';
  const admin = loaded?.me.roles.includes('institution-admin') === true;
  const canInspectInstallation = admin || loaded?.me.roles.includes('technical-admin') === true;
  return <>
    <div className="page-header">
      <PageTitle>설정</PageTitle>
      <div className="page-actions">
        <WireButton variant="neutral" onClick={() => { void auth.signOut(); }}>로그아웃</WireButton>
      </div>
    </div>
    {error && <WireCard as="section" title={<h2>서버 연결</h2>}>
      <WireError>{error.message}</WireError>
      <WireButton variant="neutral" onClick={() => auth.recheck()}>연결 다시 확인</WireButton>
    </WireCard>}
    {!loaded && !error && <WireCard><WireEmpty live reserve>설치 능력과 내 계정을 확인하고 있습니다.</WireEmpty></WireCard>}
    {loaded && <>
      <div className="settings-layout">
        <SettingsNavigation roles={loaded.me.roles} />
        <div className="settings-content">
      {module === 'account' ? <AccountModule me={loaded.me} api={loaded.api} onFailure={onFailure} />
        : module === 'guide' ? <GuideModule roles={loaded.me.roles} />
          : module === 'accounts'
            ? canInspectInstallation
              ? <AccountsModule api={loaded.accounts} currentUserId={loaded.me.id} onIdentityChanged={() => auth.recheck()} onFailure={onFailure} />
              : <WireCard><WireError>사용자 관리는 기관 관리자와 기관 기술 관리자만 사용할 수 있습니다.</WireError></WireCard>
          : isCapabilitySetting(module)
            ? canInspectInstallation
              ? <CapabilitySettingsModule setting={module} capabilities={loaded.capabilities} onRefresh={() => auth.recheck()} />
              : <WireCard><WireError>이 설정은 기관 관리자와 기관 기술 관리자만 확인할 수 있습니다.</WireError></WireCard>
          : module === 'exports'
            ? loaded.me.roles.includes('worker')
              ? <ExportsModule api={loaded.exports} onFailure={onFailure} />
              : <WireCard><WireError>기록 내보내기는 담당 배정된 실무자만 사용할 수 있습니다.</WireError></WireCard>
            : module === 'institution' || module === 'memory' || module === 'audit' || module === 'retention' || module === 'programs' || module === 'consent'
              ? admin
                ? module === 'institution' ? <InstitutionModule api={loaded.api} onFailure={onFailure} />
                  : module === 'memory' ? <MemoryModule api={loaded.api} onFailure={onFailure} />
                    : module === 'audit' ? <AuditModule api={loaded.api} onFailure={onFailure} />
                      : module === 'retention' ? <><RetentionPolicyModule api={loaded.retentionPolicy} onFailure={onFailure} /><RetentionModule api={loaded.api} onFailure={onFailure} /></>
                        : module === 'consent' ? <ConsentSettingsModule />
                          : <ProgramsModule api={loaded.programs} onFailure={onFailure} />
                : <WireCard><WireError>이 설정은 기관 관리자만 사용할 수 있습니다.</WireError></WireCard>
              : <WireCard><WireError>요청한 설정 화면이 없습니다. 설정 메뉴에서 선택해 주세요.</WireError></WireCard>}
        </div>
      </div>
    </>}
  </>;
}

function BusinessSession({ installation, auth }: BusinessRuntime) {
  const snapshot = useSyncExternalStore(auth.subscribe, auth.getSnapshot, auth.getSnapshot);
  const [route, setRoute] = useState(() => `${window.location.pathname}${window.location.search}`);
  useEffect(() => {
    const changed = () => setRoute(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') auth.recordActivity(); };
    window.addEventListener('pointerdown', auth.recordActivity, { passive: true });
    window.addEventListener('keydown', auth.recordActivity);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('pointerdown', auth.recordActivity);
      window.removeEventListener('keydown', auth.recordActivity);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [auth]);
  useEffect(() => {
    if (snapshot.phase === 'ready' && window.location.pathname === '/login') {
      window.history.replaceState(null, '', '/settings?module=account');
      setRoute('/settings?module=account');
    }
  }, [snapshot.phase]);
  return <WireLinkProvider renderer={SettingsLink}>
    <GridContainer as="main" className="page-content">
      {snapshot.phase === 'ready'
        ? <SignedInSettings key={snapshot.revision} installation={installation} auth={auth} route={route} />
        : <>
          <div className="page-header"><PageTitle>로그인</PageTitle></div>
          <AuthView key={snapshot.revision} auth={auth} snapshot={snapshot} />
        </>}
    </GridContainer>
  </WireLinkProvider>;
}

export default function BusinessPage() {
  const [loaded, setLoaded] = useState<BusinessRuntime | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  useEffect(() => {
    let live = true;
    void runtime().then((value) => { if (live) setLoaded(value); })
      .catch((cause: unknown) => { if (live) setError(safeError(cause)); });
    return () => { live = false; };
  }, []);
  if (loaded) return <BusinessSession installation={loaded.installation} auth={loaded.auth} />;
  return <GridContainer as="main" className="page-content">
    <div className="page-header"><PageTitle>설치 정보 확인</PageTitle></div>
    <WireCard>
      {error ? <>
        <WireError>{error.message}</WireError>
        <WireButton variant="neutral" onClick={() => window.location.reload()}>페이지 다시 열기</WireButton>
      </> : <WireEmpty live reserve>서명된 설치 정보를 확인하고 있습니다.</WireEmpty>}
    </WireCard>
  </GridContainer>;
}
