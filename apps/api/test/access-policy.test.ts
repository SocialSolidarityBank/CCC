import { describe, expect, it } from 'vitest';
import { decideSupportCaseContentAccess } from '@ccc/core/access-policy';

describe('support case content access policy', () => {
  it('allows an institution administrator to read an unassigned case', () => {
    const decision = decideSupportCaseContentAccess({
      hasActiveAssignment: false,
      hasActiveTeamSupervision: false,
      hasActiveInstitutionAdminRole: true,
    });

    expect(decision).toEqual({
      kind: 'allowed',
      basis: 'institution_admin',
    });
  });

  it('denies access when no active basis exists', () => {
    expect(decideSupportCaseContentAccess({
      hasActiveAssignment: false,
      hasActiveTeamSupervision: false,
      hasActiveInstitutionAdminRole: false,
    })).toEqual({ kind: 'denied' });
  });

  it('keeps direct assignment as the primary basis for multi-role practitioners', () => {
    expect(decideSupportCaseContentAccess({
      hasActiveAssignment: true,
      hasActiveTeamSupervision: true,
      hasActiveInstitutionAdminRole: true,
    })).toEqual({
      kind: 'allowed',
      basis: 'assignment',
    });
  });
});
