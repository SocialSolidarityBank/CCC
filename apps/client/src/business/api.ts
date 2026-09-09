import type { ActorRole } from '@ccc/contracts/runtime';
import type { MemorySettingsInput, MemorySettingsView } from '@ccc/contracts/counseling-memory';
import { BusinessError } from './errors';
import { BusinessTransport } from './transport';

export type HumanRole = Exclude<ActorRole, 'service'>;
export const ROLE_LABELS: Record<HumanRole, string> = {
  'institution-admin': '기관 관리자', 'technical-admin': '기관 기술 관리자',
  supervisor: '실무 책임자', worker: '실무자',
};
function isHumanRole(value: unknown): value is HumanRole {
  return typeof value === 'string' && Object.hasOwn(ROLE_LABELS, value);
}
export interface MyIdentity {
  id: string;
  orgId: string;
  email: string | null;
  name: string | null;
  active: true;
  roles: HumanRole[];
}
export interface OrganizationProfile {
  orgId: string;
  orgName: string | null;
  programDisplayName: string | null;
}
export type AssignmentRole = 'primary' | 'secondary';
export const ASSIGNMENT_ROLE_LABELS: Record<AssignmentRole, string> = {
  primary: '주 담당', secondary: '공동 담당',
};
export interface AssignmentRequest {
  id: string;
  supportCaseId: string;
  beneficiaryId: string;
  participantName: string | null;
  programType: 'financial_support_v1';
  role: AssignmentRole;
  status: 'requested';
  requestedAt: string;
}
export interface OrganizationProfileInput { orgName: string; expectedOrgName: string | null }
export type RetentionReasonKind = 'extended_consent' | 'active_work' | 'legal_requirement';
export interface RetentionReview {
  beneficiaryId: string;
  status: 'pending' | 'retained' | 'purged';
  archivedAt: string;
  reviewDueAt: string;
  retentionCapDueAt: string;
  reasonKind: RetentionReasonKind | null;
  retainUntil: string | null;
}
export type RetentionReviewInput =
  | { decision: 'retain'; reasonKind: RetentionReasonKind; reason: string; retainUntil: string }
  | { decision: 'purge' };
export interface AuditLogItem {
  id: number;
  actorId: string;
  actorRole: 'admin' | 'counselor' | 'service';
  action: string;
  targetTable: string;
  beneficiaryId: string | null;
  supportCaseId: string | null;
  createdAt: string;
}
export interface AuditLogPage { items: AuditLogItem[]; nextCursor: string | null }
export interface AuditLogFilter {
  limit?: number;
  cursor?: string;
  actorId?: string;
  from?: string;
  to?: string;
  supportCaseId?: string;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new BusinessError('invalid_response');
  return value as Record<string, unknown>;
}
function canonicalUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
function safeAuditIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isOpaqueIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
}

function assignmentRequest(value: unknown): AssignmentRequest {
  const row = record(value);
  const keys = ['id', 'supportCaseId', 'beneficiaryId', 'participantName', 'programType', 'role', 'status', 'requestedAt'];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))
    || !isOpaqueIdentifier(row.id) || !isOpaqueIdentifier(row.supportCaseId)
    || !isOpaqueIdentifier(row.beneficiaryId) || !isNullableString(row.participantName)
    || row.programType !== 'financial_support_v1'
    || (row.role !== 'primary' && row.role !== 'secondary')
    || row.status !== 'requested' || typeof row.requestedAt !== 'string'
    || !Number.isFinite(Date.parse(row.requestedAt))) throw new BusinessError('invalid_response');
  return {
    id: row.id, supportCaseId: row.supportCaseId, beneficiaryId: row.beneficiaryId,
    participantName: row.participantName, programType: row.programType, role: row.role,
    status: row.status, requestedAt: row.requestedAt,
  };
}

export function decodeAssignmentRequests(value: unknown): AssignmentRequest[] {
  const row = record(value);
  if (Object.keys(row).length !== 1 || !Array.isArray(row.requests)) throw new BusinessError('invalid_response');
  return row.requests.map(assignmentRequest);
}

