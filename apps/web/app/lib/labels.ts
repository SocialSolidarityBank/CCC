// 재개편 T3(#33): 조직·참여 사업 표시명 매핑. 클라이언트/서버 양쪽에서 쓰므로
// server-only인 lib/api.ts의 런타임 값은 import하지 않는다(타입만 erase되어 안전).
import type { ParticipantProgramType } from './api';

/** 참여 사업 유형 → 화면 표시명 (D27: 단일 조직이라도 계층 UI 유지). */
export const PROGRAM_LABELS: Record<ParticipantProgramType, string> = {
  financial_support_v1: '마이크로크레딧 씬파일러 금융지원·멘토링',
};

/** 사업 전환기가 나열하는 사업 유형 순서(D35 — 구 홈 아코디언). */
export const PROGRAM_TYPES: ParticipantProgramType[] = ['financial_support_v1'];

/**
 * 워크스페이스 폴백 (D35 · ADR-0014 §2). 경로가 사업을 알려주지 않는 화면(참여자·설정)과
 * `/` 직행이 쓴다. 배열 첨자와 달리 undefined 가 될 수 없어 호출부가 폴백을 또 두지 않는다.
 * CCC-18b 가 계정 설정의 마지막 선택 사업을 우선하고, 그 값이 없거나 사라졌을 때 여기로 떨어진다.
 */
export const DEFAULT_PROGRAM_TYPE: ParticipantProgramType = 'financial_support_v1';

/** 라우트 파라미터(string)를 알려진 사업 유형으로 좁히는 타입 가드. */
export function isKnownProgramType(value: string): value is ParticipantProgramType {
  return Object.prototype.hasOwnProperty.call(PROGRAM_LABELS, value);
}

/** 조직 식별값 → 표시명. 내부 전용 단일 조직(D1)이라 식별값 'bss'만 매핑한다. */
export const ORG_ID = 'bss';
export const ORG_LABELS: Record<string, string> = {
  bss: '사회연대은행',
};
export const ORG_LABEL = ORG_LABELS[ORG_ID];
