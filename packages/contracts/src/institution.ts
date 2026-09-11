import type { ConsentDomain } from './consent';
import type { ProgramOption } from './program-admission';
import type { ActorRole } from './runtime';

export interface OrganizationProfile {
  orgId: string;
  orgName: string | null;
  programDisplayName: string | null;
}

/** Observations, not authorization, operator approval or hosted readiness. */
export interface InstitutionReadiness {
  orgId: string;
  orgName: string | null;
  settingsState: 'present' | 'missing';
  /** Cloud requires an installer receipt bound to the designated administrator's auth_subject. */
  creatorLinkState: 'unlinked' | 'linked' | 'not_applicable';
  /** Both the persisted institution name and named initial-program link must exist. */
  initialSetupState: 'not_set_up' | 'complete';
  /** The linked first program must be active and pass the current admission policy. */
  firstProgramAdmissionState: 'not_admitted' | 'admitted';
  /** Only the persisted initial_program_id link; never the first listing result. */
  firstProgram: (ProgramOption & { status: 'active' | 'closed'; version: number }) | null;
  installationState: 'available' | 'unavailable';
  /** Stored settings, not proof that an administrator reviewed the retention policy. */
  retentionPolicyStatus: 'missing' | 'configured' | 'review_required';
  consentCopy: {
    version: string;
    status: 'available' | 'provider_registry_unavailable';
    /** Availability to issue the canonical copy; never a participant's consent. */
    domains: Array<{ domain: ConsentDomain; disclosureAvailable: boolean }>;
  };
}

export interface MeResponse {
  id: string;
  orgId: string;
  email: string | null;
  role: 'admin' | 'counselor' | 'service';
  active: boolean;
  name: string | null;
  lastProgramType: string | null;
  roles: ActorRole[];
  institution: InstitutionReadiness;
}

export interface OrganizationOnboardingInput {
  orgName: string;
  programDisplayName: string;
}

export interface OrganizationOnboardingResponse extends OrganizationProfile {
  institution: InstitutionReadiness;
}

/** Institution/program endpoints retain these sanitized HTTP error codes. */
export type InstitutionJourneyErrorCode =
  | 'actor_authentication_required'
  | 'mfa_required'
  | 'forbidden'
  | 'invalid_request'
  | 'conflict'
  | 'service_unavailable'
  | 'internal_error';
