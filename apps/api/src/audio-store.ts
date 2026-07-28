/**
 * audio-store.ts — R2 오디오 저장/조회 전용 모듈 (2단계-a).
 *
 * 이 파일만 AUDIO_BUCKET(R2) 바인딩을 직접 다룬다. gateway.ts는 D1 전용이므로(R1)
 * R2 접근을 여기로 격리하고, request-handler는 이 함수들만 호출해 얇게 유지한다.
 * 키에는 PII를 넣지 않는다: audio/<sessionId>/<uuid> 형태만 쓴다.
 */
import type { ApiEnv } from './identity';

/** 업로드 허용 오디오 MIME 타입(파라미터 제외 기본형 기준). */
export const ALLOWED_AUDIO_CONTENT_TYPES = new Set<string>([
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/x-m4a',
]);

/** 업로드 최대 크기 (200 MB). Content-Length와 실제 바이트 길이 양쪽으로 강제한다. */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

/**
 * Content-Type 헤더에서 파라미터(예: '; codecs=...')를 떼고 소문자 기본형만 남긴다.
 * 허용 목록에 없으면 null을 돌려준다.
 */
export function normalizeAudioContentType(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const base = (header.split(';')[0] ?? '').trim().toLowerCase();
  return ALLOWED_AUDIO_CONTENT_TYPES.has(base) ? base : null;
}

/** 새 오디오 객체 키 생성. PII 없는 무작위 키(audio/<sessionId>/<uuid>). */
export function newAudioKey(sessionId: string): string {
  return `audio/${sessionId}/${crypto.randomUUID()}`;
}

/** 오디오 원본을 R2에 저장한다. contentType은 httpMetadata로 보관한다. */
export async function putAudioObject(
  env: ApiEnv,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<void> {
  await env.AUDIO_BUCKET.put(key, body, { httpMetadata: { contentType } });
}

/** 방금 올린(또는 임의) 오디오 객체를 삭제한다. 등록 실패 시 고아 객체 정리에 쓴다. */
export async function deleteAudioObject(env: ApiEnv, key: string): Promise<void> {
  await env.AUDIO_BUCKET.delete(key);
}

/** 오디오 객체를 조회한다. 없으면 null. */
export async function getAudioObject(env: ApiEnv, key: string): Promise<R2ObjectBody | null> {
  return env.AUDIO_BUCKET.get(key);
}
