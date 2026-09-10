import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useOutletContext } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireChoice, WireEmpty, WireError, WireFormField, WireItem, ParticipantName,
} from '@ccc/wire';
import {
  ROLE_LABELS, type AssignmentCasePage, type AuditLogItem, type DirectoryAccountsPage, type HumanRole,
  type RetentionPolicy, type RetentionReview, type RetentionReasonKind, type SupportCaseAssignee,
} from '../business/api';
import { type BusinessError, safeError } from '../business/errors';
import { AccountModule, InstitutionModule, MemoryModule } from '../business/settings-modules';
import { destinationAt } from '../business/navigation';
import type { Session } from '../business/session';

const RETENTION_STATUS_LABELS: Record<RetentionReview['status'], string> = {
  pending: '검토 대기', retained: '보존', purged: '파기 완료',
};
const RETENTION_REASON_LABELS: Record<RetentionReasonKind, string> = {
  extended_consent: '연장 동의', active_work: '진행 중 업무', legal_requirement: '법적 보존 사유',
};

function useFailure(session: Session) {
  return useCallback((error: BusinessError) => {
    if (error.status === 401) void session.auth.signOut(error);
    else if (error.code === 'mfa_required') session.auth.recheck(true);
  }, [session.auth]);
}

function AuditModule({ session }: { session: Session }) {
  const [items, setItems] = useState<AuditLogItem[] | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.api.getAuditLog({ limit: 20 }).then((page) => {
      if (own === generation.current) setItems(page.items);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.api, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  return <WireCard title="감사 기록">
    <WireCallout tone="info" title="누가 무엇을 열고 바꿨는지만 남습니다">
      상담 내용과 개인정보 값은 이 목록에 실리지 않습니다. 기록은 지울 수 없습니다.
    </WireCallout>
    {error && <><WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div></>}
    {items === null && error === null && <WireEmpty live reserve>최근 감사 기록을 불러오고 있습니다.</WireEmpty>}
    {items !== null && items.length === 0 && <WireEmpty>기록이 없습니다.</WireEmpty>}
    {(items ?? []).map((item) => <WireItem key={item.id}
      title={item.action}
      description={`${item.targetTable}, ${item.createdAt}, 수행자 ${item.actorId}`}
      status={<WireBadge tone="neutral">{item.actorRole}</WireBadge>} />)}
  </WireCard>;
}

function RetentionModule({ session }: { session: Session }) {
  const [reviews, setReviews] = useState<RetentionReview[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { reasonKind: RetentionReasonKind; reason: string; retainUntil: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.api.getRetentionReviews().then((value) => {
      if (own === generation.current) setReviews(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.api, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const decide = async (review: RetentionReview, decision: 'retain' | 'purge') => {
    if (busy) return;
    const draft = drafts[review.beneficiaryId] ?? { reasonKind: 'active_work' as RetentionReasonKind, reason: '', retainUntil: '' };
    setBusy(true);
    setError(null);
    try {
      await session.api.reviewRetention(review.beneficiaryId, decision === 'purge'
        ? { decision: 'purge' }
        : {
          decision: 'retain', reasonKind: draft.reasonKind, reason: draft.reason,
          retainUntil: draft.retainUntil === '' ? '' : new Date(`${draft.retainUntil}T00:00:00.000Z`).toISOString(),
        });
      load();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="개인정보 보존 검토">
    <WireCallout tone="info" title="파기는 서버 설정과 관리자 확인을 모두 요구합니다">
      이 화면은 검토 큐를 보여 주고 결정을 남깁니다. 최종 파기는 서버가 그 두 조건을 확인한 뒤에만 실행합니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {reviews === null && error === null && <WireEmpty live reserve>검토 큐를 불러오고 있습니다.</WireEmpty>}
    {reviews !== null && reviews.length === 0 && <WireEmpty>검토할 항목이 없습니다.</WireEmpty>}
    {(reviews ?? []).map((review) => {
      const draft = drafts[review.beneficiaryId] ?? { reasonKind: 'active_work' as RetentionReasonKind, reason: '', retainUntil: '' };
      return <WireCardSection key={review.beneficiaryId} title={review.beneficiaryId}
        action={<WireBadge tone={review.status === 'pending' ? 'coral' : 'neutral'}>
          {RETENTION_STATUS_LABELS[review.status]}
        </WireBadge>}>
        <WireDataRows>
          <WireDataRow label="아카이브" value={review.archivedAt} />
          <WireDataRow label="검토 기한" value={review.reviewDueAt} />
          <WireDataRow label="보존 상한" value={review.retentionCapDueAt} />
          <WireDataRow label="현재 사유"
            value={review.reasonKind === null ? '없음' : RETENTION_REASON_LABELS[review.reasonKind]} />
        </WireDataRows>
        {review.status === 'pending' && <>
          <WireFormField label="보존 사유 종류" htmlFor={`retention-kind-${review.beneficiaryId}`} control="select">
            <select id={`retention-kind-${review.beneficiaryId}`} value={draft.reasonKind} disabled={busy}
              onChange={(event) => setDrafts({
                ...drafts,
                [review.beneficiaryId]: { ...draft, reasonKind: event.target.value as RetentionReasonKind },
              })}>
              {(Object.keys(RETENTION_REASON_LABELS) as RetentionReasonKind[]).map((kind) => (
                <option key={kind} value={kind}>{RETENTION_REASON_LABELS[kind]}</option>
              ))}
            </select>
          </WireFormField>
          <WireFormField label="보존 사유" htmlFor={`retention-reason-${review.beneficiaryId}`}>
            <input id={`retention-reason-${review.beneficiaryId}`} value={draft.reason} disabled={busy}
              onChange={(event) => setDrafts({
                ...drafts, [review.beneficiaryId]: { ...draft, reason: event.target.value },
              })} />
          </WireFormField>
          <WireFormField label="보존 기한" htmlFor={`retention-until-${review.beneficiaryId}`}
            hint="종결 후 5년 상한을 넘길 수 없습니다">
            <input id={`retention-until-${review.beneficiaryId}`} type="date" value={draft.retainUntil} disabled={busy}
              onChange={(event) => setDrafts({
                ...drafts, [review.beneficiaryId]: { ...draft, retainUntil: event.target.value },
              })} />
          </WireFormField>
          <div className="business-actions">
            <WireButton variant="primary" disabled={busy || draft.reason.trim() === '' || draft.retainUntil === ''}
              onClick={() => { void decide(review, 'retain'); }}>보존</WireButton>
            <WireButton variant="neutral" disabled={busy}
              onClick={() => { void decide(review, 'purge'); }}>파기 요청</WireButton>
          </div>
        </>}
      </WireCardSection>;
    })}
  </WireCard>;
}

/** 사용자와 역할. 역할 묶음 교체와 비활성만 다룬다(D74). 초대 발급은 서버 계약이 바뀌기 전까지 없다. */
function AccountsModule({ session }: { session: Session }) {
  const [page, setPage] = useState<DirectoryAccountsPage | null>(null);
  const [drafts, setDrafts] = useState<Record<string, HumanRole[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.api.getAccounts().then((value) => {
      if (own !== generation.current) return;
      setPage(value);
      setDrafts(Object.fromEntries(value.accounts.map((account) => [account.id, account.roles])));
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.api, session.auth]);

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

  return <WireCard title="사용자와 역할">
    <WireCallout tone="info" title="역할은 겹칠 수 있습니다">
      한 사람이 기관 관리자와 실무자를 함께 가질 수 있습니다. 실제 접근은 역할과 담당 관계의 합으로 서버가 정합니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {page === null && error === null && <WireEmpty live reserve>사용자 목록을 불러오고 있습니다.</WireEmpty>}
    {page !== null && page.accounts.length === 0 && <WireEmpty>등록된 사용자가 없습니다.</WireEmpty>}
    {(page?.accounts ?? []).map((account) => {
      const draft = drafts[account.id] ?? account.roles;
      const changed = [...draft].sort().join(',') !== [...account.roles].sort().join(',');
      return <WireCardSection key={account.id} title={account.name ?? account.email ?? account.id}
        action={<WireBadge tone={account.active ? 'mint' : 'neutral'}>{account.active ? '활성' : '비활성'}</WireBadge>}>
        <WireDataRows>
          <WireDataRow label="이메일" value={account.email ?? '등록되지 않음'} />
          <WireDataRow label="담당 사업 수" value={`${account.assignmentCount}건`} />
          <WireDataRow label="감독 팀" value={account.supervisedTeamIds.length === 0 ? '없음' : account.supervisedTeamIds.join(', ')} />
        </WireDataRows>
        {page?.permissions.canManageRoles === true && account.active && <>
          {(Object.keys(ROLE_LABELS) as HumanRole[]).map((role) => (
            <WireChoice key={role} type="checkbox" label={ROLE_LABELS[role]} checked={draft.includes(role)}
              disabled={busy}
              onChange={(checked) => setDrafts({
                ...drafts,
                [account.id]: checked ? [...draft, role] : draft.filter((entry) => entry !== role),
              })} />
          ))}
          <div className="business-actions">
            <WireButton variant="primary" disabled={busy || !changed || draft.length === 0}
              onClick={() => { void run(() => session.api.saveAccountRoles(account.id, { roles: draft, expectedRoles: account.roles })); }}>
              역할 저장
            </WireButton>
            <WireButton variant="neutral" disabled={busy}
              onClick={() => { void run(() => session.api.deactivateAccount(account.id, '기관 관리자 요청')); }}>
              계정 비활성
            </WireButton>
          </div>
        </>}
      </WireCardSection>;
    })}
  </WireCard>;
}

/** 개인정보 보유기간. 종결 뒤 며칠 지나 아카이브 검토로 넘길지 정한다(D32·D46). */
function RetentionPolicyModule({ session }: { session: Session }) {
  const [policy, setPolicy] = useState<RetentionPolicy | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.api.getRetentionPolicy().then((value) => {
      if (own !== generation.current) return;
      setPolicy(value);
      setDraft(String(value.piiPurgeGraceDays));
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.api, session.auth]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const save = async () => {
    const days = Number(draft);
    if (busy || policy === null || !Number.isSafeInteger(days) || days < 0) return;
    setBusy(true);
    setError(null);
    try {
      setPolicy(await session.api.saveRetentionPolicy({ piiPurgeGraceDays: days, expectedVersion: policy.version }));
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="개인정보 보유기간">
    <WireCallout tone="info" title="이 값은 파기 시점이 아닙니다">
      종결 뒤 이 기간이 지나면 금고 자료가 검토 큐로 넘어갑니다. 최종 파기는 관리자 확인을 다시 받습니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {policy === null && error === null && <WireEmpty live reserve>보유기간을 불러오고 있습니다.</WireEmpty>}
    {policy !== null && <>
      <WireFormField label="종결 뒤 보관 일수" htmlFor="retention-grace" hint="0 이상 정수">
        <input id="retention-grace" inputMode="numeric" value={draft} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} />
      </WireFormField>
      <WireDataRows>
        <WireDataRow label="최근 확인한 값" value={`${policy.piiPurgeGraceDays}일`} />
      </WireDataRows>
      <div className="business-actions">
        <WireButton variant="primary" disabled={busy || draft === String(policy.piiPurgeGraceDays)}
          onClick={() => { void save(); }}>보유기간 저장</WireButton>
        <WireButton variant="neutral" disabled={busy} onClick={load}>최신 값 확인</WireButton>
      </div>
    </>}
  </WireCard>;
}

const ASSIGNEE_STATUS_LABELS: Record<SupportCaseAssignee['status'], string> = {
  requested: '요청 중', active: '담당 중', ended: '종료',
};

/** 담당 배정 요청 승인·이관·반려(D86 6). 요청 발신은 당사자 허브에 있고 여기서는 결정만 한다. */
function AssignmentsModule({ session }: { session: Session }) {
  const [page, setPage] = useState<AssignmentCasePage | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<SupportCaseAssignee[] | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const fail = useCallback((cause: unknown) => {
    const safe = safeError(cause);
    if (safe.code === 'session_changed') return;
    setError(safe);
    if (safe.status === 401) void session.auth.signOut(safe);
  }, [session.auth]);

  const loadCases = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.api.getAssignmentCases().then((value) => {
      if (own === generation.current) setPage(value);
    }).catch((cause: unknown) => { if (own === generation.current) fail(cause); });
  }, [session.api, fail]);

  const loadAssignees = useCallback((supportCaseId: string) => {
    const own = ++generation.current;
    setAssignees(null);
    void session.api.getCaseAssignees(supportCaseId).then((value) => {
      if (own === generation.current) setAssignees(value);
    }).catch((cause: unknown) => { if (own === generation.current) fail(cause); });
  }, [session.api, fail]);

  useEffect(() => {
    loadCases();
    return () => { generation.current += 1; };
  }, [loadCases]);

  const review = async (supportCaseId: string, assignmentId: string,
    input: { decision: 'coassign' | 'transfer' } | { decision: 'reject'; reason: string }) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.participants.reviewAssignmentRequest(supportCaseId, assignmentId, input);
      setRejectReason('');
      loadAssignees(supportCaseId);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="담당 배정 요청">
    <WireCallout tone="info" title="승인은 공동 담당이나 이관 중 하나입니다">
      실무자가 보낸 요청을 여기서 결정합니다. 승인 전에는 상담 내용과 개인정보가 그 실무자에게 열리지 않습니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {page === null && error === null && <WireEmpty live reserve>케이스 목록을 불러오고 있습니다.</WireEmpty>}
    {page !== null && page.items.length === 0 && <WireEmpty>기관에 등록된 케이스가 없습니다.</WireEmpty>}
    {(page?.items ?? []).map((item) => <WireCardSection key={item.supportCaseId}
      title={<ParticipantName name={item.name} beneficiaryId={item.beneficiaryId} />}
      action={<WireButton variant="neutral" disabled={busy}
        onClick={() => {
          const next = open === item.supportCaseId ? null : item.supportCaseId;
          setOpen(next);
          if (next !== null) loadAssignees(next);
        }}>
        {open === item.supportCaseId ? '접기' : '담당 보기'}
      </WireButton>}>
      <WireDataRows>
        <WireDataRow label="사업" value={item.programName} />
        <WireDataRow label="상태" value={item.status === 'active' ? '진행 중' : '종결'} />
      </WireDataRows>
      {open === item.supportCaseId && assignees === null && <WireEmpty live reserve>담당 목록을 불러오고 있습니다.</WireEmpty>}
      {open === item.supportCaseId && assignees !== null && assignees.length === 0
        && <WireEmpty>담당 실무자가 없습니다.</WireEmpty>}
      {open === item.supportCaseId && (assignees ?? []).map((assignee) => <WireItem key={assignee.id}
        title={assignee.userId}
        description={`${assignee.role === 'primary' ? '주 담당' : '공동 담당'}, ${assignee.assignedAt}${
          assignee.transferReason === null ? '' : `, 사유: ${assignee.transferReason}`}`}
        status={<WireBadge tone={assignee.status === 'active' ? 'mint' : assignee.status === 'requested' ? 'lavender' : 'neutral'}>
          {ASSIGNEE_STATUS_LABELS[assignee.status]}
        </WireBadge>}
        action={assignee.status === 'requested' ? <>
          <WireButton variant="primary" disabled={busy}
            onClick={() => { void review(item.supportCaseId, assignee.id, { decision: 'coassign' }); }}>공동 담당</WireButton>
          <WireButton variant="neutral" disabled={busy}
            onClick={() => { void review(item.supportCaseId, assignee.id, { decision: 'transfer' }); }}>이관</WireButton>
          <WireButton variant="neutral" disabled={busy || rejectReason.trim() === ''}
            onClick={() => { void review(item.supportCaseId, assignee.id, { decision: 'reject', reason: rejectReason }); }}>반려</WireButton>
        </> : undefined} />)}
      {open === item.supportCaseId && (assignees ?? []).some((assignee) => assignee.status === 'requested')
        && <WireFormField label="반려 사유" htmlFor={`reject-${item.supportCaseId}`} hint="반려할 때만 필요합니다">
          <input id={`reject-${item.supportCaseId}`} value={rejectReason} disabled={busy}
            onChange={(event) => setRejectReason(event.target.value)} />
        </WireFormField>}
    </WireCardSection>)}
  </WireCard>;
}

export function SettingsScreen() {
  const session = useOutletContext<Session>();
  const location = useLocation();
  const onFailure = useFailure(session);
  const destination = destinationAt(location.pathname, location.search);

  if (destination?.id === 'system') {
    const cap = session.capabilities;
    return <WireCard title="서버가 확인한 연결 상태">
      <WireDataRows>
        <WireDataRow label="설치 방식" value={cap.mode} />
        <WireDataRow label="음성 인식" value={cap.sttMode === 'off' ? '꺼짐' : cap.sttMode} />
        <WireDataRow label="지정된 엔진" value={cap.sttEngine ?? '승인된 엔진 없음'} />
        <WireDataRow label="AI 처리" value={cap.llmMode === 'off' ? '꺼짐' : cap.llmMode} />
        <WireDataRow label="처리 장비" value={cap.agentStatus} />
      </WireDataRows>
      <WireCallout tone="info" title="확인 범위">
        서버가 응답한 설치 값입니다. 실제 인증, 장비 준비나 제품 활성화가 모두 완료됐다는 뜻은 아닙니다.
      </WireCallout>
      <div className="business-actions">
        <WireButton variant="neutral" onClick={() => session.auth.recheck()}>상태 다시 확인</WireButton>
      </div>
    </WireCard>;
  }
  if (destination?.id === 'institution-profile') return <InstitutionModule api={session.api} onFailure={onFailure} />;
  if (destination?.id === 'memory') return <MemoryModule api={session.api} onFailure={onFailure} />;
  if (destination?.id === 'audit') return <AuditModule session={session} />;
  if (destination?.id === 'accounts') return <AccountsModule session={session} />;
  if (destination?.id === 'assignments') return <AssignmentsModule session={session} />;
  if (destination?.id === 'retention-policy') return <RetentionPolicyModule session={session} />;
  if (destination?.id === 'retention') return <RetentionModule session={session} />;
  return <AccountModule me={session.me} api={session.api} onFailure={onFailure} />;
}
