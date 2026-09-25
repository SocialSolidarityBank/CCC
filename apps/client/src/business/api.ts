import type { ActorRole } from '@ccc/contracts/runtime';
import type { MemorySettingsInput, MemorySettingsView } from '@ccc/contracts/counseling-memory';
import { BusinessError } from './errors';
import { BusinessTransport } from './transport';

export type HumanRole = Exclude<ActorRole, 'service'>;
export const ROLE_LABELS: Record<HumanRole, string> = {
  'institution-admin': '기관 관리자', 'technical-admin': '기관 기술 관리자',
  supervisor: '실무 책임자', worker: '실무자',
};
export interface MyIdentity {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  active: true;
  roles: HumanRole[];
}
export interface OrganizationProfile {
  orgId: string;
  orgName: string | null;
  programDisplayName: string | null;
}
export interface OrganizationProfileInput { orgName: string; expectedOrgName: string | null }

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_response');
  return value as Record<string, unknown>;
}
function isHumanRole(value: unknown): value is HumanRole {
  return typeof value === 'string' && Object.hasOwn(ROLE_LABELS, value);
}
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function decodeIdentity(value: unknown): MyIdentity {
  const row = record(value);
  if (typeof row.id !== 'string' || !row.id || typeof row.orgId !== 'string' || !row.orgId
    || typeof row.email !== 'string' || !isNullableString(row.name) || row.active !== true
    || !Array.isArray(row.roles) || !row.roles.every(isHumanRole)) throw new BusinessError('invalid_response');
  return { id: row.id, orgId: row.orgId, email: row.email, name: row.name, active: true, roles: row.roles };
}

export function decodeMemorySettings(value: unknown): MemorySettingsView {
  const row = record(value);
  const keys = ['enabled', 'version', 'pendingCases', 'blockedCases', 'failedCases', 'lastSuccessAt'];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))
    || typeof row.enabled !== 'boolean' || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
    || typeof row.pendingCases !== 'number' || !Number.isSafeInteger(row.pendingCases) || row.pendingCases < 0
    || typeof row.blockedCases !== 'number' || !Number.isSafeInteger(row.blockedCases) || row.blockedCases < 0
    || typeof row.failedCases !== 'number' || !Number.isSafeInteger(row.failedCases) || row.failedCases < 0
    || !isNullableString(row.lastSuccessAt) || (row.lastSuccessAt !== null && !Number.isFinite(Date.parse(row.lastSuccessAt)))) {
    throw new BusinessError('invalid_response');
  }
  return { enabled: row.enabled, version: row.version, pendingCases: row.pendingCases,
    blockedCases: row.blockedCases, failedCases: row.failedCases, lastSuccessAt: row.lastSuccessAt };
}

/** 역할 판단은 /me의 canonical roles만 사용한다. legacy role과 URL 미리보기 값은 읽지 않는다. */
export class SettingsApi {
  private identity: MyIdentity | null = null;
  constructor(private readonly transport: BusinessTransport) {}

  async me(): Promise<MyIdentity> {
    this.identity = decodeIdentity(await this.transport.request('/me'));
    return this.identity;
  }

  private requireAdmin(): MyIdentity {
    if (!this.identity?.roles.includes('institution-admin')) throw new BusinessError('forbidden', 403);
    return this.identity;
  }

  private profile(value: unknown): OrganizationProfile {
    const row = record(value);
    if (!this.identity || row.orgId !== this.identity.orgId
      || !isNullableString(row.orgName) || !isNullableString(row.programDisplayName)) throw new BusinessError('invalid_response');
    return { orgId: this.identity.orgId, orgName: row.orgName, programDisplayName: row.programDisplayName };
  }

  async getProfile(): Promise<OrganizationProfile> {
    this.requireAdmin();
    return this.profile(await this.transport.request('/organization/profile'));
  }

  async saveProfile(input: OrganizationProfileInput): Promise<OrganizationProfile> {
    this.requireAdmin();
    const orgName = input.orgName.trim();
    if (!orgName || orgName.length > 80) throw new BusinessError('invalid_request', 400);
    return this.profile(await this.transport.request('/organization/profile', 'PATCH', {
      orgName, expectedOrgName: input.expectedOrgName,
    }));
  }

  async getMemory(): Promise<MemorySettingsView> {
    this.requireAdmin();
    return decodeMemorySettings(await this.transport.request('/settings/counseling-memory'));
  }

  async saveMemory(input: MemorySettingsInput): Promise<MemorySettingsView> {
    this.requireAdmin();
    return decodeMemorySettings(await this.transport.request('/settings/counseling-memory', 'PUT', {
      enabled: input.enabled, expectedVersion: input.expectedVersion,
    }));
  }
}
