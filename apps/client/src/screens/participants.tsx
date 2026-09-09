import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField, WireItem,
} from '@ccc/web/wire';
import type { ProgramAdmissionState } from '@ccc/contracts/program-admission';
import { type BusinessError, safeError } from '../business/errors';
import {
  BASIC_INFO_FIELDS, type BasicInfoField, type ParticipantBasicInfo, type ParticipantHub,
  type ParticipantListItem, type ParticipantProgram, type ProgramOption,
} from '../business/participants';
import type { Session } from '../business/session';

/** 도입 확인 상태를 그대로 옮긴 안내 문구 초안. 확정 문안은 design 레인이 정한다. */
export const ADMISSION_LABELS: Record<ProgramAdmissionState, string> = {
  ready: '확인 완료',
  undecided: '저장 위치나 처리 경로를 아직 정하지 않았습니다.',
  confirmation_required: '관리자 확인이 아직 없습니다.',
  selection_changed: '고른 내용이 바뀌어 다시 확인해야 합니다.',
  notice_changed: '설명 글이 바뀌어 다시 확인해야 합니다.',
  settings_changed: '기관의 음성 인식이나 AI 설정이 바뀌어 다시 확인해야 합니다.',
  storage_unavailable: '고른 저장 위치를 이 설치에서 쓸 수 없습니다.',
  processing_unavailable: '고른 처리 경로를 이 설치에서 쓸 수 없습니다.',
  installation_unavailable: '설치 정보를 읽을 수 없어 판단할 수 없습니다.',
};

const BASIC_INFO_LABELS: Record<BasicInfoField, string> = {
  name: '이름', phone: '연락처', email: '이메일', account: '계좌',
  birthDate: '생년월일', region: '거주지역', gender: '성별',
};

/** 읽기 전용 자료 한 건. 대상이 바뀌면 이전 응답을 버린다. */
function useLoaded<Value>(load: () => Promise<Value>, onFailure: (error: BusinessError) => void) {
  const [value, setValue] = useState<Value | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);
  const run = useCallback(() => {
    const own = ++generation.current;
    setValue(null);
    setError(null);
    void load().then((next) => {
      if (own === generation.current) setValue(next);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      onFailure(safe);
    });
  }, [load, onFailure]);
  useEffect(() => {
    run();
    return () => { generation.current += 1; };
  }, [run]);
  return { value, error, reload: run };
}

function useSessionFailure(session: Session) {
  return useCallback((error: BusinessError) => {
    if (error.status === 401) void session.auth.signOut(error);
    else if (error.code === 'mfa_required') session.auth.recheck(true);
  }, [session.auth]);
}

function participantTitle(name: string | null, beneficiaryId: string): string {
  return name ?? beneficiaryId;
}

export function ParticipantListScreen() {
  const session = useOutletContext<Session>();
  const onFailure = useSessionFailure(session);
  const load = useCallback(() => session.participants.list(), [session.participants]);
  const { value, error, reload } = useLoaded<ParticipantListItem[]>(load, onFailure);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'closed'>('all');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (value ?? []).filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (needle === '') return true;
      return [item.name, item.phone, item.beneficiaryId]
        .some((field) => field !== null && field.toLowerCase().includes(needle));
    });
  }, [value, query, status]);

  return <WireCard title="당사자 목록">
    {error && <><WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={reload}>다시 불러오기</WireButton></div></>}
    <div className="business-form">
      <WireFormField label="이름, 연락처, ID로 좁히기" htmlFor="participant-query">
        <input id="participant-query" value={query} autoComplete="off"
          onChange={(event) => setQuery(event.target.value)} />
      </WireFormField>
      <WireFormField label="상태" htmlFor="participant-status" control="select">
        <select id="participant-status" value={status}
          onChange={(event) => setStatus(event.target.value as 'all' | 'active' | 'closed')}>
          <option value="all">전체</option>
          <option value="active">진행 중</option>
          <option value="closed">종결</option>
        </select>
      </WireFormField>
    </div>
    {value === null && error === null && <WireEmpty live reserve>당사자 목록을 불러오고 있습니다.</WireEmpty>}
    {value !== null && shown.length === 0 && <WireEmpty>조건에 맞는 당사자가 없습니다.</WireEmpty>}
    {shown.map((item) => <WireItem key={item.beneficiaryId}
      title={participantTitle(item.name, item.beneficiaryId)}
      description={`${item.phone ?? '연락처 없음'}, 참여 사업 ${item.programCount}개`}
      status={<>
        <WireBadge tone={item.status === 'active' ? 'mint' : 'neutral'}>
          {item.status === 'active' ? '진행 중' : '종결'}
        </WireBadge>
        {item.newSignup && <WireBadge tone="lavender">새 가입</WireBadge>}
      </>}
      action={<WireButton variant="neutral" href={`/participants/${encodeURIComponent(item.beneficiaryId)}`}>
        정보 보기
      </WireButton>} />)}
    <WireCallout tone="info" title="목록에 아직 없는 것">
      이메일과 참여 사업 이름은 이 목록 응답에 없습니다. 서버가 실을 때까지 화면이 다른 요청으로 채우지 않습니다.
    </WireCallout>
  </WireCard>;
}

