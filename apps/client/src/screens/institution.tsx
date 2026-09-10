import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField,
} from '@ccc/wire';
import {
  PROGRAM_ADMISSION_COPY, type ProgramProcessingMode, type ProgramStorageMode,
} from '@ccc/contracts/program-admission';
import type { InstitutionReadiness } from '@ccc/contracts/institution';
import { type BusinessError, safeError } from '../business/errors';
import type { ProgramSummary, ProgramsView } from '../business/institution';
import type { Session } from '../business/session';
import { ADMISSION_LABELS } from './participants';

const CONSENT_DOMAIN_LABELS: Record<string, string> = {
  personal_data_collection_use: '개인정보 수집과 이용',
  sensitive_information_processing: '민감정보 처리',
  counseling_recording: '상담 녹음',
  external_stt_processing: '외부 음성 인식',
  external_llm_cross_border_processing: '외부 AI 국외 처리',
  voice_original_retention_period: '원음 보관 기간',
};

function readinessRows(readiness: InstitutionReadiness) {
  return [
    ['기관 이름', readiness.orgName ?? '아직 저장되지 않음'],
    ['초기 설정', readiness.initialSetupState === 'complete' ? '완료' : '아직 끝나지 않음'],
    ['첫 사업 도입 확인', readiness.firstProgramAdmissionState === 'admitted' ? '확인 완료' : '확인 전'],
    ['첫 사업', readiness.firstProgram === null ? '연결된 사업 없음'
      : `${readiness.firstProgram.displayName ?? readiness.firstProgram.id}: ${ADMISSION_LABELS[readiness.firstProgram.admissionState]}`],
    ['설치 정보', readiness.installationState === 'available' ? '읽을 수 있음' : '읽을 수 없음'],
    ['관리자 연결', readiness.creatorLinkState === 'linked' ? '연결됨'
      : readiness.creatorLinkState === 'not_applicable' ? '이 설치에는 해당하지 않음' : '아직 연결되지 않음'],
    ['보유 기간 설정', readiness.retentionPolicyStatus === 'configured' ? '저장됨'
      : readiness.retentionPolicyStatus === 'review_required' ? '값을 다시 봐야 함' : '저장되지 않음'],
    ['동의 문안', readiness.consentCopy.status === 'available'
      ? `여섯 영역 모두 발행 가능 (${readiness.consentCopy.version})`
      : `발행할 수 없는 영역이 있음: ${readiness.consentCopy.domains.filter((entry) => !entry.disclosureAvailable)
        .map((entry) => CONSENT_DOMAIN_LABELS[entry.domain] ?? entry.domain).join(', ')}`],
  ] as const;
}

