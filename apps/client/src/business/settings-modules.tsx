import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice, WireDataRow, WireDataRows,
  Icon, WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/wire';
import type { MemorySettingsView } from '@ccc/contracts/counseling-memory';
import {
  ASSIGNMENT_ROLE_LABELS, ROLE_LABELS, type AssignmentRequest, type MyIdentity, type OrganizationProfile, type SettingsApi,
} from './api';
import { type BusinessError, safeError } from './errors';
import { type EditorAction, type EditorState, initialEditor, reduceEditor } from './editing';

interface EditableResource<Value, Draft> {
  load: () => Promise<Value>;
  save: (value: Value, draft: Draft) => Promise<Value>;
  draft: (value: Value) => Draft;
}

function useCasEditor<Value, Draft>(resource: EditableResource<Value, Draft>, onFailure: (error: BusinessError) => void) {
  const [state, dispatch] = useReducer(
    (current: EditorState<Value, Draft>, action: EditorAction<Value, Draft>) => reduceEditor(current, action),
    initialEditor<Value, Draft>(),
  );
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    const own = ++generation.current;
    busy.current = true;
    dispatch({ type: 'loading' });
    void resource.load().then((value) => {
      if (own === generation.current) dispatch({ type: 'loaded', value, draft: resource.draft(value) });
    }).catch((error: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(error);
      dispatch({ type: 'failed', error: safe, write: false });
      onFailure(safe);
    }).finally(() => { if (own === generation.current) busy.current = false; });
    return () => { generation.current += 1; };
  }, [resource, onFailure]);

  async function perform(write: boolean): Promise<void> {
    if (busy.current || (write && (state.value === null || state.draft === null || state.needsRefresh))) return;
    const own = generation.current;
    busy.current = true;
    dispatch({ type: write ? 'saving' : 'loading' });
    try {
      const value = write && state.value !== null && state.draft !== null
        ? await resource.save(state.value, state.draft) : await resource.load();
      if (own === generation.current) dispatch({ type: write ? 'saved' : 'loaded', value, draft: resource.draft(value) });
    } catch (error) {
      if (own !== generation.current) return;
      const safe = safeError(error);
      dispatch({ type: 'failed', error: safe, write });
      onFailure(safe);
    } finally {
      if (own === generation.current) busy.current = false;
    }
  }
  return { state, edit: (draft: Draft) => dispatch({ type: 'edit', draft }),
    reload: () => { void perform(false); }, save: () => { void perform(true); } };
}

