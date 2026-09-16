'use client';

import {
  Icon,
  WireButton,
  WireCard,
  WireCardSection,
  WireChoice,
} from '@ccc/wire';
import type {
  ProgramListResponse,
  ProgramProcessingMode,
  ProgramStorageMode,
  ProgramView,
} from '@ccc/contracts/program-admission';
import { useState } from 'react';

const GUIDE_URL = 'https://github.com/SocialSolidarityBank/CCC-new/blob/main/docs/manual/project-admission-check.md';

type AdmissionCopy = ProgramListResponse['admissionCopy'];
type Installation = ProgramListResponse['installation'];

export interface ProgramAdmissionFormProps {
  program: ProgramView;
  admissionCopy: AdmissionCopy;
  installation: Installation;
  action: (formData: FormData) => void | Promise<void>;
}

export function ProgramAdmissionForm({ program, admissionCopy, installation, action }: ProgramAdmissionFormProps) {
  const [storageMode, setStorageMode] = useState<ProgramStorageMode | null>(
    program.storageMode === 'undecided' ? null : program.storageMode,
  );
  const [processingMode, setProcessingMode] = useState<ProgramProcessingMode | null>(
    program.processingMode === 'undecided' ? null : program.processingMode,
  );
  const [confirmed, setConfirmed] = useState(program.admissionState === 'ready');
  const communityCloud = installation.deploymentMode === 'community-cloud';
  const choicesDecided = (!communityCloud || (storageMode !== null && storageMode !== 'undecided'))
    && processingMode !== null && processingMode !== 'undecided';
  const { copy } = admissionCopy;

  const chooseStorage = (mode: ProgramStorageMode) => (checked: boolean) => {
    if (checked) {
      setStorageMode(mode);
      setConfirmed(false);
    }
  };
  const chooseProcessing = (mode: ProgramProcessingMode) => (checked: boolean) => {
    if (checked) {
      setProcessingMode(mode);
      setConfirmed(false);
    }
  };

  return (
    <form action={action}>
      <input type="hidden" name="programId" value={program.id} />
      <input type="hidden" name="expectedVersion" value={program.version} />
      <input type="hidden" name="deploymentMode" value={installation.deploymentMode} />
      <input type="hidden" name="copyVersion" value={admissionCopy.version} />
      <input type="hidden" name="copyHash" value={admissionCopy.hash} />
      <input type="hidden" name="installationPolicyVersion" value={installation.policyVersion} />
      <input type="hidden" name="installationConfigHash" value={installation.configHash} />

      <WireCard
        as="section"
        className="settings-section wire-form-card"
        labelledBy={`program-admission-${program.id}`}
        title={<h2 id={`program-admission-${program.id}`}>사업 도입 확인</h2>}
      >
        <p className="panel-meta">{program.displayName ?? '사업 이름 설정 전'}</p>

        {communityCloud ? (
          <WireCardSection title={copy.storage.heading}>
            <p className="wire-form-hint">{copy.storage.installationNotice}</p>
            <div className="wire-choice-group" data-layout="stack" role="radiogroup" aria-label={copy.storage.heading}>
              <WireChoice
                type="radio"
                name="storageMode"
                value="supabase_seoul"
                label={copy.storage.options.supabase_seoul.label}
                desc={copy.storage.options.supabase_seoul.description}
                checked={storageMode === 'supabase_seoul'}
                onChange={chooseStorage('supabase_seoul')}
              />
              <WireChoice
                type="radio"
                name="storageMode"
                value="naver_public"
                label={copy.storage.options.naver_public.label}
                desc={<>{copy.storage.options.naver_public.description}<br />{copy.storage.options.naver_public.disabledNotice}</>}
                disabled
                checked={false}
              />
              <WireChoice
                type="radio"
                name="storageMode"
                value="undecided"
                label={copy.storage.options.undecided.label}
                desc={copy.storage.options.undecided.description}
                checked={storageMode === 'undecided'}
                onChange={chooseStorage('undecided')}
              />
            </div>
            <p className="wire-form-hint"><a href={GUIDE_URL} target="_blank" rel="noreferrer">{copy.guideLinkLabel}</a></p>
          </WireCardSection>
        ) : null}

        <WireCardSection title={copy.processing.heading}>
          <div className="wire-choice-group" data-layout="stack" role="radiogroup" aria-label={copy.processing.heading}>
            <WireChoice
              type="radio"
              name="processingMode"
              value="external_allowed"
              label={copy.processing.options.external_allowed.label}
              desc={(
                <>
                  {copy.processing.options.external_allowed.description}<br />
                  {copy.processing.options.external_allowed.aiNotice}<br />
                  {copy.processing.options.external_allowed.speechNotice}
                </>
              )}
              checked={processingMode === 'external_allowed'}
              onChange={chooseProcessing('external_allowed')}
            />
            <WireChoice
              type="radio"
              name="processingMode"
              value="internal_only"
              label={copy.processing.options.internal_only.label}
              desc={<>{copy.processing.options.internal_only.description}<br />{copy.processing.options.internal_only.notice}</>}
              checked={processingMode === 'internal_only'}
              onChange={chooseProcessing('internal_only')}
            />
            <WireChoice
              type="radio"
              name="processingMode"
              value="undecided"
              label={copy.processing.options.undecided.label}
              desc={copy.processing.options.undecided.description}
              checked={processingMode === 'undecided'}
              onChange={chooseProcessing('undecided')}
            />
          </div>
          <p className="wire-form-hint"><a href={GUIDE_URL} target="_blank" rel="noreferrer">{copy.guideLinkLabel}</a></p>
        </WireCardSection>

        <p className="wire-form-hint">{copy.footerNotice}</p>
        {choicesDecided ? (
          <WireChoice
            type="checkbox"
            name="confirmed"
            value="yes"
            label={copy.confirmation}
            checked={confirmed}
            onChange={setConfirmed}
          />
        ) : null}
        <div className="onboarding-actions">
          <WireButton type="submit" variant="primary" icon={<Icon name="check" />}>저장</WireButton>
        </div>
      </WireCard>
    </form>
  );
}
