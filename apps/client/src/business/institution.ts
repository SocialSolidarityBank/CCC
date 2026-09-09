// 기관 초기 설정과 사업 도입 확인의 실제 API 경계 (D86 초기 설정, D87 도입 확인).
// 준비 상태는 /me의 관측값이 정본이고, 이 모듈은 저장과 사업 목록만 맡는다.

import type { InstitutionReadiness } from '@ccc/contracts/institution';
import {
  PROGRAM_ADMISSION_COPY,
  PROGRAM_ADMISSION_COPY_VERSION,
  type ProgramAdmissionState,
  type ProgramProcessingMode,
  type ProgramStorageMode,
} from '@ccc/contracts/program-admission';
import { sha256Hex } from '@ccc/contracts/consent';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import type { DeploymentMode } from '@ccc/contracts/runtime';
import { decodeInstitutionReadiness, isAdmissionState, isNullableString, isOpaqueIdentifier, record } from './api';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

export interface ProgramConfirmationInput {
  copyVersion: string;
  copyHash: string;
  installationPolicyVersion: number;
  installationConfigHash: string;
}

export interface ProgramSummary {
  id: string;
  displayName: string | null;
  status: 'active' | 'closed';
  storageMode: ProgramStorageMode;
  processingMode: ProgramProcessingMode;
  version: number;
  admissionState: ProgramAdmissionState;
  confirmedAt: string | null;
}

export interface ProgramsView {
  programs: ProgramSummary[];
  /**
   * 화면이 실제로 보여 주는 문안의 hash와 버전이 서버가 hash한 것과 같을 때만 확인을 연다.
   * 버전만 맞고 내용이 다르면 확인은 잠긴다 - 안 읽은 문안에 확인 도장을 찍지 않는다.
   */
  admissionCopy: { version: string; hash: string; matchesDisplayedCopy: boolean };
  installation: {
    deploymentMode: DeploymentMode;
    sttMode: 'off' | 'local' | 'azure';
    llmMode: 'off' | 'openai';
    policyVersion: number;
    configHash: string;
  };
}

const STORAGE_MODES: readonly ProgramStorageMode[] = ['supabase_seoul', 'naver_public', 'local_encrypted', 'undecided'];
const PROCESSING_MODES: readonly ProgramProcessingMode[] = ['external_allowed', 'internal_only', 'undecided'];

function decodeProgram(value: unknown): ProgramSummary {
  const row = record(value);
  const confirmation = row.confirmation === null ? null : record(row.confirmation);
  if (!isOpaqueIdentifier(row.id) || !isNullableString(row.displayName)
    || (row.status !== 'active' && row.status !== 'closed')
    || !(STORAGE_MODES as readonly unknown[]).includes(row.storageMode)
    || !(PROCESSING_MODES as readonly unknown[]).includes(row.processingMode)
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
    || !isAdmissionState(row.admissionState)
    || (confirmation !== null && typeof confirmation.at !== 'string')) throw new BusinessError('invalid_response');
  return {
    id: row.id, displayName: row.displayName, status: row.status,
    storageMode: row.storageMode as ProgramStorageMode, processingMode: row.processingMode as ProgramProcessingMode,
    version: row.version, admissionState: row.admissionState,
    confirmedAt: confirmation === null ? null : confirmation.at as string,
  };
}

/** 화면이 보여 줄 정본 문안의 hash. 서버 hash와 대조하는 값이며 확인 근거로 대신 쓰지 않는다. */
let displayedCopyHash: Promise<string> | undefined;
export function displayedAdmissionCopyHash(): Promise<string> {
  displayedCopyHash ??= sha256Hex(canonicalizeJcs(PROGRAM_ADMISSION_COPY));
  return displayedCopyHash;
}

export function decodePrograms(value: unknown, displayedHash: string): ProgramsView {
  const row = record(value);
  const copy = record(row.admissionCopy);
  const installation = record(row.installation);
  if (!Array.isArray(row.programs) || typeof copy.version !== 'string' || !copy.version
    || typeof copy.hash !== 'string' || !/^[a-f0-9]{64}$/.test(copy.hash)
    || (installation.deploymentMode !== 'community-cloud' && installation.deploymentMode !== 'local-single'
      && installation.deploymentMode !== 'local-office')
    || (installation.sttMode !== 'off' && installation.sttMode !== 'local' && installation.sttMode !== 'azure')
    || (installation.llmMode !== 'off' && installation.llmMode !== 'openai')
    || typeof installation.policyVersion !== 'number' || !Number.isSafeInteger(installation.policyVersion)
    || typeof installation.configHash !== 'string' || !installation.configHash) {
    throw new BusinessError('invalid_response');
  }
  return {
    programs: row.programs.map(decodeProgram),
    admissionCopy: {
      version: copy.version, hash: copy.hash,
      matchesDisplayedCopy: copy.version === PROGRAM_ADMISSION_COPY_VERSION && copy.hash === displayedHash,
    },
    installation: {
      deploymentMode: installation.deploymentMode, sttMode: installation.sttMode, llmMode: installation.llmMode,
      policyVersion: installation.policyVersion, configHash: installation.configHash,
    },
  };
}

export class InstitutionApi {
  constructor(private readonly transport: BusinessTransport) {}

  /** 기관 이름과 첫 사업 이름을 저장한다. 준비 완료 판정은 응답의 institution만 읽는다. */
  async completeInitialSetup(input: { orgName: string; programDisplayName: string }): Promise<InstitutionReadiness> {
    const orgName = input.orgName.trim();
    const programDisplayName = input.programDisplayName.trim();
    if (!orgName || orgName.length > 80 || !programDisplayName || programDisplayName.length > 120) {
      throw new BusinessError('invalid_request', 400);
    }
    const response = record(await this.transport.request('/organization/onboarding', 'POST', {
      orgName, programDisplayName,
    }));
    if (typeof response.orgId !== 'string') throw new BusinessError('invalid_response');
    return decodeInstitutionReadiness(response.institution, response.orgId);
  }

  async listPrograms(): Promise<ProgramsView> {
    const [payload, displayedHash] = await Promise.all([
      this.transport.request('/programs'), displayedAdmissionCopyHash(),
    ]);
    return decodePrograms(payload, displayedHash);
  }

  /** 저장 위치와 처리 경로 선택, 그리고 관리자 확인을 한 번에 보낸다. 확인값은 서버가 만든다. */
  async confirmProgram(input: {
    programId: string;
    expectedVersion: number;
    storageMode: ProgramStorageMode;
    processingMode: ProgramProcessingMode;
    confirmation: ProgramConfirmationInput;
  }): Promise<ProgramSummary> {
    if (!isOpaqueIdentifier(input.programId) || !Number.isSafeInteger(input.expectedVersion)) {
      throw new BusinessError('invalid_request', 400);
    }
    const response = record(await this.transport.request(
      `/programs/${encodeURIComponent(input.programId)}`, 'PATCH',
      {
        expectedVersion: input.expectedVersion,
        storageMode: input.storageMode,
        processingMode: input.processingMode,
        confirmation: input.confirmation,
      },
    ));
    return decodeProgram(response.program);
  }
}
