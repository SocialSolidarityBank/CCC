import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PROGRAM_ADMISSION_COPY, PROGRAM_ADMISSION_COPY_VERSION,
  type ProgramProcessingMode, type ProgramStorageMode,
} from '@ccc/contracts/program-admission';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField,
  Icon, WireRadioGroup,
} from '@ccc/web/wire';
import { BusinessError, safeError } from './errors';
import { BusinessTransport } from './transport';

export interface ProgramConfirmation {
  by: string; at: string; storageMode: ProgramStorageMode; processingMode: ProgramProcessingMode;
  copyVersion: string; copyHash: string; installationPolicyVersion: number; installationConfigHash: string;
}
export type ProgramAdmissionState = 'ready' | 'undecided' | 'confirmation_required' | 'selection_changed'
  | 'notice_changed' | 'settings_changed' | 'storage_unavailable' | 'processing_unavailable' | 'installation_unavailable';
interface StaffOption { userId: string; name: string | null }
interface ProgramStaff extends StaffOption { isResponsible: boolean; active: boolean }
type ProgramStaffInput = Pick<ProgramStaff, 'userId' | 'isResponsible'>;
export interface Program {
  id: string; orgId: string; displayName: string | null; programType: 'financial_support_v1';
  storageMode: ProgramStorageMode; processingMode: ProgramProcessingMode; version: number;
  confirmation: ProgramConfirmation | null; admissionState: ProgramAdmissionState;
  status: 'active' | 'closed';
  staff: ProgramStaff[];
}
export interface ProgramsResponse {
  programs: Program[];
  staffOptions: StaffOption[];
  admissionCopy: { version: string; hash: string; copy: typeof PROGRAM_ADMISSION_COPY };
  installation: { deploymentMode: 'community-cloud' | 'local-single' | 'local-office'; sttMode: 'off' | 'local' | 'azure'; llmMode: 'off' | 'openai'; policyVersion: number; configHash: string };
}
export type ProgramConfirmationEvidence = Pick<ProgramConfirmation, 'copyVersion' | 'copyHash' | 'installationPolicyVersion' | 'installationConfigHash'>;
export interface CreateProgramInput {
  displayName: string;
  storageMode?: ProgramStorageMode;
  processingMode?: ProgramProcessingMode;
  confirmation?: ProgramConfirmationEvidence;
  staff?: ProgramStaffInput[];
}
export interface UpdateProgramInput {
  expectedVersion: number;
  displayName?: string;
  storageMode?: ProgramStorageMode;
  processingMode?: ProgramProcessingMode;
  confirmation?: ProgramConfirmationEvidence;
  status?: Program['status'];
  staff?: ProgramStaffInput[];
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_response');
  return value as Record<string, unknown>;
}
function safeString(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function storage(value: unknown): value is ProgramStorageMode {
  return value === 'supabase_seoul' || value === 'naver_public' || value === 'local_encrypted' || value === 'undecided';
}
function processing(value: unknown): value is ProgramProcessingMode {
  return value === 'external_allowed' || value === 'internal_only' || value === 'undecided';
}
function confirmation(value: unknown): ProgramConfirmation | null {
  if (value === null) return null;
  const row = record(value);
  const keys = ['by', 'at', 'storageMode', 'processingMode', 'copyVersion', 'copyHash', 'installationPolicyVersion', 'installationConfigHash'];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))
    || !safeString(row.by) || !utc(row.at) || !storage(row.storageMode) || !processing(row.processingMode)
    || !safeString(row.copyVersion, 40) || !hash(row.copyHash) || typeof row.installationPolicyVersion !== 'number'
    || !Number.isSafeInteger(row.installationPolicyVersion) || row.installationPolicyVersion < 1 || !hash(row.installationConfigHash)) {
    throw new BusinessError('invalid_response');
  }
  return row as unknown as ProgramConfirmation;
}
function decodeStaffOption(value: unknown): StaffOption {
  const row = record(value);
  if (Object.keys(row).length !== 2 || !safeString(row.userId) || !(row.name === null || safeString(row.name))) {
    throw new BusinessError('invalid_response');
  }
  return { userId: row.userId, name: row.name };
}
function decodeProgramStaff(value: unknown): ProgramStaff {
  const row = record(value);
  if (Object.keys(row).length !== 4 || !safeString(row.userId) || !(row.name === null || safeString(row.name))
    || typeof row.isResponsible !== 'boolean' || typeof row.active !== 'boolean') throw new BusinessError('invalid_response');
  return { userId: row.userId, name: row.name, isResponsible: row.isResponsible, active: row.active };
}

