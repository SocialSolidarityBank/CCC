// 실무자 초대는 목록과 취소만 제공한다. 발급과 수락은 서버 계약이 준비될 때까지 닫아 둔다.
// 당사자 접점은 목적 하나짜리 요청 링크이며 공개 전송기는 Bearer를 붙이지 않는다.

import type { ConsentDisclosureSnapshot } from '@ccc/contracts/consent';
import { isNullableString, isOpaqueIdentifier, record } from './api';
import { decodeDisclosures } from './consent';
import { BusinessError } from './errors';
import type { BusinessTransport, PublicTransport } from './transport';

/** 서버가 저장하는 역할 이름. 화면 역할 이름과 철자가 다르다. */
export type InviteStoredRole = 'institution_admin' | 'institution_technical_admin' | 'supervisor' | 'practitioner';
export const INVITE_ROLE_LABELS: Record<InviteStoredRole, string> = {
  institution_admin: '기관 관리자',
  institution_technical_admin: '기관 기술 관리자',
  supervisor: '실무 책임자',
  practitioner: '실무자',
};
export const INVITE_STATUS_LABELS: Record<StaffInvite['status'], string> = {
  issued: '보냄', used: '가입 완료', revoked: '취소됨',
};

export interface StaffInvite {
  id: string;
  email: string;
  roles: InviteStoredRole[];
  status: 'issued' | 'used' | 'revoked';
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export type RequestLinkInfo =
  | { status: 'issued'; programId: string; programType: string; orgName: string | null; expiresAt: string }
  | { status: 'used'; counselorName: string | null; message: string };

function isStoredRole(value: unknown): value is InviteStoredRole {
  return typeof value === 'string' && Object.hasOwn(INVITE_ROLE_LABELS, value);
}

function decodeInvite(value: unknown): StaffInvite {
  const row = record(value);
  if (!isOpaqueIdentifier(row.id) || typeof row.email !== 'string'
    || !Array.isArray(row.roles) || !row.roles.every(isStoredRole)
    || (row.status !== 'issued' && row.status !== 'used' && row.status !== 'revoked')
    || typeof row.issuedAt !== 'string' || typeof row.expiresAt !== 'string'
    || !isNullableString(row.usedAt) || !isNullableString(row.revokedAt)) {
    throw new BusinessError('invalid_response');
  }
  return {
    id: row.id, email: row.email, roles: row.roles as InviteStoredRole[], status: row.status,
    issuedAt: row.issuedAt, expiresAt: row.expiresAt, usedAt: row.usedAt, revokedAt: row.revokedAt,
  };
}

/** 기존 실무자 초대 관리와 당사자 요청 링크 발급. */
export class InvitesApi {
  constructor(private readonly transport: BusinessTransport) {}

  async list(): Promise<StaffInvite[]> {
    const row = record(await this.transport.request('/staff-invites'));
    if (!Array.isArray(row.invites)) throw new BusinessError('invalid_response');
    return row.invites.map(decodeInvite);
  }


  async revoke(inviteId: string): Promise<StaffInvite> {
    if (!isOpaqueIdentifier(inviteId)) throw new BusinessError('invalid_request', 400);
    const row = record(await this.transport.request(
      `/staff-invites/${encodeURIComponent(inviteId)}/revoke`, 'POST', {},
    ));
    return decodeInvite(row.invite);
  }

  /**
   * 당사자 요청 링크 발급. 목적 하나, 만료는 서버가 정한다(7일).
   * 이 설치가 공개 가입 표면을 닫아 두면 서버는 404 로 답한다(CCC-112). 연결 실패가 아니므로
   * 다시 시도하라고 하지 않고 그 사실을 그대로 알리는 코드로 바꾼다.
   */
  async createRequestLink(programId: string): Promise<{ token: string; expiresAt: string | null }> {
    if (!isOpaqueIdentifier(programId)) throw new BusinessError('invalid_request', 400);
    const row = record(await this.transport.request('/invites/participant', 'POST', { programId })
      .catch((cause: unknown) => {
        if (cause instanceof BusinessError && cause.status === 404) {
          throw new BusinessError('public_signup_disabled', 404);
        }
        throw cause;
      }));
    if (typeof row.token !== 'string' || row.token === '' || !isNullableString(row.expiresAt)) {
      throw new BusinessError('invalid_response');
    }
    return { token: row.token, expiresAt: row.expiresAt };
  }
}

/** 토큰만 갖고 도는 공개 화면의 경계. Bearer 도 업무 API 도 쓰지 않는다. */
export class PublicJoinApi {
  constructor(private readonly transport: PublicTransport) {}


  async requestLink(token: string): Promise<RequestLinkInfo> {
    const row = record(await this.transport.request(`/invites/participant/${encodeURIComponent(token)}`));
    if (row.status === 'used') {
      if (!isNullableString(row.counselorName) || typeof row.message !== 'string' || row.message === '') {
        throw new BusinessError('invalid_response');
      }
      return { status: 'used', counselorName: row.counselorName, message: row.message };
    }
    if (row.status !== 'issued' || typeof row.programId !== 'string' || typeof row.programType !== 'string'
      || !isNullableString(row.orgName) || typeof row.expiresAt !== 'string') {
      throw new BusinessError('invalid_response');
    }
    return {
      status: 'issued', programId: row.programId, programType: row.programType,
      orgName: row.orgName, expiresAt: row.expiresAt,
    };
  }

  async requestLinkDisclosures(token: string): Promise<ConsentDisclosureSnapshot[]> {
    return decodeDisclosures(await this.transport.request(
      `/invites/participant/${encodeURIComponent(token)}/consent/disclosures`,
    ));
  }

  async completeSignup(input: {
    token: string; name: string; phone?: string; email?: string; consentEvents: Record<string, unknown>[];
  }): Promise<{ beneficiaryId: string; supportCaseId: string }> {
    if (input.name.trim() === '') throw new BusinessError('invalid_request', 400);
    const row = record(await this.transport.request('/signup/participant', 'POST', {
      token: input.token,
      name: input.name.trim(),
      ...(input.phone === undefined || input.phone.trim() === '' ? {} : { phone: input.phone.trim() }),
      ...(input.email === undefined || input.email.trim() === '' ? {} : { email: input.email.trim() }),
      consentEvents: input.consentEvents,
    }));
    if (!isOpaqueIdentifier(row.beneficiaryId) || !isOpaqueIdentifier(row.supportCaseId)) {
      throw new BusinessError('invalid_response');
    }
    return { beneficiaryId: row.beneficiaryId, supportCaseId: row.supportCaseId };
  }
}
