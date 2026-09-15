import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import {
  GridContainer, PageTitle, WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/wire';
import type { ConsentDisclosureSnapshot } from '@ccc/contracts/consent';
import type { ProgramOption } from '../business/participants';
import {
  ConsentDecisionList, allDomainsDecided, consentEventsFrom, type ConsentDecisions,
} from '../business/consent-decisions';
import { BusinessError, safeError } from '../business/errors';
import {
  INVITE_ROLE_LABELS, INVITE_STATUS_LABELS, type RequestLinkInfo, type StaffInvite,
} from '../business/invites';
import { ADMISSION_LABELS } from './participants';
import type { PublicSession, Session } from '../business/session';
import { firstAdminInviteBootstrap, type CloudAuth, type InviteFailureCode, type InviteCompletionResult } from '../business/auth';

/** 링크는 한 번만 보여 준다. 서버는 토큰 원문을 다시 주지 않는다. */
function IssuedLink({ label, href }: { label: string; href: string }) {
  const [copied, setCopied] = useState(false);
  return <WireCallout tone="info" title={`${label}를 한 번만 보여 줍니다`}>
    <p className="wire-section-value">{href}</p>
    <div className="business-actions">
      <WireButton variant="neutral" onClick={() => {
        void navigator.clipboard.writeText(href).then(() => setCopied(true)).catch(() => setCopied(false));
      }}>주소 복사</WireButton>
    </div>
    {copied && <p className="wire-section-value">복사했습니다. 이 창을 닫으면 다시 볼 수 없습니다.</p>}
  </WireCallout>;
}

/** 기존 실무자 초대의 목록과 취소만 제공한다. */
export function StaffInviteScreen() {
  const session = useOutletContext<Session>();
  const [invites, setInvites] = useState<StaffInvite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.invites.list().then((value) => {
      if (own === generation.current) setInvites(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.invites, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      load();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="실무자 초대">
    <WireCallout tone="info" title="새 실무자 초대는 준비 중입니다">
      새 초대를 만들거나 수락하는 기능은 아직 열리지 않았습니다. 기존에 보낸 초대는 확인하거나 취소할 수 있습니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {invites === null && error === null && <WireEmpty live reserve>초대 목록을 불러오고 있습니다.</WireEmpty>}
    {invites !== null && invites.length === 0 && <WireEmpty>보낸 초대가 없습니다.</WireEmpty>}
    {(invites ?? []).map((invite) => <WireItem key={invite.id} title={invite.email}
      description={`${invite.roles.map((role) => INVITE_ROLE_LABELS[role]).join(', ') || '역할 대기'}, 만료 ${invite.expiresAt}`}
      status={<WireBadge tone={invite.status === 'issued' ? 'mint' : 'neutral'}>
        {INVITE_STATUS_LABELS[invite.status]}
      </WireBadge>}
      action={invite.status === 'issued'
        ? <WireButton variant="neutral" disabled={busy}
          onClick={() => { void run(() => session.invites.revoke(invite.id)); }}>취소</WireButton>
        : undefined} />)}
  </WireCard>;
}

/** 당사자 요청 링크 발급(D86 ④). 목적 하나, 만료는 서버가 정한다. */
export function ParticipantInviteScreen() {
  const session = useOutletContext<Session>();
  // 설치가 공개 가입 표면을 닫아 두면 발급이 서버에서 404 다. 주소로 직접 들어와도 같은 사실을 알린다.
  const publicSignup = session.capabilities.features.public_signup === true;
  const [options, setOptions] = useState<ProgramOption[] | null>(null);
  const [programId, setProgramId] = useState('');
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const own = ++generation.current;
    void session.participants.programOptions().then((value) => {
      if (own === generation.current) setOptions(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
    return () => { generation.current += 1; };
  }, [session.participants, session.auth]);

  const ready = (options ?? []).filter((option) => option.admissionState === 'ready');
  const locked = (options ?? []).filter((option) => option.admissionState !== 'ready');

  if (!publicSignup) {
    return <WireCard title="당사자 초대">
      <WireCallout tone="info" title="이 설치는 요청 링크를 쓰지 않습니다">
        당사자 요청 링크가 꺼져 있어 링크를 만들 수 없습니다. 당사자 등록 화면에서 직접 등록해 주세요.
      </WireCallout>
      <div className="business-actions">
        <WireButton variant="neutral" href="/participants/new">당사자 등록</WireButton>
      </div>
    </WireCard>;
  }

  return <WireCard title="당사자 초대">
    <WireCallout tone="info" title="링크 하나에 목적 하나입니다">
      링크는 한 번만 쓸 수 있고 서버가 정한 기한이 지나면 만료됩니다. 링크를 어디로 보낼지는 기관이 정합니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {issued !== null && <IssuedLink label="요청 링크" href={issued} />}
    {options === null && error === null && <WireEmpty live reserve>사업 목록을 불러오고 있습니다.</WireEmpty>}
    {locked.length > 0 && <WireCallout tone="info" title="지금 고를 수 없는 사업">
      {locked.map((option) => `${option.displayName ?? option.id}: ${ADMISSION_LABELS[option.admissionState]}`).join(' / ')}
    </WireCallout>}
    <form className="business-form" onSubmit={(event) => {
      event.preventDefault();
      if (busy || programId === '') return;
      setBusy(true);
      setError(null);
      void session.invites.createRequestLink(programId).then((created) => {
        setIssued(`${window.location.origin}/join#t=${created.token}`);
      }).catch((cause: unknown) => {
        const safe = safeError(cause);
        setError(safe);
        if (safe.status === 401) void session.auth.signOut(safe);
      }).finally(() => setBusy(false));
    }}>
      <WireFormField label="참여 사업" htmlFor="request-link-program" control="select" required>
        <select id="request-link-program" value={programId} required disabled={busy}
          onChange={(event) => setProgramId(event.target.value)}>
          <option value="">사업을 고르세요</option>
          {ready.map((option) => <option key={option.id} value={option.id}>{option.displayName ?? option.id}</option>)}
        </select>
      </WireFormField>
      <div className="business-actions">
        <WireButton type="submit" variant="primary" disabled={busy || programId === ''}>요청 링크 만들기</WireButton>
      </div>
    </form>
  </WireCard>;
}

/**
 * 조각에서 토큰을 읽고 주소에서 지운다(S2 §2.10). 토큰은 기록에 남지 않는다.
 *
 * `nonce` 는 링크를 다시 열 때마다 오른다. 같은 토큰으로 다시 들어오면 브라우저가 문서를 새로
 * 읽지 않고 조각만 바꾸므로, 이 값이 없으면 앞선 제출 완료 화면이 그대로 남는다.
 */
function useFragmentToken(): { token: string | null; nonce: number } {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState<{ token: string | null; nonce: number }>({ token: null, nonce: 0 });
  useEffect(() => {
    const raw = location.hash.startsWith('#t=') ? location.hash.slice(3) : '';
    if (raw === '') return;
    setState((current) => ({ token: raw, nonce: current.nonce + 1 }));
    void navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true });
  }, [location.hash, location.pathname, location.search, navigate]);
  return state;
}

/** 옛 실무자 링크는 URL 정리 뒤 설치 정보나 Auth를 요청하지 않는다. */
export function StaffJoinScreen() {
  return <GridContainer as="main" className="page-content">
    <PageTitle>실무자 초대</PageTitle>
    <WireCard>
      <WireCallout tone="info" title="실무자 초대 수락은 준비 중입니다">
        이 링크로 계정을 만들거나 초대를 수락할 수 없습니다. 기관 관리자에게 문의해 주세요.
      </WireCallout>
    </WireCard>
  </GridContainer>;
}

type InviteScreenState =
  | { phase: 'entry'; error: null | 'invalid_request' | 'password_mismatch' | 'invite_invalid' | 'provider_unavailable' }
  | { phase: 'submitting' }
  | { phase: 'password'; error: 'password_rejected' | 'provider_unavailable' }
  | { phase: 'failure'; code: 'invite_invalid' | 'invite_expired' | 'invite_session_conflict' | 'provider_unavailable' }
  | { phase: 'complete' };
const INVITE_FAILURE_COPY: Record<InviteFailureCode, string> = {
  invite_invalid: '초대 정보를 확인할 수 없습니다. 처음 받은 초대 이메일의 링크와 인증 코드를 확인해 주세요.',
  invite_expired: '초대가 만료됐습니다. 설치 담당자에게 새 초대 이메일을 요청해 주세요.',
  invite_session_conflict: '다른 계정의 로그인이 남아 있습니다. 다른 계정의 작업을 마치고 로그아웃한 뒤 초대 이메일의 링크를 다시 열어 주세요.',
  password_rejected: '비밀번호를 설정하지 못했습니다. 여덟 자 이상의 새 비밀번호를 두 칸에 같게 입력해 주세요.',
  provider_unavailable: '인증 서비스의 응답을 확인하지 못했습니다. 입력한 값은 저장하지 않습니다. 다시 입력해 주세요.',
};

/** 입력값은 제출 순간에만 읽고 Auth에는 값 없는 상태 결과만 돌려받는다. */
export function FirstAdminInviteScreen() {
  const { auth } = useOutletContext<{ auth: CloudAuth }>();
  const [state, setState] = useState<InviteScreenState>(() => firstAdminInviteBootstrap() === 'entry'
    ? { phase: 'entry', error: null } : { phase: 'failure', code: 'invite_invalid' });
  const submitting = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => { if (!mounted.current) void auth.cancelFirstAdminInvite(); });
    };
  }, [auth]);
  const finish = (result: InviteCompletionResult) => {
    submitting.current = false;
    if (!mounted.current) return;
    if (result.status === 'complete') setState({ phase: 'complete' });
    else if (result.retry === 'entry' && (result.code === 'invite_invalid' || result.code === 'provider_unavailable')) {
      setState({ phase: 'entry', error: result.code });
    } else if (result.retry === 'password' && (result.code === 'password_rejected' || result.code === 'provider_unavailable')) {
      setState({ phase: 'password', error: result.code });
    } else {
      setState({ phase: 'failure', code: result.code === 'password_rejected' ? 'provider_unavailable' : result.code });
    }
  };
  const error = state.phase === 'failure' ? state.code : state.phase === 'entry' || state.phase === 'password' ? state.error : null;
  const errorCopy = error === 'invalid_request' || error === 'password_mismatch'
    ? new BusinessError(error, 400).message : error ? INVITE_FAILURE_COPY[error] : null;
  return <GridContainer as="main" className="page-content">
    <PageTitle>관리자 초대</PageTitle>
    <WireCard title={state.phase === 'complete' ? '비밀번호 설정 완료' : '관리자 계정 설정'}>
      {errorCopy && <WireError>{errorCopy}</WireError>}
      {state.phase === 'submitting' && <WireEmpty live reserve>초대 확인과 비밀번호 설정을 진행하고 있습니다.</WireEmpty>}
      {state.phase === 'complete' && <>
        <WireCallout tone="info" title="설치 담당자의 연결 완료를 기다려 주세요">
          비밀번호를 설정하고 초대용 로그인을 종료했습니다. 아직 업무 계정 연결이 끝난 것은 아닙니다.
          설치 담당자가 관리자 연결을 마쳤다고 알리면 로그인 화면에서 새 비밀번호로 로그인해 주세요.
        </WireCallout>
        <div className="business-actions">
          <WireButton variant="neutral" href="/login">연결 완료 안내를 받은 뒤 로그인</WireButton>
        </div>
      </>}
      {(state.phase === 'entry' || state.phase === 'password') && <form className="business-form" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current) return;
        const values = new FormData(event.currentTarget);
        let email = String(values.get('email') ?? '').trim().toLowerCase();
        let code = String(values.get('code') ?? '');
        let password = String(values.get('password') ?? '');
        let confirmation = String(values.get('passwordConfirm') ?? '');
        const passwordOnly = state.phase === 'password';
        const valid = password.length >= 8 && (passwordOnly || email.length <= 254
          && /^[^\s@;,'"\\]{1,64}@[A-Za-z0-9][A-Za-z0-9.-]{0,180}\.[A-Za-z]{2,24}$/u.test(email) && /^[0-9]{6}$/.test(code));
        const matches = password === confirmation;
        for (const name of ['email', 'code', 'password', 'passwordConfirm']) values.delete(name);
        event.currentTarget.reset();
        confirmation = '';
        if (!valid || !matches) {
          email = ''; code = ''; password = '';
          setState(passwordOnly ? { phase: 'password', error: 'password_rejected' }
            : { phase: 'entry', error: valid ? 'password_mismatch' : 'invalid_request' });
          return;
        }
        submitting.current = true;
        setState({ phase: 'submitting' });
        const pending = passwordOnly ? auth.retryFirstAdminPassword(password) : auth.completeFirstAdminInvite(email, code, password);
        email = ''; code = ''; password = '';
        void pending.then(finish);
      }}>
        {state.phase === 'entry' && <>
          <WireFormField label="초대받은 이메일" htmlFor="first-admin-email" required>
            <input id="first-admin-email" name="email" type="email" required maxLength={254} autoComplete="email" />
          </WireFormField>
          <WireFormField label="여섯 자리 인증 코드" htmlFor="first-admin-code" required hint="초대 이메일에 적힌 숫자 여섯 자리를 입력해 주세요">
            <input id="first-admin-code" name="code" type="text" required minLength={6} maxLength={6}
              pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" />
          </WireFormField>
        </>}
        <WireFormField label="새 비밀번호" htmlFor="first-admin-password" required hint="여덟 자 이상으로 정해 주세요">
          <input id="first-admin-password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </WireFormField>
        <WireFormField label="새 비밀번호 확인" htmlFor="first-admin-password-confirm" required>
          <input id="first-admin-password-confirm" name="passwordConfirm" type="password" autoComplete="new-password" minLength={8} required />
        </WireFormField>
        <div className="business-actions">
          <WireButton type="submit" variant="primary">{state.phase === 'password' ? '비밀번호 다시 설정' : '초대 확인하고 비밀번호 설정'}</WireButton>
        </div>
      </form>}
    </WireCard>
  </GridContainer>;
}

