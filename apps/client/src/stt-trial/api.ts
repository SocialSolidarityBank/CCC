// 같은 origin 로컬 시험 API 클라이언트. service 전용 파이프라인 API 는 부르지 않는다.
// 응답 본문에서 꺼내는 것은 계약이 정한 필드뿐이고, provider 원문 오류는 버린다.

import type {
  EngineId,
  StatusResponse,
  TranscriptResponse,
  TrialCreated,
  TrialResponse,
} from './contract';

const BASE = '/internal/stt';

export class SttApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SttApiError';
  }
}

// 본문이 JSON 이 아닐 때만 쓰는 대비책. 정상 응답은 {"error":"<code>"} 를 싣는다.
const STATUS_CODE_FALLBACK: Record<number, string> = {
  404: 'not_found',
  405: 'method_not_allowed',
  408: 'upload_timeout',
  413: 'audio_too_large',
  415: 'content_type_not_allowed',
};

async function failureCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const { error } = body;
      if (typeof error === 'string' && error !== '') return error;
    }
  } catch {
    // 본문이 JSON 이 아니면 상태 코드만 쓴다. 원문은 읽지도 남기지도 않는다.
  }
  return STATUS_CODE_FALLBACK[response.status] ?? 'internal_error';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new SttApiError('network_unavailable');
  }
  if (!response.ok) throw new SttApiError(await failureCode(response));
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new SttApiError('invalid_response');
  }
}

export async function fetchStatus(): Promise<StatusResponse> {
  return request<StatusResponse>('/status');
}

export async function submitTrial(
  file: File,
  engine: EngineId,
  allowExternalUpload: boolean,
): Promise<TrialCreated> {
  const headers: Record<string, string> = {
    'Content-Type': file.type,
    'X-CCC-Trial-Engine': engine,
    'X-CCC-Owned-Test-Recording': '1',
  };
  // Azure 를 고르고 외부 전송을 따로 확인했을 때만 붙는다. 기본값으로 보내지 않는다.
  if (engine === 'azure' && allowExternalUpload) headers['X-CCC-Allow-External-Upload'] = '1';
  return request<TrialCreated>('/trials', { method: 'POST', headers, body: file });
}

export async function fetchTrial(trialId: string): Promise<TrialResponse> {
  return request<TrialResponse>(`/trials/${encodeURIComponent(trialId)}`);
}

export async function fetchTranscript(trialId: string): Promise<TranscriptResponse> {
  return request<TranscriptResponse>(`/trials/${encodeURIComponent(trialId)}/transcript`);
}

export async function deleteTrial(trialId: string): Promise<void> {
  await request<void>(`/trials/${encodeURIComponent(trialId)}`, { method: 'DELETE' });
}
