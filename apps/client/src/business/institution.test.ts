import { describe, expect, it } from 'vitest';
import { PROGRAM_ADMISSION_COPY_VERSION } from '@ccc/contracts/program-admission';
import { decodeInstitutionReadiness } from './api';
import { decodePrograms, displayedAdmissionCopyHash } from './institution';
import { BusinessError } from './errors';
import { readiness } from './test-support';

const program = {
  id: 'program-1', orgId: 'org-1', displayName: '금전 지원', status: 'active',
  programType: 'financial_support_v1', storageMode: 'supabase_seoul', processingMode: 'external_allowed',
  version: 3, confirmation: null, admissionState: 'confirmation_required', staff: [],
};

function payload(hash: string, version = PROGRAM_ADMISSION_COPY_VERSION) {
  return {
    programs: [program],
    staffOptions: [],
    admissionCopy: { version, hash, copy: { unread: '서버가 보낸 다른 문안' } },
    installation: {
      deploymentMode: 'community-cloud', sttMode: 'off', llmMode: 'off',
      policyVersion: 2, configHash: 'config-hash',
    },
  };
}

describe('program admission copy integrity', () => {
  it('locks confirmation when the displayed copy does not hash to the served hash', async () => {
    const displayed = await displayedAdmissionCopyHash();
    const otherContent = 'f'.repeat(64);
    expect(otherContent).not.toBe(displayed);
    // 같은 버전이어도 내용이 다르면 확인을 열지 않는다.
    expect(decodePrograms(payload(otherContent), displayed).admissionCopy.matchesDisplayedCopy).toBe(false);
    expect(decodePrograms(payload(displayed), displayed).admissionCopy.matchesDisplayedCopy).toBe(true);
    expect(decodePrograms(payload(displayed, 'D87-v0'), displayed).admissionCopy.matchesDisplayedCopy).toBe(false);
  });

  it('keeps the served program version and state instead of assuming readiness', async () => {
    const displayed = await displayedAdmissionCopyHash();
    const view = decodePrograms(payload(displayed), displayed);
    expect(view.programs[0]).toMatchObject({ version: 3, admissionState: 'confirmation_required', confirmedAt: null });
  });
});

describe('institution readiness boundary', () => {
  it('rejects a readiness payload that drops an axis or belongs to another institution', () => {
    const { creatorLinkState: _dropped, ...missingAxis } = readiness('org-1');
    expect(() => decodeInstitutionReadiness(missingAxis, 'org-1')).toThrow(BusinessError);
    expect(() => decodeInstitutionReadiness(readiness('other-org'), 'org-1')).toThrow(BusinessError);
    expect(() => decodeInstitutionReadiness(readiness('org-1', { initialSetupState: 'ready' }), 'org-1'))
      .toThrow(BusinessError);
  });

  it('keeps the three independent axes apart', () => {
    const value = decodeInstitutionReadiness(readiness('org-1', {
      creatorLinkState: 'linked', initialSetupState: 'complete', firstProgramAdmissionState: 'not_admitted',
      firstProgram: {
        id: 'program-1', displayName: '금전 지원', programType: 'financial_support_v1',
        admissionState: 'confirmation_required', status: 'active', version: 3,
      },
    }), 'org-1');
    expect(value.creatorLinkState).toBe('linked');
    expect(value.initialSetupState).toBe('complete');
    expect(value.firstProgramAdmissionState).toBe('not_admitted');
    expect(value.firstProgram?.admissionState).toBe('confirmation_required');
  });
});