function decodeProgram(value: unknown): Program {
  const row = record(value);
  const keys = ['id', 'orgId', 'displayName', 'programType', 'storageMode', 'processingMode', 'version', 'confirmation', 'admissionState', 'status', 'staff'];
  const states: ProgramAdmissionState[] = ['ready', 'undecided', 'confirmation_required', 'selection_changed', 'notice_changed', 'settings_changed', 'storage_unavailable', 'processing_unavailable', 'installation_unavailable'];
  const admissionState = states.find((state) => state === row.admissionState);
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))
    || !safeString(row.id) || !safeString(row.orgId) || !(row.displayName === null || safeString(row.displayName, 120))
    || row.programType !== 'financial_support_v1' || !storage(row.storageMode) || !processing(row.processingMode)
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
    || (row.status !== 'active' && row.status !== 'closed') || !Array.isArray(row.staff)
    || admissionState === undefined) throw new BusinessError('invalid_response');
  return { id: row.id, orgId: row.orgId, displayName: row.displayName, programType: row.programType,
    storageMode: row.storageMode, processingMode: row.processingMode, version: row.version,
    confirmation: confirmation(row.confirmation), admissionState, status: row.status, staff: row.staff.map(decodeProgramStaff) };
}
function decodePrograms(value: unknown): ProgramsResponse {
  const row = record(value);
  const copy = record(row.admissionCopy); const install = record(row.installation);
  const copyKeys = ['version', 'hash', 'copy']; const installKeys = ['deploymentMode', 'sttMode', 'llmMode', 'policyVersion', 'configHash'];
  if (Object.keys(row).length !== 4 || !Array.isArray(row.programs) || !Array.isArray(row.staffOptions) || Object.keys(copy).length !== 3
    || !copyKeys.every((key) => Object.hasOwn(copy, key)) || copy.version !== PROGRAM_ADMISSION_COPY_VERSION || !hash(copy.hash)
    || JSON.stringify(copy.copy) !== JSON.stringify(PROGRAM_ADMISSION_COPY) || Object.keys(install).length !== 5
    || !installKeys.every((key) => Object.hasOwn(install, key))
    || (install.deploymentMode !== 'community-cloud' && install.deploymentMode !== 'local-single' && install.deploymentMode !== 'local-office')
    || (install.sttMode !== 'off' && install.sttMode !== 'local' && install.sttMode !== 'azure')
    || (install.llmMode !== 'off' && install.llmMode !== 'openai') || typeof install.policyVersion !== 'number'
    || !Number.isSafeInteger(install.policyVersion) || install.policyVersion < 1 || !hash(install.configHash)) throw new BusinessError('invalid_response');
  return { programs: row.programs.map(decodeProgram), admissionCopy: { version: copy.version, hash: copy.hash, copy: copy.copy as typeof PROGRAM_ADMISSION_COPY },
    installation: install as ProgramsResponse['installation'], staffOptions: row.staffOptions.map(decodeStaffOption) };
}
function decodeProgramEnvelope(value: unknown): Program {
  const row = record(value);
  if (Object.keys(row).length !== 1 || !Object.hasOwn(row, 'program')) throw new BusinessError('invalid_response');
  return decodeProgram(row.program);
}

