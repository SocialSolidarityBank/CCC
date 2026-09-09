import type { DeploymentMode } from './runtime';

/**
 * D87 사업 도입 확인의 저장·처리 선택지와 화면 문안 단일 정본.
 *
 * The values are deliberately strings shared with both database migrations and
 * the gateway.  Admission is an institution decision: this module describes
 * the choices and notices, but never selects or confirms one.
 */

export type ProgramStorageMode =
  | 'supabase_seoul'
  | 'naver_public'
  | 'local_encrypted'
  | 'undecided';

export type ProgramProcessingMode =
  | 'external_allowed'
  | 'internal_only'
  | 'undecided';

export const PROGRAM_STORAGE_MODES = [
  'supabase_seoul',
  'naver_public',
  'local_encrypted',
  'undecided',
] as const satisfies readonly ProgramStorageMode[];

export const PROGRAM_PROCESSING_MODES = [
  'external_allowed',
  'internal_only',
  'undecided',
] as const satisfies readonly ProgramProcessingMode[];

/** D87 확정 문안 묶음의 버전. 문안 변경 시 버전과 hash를 함께 발행한다. */
export const PROGRAM_ADMISSION_COPY_VERSION = 'D87-v1';

export const PROGRAM_ADMISSION_COPY = {
  storage: {
    heading: '데이터 저장 위치',
    installationNotice: '이 설치는 기본형입니다. 다른 저장 위치는 설치를 따로 해야 합니다.',
    options: {
      supabase_seoul: {
        label: '기본형(기관 소유 Supabase 서울 프로젝트)',
        description: '발주처가 클라우드 종류나 보안 인증을 따로 요구하지 않는 경우',
      },
      naver_public: {
        label: '네이버 클라우드 공공형',
        description: '발주처가 국내 공공 클라우드나 CSAP 인증을 요구하는 경우',
        disabledNotice: '준비 중입니다. 이 조건에 해당하면 도입 문의로 알려 주세요. 별도 계약과 설치가 필요합니다.',
      },
      undecided: {
        label: '나중에 정하기',
        description: '사업은 만들어지고, 정하기 전까지 당사자 등록과 녹음·AI 처리는 열리지 않습니다.',
      },
    },
  },
  processing: {
    heading: '녹음과 AI 정리',
    options: {
      external_allowed: {
        label: '외부 업체 처리 허용',
        description: '계약서에 외부 처리나 국외 이전을 막는 조항이 없는 경우',
        aiNotice: 'AI 정리(OpenAI, 미국 회사): 이름, 전화번호, 계좌번호를 지운 글만 보냅니다.',
        speechNotice: '음성 인식(Azure, 서울에 있는 마이크로소프트 서버): 녹음 파일을 지우기 전 그대로 보냅니다. 목소리가 밖으로 나가므로 당사자에게 따로 허락을 받아야 하고, 관리자가 연결을 확인해야 켜집니다. 지금은 켤 수 없습니다.',
      },
      internal_only: {
        label: '기관 안에서만 처리',
        description: '계약서가 외부 처리를 금지하는 경우',
        notice: '이 사업의 상담 자료는 기관 밖으로 나가지 않습니다. 기관이 가진 PC, 노트북, 서버에서 처리하며 일정 이상의 성능이 필요합니다(최소 권장 사양은 `확인하는 법` 참고). 지금은 기관 안에서 도는 음성 인식이 아직 없어 녹음 없이 손으로 기록합니다. 준비되면 이 설명이 바뀌고 다시 확인을 받습니다.',
      },
      undecided: {
        label: '나중에 정하기',
        description: '사업은 만들어지고, 정하기 전까지 당사자 등록과 녹음·AI 처리는 열리지 않습니다.',
      },
    },
  },
  confirmation: '위 선택은 우리 기관이 계약 조건을 확인하고 정한 것입니다.',
  guideLinkLabel: '확인하는 법',
  footerNotice: '발주처가 지정한 업무 시스템이 따로 있으면, 그 시스템에 남겨야 하는 기록을 CCC가 대신하지 않습니다.',
  recheckNotices: {
    selectionChanged: '고른 내용이 바뀌었습니다. 바뀐 내용을 다시 읽고 확인해 주세요. 확인 전에는 새 당사자 등록, 녹음, AI 정리가 잠깁니다.',
    installationPolicyChanged: '기관의 음성 인식이나 AI 설정이 바뀌어서, 이 사업의 상담 자료가 밖으로 나가는 방식도 바뀌었습니다. 무엇이 나가는지 다시 읽고 확인해 주세요. 확인 전에는 새 당사자 등록, 녹음, AI 정리가 잠깁니다.',
    copyVersionChanged: '설명 글이 바뀌었습니다. 바뀐 설명을 다시 읽고 확인해 주세요. 확인 전에는 새 당사자 등록, 녹음, AI 정리가 잠깁니다.',
    installationSettingsWillChange: '이 설정을 저장하면 N개 사업의 자료가 밖으로 나가는 방식이 바뀝니다. 그 사업들은 관리자가 다시 확인하기 전까지 새 당사자 등록, 녹음, AI 정리가 잠깁니다.',
  },
} as const;

