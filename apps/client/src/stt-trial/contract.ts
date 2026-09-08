// 로컬 내부 시험 API 계약(백엔드 구현 중). same-origin 127.0.0.1 서버만 부른다.
// 화면은 키, 서버 파일 경로, provider URL 을 만들지도 보내지도 않는다.

export type EngineId = 'qwen3-asr' | 'azure';
export type TrialStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface LocalEngineInfo {
  configured: boolean;
  reason?: string;
  modelId: string;
  modelRevision: string;
  alignerId: string;
  alignerRevision: string;
  /** 엔진이 실제로 쓰는 실행 장치. */
  device: string;
}

export interface AzureEngineInfo {
  configured: boolean;
  reason?: string;
  region: string;
  apiVersion: string;
  /** 원본 파일 외부 전송에 명시 확인이 필요한지. */
  externalUploadAuthorizationRequired: boolean;
}

export interface UploadLimits {
  maxBytes: number;
  contentTypes: string[];
}

export interface StatusResponse {
  purpose: 'internal-stt-trial';
  productActivation: false;
  busy: boolean;
  activeTrialId: string | null;
  engines: {
    'qwen3-asr': LocalEngineInfo;
    azure: AzureEngineInfo;
  };
  upload: UploadLimits;
}

export interface TrialCreated {
  trialId: string;
  status: TrialStatus;
}

export interface TrialResponse {
  trialId: string;
  status: TrialStatus;
  engine: EngineId;
  /**
   * Local 은 false, Azure 는 확인 가능한 기록의 true 또는 false 다.
   * 증거가 없거나 기록이 실패하면 null 이고 필드가 없을 수도 있다. 실제로 보내졌을 수 있으므로
   * 화면은 이 값을 false 로 접지 않는다.
   */
  externalUploadAttempted?: boolean | null;
  errorCode?: string;
  segmentCount?: number;
  repetitionWarningCount?: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** 익명의 파일별 provider 화자 ID. 없으면 필드 자체가 없다. */
  speaker?: string;
  /** pipeline 이 끼워 넣은 반복 경고 줄. 발화가 아니다. */
  warning?: boolean;
}

export interface RepetitionWarning {
  start: number;
  end: number;
  count: number;
  reason: 'repetition';
}

export interface TranscriptResponse {
  segments: TranscriptSegment[];
  repetitionWarnings: RepetitionWarning[];
  forcedCuts: number;
  qualityEvaluation: 'deferred';
}