/** 당사자 요청 링크 완료(공개). 여섯 영역 동의를 여기서 받는다. */
export function ParticipantJoinScreen() {
  const session = useOutletContext<PublicSession>();
  const { token, nonce } = useFragmentToken();
  const [info, setInfo] = useState<RequestLinkInfo | null>(null);
  const [disclosures, setDisclosures] = useState<ConsentDisclosureSnapshot[]>([]);
  const [decisions, setDecisions] = useState<ConsentDecisions>({});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);

  useEffect(() => {
    if (token === null) return;
    // 링크를 다시 열 때마다 제출 완료 상태를 지운다. 이미 쓴 링크를 방금 접수한 것처럼 보이면 안 된다.
    setDone(false);
    setError(null);
    void session.publicJoin.requestLink(token).then((value) => {
      setInfo(value);
      if (value.status !== 'issued') { setDisclosures([]); return; }
      return session.publicJoin.requestLinkDisclosures(token).then(setDisclosures);
    }).catch((cause: unknown) => setError(safeError(cause)));
  }, [token, nonce, session.publicJoin]);

  if (token === null) return <WireCard title="당사자 등록"><WireEmpty>요청 링크가 아닙니다.</WireEmpty></WireCard>;
  if (done) {
    return <WireCard title="등록 완료">
      <WireCallout tone="info" title="접수했습니다">
        담당 실무자가 확인한 뒤 연락합니다. 이 링크는 다시 쓸 수 없습니다.
      </WireCallout>
    </WireCard>;
  }
  return <WireCard title="당사자 등록">
    {error && <WireError>{error.message}</WireError>}
    {info === null && error === null && <WireEmpty live reserve>요청 링크를 확인하고 있습니다.</WireEmpty>}
    {info?.status === 'used' && <WireCallout tone="info" title="이미 사용한 링크입니다">
      {/* 문구는 서버가 준 그대로 쓰고, 담당 이름이 있으면 한 줄 덧붙인다. 접수 완료 화면과 다른 자리다. */}
      <p className="wire-section-value">{info.message}</p>
      {info.counselorName !== null && <p className="wire-section-value">
        {`담당 실무자: ${info.counselorName}`}
      </p>}
    </WireCallout>}
    {info?.status === 'issued' && <>
      <WireDataRows>
        <WireDataRow label="기관" value={info.orgName ?? '이름 없음'} />
        <WireDataRow label="만료" value={info.expiresAt} />
      </WireDataRows>
      <form className="business-form" onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        void session.publicJoin.completeSignup({
          token, name, phone, email, consentEvents: consentEventsFrom(disclosures, decisions),
        }).then(() => setDone(true))
          .catch((cause: unknown) => setError(safeError(cause)))
          .finally(() => setBusy(false));
      }}>
        <WireFormField label="이름" htmlFor="join-name" required>
          <input id="join-name" value={name} required disabled={busy}
            onChange={(event) => setName(event.target.value)} />
        </WireFormField>
        <WireFormField label="연락처" htmlFor="join-phone">
          <input id="join-phone" inputMode="tel" value={phone} disabled={busy}
            onChange={(event) => setPhone(event.target.value)} />
        </WireFormField>
        <WireFormField label="이메일" htmlFor="join-email">
          <input id="join-email" type="email" value={email} disabled={busy}
            onChange={(event) => setEmail(event.target.value)} />
        </WireFormField>
        <ConsentDecisionList disclosures={disclosures} decisions={decisions} disabled={busy} onChange={setDecisions} />
        <div className="business-actions">
          <WireButton type="submit" variant="primary"
            disabled={busy || name.trim() === '' || !allDomainsDecided(disclosures, decisions)}>등록 보내기</WireButton>
        </div>
      </form>
    </>}
  </WireCard>;
}