export class ProgramsApi {
  constructor(private readonly transport: BusinessTransport) {}
  async list(): Promise<ProgramsResponse> { return decodePrograms(await this.transport.request('/programs')); }
  async create(input: CreateProgramInput): Promise<Program> {
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120) throw new BusinessError('invalid_request', 400);
    const body: Record<string, unknown> = { displayName };
    if (input.storageMode !== undefined) body.storageMode = input.storageMode;
    if (input.processingMode !== undefined) body.processingMode = input.processingMode;
    if (input.confirmation !== undefined) body.confirmation = input.confirmation;
    if (input.staff !== undefined) body.staff = input.staff;
    return decodeProgramEnvelope(await this.transport.request('/programs', 'POST', body));
  }
  async update(id: string, input: UpdateProgramInput): Promise<Program> {
    if (!safeString(id) || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new BusinessError('invalid_request', 400);
    const body: Record<string, unknown> = { expectedVersion: input.expectedVersion };
    if (input.displayName !== undefined) {
      const displayName = input.displayName.trim();
      if (!displayName || displayName.length > 120) throw new BusinessError('invalid_request', 400);
      body.displayName = displayName;
    }
    if (input.storageMode !== undefined) body.storageMode = input.storageMode;
    if (input.processingMode !== undefined) body.processingMode = input.processingMode;
    if (input.confirmation !== undefined) body.confirmation = input.confirmation;
    if (input.status !== undefined) body.status = input.status;
    if (input.staff !== undefined) body.staff = input.staff;
    return decodeProgramEnvelope(await this.transport.request(`/programs/${encodeURIComponent(id)}`, 'PATCH', body));
  }
}

type Draft = { displayName: string; storage: ProgramStorageMode | null; processing: ProgramProcessingMode | null; acknowledged: boolean; evidence: ProgramConfirmationEvidence | null; status: Program['status']; staff: ProgramStaffInput[] };
const stateLabel: Record<ProgramAdmissionState, string> = {
  ready: '확인 완료', undecided: '설정 필요', confirmation_required: '설정 필요', selection_changed: '다시 확인 필요',
  notice_changed: '다시 확인 필요', settings_changed: '다시 확인 필요', storage_unavailable: '설정 필요', processing_unavailable: '설정 필요', installation_unavailable: '설정 필요',
};
const processingLabel: Record<ProgramProcessingMode, string> = {
  external_allowed: '외부 처리 허용',
  internal_only: '기관 내부 처리',
  undecided: '나중에 정하기',
};
function initialDraft(program: Program, data: ProgramsResponse): Draft {
  return { displayName: program.displayName ?? '', storage: data.installation.deploymentMode === 'community-cloud'
    ? program.storageMode : null, processing: program.processingMode, acknowledged: false, evidence: null,
    status: program.status, staff: program.staff.map(({ userId, isResponsible }) => ({ userId, isResponsible })) };
}

function sameStaff(left: ProgramStaffInput[], right: ProgramStaffInput[]): boolean {
  if (left.length !== right.length) return false;
  const members = new Map(left.map((person) => [person.userId, person.isResponsible]));
  return right.every((person) => members.get(person.userId) === person.isResponsible);
}