export function decodeIdentity(value: unknown): MyIdentity {
  const row = record(value);
  if (typeof row.id !== 'string' || !row.id || typeof row.orgId !== 'string' || !row.orgId
    || !isNullableString(row.email) || !isNullableString(row.name) || row.active !== true
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

function decodeRetentionReview(value: unknown): RetentionReview {
  const row = record(value);
  const keys = ['beneficiaryId', 'status', 'archivedAt', 'reviewDueAt', 'retentionCapDueAt', 'reasonKind', 'retainUntil'];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))
    || !safeAuditIdentifier(row.beneficiaryId)
    || (row.status !== 'pending' && row.status !== 'retained' && row.status !== 'purged')
    || !canonicalUtc(row.archivedAt) || !canonicalUtc(row.reviewDueAt) || !canonicalUtc(row.retentionCapDueAt)
    || !(row.reasonKind === null || row.reasonKind === 'extended_consent' || row.reasonKind === 'active_work' || row.reasonKind === 'legal_requirement')
    || !(row.retainUntil === null || canonicalUtc(row.retainUntil))) throw new BusinessError('invalid_response');
  return {
    beneficiaryId: row.beneficiaryId, status: row.status, archivedAt: row.archivedAt,
    reviewDueAt: row.reviewDueAt, retentionCapDueAt: row.retentionCapDueAt,
    reasonKind: row.reasonKind, retainUntil: row.retainUntil,
  };
}
export function decodeRetentionReviews(value: unknown): RetentionReview[] {
  const row = record(value);
  if (Object.keys(row).length !== 1 || !Array.isArray(row.reviews)) throw new BusinessError('invalid_response');
  return row.reviews.map(decodeRetentionReview);
}
export function decodeRetentionReviewResponse(value: unknown): RetentionReview {
  return decodeRetentionReview(value);
}
function decodeAuditItem(value: unknown): AuditLogItem {
  const row = record(value);
  const keys = ['id', 'actorId', 'actorRole', 'action', 'targetTable', 'beneficiaryId', 'supportCaseId', 'createdAt'];
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))
    || typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < 1
    || !safeAuditIdentifier(row.actorId)
    || (row.actorRole !== 'admin' && row.actorRole !== 'counselor' && row.actorRole !== 'service')
    || !safeAuditIdentifier(row.action) || !safeAuditIdentifier(row.targetTable)
    || !(row.beneficiaryId === null || safeAuditIdentifier(row.beneficiaryId))
    || !(row.supportCaseId === null || safeAuditIdentifier(row.supportCaseId))
    || !canonicalUtc(row.createdAt)) throw new BusinessError('invalid_response');
  return {
    id: row.id, actorId: row.actorId, actorRole: row.actorRole, action: row.action,
    targetTable: row.targetTable, beneficiaryId: row.beneficiaryId, supportCaseId: row.supportCaseId,
    createdAt: row.createdAt,
  };
}
export function decodeAuditLogPage(value: unknown): AuditLogPage {
  const row = record(value);
  if (Object.keys(row).length !== 2 || !Array.isArray(row.items)
    || !(row.nextCursor === null || (typeof row.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,300}$/u.test(row.nextCursor)))) {
    throw new BusinessError('invalid_response');
  }
  return { items: row.items.map(decodeAuditItem), nextCursor: row.nextCursor };
}

/** 역할 판단은 /me의 canonical roles만 사용한다. legacy role과 URL 미리보기 값은 읽지 않는다. */
export class SettingsApi {
  private identity: MyIdentity | null = null;
  constructor(private readonly transport: BusinessTransport) {}

  async me(): Promise<MyIdentity> {
    this.identity = decodeIdentity(await this.transport.request('/me'));
    return this.identity;
  }
  async getAssignmentRequests(): Promise<AssignmentRequest[]> {
    return decodeAssignmentRequests(await this.transport.request('/assignment-requests'));
  }

  async acceptAssignment(supportCaseId: string, assignmentId: string): Promise<void> {
    if (!isOpaqueIdentifier(supportCaseId) || !isOpaqueIdentifier(assignmentId)) {
      throw new BusinessError('invalid_request', 400);
    }
    const value = await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/assignees/${encodeURIComponent(assignmentId)}/accept`,
      'POST',
    );
    const row = record(value);
    if (Object.keys(row).length !== 1 || row.accepted !== true) throw new BusinessError('invalid_response');
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
  async getAuditLog(filter: AuditLogFilter = {}): Promise<AuditLogPage> {
    this.requireAdmin();
    if ((filter.limit !== undefined && (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 100))
      || (filter.cursor !== undefined && !/^[A-Za-z0-9_-]{1,300}$/u.test(filter.cursor))
      || (filter.actorId !== undefined && !safeAuditIdentifier(filter.actorId))
      || (filter.supportCaseId !== undefined && !safeAuditIdentifier(filter.supportCaseId))
      || (filter.from !== undefined && !canonicalUtc(filter.from))
      || (filter.to !== undefined && !canonicalUtc(filter.to))
      || (filter.from !== undefined && filter.to !== undefined && Date.parse(filter.from) > Date.parse(filter.to))) {
      throw new BusinessError('invalid_request', 400);
    }
    const params = new URLSearchParams();
    if (filter.limit !== undefined) params.set('limit', String(filter.limit));
    if (filter.cursor !== undefined) params.set('cursor', filter.cursor);
    if (filter.actorId !== undefined) params.set('actorId', filter.actorId);
    if (filter.from !== undefined) params.set('from', filter.from);
    if (filter.to !== undefined) params.set('to', filter.to);
    if (filter.supportCaseId !== undefined) params.set('supportCaseId', filter.supportCaseId);
    const query = params.toString();
    return decodeAuditLogPage(await this.transport.request(query ? `/audit-log?${query}` : '/audit-log'));
  }

  async getRetentionReviews(): Promise<RetentionReview[]> {
    this.requireAdmin();
    return decodeRetentionReviews(await this.transport.request('/pii-retention/reviews'));
  }

  async reviewRetention(beneficiaryId: string, input: RetentionReviewInput): Promise<RetentionReview> {
    this.requireAdmin();
    if (!safeAuditIdentifier(beneficiaryId)) throw new BusinessError('invalid_request', 400);
    if (input.decision === 'retain'
      && (input.reasonKind !== 'extended_consent' && input.reasonKind !== 'active_work' && input.reasonKind !== 'legal_requirement'
        || !input.reason.trim() || input.reason.trim().length > 500 || !canonicalUtc(input.retainUntil))) {
      throw new BusinessError('invalid_request', 400);
    }
    if (input.decision !== 'retain' && input.decision !== 'purge') throw new BusinessError('invalid_request', 400);
    const body = input.decision === 'purge'
      ? { decision: 'purge' as const }
      : { decision: 'retain' as const, reasonKind: input.reasonKind, reason: input.reason.trim(), retainUntil: input.retainUntil };
    return decodeRetentionReviewResponse(await this.transport.request(
      `/pii-retention/reviews/${encodeURIComponent(beneficiaryId)}`, 'POST', body,
    ));
  }
}
