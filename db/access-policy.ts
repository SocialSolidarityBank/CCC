export const INSTITUTION_ROLE_KINDS = [
  'institution_admin',
  'institution_technical_admin',
  'practice_supervisor',
  'practitioner',
] as const;

export type InstitutionRoleKind = (typeof INSTITUTION_ROLE_KINDS)[number];

export const UNSCOPED_INSTITUTION_ROLES = [
  'institution_admin',
  'institution_technical_admin',
  'practitioner',
] as const satisfies readonly InstitutionRoleKind[];

export interface SupportCaseContentAccessFacts {
  readonly hasActiveAssignment: boolean;
  readonly hasActiveTeamSupervision: boolean;
  readonly hasActiveInstitutionAdminRole: boolean;
}

export type SupportCaseContentAccessDecision =
  | {
      readonly kind: 'allowed';
      readonly basis: 'assignment' | 'team_supervision' | 'institution_admin';
    }
  | {
      readonly kind: 'denied';
    };

export function decideSupportCaseContentAccess(
  facts: SupportCaseContentAccessFacts,
): SupportCaseContentAccessDecision {
  if (facts.hasActiveAssignment) {
    return { kind: 'allowed', basis: 'assignment' };
  }
  if (facts.hasActiveTeamSupervision) {
    return { kind: 'allowed', basis: 'team_supervision' };
  }
  if (facts.hasActiveInstitutionAdminRole) {
    return { kind: 'allowed', basis: 'institution_admin' };
  }
  return { kind: 'denied' };
}