export function ProgramsModule({ api, onFailure }: { api: ProgramsApi; onFailure: (error: BusinessError) => void }) {
  const [data, setData] = useState<ProgramsResponse | null>(null); const [error, setError] = useState<BusinessError | null>(null);
  const [busy, setBusy] = useState(true); const [needsRefresh, setNeedsRefresh] = useState(false); const [saved, setSaved] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}); const [newDraft, setNewDraft] = useState<Draft>({ displayName: '', storage: null, processing: null, acknowledged: false, evidence: null, status: 'active', staff: [] });
  const generation = useRef(0);
  const mounted = useRef(false); const busyRef = useRef(false);
  async function refresh(): Promise<void> {
    if (busyRef.current || !mounted.current) return;
    const own = generation.current; busyRef.current = true; setBusy(true); setError(null); setSaved(null);
    try { const value = await api.list(); if (!mounted.current || own !== generation.current) return; setData(value); setDrafts((current) => {
      const next = { ...current }; for (const program of value.programs) if (next[program.id] === undefined) next[program.id] = initialDraft(program, value); return next;
    }); setNeedsRefresh(false); }
    catch (cause) { if (!mounted.current || own !== generation.current) return; const safe = safeError(cause); setError(safe); onFailure(safe); }
    finally { if (mounted.current && own === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  useEffect(() => {
    mounted.current = true; generation.current += 1; busyRef.current = false;
    setData(null); setDrafts({}); setNeedsRefresh(false);
    setNewDraft({ displayName: '', storage: null, processing: null, acknowledged: false, evidence: null, status: 'active', staff: [] });
    void refresh();
    return () => { mounted.current = false; generation.current += 1; };
  }, [api]);
  function editDraft(id: string, patch: Partial<Draft>): void {
    const program = data?.programs.find((candidate) => candidate.id === id);
    if (!data || !program) return;
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? initialDraft(program, data)), ...patch } }));
  }
  function acknowledge(setter: (patch: Partial<Draft>) => void, checked: boolean): void {
    if (!data) return;
    setter({ acknowledged: checked, evidence: checked ? { copyVersion: data.admissionCopy.version, copyHash: data.admissionCopy.hash, installationPolicyVersion: data.installation.policyVersion, installationConfigHash: data.installation.configHash } : null });
  }
  function resolvedStorage(draft: Draft): ProgramStorageMode | undefined {
    return data?.installation.deploymentMode === 'community-cloud' ? draft.storage ?? undefined : undefined;
  }
  function resolvedProcessing(draft: Draft): ProgramProcessingMode | undefined { return draft.processing ?? undefined; }
  async function saveProgram(program: Program, draft: Draft): Promise<void> {
    if (!data || needsRefresh || busyRef.current || !mounted.current) return;
    const storageMode = resolvedStorage(draft); const processingMode = resolvedProcessing(draft);
    const changedStorage = data.installation.deploymentMode === 'community-cloud' && storageMode !== program.storageMode;
    const changedProcessing = processingMode !== undefined && processingMode !== program.processingMode;
    const changedName = draft.displayName.trim() !== (program.displayName ?? '');
    const changedStatus = draft.status !== program.status;
    const changedStaff = !sameStaff(draft.staff, program.staff);
    const canConfirm = data.installation.deploymentMode !== 'community-cloud' || storageMode !== undefined;
    const wantsConfirmation = draft.acknowledged && draft.evidence !== null && canConfirm && processingMode !== undefined;
    if (!changedName && !changedStorage && !changedProcessing && !wantsConfirmation && !changedStatus && !changedStaff) return;
    const own = generation.current; busyRef.current = true; setBusy(true); setError(null); setSaved(null);
    try {
      const input: UpdateProgramInput = { expectedVersion: program.version };
      if (changedName) input.displayName = draft.displayName;
      if (changedStorage && storageMode !== undefined) input.storageMode = storageMode;
      if (changedProcessing && processingMode !== undefined) input.processingMode = processingMode;
      if (wantsConfirmation && draft.evidence !== null) input.confirmation = draft.evidence;
      if (changedStatus) input.status = draft.status;
      if (changedStaff) input.staff = draft.staff;
      await api.update(program.id, input);
      if (!mounted.current || own !== generation.current) return;
      const latest = await api.list();
      if (!mounted.current || own !== generation.current) return;
      setData(latest); setDrafts((current) => {
        const next = { ...current }; delete next[program.id]; return next;
      }); setNeedsRefresh(false); setSaved(draft.displayName || '사업');
    } catch (cause) { if (!mounted.current || own !== generation.current) return; const safe = safeError(cause); setError(safe); setNeedsRefresh(true); onFailure(safe); }
    finally { if (mounted.current && own === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  async function createProgram(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault(); if (!data || needsRefresh || busyRef.current || !mounted.current) return;
    const storageMode = resolvedStorage(newDraft); const processingMode = resolvedProcessing(newDraft);
    const own = generation.current; busyRef.current = true; setBusy(true); setError(null); setSaved(null);
    try {
      const canConfirm = data.installation.deploymentMode !== 'community-cloud' || storageMode !== undefined;
      const input: CreateProgramInput = { displayName: newDraft.displayName, staff: newDraft.staff };
      if (storageMode !== undefined) input.storageMode = storageMode;
      if (processingMode !== undefined) input.processingMode = processingMode;
      if (newDraft.acknowledged && newDraft.evidence !== null && canConfirm && processingMode !== undefined) {
        input.confirmation = newDraft.evidence;
      }
      await api.create(input);
      if (!mounted.current || own !== generation.current) return;
      const latest = await api.list();
      if (!mounted.current || own !== generation.current) return;
      setData(latest); setNeedsRefresh(false); setNewDraft({ displayName: '', storage: null, processing: null, acknowledged: false, evidence: null, status: 'active', staff: [] }); setSaved('새 사업');
    } catch (cause) { if (!mounted.current || own !== generation.current) return; const safe = safeError(cause); setError(safe); setNeedsRefresh(true); onFailure(safe); }
    finally { if (mounted.current && own === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  return <WireCard as="section" labelledBy="programs-title" title={<h2 id="programs-title">사업 설정</h2>}>
    <WireCallout tone="info" title="사업별 도입 확인">사업마다 저장 위치와 녹음·AI 처리 경로를 선택하고, 설명을 읽은 뒤 확인합니다.</WireCallout>
    {error && <WireError>{error.message}</WireError>}
    {saved && <WireEmpty live>{saved} 설정을 저장했습니다.</WireEmpty>}
    {data && !busy && data.programs.map((program) => <ProgramEditor key={program.id} data={data} program={program} draft={drafts[program.id] ?? initialDraft(program, data)} setDraft={(patch) => editDraft(program.id, patch)} onAcknowledge={(checked) => acknowledge((patch) => editDraft(program.id, patch), checked)} onSave={(draft) => { void saveProgram(program, draft); }} disabled={busy || needsRefresh} />)}
    {busy && <WireEmpty live>사업 설정을 확인하고 있습니다.</WireEmpty>}
    {needsRefresh && <WireCallout tone="info" title="다시 저장하기 전에 최신 상태를 확인해 주세요">저장 결과를 확정하지 못했습니다. 입력한 내용은 남아 있습니다.</WireCallout>}
    {data && !busy && <WireCardSection title="새 사업 등록"><form className="business-form" onSubmit={(event) => { void createProgram(event); }}>
      <WireFormField label="사업 표시 이름" htmlFor="new-program-name" required><input id="new-program-name" value={newDraft.displayName} maxLength={120} required disabled={busy || needsRefresh} onChange={(event) => setNewDraft((current) => ({ ...current, displayName: event.target.value }))} /></WireFormField>
      <ChoiceSections data={data} draft={newDraft} idPrefix="new-program" setDraft={(patch) => setNewDraft((current) => ({ ...current, ...patch }))} onAcknowledge={(checked) => acknowledge((patch) => setNewDraft((current) => ({ ...current, ...patch })), checked)} disabled={busy || needsRefresh} />
      <StaffChoices options={data.staffOptions} selected={newDraft.staff} onChange={(staff) => setNewDraft((current) => ({ ...current, staff }))} disabled={busy || needsRefresh} />
      <div className="business-actions"><WireButton variant="primary" icon={<Icon name="check" />} type="submit" disabled={busy || needsRefresh || !newDraft.displayName.trim()}>사업 만들기</WireButton></div>
    </form></WireCardSection>}
    <div className="business-actions"><WireButton variant="neutral" disabled={busy} onClick={() => { void refresh(); }}>최신 정보 확인</WireButton></div>
  </WireCard>;
}

function StaffChoices({ options, selected, onChange, disabled }: {
  options: StaffOption[]; selected: ProgramStaffInput[]; onChange: (staff: ProgramStaffInput[]) => void; disabled: boolean;
}) {
  return <fieldset className="wire-fieldset">
    <legend>사업 담당 구성</legend>
    <p className="wire-form-hint">사업 담당으로 추가해도 상담 기록 열람 권한은 생기지 않습니다. 케이스 배정은 별도로 관리합니다.</p>
    {options.length === 0 && <WireEmpty>배정할 수 있는 계정이 없습니다.</WireEmpty>}
    {options.map((person) => {
      const member = selected.find((entry) => entry.userId === person.userId);
      return <div key={person.userId} className="wire-choice-group" role="group" aria-label={person.name ?? person.userId}>
        <WireChoice type="checkbox" label={person.name ?? person.userId} checked={member !== undefined} disabled={disabled}
          onChange={(checked) => onChange(checked ? [...selected, { userId: person.userId, isResponsible: false }] : selected.filter((entry) => entry.userId !== person.userId))} />
        {member !== undefined && <WireChoice type="checkbox" label="사업 책임" checked={member.isResponsible} disabled={disabled}
          onChange={(isResponsible) => onChange(selected.map((entry) => entry.userId === person.userId ? { ...entry, isResponsible } : entry))} />}
      </div>;
    })}
  </fieldset>;
}

function ChoiceSections({ data, draft, idPrefix, setDraft, onAcknowledge, disabled }: { data: ProgramsResponse; draft: Draft; idPrefix: string; setDraft: (patch: Partial<Draft>) => void; onAcknowledge: (checked: boolean) => void; disabled: boolean }) {
  const copy = data.admissionCopy.copy;
  return <>
    {data.installation.deploymentMode === 'community-cloud' ? <fieldset className="wire-fieldset">
      <legend>{copy.storage.heading}</legend>
      <WireRadioGroup>
      <WireChoice type="radio" name={`${idPrefix}-storage`} label={copy.storage.options.supabase_seoul.label} desc={copy.storage.options.supabase_seoul.description} checked={draft.storage === 'supabase_seoul'} disabled={disabled} onChange={() => setDraft({ storage: 'supabase_seoul', acknowledged: false, evidence: null })} />
      <WireChoice type="radio" name={`${idPrefix}-storage`} label={copy.storage.options.naver_public.label} desc={copy.storage.options.naver_public.disabledNotice} checked={false} disabled />
      <WireChoice type="radio" name={`${idPrefix}-storage`} label={copy.storage.options.undecided.label} desc={copy.storage.options.undecided.description} checked={draft.storage === 'undecided'} disabled={disabled} onChange={() => setDraft({ storage: 'undecided', acknowledged: false, evidence: null })} />
      </WireRadioGroup>
      <p className="wire-form-hint">{copy.storage.installationNotice}</p>
    </fieldset> : <WireCallout tone="info" title={copy.storage.heading}>{copy.storage.installationNotice}</WireCallout>}
    <fieldset className="wire-fieldset">
      <legend>{copy.processing.heading}</legend>
      <WireRadioGroup>
      <WireChoice type="radio" name={`${idPrefix}-processing`} label={copy.processing.options.external_allowed.label} desc={copy.processing.options.external_allowed.description} checked={draft.processing === 'external_allowed'} disabled={disabled} onChange={() => setDraft({ processing: 'external_allowed', acknowledged: false, evidence: null })} />
      <WireChoice type="radio" name={`${idPrefix}-processing`} label={copy.processing.options.internal_only.label} desc={copy.processing.options.internal_only.description} checked={draft.processing === 'internal_only'} disabled={disabled} onChange={() => setDraft({ processing: 'internal_only', acknowledged: false, evidence: null })} />
      <WireChoice type="radio" name={`${idPrefix}-processing`} label={copy.processing.options.undecided.label} desc={copy.processing.options.undecided.description} checked={draft.processing === 'undecided'} disabled={disabled} onChange={() => setDraft({ processing: 'undecided', acknowledged: false, evidence: null })} />
      </WireRadioGroup>
    </fieldset>
    {draft.processing === 'external_allowed' && <WireCallout tone="info" title={copy.processing.options.external_allowed.label}>{copy.processing.options.external_allowed.aiNotice} {copy.processing.options.external_allowed.speechNotice}</WireCallout>}
    {draft.processing === 'internal_only' && <WireCallout tone="info" title={copy.processing.options.internal_only.label}>{copy.processing.options.internal_only.notice}</WireCallout>}
    <WireChoice type="checkbox" label={copy.confirmation} checked={draft.acknowledged} disabled={disabled || data.installation.deploymentMode === 'community-cloud' && (draft.storage === null || draft.storage === 'undecided') || draft.processing === null || draft.processing === 'undecided'} onChange={onAcknowledge} />
  </>;
}
function ProgramEditor({ data, program, draft, setDraft, onAcknowledge, onSave, disabled }: { data: ProgramsResponse; program: Program; draft: Draft; setDraft: (patch: Partial<Draft>) => void; onAcknowledge: (checked: boolean) => void; onSave: (draft: Draft) => void; disabled: boolean }) {
  const storage = program.storageMode;
  const changed = draft.acknowledged || draft.displayName.trim() !== (program.displayName ?? '') || (data.installation.deploymentMode === 'community-cloud' && draft.storage !== program.storageMode)
    || draft.processing !== program.processingMode || draft.status !== program.status || !sameStaff(draft.staff, program.staff);
  const options = new Map(data.staffOptions.map((person) => [person.userId, person]));
  for (const person of program.staff) if (!options.has(person.userId)) options.set(person.userId, person);
  return <WireCardSection title={<>{program.displayName ?? '이름 미입력'} <WireBadge tone={program.status === 'active' ? 'mint' : 'neutral'}>{program.status === 'active' ? '운영 중' : '종료'}</WireBadge> <WireBadge tone={program.admissionState === 'ready' ? 'mint' : 'lavender'}>{stateLabel[program.admissionState]}</WireBadge></>}>
    <WireDataRows>
      <WireDataRow label="현재 저장 위치" value={storage === 'supabase_seoul' ? '기본형(기관 소유 Supabase 서울 프로젝트)' : storage === 'local_encrypted' ? '기관 내부 저장' : '나중에 정하기'} />
      <WireDataRow label="현재 처리 경로" value={processingLabel[program.processingMode]} />
      <WireDataRow label="사업 버전" value={String(program.version)} />
    </WireDataRows>
    <form className="business-form" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <WireFormField label="사업 표시 이름" htmlFor={`program-name-${program.id}`} required>
        <input id={`program-name-${program.id}`} value={draft.displayName} maxLength={120} required disabled={disabled} onChange={(event) => setDraft({ displayName: event.target.value })} />
      </WireFormField>
      <WireFormField label="운영 상태" htmlFor={`program-status-${program.id}`} hint="종료하면 새 당사자 등록과 초대가 중단됩니다. 기존 케이스는 그대로 유지됩니다.">
        <select id={`program-status-${program.id}`} value={draft.status} disabled={disabled} onChange={(event) => setDraft({ status: event.target.value === 'closed' ? 'closed' : 'active' })}>
          <option value="active">운영 중</option><option value="closed">종료</option>
        </select>
      </WireFormField>
      <ChoiceSections data={data} draft={draft} idPrefix={`program-${program.id}`} setDraft={setDraft} onAcknowledge={onAcknowledge} disabled={disabled} />
      <StaffChoices options={[...options.values()]} selected={draft.staff} onChange={(staff) => setDraft({ staff })} disabled={disabled} />
      <div className="business-actions"><WireButton variant="primary" icon={<Icon name="check" />} type="submit" disabled={disabled || !changed}>사업 설정 저장</WireButton></div>
    </form>
  </WireCardSection>;
}