export type ProgramAdmissionState =
  | 'ready' | 'undecided' | 'confirmation_required' | 'selection_changed'
  | 'notice_changed' | 'settings_changed' | 'storage_unavailable'
  | 'processing_unavailable' | 'installation_unavailable';

export type ProgramAdmissionDenialReason = Exclude<ProgramAdmissionState, 'ready'> | 'program_closed';
export interface ProgramAdmissionDeniedResponse {
  error: 'program_admission_required';
  reason: ProgramAdmissionDenialReason;
}

export interface ProgramConfirmationInput {
  copyVersion: string;
  copyHash: string;
  installationPolicyVersion: number;
  installationConfigHash: string;
}

export interface ProgramStaffInput {
  userId: string;
  isResponsible: boolean;
}

export interface ProgramStaff extends ProgramStaffInput {
  name: string | null;
  active: boolean;
}

export interface CreateProgramInput {
  displayName: string;
  storageMode?: ProgramStorageMode | null;
  processingMode?: ProgramProcessingMode | null;
  confirmation?: ProgramConfirmationInput | null;
  staff?: ProgramStaffInput[];
}

export interface UpdateProgramInput {
  expectedVersion: number;
  displayName?: string;
  storageMode?: ProgramStorageMode | null;
  processingMode?: ProgramProcessingMode | null;
  confirmation?: ProgramConfirmationInput | null;
  status?: 'active' | 'closed';
  staff?: ProgramStaffInput[];
}

export interface ProgramConfirmation extends ProgramConfirmationInput {
  by: string;
  at: string;
  storageMode: ProgramStorageMode;
  processingMode: ProgramProcessingMode;
}

export interface ProgramRecord {
  id: string;
  orgId: string;
  displayName: string | null;
  status: 'active' | 'closed';
  programType: 'financial_support_v1';
  storageMode: ProgramStorageMode;
  processingMode: ProgramProcessingMode;
  version: number;
  confirmation: ProgramConfirmation | null;
}

export interface ProgramView extends ProgramRecord {
  admissionState: ProgramAdmissionState;
  staff: ProgramStaff[];
}

export interface ProgramOption {
  id: string;
  displayName: string | null;
  programType: 'financial_support_v1';
  admissionState: ProgramAdmissionState;
}

export interface ProgramOptionsResponse {
  programs: ProgramOption[];
}

export interface ProgramListResponse {
  programs: ProgramView[];
  staffOptions: Array<{ userId: string; name: string | null }>;
  admissionCopy: {
    version: string;
    hash: string;
    copy: typeof PROGRAM_ADMISSION_COPY;
  };
  installation: {
    deploymentMode: DeploymentMode;
    sttMode: 'off' | 'local' | 'azure';
    llmMode: 'off' | 'openai';
    policyVersion: number;
    configHash: string;
  };
}

export interface ProgramMutationResponse {
  program: ProgramView;
}