function registrationBlock(session: Session, options: ProgramOption[] | null): string | null {
  const readiness = session.me.institution;
  if (readiness.installationState !== 'available') return '설치 정보를 읽을 수 없어 등록을 열지 않습니다.';
  if (readiness.initialSetupState !== 'complete') return '기관 초기 설정이 끝나지 않았습니다.';
  if (options !== null && !options.some((option) => option.admissionState === 'ready')) {
    return '도입 확인이 끝난 사업이 없습니다. 사업 등록과 확인을 먼저 마쳐야 합니다.';
  }
  if (!session.me.roles.includes('worker')) {
    return '이 화면의 등록은 담당 실무자 역할로만 진행합니다. 관리자 등록은 첫 담당 실무자를 고르는 계약이 아직 연결되지 않았습니다.';
  }
  return null;
}

export function ParticipantRegisterScreen() {
  const session = useOutletContext<Session>();
  const onFailure = useSessionFailure(session);
  const navigate = useNavigate();
  const load = useCallback(() => session.participants.programOptions(), [session.participants]);
  const { value: options, error: loadError } = useLoaded<ProgramOption[]>(load, onFailure);
  const [programId, setProgramId] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [recordingAi, setRecordingAi] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);

  const blocked = registrationBlock(session, options);
  const ready = (options ?? []).filter((option) => option.admissionState === 'ready');
  const locked = (options ?? []).filter((option) => option.admissionState !== 'ready');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || blocked !== null) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => {
      const raw = form.get(key);
      return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
    };
    setBusy(true);
    setError(null);
    try {
      const created = await session.participants.register({
        programId,
        consentPrivacy: privacy,
        consentRecordingAi: recordingAi,
        ...(emergency ? { emergencyReason } : {}),
        ...(text('name') === undefined ? {} : { name: text('name')! }),
        ...(text('phone') === undefined ? {} : { phone: text('phone')! }),
        ...(text('email') === undefined ? {} : { email: text('email')! }),
        ...(text('birthDate') === undefined ? {} : { birthDate: text('birthDate')! }),
        ...(text('region') === undefined ? {} : { region: text('region')! }),
        ...(text('gender') === undefined ? {} : { gender: text('gender')! }),
      });
      void navigate(`/participants/${encodeURIComponent(created.beneficiaryId)}`);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      onFailure(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="당사자 등록">
    {loadError && <WireError>{loadError.message}</WireError>}
    {blocked !== null && <WireCallout tone="info" title="지금은 등록할 수 없습니다">{blocked}</WireCallout>}
    {error && <WireError>{error.message}</WireError>}
    {options === null && loadError === null && <WireEmpty live reserve>사업 목록을 불러오고 있습니다.</WireEmpty>}
    <form className="business-form" onSubmit={(event) => { void submit(event); }}>
      <WireFormField label="참여 사업" htmlFor="register-program" control="select" required>
        <select id="register-program" value={programId} required disabled={busy || blocked !== null}
          onChange={(event) => setProgramId(event.target.value)}>
          <option value="">사업을 고르세요</option>
          {ready.map((option) => <option key={option.id} value={option.id}>
            {option.displayName ?? option.id}
          </option>)}
        </select>
      </WireFormField>
      {locked.length > 0 && <WireCallout tone="info" title="지금 고를 수 없는 사업">
        {locked.map((option) => `${option.displayName ?? option.id}: ${ADMISSION_LABELS[option.admissionState]}`).join(' / ')}
      </WireCallout>}
      <WireFormField label="이름" htmlFor="register-name">
        <input id="register-name" name="name" autoComplete="off" disabled={busy || blocked !== null} />
      </WireFormField>
      <WireFormField label="연락처" htmlFor="register-phone">
        <input id="register-phone" name="phone" inputMode="tel" autoComplete="off" disabled={busy || blocked !== null} />
      </WireFormField>
      <WireFormField label="이메일" htmlFor="register-email">
        <input id="register-email" name="email" type="email" autoComplete="off" disabled={busy || blocked !== null} />
      </WireFormField>
      <WireFormField label="생년월일" htmlFor="register-birth" hint="예: 1980-03-05">
        <input id="register-birth" name="birthDate" autoComplete="off" disabled={busy || blocked !== null} />
      </WireFormField>
      <WireFormField label="거주지역" htmlFor="register-region">
        <input id="register-region" name="region" autoComplete="off" disabled={busy || blocked !== null} />
      </WireFormField>
      <WireFormField label="성별" htmlFor="register-gender">
        <input id="register-gender" name="gender" autoComplete="off" disabled={busy || blocked !== null} />
      </WireFormField>
      <WireChoice type="checkbox" label="개인정보 수집과 이용에 동의받았습니다" checked={privacy}
        disabled={busy || blocked !== null} onChange={setPrivacy} />
      <WireChoice type="checkbox" label="AI를 활용한 녹취기록에 동의받았습니다" checked={recordingAi}
        disabled={busy || blocked !== null} onChange={setRecordingAi} />
      {!privacy && <>
        <WireChoice type="checkbox" label="개인정보 동의 없이 긴급 등록합니다" checked={emergency}
          disabled={busy || blocked !== null} onChange={setEmergency} />
        {emergency && <WireFormField label="긴급 등록 사유" htmlFor="register-emergency" required>
          <input id="register-emergency" value={emergencyReason} required disabled={busy}
            onChange={(event) => setEmergencyReason(event.target.value)} />
        </WireFormField>}
      </>}
      <div className="business-actions">
        <WireButton type="submit" variant="primary" disabled={busy || blocked !== null || programId === ''}>
          등록하기
        </WireButton>
      </div>
    </form>
  </WireCard>;
}

function ProgramConsent({ program, session, onSaved }: {
  program: ParticipantProgram; session: Session; onSaved: () => void;
}) {
  const onFailure = useSessionFailure(session);
  const [privacy, setPrivacy] = useState(program.consent.privacy);
  const [recordingAi, setRecordingAi] = useState(program.consent.recordingAi);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const changed = privacy !== program.consent.privacy || recordingAi !== program.consent.recordingAi;

  const save = async () => {
    if (busy || !changed) return;
    setBusy(true);
    setError(null);
    try {
      await session.participants.updateConsent(program.id, { privacy, recordingAi });
      onSaved();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      onFailure(safe);
    } finally {
      setBusy(false);
    }
  };

  return <>
    {error && <WireError>{error.message}</WireError>}
    <WireChoice type="checkbox" label="개인정보 수집과 이용 동의" checked={privacy} disabled={busy} onChange={setPrivacy} />
    <WireChoice type="checkbox" label="AI를 활용한 녹취기록 동의" checked={recordingAi} disabled={busy} onChange={setRecordingAi} />
    <div className="business-actions">
      <WireButton variant="primary" disabled={busy || !changed} onClick={() => { void save(); }}>동의 상태 저장</WireButton>
    </div>
  </>;
}

export function ParticipantHubScreen() {
  const session = useOutletContext<Session>();
  const onFailure = useSessionFailure(session);
  const { beneficiaryId = '' } = useParams();
  const load = useCallback(() => session.participants.hub(beneficiaryId), [session.participants, beneficiaryId]);
  const { value, error, reload } = useLoaded<ParticipantHub>(load, onFailure);

  if (error) {
    return <WireCard>
      <WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={reload}>다시 불러오기</WireButton></div>
    </WireCard>;
  }
  if (value === null) return <WireCard><WireEmpty live reserve>당사자 정보를 불러오고 있습니다.</WireEmpty></WireCard>;

  return <>
    <WireCard title={participantTitle(value.participantName, value.beneficiaryId)}>
      <WireDataRows>
        <WireDataRow label="ID" value={value.beneficiaryId} />
        <WireDataRow label="연락처" value={value.participantPhone ?? '등록되지 않음'} />
        <WireDataRow label="이메일" value={value.participantEmail ?? '등록되지 않음'} />
      </WireDataRows>
      <div className="business-actions">
        <WireButton variant="neutral" href={`/participants/${encodeURIComponent(value.beneficiaryId)}/edit`}>
          기본정보 수정
        </WireButton>
      </div>
      <WireCallout tone="info" title="아직 싣지 않는 정보">
        생년월일과 진행 상태는 이 허브 응답에 없습니다. 서버가 실을 때까지 화면이 만들어 채우지 않습니다.
      </WireCallout>
    </WireCard>
    <WireCard title="참여 사업">
      {value.programs.length === 0 && <WireEmpty>참여 중인 사업이 없습니다.</WireEmpty>}
      {value.programs.map((program) => <WireCardSection key={program.id}
        title={program.status === 'active' ? '진행 중인 사업' : '종결된 사업'}>
        <WireDataRows>
          <WireDataRow label="담당 실무자"
            value={program.assigneeNames.length === 0 ? '이름이 등록된 담당 실무자가 없습니다' : program.assigneeNames.join(', ')} />
          <WireDataRow label="인테이크" value={program.intakeAt ?? '아직 없음'} />
          <WireDataRow label="다음 일정"
            value={program.upcomingSchedule === null ? '예정 없음' : program.upcomingSchedule.scheduledAt} />
          <WireDataRow label="동의 기록 시각" value={program.consentRecordedAt ?? '기록 없음'} />
        </WireDataRows>
        {program.authorized
          ? <ProgramConsent program={program} session={session} onSaved={reload} />
          : <WireCallout tone="info" title="담당하지 않는 사업">
            이 사업의 상담 내용과 동의 수정은 담당 실무자만 할 수 있습니다. 배정 요청 기능은 아직 연결되지 않았습니다.
          </WireCallout>}
      </WireCardSection>)}
    </WireCard>
  </>;
}

export function ParticipantBasicInfoScreen() {
  const session = useOutletContext<Session>();
  const onFailure = useSessionFailure(session);
  const { beneficiaryId = '' } = useParams();
  const load = useCallback(() => session.participants.basicInfo(beneficiaryId), [session.participants, beneficiaryId]);
  const { value, error: loadError, reload } = useLoaded<ParticipantBasicInfo>(load, onFailure);
  const [draft, setDraft] = useState<Record<BasicInfoField, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);

  useEffect(() => {
    if (value === null || draft !== null) return;
    setDraft(Object.fromEntries(
      BASIC_INFO_FIELDS.map((field) => [field, value[field] ?? '']),
    ) as Record<BasicInfoField, string>);
  }, [value, draft]);

  const save = async () => {
    if (busy || value === null || draft === null) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const patch = Object.fromEntries(
        BASIC_INFO_FIELDS.map((field) => [field, draft[field].trim() === '' ? null : draft[field].trim()]),
      ) as Record<BasicInfoField, string | null>;
      await session.participants.saveBasicInfo(beneficiaryId, {
        supportCaseContextId: value.supportCaseContextId, expectedVersion: value.version, ...patch,
      });
      setDraft(null);
      reload();
      setSaved(true);
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      onFailure(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCard title="기본정보 수정">
    {loadError && <><WireError>{loadError.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={reload}>다시 불러오기</WireButton></div></>}
    {error && <><WireError>{error.message}</WireError>
      {error.code === 'conflict' && <div className="business-actions">
        <WireButton variant="neutral" onClick={reload}>최신 정보 다시 읽기</WireButton>
      </div>}</>}
    {saved && error === null && <WireCallout tone="info" title="저장했습니다">서버가 받은 값으로 다시 읽었습니다.</WireCallout>}
    {value === null && loadError === null && <WireEmpty live reserve>기본정보를 불러오고 있습니다.</WireEmpty>}
    {value !== null && draft !== null && <form className="business-form" onSubmit={(event) => {
      event.preventDefault();
      void save();
    }}>
      {BASIC_INFO_FIELDS.map((field) => <WireFormField key={field} label={BASIC_INFO_LABELS[field]} htmlFor={`basic-${field}`}>
        <input id={`basic-${field}`} value={draft[field]} autoComplete="off" disabled={busy}
          onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />
      </WireFormField>)}
      <div className="business-actions">
        <WireButton type="submit" variant="primary" disabled={busy}>저장</WireButton>
      </div>
    </form>}
  </WireCard>;
}
