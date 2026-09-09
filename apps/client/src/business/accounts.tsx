import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Icon, WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice,
  WireDataRow, WireDataRows, WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/web/wire';
import { BusinessError, safeError } from './errors';
import { BusinessTransport } from './transport';
import { decodeSettingsCaseOptions, type SettingsCaseOptions } from './case-options';

export type DirectoryRole = 'institution-admin' | 'technical-admin' | 'supervisor' | 'worker';
export const DIRECTORY_ROLE_LABELS: Record<DirectoryRole, string> = {
  'institution-admin': '기관 관리자',
  'technical-admin': '기관 기술 관리자',
  supervisor: '실무 책임자',
  worker: '실무자',
};
const EDITABLE_ROLES: readonly DirectoryRole[] = ['institution-admin', 'technical-admin', 'worker'];

export interface AccountView {
  id: string;
  email: string | null;
  name: string | null;
  active: boolean;
  roles: DirectoryRole[];
  supervisedTeamIds: string[];
  assignmentCount: number;
}

export interface AccountPermissions {
  canManageRoles: boolean;
  canManageAccounts: boolean;
}

export interface AccountDirectory {
  accounts: AccountView[];
  permissions: AccountPermissions;
  nextCursor: string | null;
}

export interface AccountAssignment {
  beneficiaryId: string;
  supportCaseId: string;
  programType: 'financial_support_v1';
  status: 'active' | 'closed';
  assignmentRole: 'primary' | 'secondary';
  participantName: string | null;
  participantPhone: string | null;
}
export interface SupportCaseAssignment {
  id: string;
  supportCaseId: string;
  userId: string;
  role: 'primary' | 'secondary';
  status: 'requested' | 'active' | 'ended';
  assignedAt: string;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_response');
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new BusinessError('invalid_response');
  return value;
}
function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return string(value, field);
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new BusinessError('invalid_response');
  return value;
}
function role(value: unknown): DirectoryRole {
  if (value === 'institution-admin' || value === 'technical-admin' || value === 'supervisor' || value === 'worker') return value;
  throw new BusinessError('invalid_response');
}
function roles(value: unknown): DirectoryRole[] {
  if (!Array.isArray(value)) throw new BusinessError('invalid_response');
  const result = value.map(role);
  if (new Set(result).size !== result.length) throw new BusinessError('invalid_response');
  return result;
}
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0 || entry.length > 200)) {
    throw new BusinessError('invalid_response');
  }
  return [...value];
}
function nonnegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new BusinessError('invalid_response');
  return value;
}
function decodeAccount(value: unknown): AccountView {
  const row = object(value);
  return {
    id: string(row.id, 'id'),
    email: nullableString(row.email, 'email'),
    name: nullableString(row.name, 'name'),
    active: boolean(row.active, 'active'),
    roles: roles(row.roles),
    supervisedTeamIds: stringArray(row.supervisedTeamIds),
    assignmentCount: nonnegativeInteger(row.assignmentCount),
  };
}
function decodePermissions(value: unknown): AccountPermissions {
  const row = object(value);
  return { canManageRoles: boolean(row.canManageRoles, 'canManageRoles'), canManageAccounts: boolean(row.canManageAccounts, 'canManageAccounts') };
}
function decodeDirectory(value: unknown): AccountDirectory {
  const row = object(value);
  if (!Array.isArray(row.accounts) || row.accounts.length > 100
    || !(row.nextCursor === null || typeof row.nextCursor === 'string')) throw new BusinessError('invalid_response');
  return { accounts: row.accounts.map(decodeAccount), permissions: decodePermissions(row.permissions),
    nextCursor: nullableString(row.nextCursor, 'nextCursor') };
}
function decodeAssignment(value: unknown): AccountAssignment {
  const row = object(value);
  const programType = row.programType;
  if (programType !== 'financial_support_v1') throw new BusinessError('invalid_response');
  const status = row.status;
  if (status !== 'active' && status !== 'closed') throw new BusinessError('invalid_response');
  const assignmentRole = row.assignmentRole;
  if (assignmentRole !== 'primary' && assignmentRole !== 'secondary') throw new BusinessError('invalid_response');
  return {
    beneficiaryId: string(row.beneficiaryId, 'beneficiaryId'),
    supportCaseId: string(row.supportCaseId, 'supportCaseId'),
    programType,
    status,
    assignmentRole,
    participantName: nullableString(row.participantName, 'participantName'),
    participantPhone: nullableString(row.participantPhone, 'participantPhone'),
  };
}