function InitialSetupForm({ session }: { session: Session }) {
  const readiness = session.me.institution;
  const [orgName, setOrgName] = useState(readiness.orgName ?? '');
  const [programName, setProgramName] = useState(readiness.firstProgram?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.institution.completeInitialSetup({ orgName, programDisplayName: programName });
      session.reloadIdentity();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <WireCardSection title="기관 초기 설정">
    {error && <WireError>{error.message}</WireError>}
    <form className="business-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <WireFormField label="기관 이름" htmlFor="setup-org" required>
        <input id="setup-org" value={orgName} required disabled={busy}
          onChange={(event) => setOrgName(event.target.value)} />
      </WireFormField>
      <WireFormField label="첫 사업 이름" htmlFor="setup-program" required>
        <input id="setup-program" value={programName} required disabled={busy}
          onChange={(event) => setProgramName(event.target.value)} />
      </WireFormField>
      <div className="business-actions">
        <WireButton type="submit" variant="primary" disabled={busy}>초기 설정 저장</WireButton>
      </div>
    </form>
  </WireCardSection>;
}

function ProgramAdmissionForm({ session, program, view, onSaved }: {
  session: Session; program: ProgramSummary; view: ProgramsView; onSaved: () => void;
}) {
  const cloud = view.installation.deploymentMode === 'community-cloud';
  const [storage, setStorage] = useState<ProgramStorageMode>(program.storageMode);
  const [processing, setProcessing] = useState<ProgramProcessingMode>(program.processingMode);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BusinessError | null>(null);
  const copy = PROGRAM_ADMISSION_COPY;
  const complete = storage !== 'undecided' && processing !== 'undecided';

  const save = async () => {
    if (busy || !acknowledged || !complete || !view.admissionCopy.matchesDisplayedCopy) return;
    setBusy(true);
    setError(null);
    try {
      await session.institution.confirmProgram({
        programId: program.id, expectedVersion: program.version, storageMode: storage, processingMode: processing,
        confirmation: {
          copyVersion: view.admissionCopy.version, copyHash: view.admissionCopy.hash,
          installationPolicyVersion: view.installation.policyVersion,
          installationConfigHash: view.installation.configHash,
        },
      });
      setAcknowledged(false);
      onSaved();
      session.reloadIdentity();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  return <>
    {error && <WireError>{error.message}</WireError>}
    <WireCardSection title={copy.storage.heading}>
      <p className="wire-section-value">{copy.storage.installationNotice}</p>
      <WireChoice type="radio" name={`storage-${program.id}`} label={copy.storage.options.supabase_seoul.label}
        desc={copy.storage.options.supabase_seoul.description} checked={storage === 'supabase_seoul'}
        disabled={busy || !cloud} onChange={() => setStorage('supabase_seoul')} />
      <WireChoice type="radio" name={`storage-${program.id}`} label={copy.storage.options.naver_public.label}
        desc={copy.storage.options.naver_public.disabledNotice} checked={false} disabled onChange={() => undefined} />
      <WireChoice type="radio" name={`storage-${program.id}`} label={copy.storage.options.undecided.label}
        desc={copy.storage.options.undecided.description} checked={storage === 'undecided'}
        disabled={busy} onChange={() => setStorage('undecided')} />
    </WireCardSection>
    <WireCardSection title={copy.processing.heading}>
      <WireChoice type="radio" name={`processing-${program.id}`} label={copy.processing.options.external_allowed.label}
        desc={copy.processing.options.external_allowed.description} checked={processing === 'external_allowed'}
        disabled={busy} onChange={() => setProcessing('external_allowed')} />
      <p className="wire-section-value">{copy.processing.options.external_allowed.aiNotice}</p>
      <p className="wire-section-value">{copy.processing.options.external_allowed.speechNotice}</p>
      <WireChoice type="radio" name={`processing-${program.id}`} label={copy.processing.options.internal_only.label}
        desc={copy.processing.options.internal_only.description} checked={processing === 'internal_only'}
        disabled={busy} onChange={() => setProcessing('internal_only')} />
      <p className="wire-section-value">{copy.processing.options.internal_only.notice}</p>
      <WireChoice type="radio" name={`processing-${program.id}`} label={copy.processing.options.undecided.label}
        desc={copy.processing.options.undecided.description} checked={processing === 'undecided'}
        disabled={busy} onChange={() => setProcessing('undecided')} />
    </WireCardSection>
    <WireCardSection title="관리자 확인">
      <p className="wire-section-value">{copy.footerNotice}</p>
      {!view.admissionCopy.matchesDisplayedCopy && <WireCallout tone="info" title="확인을 열지 않습니다">
        서버가 확인값으로 쓰는 문안과 이 화면이 보여 주는 문안이 같지 않습니다. 화면을 최신으로 올린 뒤에 확인해 주세요.
      </WireCallout>}
      <WireChoice type="checkbox" label={copy.confirmation} checked={acknowledged}
        disabled={busy || !complete || !view.admissionCopy.matchesDisplayedCopy}
        onChange={setAcknowledged} />
      <div className="business-actions">
        <WireButton variant="primary"
          disabled={busy || !acknowledged || !complete || !view.admissionCopy.matchesDisplayedCopy}
          onClick={() => { void save(); }}>확인 저장</WireButton>
      </div>
    </WireCardSection>
  </>;
}

/** 이 화면은 기관 관리자 전용 route다. 셸이 권한을 먼저 막고, 여기서는 저장과 확인만 다룬다. */
export function InstitutionScreen() {
  const session = useOutletContext<Session>();
  const readiness = session.me.institution;
  const [programs, setPrograms] = useState<ProgramsView | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);

  const loadPrograms = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.institution.listPrograms().then((value) => {
      if (own === generation.current) setPrograms(value);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.institution, session.auth]);

  useEffect(() => {
    loadPrograms();
    return () => { generation.current += 1; };
  }, [loadPrograms]);

  return <>
    <WireCard title="기관 준비 상태">
      <WireDataRows>
        {readinessRows(readiness).map(([label, value]) => <WireDataRow key={label} label={label} value={value} />)}
      </WireDataRows>
      <WireCallout tone="info" title="이 값이 뜻하는 것">
        서버가 저장된 상태를 관측한 결과입니다. 실제 인증이나 외부 연결이 준비됐다는 뜻은 아닙니다.
      </WireCallout>
    </WireCard>
    <WireCard title="초기 설정과 사업 도입 확인">
      <InitialSetupForm session={session} />
      {error && <WireError>{error.message}</WireError>}
      {programs === null && error === null && <WireEmpty live reserve>사업 목록을 불러오고 있습니다.</WireEmpty>}
      {programs !== null && programs.programs.length === 0
        && <WireEmpty>등록된 사업이 없습니다. 초기 설정으로 첫 사업을 만들어 주세요.</WireEmpty>}
      {programs?.programs.map((program) => <WireCardSection key={program.id}
        title={program.displayName ?? program.id}
        action={<WireBadge tone={program.admissionState === 'ready' ? 'mint' : 'neutral'}>
          {ADMISSION_LABELS[program.admissionState]}
        </WireBadge>}>
        <WireDataRows>
          <WireDataRow label="사업 상태" value={program.status === 'active' ? '진행 중' : '종결'} />
          <WireDataRow label="마지막 확인" value={program.confirmedAt ?? '확인 기록 없음'} />
        </WireDataRows>
        <ProgramAdmissionForm session={session} program={program} view={programs} onSaved={loadPrograms} />
      </WireCardSection>)}
    </WireCard>
  </>;
}