export function AccountModule({
  me, api, onFailure,
}: { me: MyIdentity; api: SettingsApi; onFailure: (error: BusinessError) => void }) {
  const [requests, setRequests] = useState<AssignmentRequest[] | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const own = ++generation.current;
    busyRef.current = true;
    setRequests(null);
    setNeedsRefresh(false);
    const reload = async () => {
      setBusy(true);
      setError(null);
      try {
        const value = await api.getAssignmentRequests();
        if (mounted.current && own === generation.current) setRequests(value);
      } catch (cause) {
        if (!mounted.current || own !== generation.current) return;
        const safe = safeError(cause);
        if (safe.code === 'session_changed') return;
        setError(safe);
        onFailure(safe);
      } finally {
        if (mounted.current && own === generation.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    };
    void reload();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [api, onFailure]);

  const refresh = async () => {
    if (busyRef.current || !mounted.current) return;
    const own = generation.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await api.getAssignmentRequests();
      if (mounted.current && own === generation.current) {
        setRequests(value);
        setNeedsRefresh(false);
      }
    } catch (cause) {
      if (!mounted.current || own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      onFailure(safe);
    } finally {
      if (mounted.current && own === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  const accept = async (request: AssignmentRequest) => {
    if (busyRef.current || needsRefresh || !mounted.current) return;
    const own = generation.current;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.acceptAssignment(request.supportCaseId, request.id);
      const value = await api.getAssignmentRequests();
      if (mounted.current && own === generation.current) setRequests(value);
    } catch (cause) {
      if (!mounted.current || own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setNeedsRefresh(true);
      setError(safe);
      onFailure(safe);
    } finally {
      if (mounted.current && own === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };

  return <WireCard as="section" labelledBy="account-title" title={<h2 id="account-title">내 정보</h2>}>
    <WireDataRows>
      <WireDataRow label="이름" value={me.name ?? '등록되지 않음'} />
      <WireDataRow label="이메일" value={me.email ?? '등록되지 않음'} />
      <WireDataRow label="역할" value={me.roles.length === 0 ? <WireBadge tone="lavender">역할 대기</WireBadge>
        : me.roles.map((role) => <span key={role}><WireBadge tone="mint">{ROLE_LABELS[role]}</WireBadge>{' '}</span>)} />
    </WireDataRows>
    <WireCardSection title="배정 요청" titleId="assignment-requests-title">
      {error && <WireError>{error.message}</WireError>}
      {needsRefresh && <WireCallout tone="info" title="다시 수락하기 전에 확인해 주세요">
        처리 결과를 확인하지 못했습니다. 최신 정보를 불러온 뒤 남아 있는 요청을 확인해 주세요.
      </WireCallout>}
      {requests === null && busy && <WireEmpty live>배정 요청을 확인하고 있습니다.</WireEmpty>}
      {requests !== null && requests.length === 0 && <WireEmpty>현재 배정 요청이 없습니다.</WireEmpty>}
      {requests !== null && requests.length > 0 && <div>
        {requests.map((request) => (
          <WireItem
            key={request.id}
            title={request.participantName ?? '이름 미입력'}
            description={`요청 시간: ${new Date(request.requestedAt).toLocaleString('ko-KR')}`}
            status={<WireBadge tone="mint">{ASSIGNMENT_ROLE_LABELS[request.role]}</WireBadge>}
            action={<WireButton variant="primary" disabled={busy || needsRefresh} onClick={() => { void accept(request); }}>수락</WireButton>}
          />
        ))}
      </div>}
      <WireButton variant="neutral" disabled={busy} onClick={() => { void refresh(); }}>최신 정보 확인</WireButton>
    </WireCardSection>
  </WireCard>;
}

interface ModuleProps { api: SettingsApi; onFailure: (error: BusinessError) => void }

export function InstitutionModule({ api, onFailure }: ModuleProps) {
  const resource = useMemo<EditableResource<OrganizationProfile, string>>(() => ({
    load: () => api.getProfile(),
    save: (current, draft) => api.saveProfile({ orgName: draft, expectedOrgName: current.orgName }),
    draft: (current) => current.orgName ?? '',
  }), [api]);
  const editor = useCasEditor(resource, onFailure);
  const { state } = editor;
  return <WireCard as="section" labelledBy="institution-title" title={<h2 id="institution-title">기관 정보</h2>}>
    {state.error && <WireError>{state.error.message}</WireError>}
    {state.busy && <WireEmpty live>기관 정보를 확인하고 있습니다.</WireEmpty>}
    {state.saved && <WireEmpty live>기관 이름을 저장했습니다.</WireEmpty>}
    {state.value !== null && state.draft !== null && <form className="business-form" onSubmit={(event) => { event.preventDefault(); editor.save(); }}>
      <WireFormField label="기관 이름" htmlFor="organization-name" required hint="이름만 변경합니다. 사업과 도입 확인 설정은 바뀌지 않습니다.">
        <input id="organization-name" value={state.draft} maxLength={80} required disabled={state.busy}
          aria-describedby="organization-name-hint" onChange={(event) => editor.edit(event.target.value)} />
      </WireFormField>
      <WireDataRows>
        <WireDataRow label="최근 확인한 기관 이름" value={state.value.orgName ?? '등록되지 않음'} />
        <WireDataRow label="사업 표시 이름" value={state.value.programDisplayName ?? '등록되지 않음'} />
      </WireDataRows>
      <WireButton variant="primary" icon={<Icon name="check" />} type="submit" disabled={state.busy || state.needsRefresh
        || state.draft.trim().length === 0 || state.draft.trim().length > 80 || state.draft.trim() === state.value.orgName}>
        기관 이름 저장
      </WireButton>
    </form>}
    <WireButton variant="neutral" disabled={state.busy} onClick={editor.reload}>최신 정보 확인</WireButton>
    {state.needsRefresh && <WireCallout tone="info" title="다시 저장하기 전에 확인해 주세요">
      최신 정보를 불러와도 입력한 내용은 남습니다. 현재 기관 이름과 비교한 뒤 저장해 주세요.
    </WireCallout>}
  </WireCard>;
}

export function MemoryModule({ api, onFailure }: ModuleProps) {
  const resource = useMemo<EditableResource<MemorySettingsView, boolean>>(() => ({
    load: () => api.getMemory(),
    save: (current, enabled) => api.saveMemory({ enabled, expectedVersion: current.version }),
    draft: (current) => current.enabled,
  }), [api]);
  const editor = useCasEditor(resource, onFailure);
  const { state } = editor;
  return <WireCard as="section" labelledBy="memory-title" title={<h2 id="memory-title">기관 상담 기억</h2>}>
    <WireCallout tone="info" title="기관 전체의 상담 기억 설정입니다">
      상담 기억을 켜도 AI 처리 조건을 통과한 자료만 처리합니다. 아래에는 처리 건수만 표시하며 상담 내용은 표시하지 않습니다.
    </WireCallout>
    {state.error && <WireError>{state.error.message}</WireError>}
    {state.busy && <WireEmpty live>상담 기억 설정을 확인하고 있습니다.</WireEmpty>}
    {state.saved && <WireEmpty live>상담 기억 설정을 저장했습니다.</WireEmpty>}
    {state.value !== null && state.draft !== null && <form className="business-form" onSubmit={(event) => { event.preventDefault(); editor.save(); }}>
      <WireChoice type="checkbox" label="기관 상담 기억 사용" checked={state.draft} disabled={state.busy} onChange={editor.edit} />
      <WireDataRows>
        <WireDataRow label="최근 확인한 설정" value={<WireBadge tone={state.value.enabled ? 'mint' : 'neutral'}>
          {state.value.enabled ? '사용' : '사용 안 함'}
        </WireBadge>} />
        <WireDataRow label="처리 대기" value={`${state.value.pendingCases}건`} />
        <WireDataRow label="조건 확인 필요" value={`${state.value.blockedCases}건`} />
        <WireDataRow label="처리 실패" value={`${state.value.failedCases}건`} />
        <WireDataRow label="마지막 처리 성공" value={state.value.lastSuccessAt === null ? '아직 없음'
          : new Date(state.value.lastSuccessAt).toLocaleString('ko-KR')} />
      </WireDataRows>
      <WireButton variant="primary" icon={<Icon name="check" />} type="submit" disabled={state.busy || state.needsRefresh || state.draft === state.value.enabled}>
        상담 기억 설정 저장
      </WireButton>
    </form>}
    <WireButton variant="neutral" disabled={state.busy} onClick={editor.reload}>최신 정보 확인</WireButton>
    {state.needsRefresh && <WireCallout tone="info" title="다시 저장하기 전에 확인해 주세요">
      최신 처리 상태를 불러온 뒤 선택한 설정을 다시 확인해 주세요. 선택한 값은 그대로 남겨 둡니다.
    </WireCallout>}
  </WireCard>;
}