function decodeSupportCaseAssignment(value: unknown): SupportCaseAssignment {
  const row = object(value);
  const assignmentRole = row.role;
  const status = row.status;
  if ((assignmentRole !== 'primary' && assignmentRole !== 'secondary') || (status !== 'requested' && status !== 'active' && status !== 'ended')) throw new BusinessError('invalid_response');
  return {
    id: string(row.id, 'id'),
    supportCaseId: string(row.supportCaseId, 'supportCaseId'),
    userId: string(row.userId, 'userId'),
    role: assignmentRole,
    status,
    assignedAt: string(row.assignedAt, 'assignedAt'),
  };
}
export class AccountsApi {
  constructor(private readonly transport: BusinessTransport) {}

  async directory(cursor?: string): Promise<AccountDirectory> {
    return decodeDirectory(await this.transport.request(`/settings/accounts${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`));
  }

  async cases(cursor?: string): Promise<SettingsCaseOptions> {
    return decodeSettingsCaseOptions(await this.transport.request(`/settings/assignments/cases${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`));
  }

  async updateRoles(userId: string, rolesToSave: DirectoryRole[], expectedRoles: DirectoryRole[]): Promise<AccountView> {
    return decodeAccount(await this.transport.request(`/settings/accounts/${encodeURIComponent(userId)}/roles`, 'PATCH', {
      roles: rolesToSave,
      expectedRoles,
    }));
  }

  async deactivate(userId: string, reason: string): Promise<AccountView> {
    return decodeAccount(await this.transport.request(`/settings/accounts/${encodeURIComponent(userId)}/deactivate`, 'POST', { reason }));
  }

  /** Existing canonical support-case assignment read; this endpoint never changes assignment state. */
  async assignments(userId: string): Promise<AccountAssignment[]> {
    const value = object(await this.transport.request(`/users/${encodeURIComponent(userId)}/assignments`));
    if (!Array.isArray(value.participants)) throw new BusinessError('invalid_response');
    return value.participants.map(decodeAssignment);
  }

  async caseAssignments(supportCaseId: string): Promise<SupportCaseAssignment[]> {
    const value = object(await this.transport.request(`/settings/assignments/cases/${encodeURIComponent(supportCaseId)}`));
    if (!Array.isArray(value.assignees)) throw new BusinessError('invalid_response');
    return value.assignees.map(decodeSupportCaseAssignment);
  }
  async requestAssignment(supportCaseId: string, userId: string, role: 'primary' | 'secondary' = 'secondary'): Promise<SupportCaseAssignment> {
    return decodeSupportCaseAssignment(await this.transport.request(`/support-cases/${encodeURIComponent(supportCaseId)}/assignees`, 'POST', { userId, role }));
  }

  async forceTransfer(supportCaseId: string, toUserId: string, reason: string, participantNotified: boolean): Promise<void> {
    await this.transport.request(`/support-cases/${encodeURIComponent(supportCaseId)}/force-transfer`, 'POST', {
      toUserId, reason, participantNotified,
    });
  }
}

interface Props {
  api: AccountsApi;
  currentUserId: string;
  onIdentityChanged: () => void;
  onFailure: (error: BusinessError) => void;
}

