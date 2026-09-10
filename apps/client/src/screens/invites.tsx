import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/wire';
import type { ConsentDisclosureSnapshot } from '@ccc/contracts/consent';
import type { ProgramOption } from '../business/participants';
import {
  ConsentDecisionList, allDomainsDecided, consentEventsFrom, type ConsentDecisions,
} from '../business/consent-decisions';
import { type BusinessError, safeError } from '../business/errors';
import {
  INVITE_ROLE_BY_HUMAN, INVITE_ROLE_LABELS, INVITE_STATUS_LABELS,
  type InviteStoredRole, type RequestLinkInfo, type StaffInvite, type StaffInvitePublicInfo,
} from '../business/invites';
import { ADMISSION_LABELS } from './participants';
import type { PublicSession, Session } from '../business/session';

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

/** 실무자 초대(D86 ③). 이메일 하나에 묶인 1회용이고 익명 발급은 없다. */
export function StaffInviteScreen() {
  const session = useOutletContext<Session>();
  const [invites, setInvites] = useState<StaffInvite[] | null>(null);
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<InviteStoredRole[]>([]);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);
  const admin = session.me.roles.includes('institution-admin');

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
    <WireCallout tone="info" title="이메일 하나에 묶인 1회용 초대입니다">
      {admin
        ? '기관 관리자는 줄 역할을 반드시 고릅니다. 링크는 한 번만 쓸 수 있고 서버가 정한 기한이 지나면 만료됩니다.'
        : '기술 관리자가 만든 초대는 역할 대기 상태로 가입합니다. 업무 역할은 기관 관리자가 나중에 정합니다.'}
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {issued !== null && <IssuedLink label="초대 링크" href={issued} />}
    <form className="business-form" onSubmit={(event) => {
      event.preventDefault();
      void run(async () => {
        const created = await session.invites.create(email, roles);
        setIssued(`${window.location.origin}/staff/join#t=${created.token}`);
        setEmail('');
        setRoles([]);
      });
    }}>
      <WireFormField label="초대할 이메일" htmlFor="invite-email" required hint="이 이메일로만 가입할 수 있습니다">
        <input id="invite-email" type="email" value={email} required disabled={busy}
          onChange={(event) => setEmail(event.target.value)} />
      </WireFormField>
      {admin && (Object.keys(INVITE_ROLE_BY_HUMAN) as (keyof typeof INVITE_ROLE_BY_HUMAN)[]).map((role) => {
        const stored = INVITE_ROLE_BY_HUMAN[role];
        return <WireChoice key={stored} type="checkbox" label={INVITE_ROLE_LABELS[stored]}
          checked={roles.includes(stored)} disabled={busy}
          onChange={(checked) => setRoles(checked ? [...roles, stored] : roles.filter((entry) => entry !== stored))} />;
      })}
      <div className="business-actions">
        <WireButton type="submit" variant="primary"
          disabled={busy || email.trim() === '' || (admin && roles.length === 0)}>초대 만들기</WireButton>
      </div>
    </form>
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

/** 실무자 초대 수락(공개). 업무 셸도 Bearer 도 쓰지 않는다. */
export function StaffJoinScreen() {
  const session = useOutletContext<PublicSession>();
  const { token, nonce } = useFragmentToken();
  const [info, setInfo] = useState<StaffInvitePublicInfo | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<{ roleWaiting: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);

  useEffect(() => {
    if (token === null) return;
    setDone(null);
    setError(null);
    void session.publicJoin.staffInvite(token).then(setInfo).catch((cause: unknown) => setError(safeError(cause)));
  }, [token, nonce, session.publicJoin]);

  if (token === null) {
    return <WireCard title="실무자 초대"><WireEmpty>초대 링크가 아닙니다.</WireEmpty></WireCard>;
  }
  if (done !== null) {
    return <WireCard title="가입 완료">
      <WireCallout tone="info" title={done.roleWaiting ? '역할 배정을 기다립니다' : '가입이 끝났습니다'}>
        {done.roleWaiting
          ? '기관 관리자가 업무 역할을 정하기 전까지 업무 화면은 열리지 않습니다.'
          : '이제 기관 계정으로 로그인할 수 있습니다.'}
      </WireCallout>
      <div className="business-actions"><WireButton variant="primary" href="/settings">로그인하기</WireButton></div>
    </WireCard>;
  }
  return <WireCard title="실무자 초대">
    {error && <WireError>{error.message}</WireError>}
    {info === null && error === null && <WireEmpty live reserve>초대를 확인하고 있습니다.</WireEmpty>}
    {info !== null && <>
      <WireDataRows>
        <WireDataRow label="기관" value={info.orgName ?? '이름 없음'} />
        <WireDataRow label="받을 역할"
          value={info.roles.length === 0 ? '역할 대기' : info.roles.map((role) => INVITE_ROLE_LABELS[role]).join(', ')} />
        <WireDataRow label="만료" value={info.expiresAt} />
      </WireDataRows>
      <form className="business-form" onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        void session.publicJoin.acceptStaffInvite(token, { name, email })
          .then((result) => setDone({ roleWaiting: result.roleWaiting }))
          .catch((cause: unknown) => setError(safeError(cause)))
          .finally(() => setBusy(false));
      }}>
        <WireFormField label="이름" htmlFor="staff-join-name" required>
          <input id="staff-join-name" value={name} required disabled={busy}
            onChange={(event) => setName(event.target.value)} />
        </WireFormField>
        <WireFormField label="이메일" htmlFor="staff-join-email" required hint="초대받은 이메일과 같아야 합니다">
          <input id="staff-join-email" type="email" value={email} required disabled={busy}
            onChange={(event) => setEmail(event.target.value)} />
        </WireFormField>
        <div className="business-actions">
          <WireButton type="submit" variant="primary"
            disabled={busy || name.trim() === '' || email.trim() === ''}>초대 수락</WireButton>
        </div>
      </form>
    </>}
  </WireCard>;
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