export function AccountsModule({ api, currentUserId, onIdentityChanged, onFailure }: Props) {
  const [directory, setDirectory] = useState<AccountDirectory | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<DirectoryRole[]>([]);
  const [reason, setReason] = useState('');
  const [assignments, setAssignments] = useState<AccountAssignment[] | null>(null);
  const [cases, setCases] = useState<SettingsCaseOptions | null>(null);
  const [caseId, setCaseId] = useState('');
  const [caseAssignments, setCaseAssignments] = useState<SupportCaseAssignment[] | null>(null);
  const [assignmentRole, setAssignmentRole] = useState<'primary' | 'secondary'>('secondary');
  const [force, setForce] = useState(false);
  const [transferReason, setTransferReason] = useState('');
  const [notified, setNotified] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const draftOwner = useRef<string | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const selected = useMemo(() => directory?.accounts.find((account) => account.id === selectedId) ?? null, [directory, selectedId]);

  async function load(cursor?: string): Promise<void> {
    if (busyRef.current || (cursor !== undefined && needsRefresh)) return;
    busyRef.current = true;
    const own = ++generation.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      let page = await api.directory(cursor);
      while (cursor === undefined && selectedId !== null && page.nextCursor !== null
        && !page.accounts.some((account) => account.id === selectedId)) {
        if (own !== generation.current) return;
        const next = await api.directory(page.nextCursor);
        page = { ...next, accounts: [...page.accounts, ...next.accounts] };
      }
      if (cursor === undefined && selectedId !== null && page.permissions.canManageRoles) {
        const [currentAssignments, currentCaseAssignments] = await Promise.all([
          api.assignments(selectedId), caseId === '' ? Promise.resolve(null) : api.caseAssignments(caseId),
        ]);
        if (own !== generation.current) return;
        setAssignments(currentAssignments); setCaseAssignments(currentCaseAssignments);
      }
      if (own !== generation.current) return;
      setDirectory((previous) => cursor === undefined || previous === null ? page
        : { ...page, accounts: [...previous.accounts, ...page.accounts] });
      if (cursor === undefined) setSelectedId((id) => page.accounts.some((account) => account.id === id) ? id : page.accounts[0]?.id ?? null);
      setNeedsRefresh(false);
    } catch (caught) {
      if (own !== generation.current) return;
      const failure = safeError(caught); setError(failure); onFailure(failure);
    } finally {
      if (own === generation.current) { setBusy(false); busyRef.current = false; }
    }
  }
  useEffect(() => {
    busyRef.current = false;
    void load();
    return () => { generation.current += 1; };
  }, [api]);

  useEffect(() => {
    if (draftOwner.current !== (selected?.id ?? null)) {
      draftOwner.current = selected?.id ?? null;
      setDraftRoles(selected?.roles.filter((candidate) => EDITABLE_ROLES.includes(candidate)) ?? []);
      setReason(''); setNotice(null); setCaseId(''); setForce(false); setTransferReason(''); setNotified(false);
      setNeedsRefresh(false); setError(null);
    }
    setAssignments(null);
    if (selected === null || directory?.permissions.canManageRoles !== true) return;
    let live = true;
    void api.assignments(selected.id).then((value) => { if (live) setAssignments(value); })
      .catch((caught) => {
        if (!live) return;
        const failure = safeError(caught); setError(failure); onFailure(failure);
      });
    return () => { live = false; };
  }, [api, selectedId, directory?.permissions.canManageRoles, onFailure]);

  useEffect(() => {
    setCaseAssignments(null);
    if (caseId === '') return;
    let live = true;
    void api.caseAssignments(caseId).then((value) => { if (live) setCaseAssignments(value); })
      .catch((caught) => {
        if (!live) return;
        const failure = safeError(caught); setError(failure); onFailure(failure);
      });
    return () => { live = false; };
  }, [api, caseId, onFailure]);

  async function loadCases(cursor?: string): Promise<void> {
    if (busyRef.current || needsRefresh || directory?.permissions.canManageRoles !== true) return;
    busyRef.current = true;
    const own = ++generation.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const page = await api.cases(cursor);
      if (own !== generation.current) return;
      setCases((previous) => cursor === undefined || previous === null ? page : { ...page, items: [...previous.items, ...page.items] });
      if (cursor === undefined) setCaseId('');
    } catch (caught) {
      if (own !== generation.current) return;
      const failure = safeError(caught); setError(failure); onFailure(failure);
    } finally {
      if (own === generation.current) { setBusy(false); busyRef.current = false; }
    }
  }

  async function mutate(kind: 'roles' | 'deactivate' | 'assignment'): Promise<void> {
    if (selected === null || busyRef.current || needsRefresh) return;
    busyRef.current = true;
    const own = ++generation.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (kind === 'assignment') {
        if (caseId === '' || caseAssignments === null) return;
        let message: string;
        if (force) {
          await api.forceTransfer(caseId, selected.id, transferReason, notified);
          message = '예외 이관을 완료했습니다. 새 주 담당자의 권한이 바로 적용됩니다.';
        } else {
          const result = await api.requestAssignment(caseId, selected.id, assignmentRole);
          message = result.status === 'active' ? '담당 배정을 완료했습니다.'
            : '배정 요청을 보냈습니다. 실무자가 내 정보에서 수락하면 담당 권한이 열립니다.';
        }
        const [currentAssignments, currentCaseAssignments] = await Promise.all([
          api.assignments(selected.id), api.caseAssignments(caseId),
        ]);
        if (own !== generation.current) return;
        setAssignments(currentAssignments); setCaseAssignments(currentCaseAssignments); setNotice(message);
      } else {
        const updated = kind === 'roles'
          ? await api.updateRoles(selected.id, draftRoles, selected.roles.filter((candidate) => EDITABLE_ROLES.includes(candidate)))
          : await api.deactivate(selected.id, reason);
        if (own !== generation.current) return;
        setDirectory((current) => current === null ? current : { ...current, accounts: current.accounts.map((account) => account.id === updated.id ? updated : account) });
        if (kind === 'roles') setDraftRoles(updated.roles.filter((candidate) => EDITABLE_ROLES.includes(candidate)));
        else { setReason(''); setAssignments([]); }
        if (updated.id === currentUserId) onIdentityChanged();
      }
    } catch (caught) {
      if (own !== generation.current) return;
      const failure = safeError(caught); setError(failure); onFailure(failure);
      setNeedsRefresh(true);
    } finally {
      if (own === generation.current) { setBusy(false); busyRef.current = false; }
    }
  }

  const existingAssignment = caseAssignments?.find((assignment) => assignment.userId === selectedId && assignment.status !== 'ended');
  return <WireCard as="section" labelledBy="accounts-title" title={<h2 id="accounts-title">사용자와 역할</h2>}>
    <WireCallout tone="info" title="저장된 역할과 감독 관계">
      실무 책임자는 팀 감독 관계에서 정해집니다. 아래 역할 선택으로 감독 관계를 만들거나 지우지 않습니다.
    </WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {needsRefresh && <WireCallout tone="info" title="다시 저장하기 전에 확인해 주세요">
      입력한 값은 남아 있습니다. 최신 상태를 확인한 뒤 변경 내용을 다시 검토해 주세요. 확인하기 전에는 저장과 배정을 다시 실행하지 않습니다.
    </WireCallout>}
    {notice && <WireEmpty live>{notice}</WireEmpty>}
    <WireCardSection title="기관 사용자">
      {directory === null ? <WireEmpty live>{busy ? '사용자 목록을 불러오고 있습니다.' : '사용자 목록을 확인해 주세요.'}</WireEmpty>
        : directory.accounts.length === 0 ? <WireEmpty>등록된 사용자가 없습니다.</WireEmpty>
          : <WireFormField label="사용자 선택" htmlFor="settings-account-user">
            <select id="settings-account-user" value={selectedId ?? ''} disabled={busy} onChange={(event) => setSelectedId(event.target.value)}>
              {directory.accounts.map((account) => <option key={account.id} value={account.id}>
                {account.name ?? account.email ?? '이름 없는 계정'}{account.name && account.email ? ` (${account.email})` : ''}{account.active ? '' : ' (비활성)'}
              </option>)}
            </select>
          </WireFormField>}
      <div className="business-actions">
        <WireButton variant="neutral" onClick={() => void load()} disabled={busy}>최신 상태 확인</WireButton>
        {directory?.nextCursor != null && <WireButton variant="neutral" onClick={() => void load(directory.nextCursor!)} disabled={busy || needsRefresh}>사용자 더 불러오기</WireButton>}
      </div>
    </WireCardSection>
    {selected && <WireCardSection title="계정 상세">
      <WireDataRows>
        <WireDataRow label="이름" value={selected.name ?? '미입력'} />
        <WireDataRow label="이메일" value={selected.email ?? '없음'} />
        <WireDataRow label="계정 상태" value={<WireBadge tone={selected.active ? 'mint' : 'neutral'}>{selected.active ? '활성' : '비활성'}</WireBadge>} />
        <WireDataRow label="현재 역할" value={selected.roles.length === 0 ? <WireBadge tone="lavender">역할 대기</WireBadge>
          : selected.roles.map((entry) => <span key={entry}><WireBadge tone="mint">{DIRECTORY_ROLE_LABELS[entry]}</WireBadge>{' '}</span>)} />
        {directory?.permissions.canManageRoles && <WireDataRow label="감독 팀" value={`${selected.supervisedTeamIds.length}개`} />}
      </WireDataRows>
      {directory?.permissions.canManageRoles && selected.active && <>
        <fieldset className="wire-fieldset" aria-describedby="settings-account-role-hint">
          <legend>업무 역할</legend>
          <div className="wire-choice-group">{EDITABLE_ROLES.map((entry) => <WireChoice key={entry} type="checkbox" label={DIRECTORY_ROLE_LABELS[entry]}
            name={`role-${selected.id}`} value={entry} checked={draftRoles.includes(entry)}
            disabled={busy || (selected.id === currentUserId && entry === 'institution-admin')}
            onChange={() => setDraftRoles((current) => current.includes(entry) ? current.filter((item) => item !== entry) : [...current, entry])} />)}</div>
          <p className="wire-form-hint" id="settings-account-role-hint">실무 책임자 역할은 팀 감독 관계에 따라 유지됩니다.</p>
        </fieldset>
        <div className="business-actions"><WireButton variant="primary" icon={<Icon name="check" />} onClick={() => void mutate('roles')} disabled={busy || needsRefresh}>역할 저장</WireButton></div>
      </>}
      {directory?.permissions.canManageAccounts && selected.active && selected.id !== currentUserId && <>
        <WireFormField label="비활성화 사유" htmlFor="settings-account-reason" required>
          <input id="settings-account-reason" value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} maxLength={200} />
        </WireFormField>
        <WireCallout tone="info" title="접근과 배정을 함께 종료합니다">계정을 비활성화하면 현재 담당 배정과 팀 감독 관계가 끝나고 기존 인증이 회수됩니다.</WireCallout>
        <div className="business-actions"><WireButton variant="danger" onClick={() => void mutate('deactivate')} disabled={busy || needsRefresh || reason.trim() === ''}>계정 비활성화</WireButton></div>
      </>}
    </WireCardSection>}
    {selected && directory?.permissions.canManageRoles && <WireCardSection title="담당 배정">
      {assignments === null ? <WireEmpty>담당 케이스를 확인하고 있습니다.</WireEmpty> : assignments.length === 0
        ? <WireEmpty>현재 담당한 케이스가 없습니다.</WireEmpty> : assignments.map((assignment) => <WireItem key={assignment.supportCaseId}
          title={assignment.participantName ?? assignment.beneficiaryId} description={assignment.participantPhone ?? '연락처 없음'}
          status={<WireBadge tone="mint">{assignment.assignmentRole === 'primary' ? '주 담당' : '공동 담당'}</WireBadge>} />)}
      {selected.active && selected.roles.includes('worker') ? <>
        <div className="business-actions"><WireButton variant="neutral" onClick={() => void loadCases()} disabled={busy || needsRefresh}>배정할 당사자 불러오기</WireButton></div>
        {cases !== null && (cases.items.length === 0 ? <WireEmpty>배정할 활성 케이스가 없습니다.</WireEmpty> : <>
          <WireFormField label="당사자와 사업 선택" htmlFor="settings-assignment-case">
            <select id="settings-assignment-case" value={caseId} disabled={busy} onChange={(event) => {
              setCaseId(event.target.value); setCaseAssignments(null); setNotice(null);
              setForce(false); setTransferReason(''); setNotified(false); setAssignmentRole('secondary');
            }}>
              <option value="">선택해 주세요</option>
              {cases.items.map((item) => <option key={item.supportCaseId} value={item.supportCaseId}>{item.name ?? item.beneficiaryId}{item.phone ? ` (${item.phone})` : ''}, {item.programName}</option>)}
            </select>
          </WireFormField>
          {cases.nextCursor !== null && <div className="business-actions"><WireButton variant="neutral" onClick={() => void loadCases(cases.nextCursor!)} disabled={busy || needsRefresh}>당사자 더 불러오기</WireButton></div>}
          {caseId !== '' && (caseAssignments === null ? <WireEmpty>기존 배정을 확인하고 있습니다.</WireEmpty>
            : existingAssignment ? <WireEmpty>{existingAssignment.status === 'requested' ? '이 사용자의 배정 수락을 기다리고 있습니다.' : '이미 이 사용자가 담당하고 있습니다.'}</WireEmpty> : <>
              <fieldset className="wire-fieldset"><legend>배정 방식</legend>
                <WireChoice type="checkbox" label="퇴사나 장기 부재로 수락 없이 예외 이관" checked={force} disabled={busy} onChange={() => setForce((value) => !value)} />
              </fieldset>
              {force ? <>
                <WireCallout tone="info" title="기존 주 담당자가 바뀝니다">예외 이관은 수락을 기다리지 않습니다. 기존 주 담당자의 배정을 끝내고 선택한 사용자를 새 주 담당자로 지정합니다.</WireCallout>
                <WireFormField label="예외 이관 사유" htmlFor="settings-transfer-reason" required>
                  <textarea id="settings-transfer-reason" value={transferReason} disabled={busy} maxLength={500} onChange={(event) => setTransferReason(event.target.value)} />
                </WireFormField>
                <WireChoice type="checkbox" label="당사자에게 담당 변경을 안내했습니다" checked={notified} disabled={busy} onChange={() => setNotified((value) => !value)} />
              </> : <WireFormField label="담당 역할" htmlFor="settings-assignment-role" hint="주 담당 요청을 수락하면 기존 주 담당자의 배정이 끝납니다.">
                <select id="settings-assignment-role" value={assignmentRole} disabled={busy} onChange={(event) => setAssignmentRole(event.target.value === 'primary' ? 'primary' : 'secondary')}>
                  <option value="secondary">공동 담당</option><option value="primary">주 담당</option>
                </select>
              </WireFormField>}
              <div className="business-actions"><WireButton variant={force ? 'danger' : 'primary'} icon={force ? undefined : <Icon name="check" />} onClick={() => void mutate('assignment')} disabled={busy || needsRefresh || (force && transferReason.trim() === '')}>
                {force ? '예외 이관 실행' : '배정 요청 보내기'}
              </WireButton></div>
            </>)}
        </>)}
      </> : <p className="wire-section-value">활성 실무자 역할이 있는 사용자에게만 배정할 수 있습니다.</p>}
    </WireCardSection>}
    <WireCardSection title="실무자 초대">
      <WireCallout tone="info" title="인증 초대 연결 전">이 배포에는 이메일에 묶인 일회용 인증 초대 기능이 아직 연결되지 않았습니다. 초대 링크를 만들 수 없으며 익명 링크로 대신하지 않습니다.</WireCallout>
    </WireCardSection>
  </WireCard>;
}
