import { canonicalizeJcs } from './jcs';

export const CONSENT_DOMAINS = [
  'personal_data_collection_use',
  'sensitive_information_processing',
  'counseling_recording',
  'external_stt_processing',
  'external_llm_cross_border_processing',
  'voice_original_retention_period',
] as const;
export type ConsentDomain = typeof CONSENT_DOMAINS[number];
export type ConsentDecision = 'grant' | 'withdraw' | 'decline' | 'correct';
export type ProviderId = 'institution' | 'institution_recording' | 'institution_private_storage' | 'azure' | 'openai';
export type PurposeLiteral = 'case_management' | 'sensitive_case_management' | 'counseling_recording' | 'speech_to_text' | 'ai_briefing' | 'voice_original_retention';
export type RetentionDuration = 'default_temporary_d85';

export const CONSENT_COPY_VERSION = 'consent-six-domains-v1';
export const CONSENT_COPY: Record<ConsentDomain, { label: string; copy: string; provider: ProviderId; purpose: PurposeLiteral }> = {
  personal_data_collection_use: { label: '개인정보 수집·이용', copy: '개인정보를 상담과 사례관리 제공 및 상담 기록 관리 목적으로 수집·이용합니다.', provider: 'institution', purpose: 'case_management' },
  sensitive_information_processing: { label: '민감정보 처리', copy: '건강·채무·주거 등 상담에 포함될 수 있는 민감정보를 사례관리 목적에 필요한 범위에서 처리합니다.', provider: 'institution', purpose: 'sensitive_case_management' },
  counseling_recording: { label: '상담 녹음', copy: '상담 내용을 녹음하여 상담 기록 작성에 이용합니다.', provider: 'institution_recording', purpose: 'counseling_recording' },
  external_stt_processing: { label: '외부 STT 처리', copy: '녹음 음성을 선택한 외부 음성인식(STT) 제공자에게 보내 전사합니다.', provider: 'azure', purpose: 'speech_to_text' },
  external_llm_cross_border_processing: { label: '외부 LLM·국외 처리', copy: '가림 처리한 상담 자료를 외부 LLM에 보내 요약·정리하며 국외에서 처리될 수 있습니다.', provider: 'openai', purpose: 'ai_briefing' },
  voice_original_retention_period: { label: '음성 원본 보유기간', copy: '상담 음성 원본을 고지한 보유기간 동안 보관한 뒤 삭제합니다.', provider: 'institution_private_storage', purpose: 'voice_original_retention' },
};

export interface ConsentEvent {
  id: string; orgId: string; beneficiaryId: string; supportCaseId: string;
  domain: ConsentDomain; decision: ConsentDecision; provider: ProviderId | null;
  providerLegalRecipient: string | null; providerCountry: string | null;
  purpose: PurposeLiteral | null; retentionDuration: RetentionDuration | null;
  copyVersion: string; copyHash: string; disclosureSnapshotId: string;
  effectiveAt: string; recordedBy: string; recordedAt: string; idempotencyKey: string;
  revision: number; eventSequence: number; correctionOfEventId: string | null;
}

export interface ConsentDisclosureSnapshot {
  snapshotId: string;
  scopeBinding: { orgId: string; programId: string; issuerId: string; supportCaseId: string | null };
  domain: ConsentDomain; fullKoreanCopy: string; provider: ProviderId | null;
  providerLegalRecipient: string | null; country: string | null; purpose: PurposeLiteral | null;
  retentionProfile: RetentionDuration; retentionDuration: RetentionDuration;
  copyVersion: string; copyHash: string; issuedAt: string; expiresAt: string;
}

export interface ConsentGateReceiptEntry {
  domain: ConsentDomain; eventSequence: number; revision: number; eventId: string;
  copyHash: string; decision: 'grant'; provider: ProviderId; purpose: PurposeLiteral; effectiveAt: string;
}
export interface ConsentGateReceipt { required: ConsentGateReceiptEntry[]; consentRevision: string }
export type ConsentState = 'unconfirmed' | 'granted' | 'not_granted';
export interface CurrentConsentState {
  domain: ConsentDomain; state: ConsentState; provider: ProviderId | null;
  providerLegalRecipient: string | null; providerCountry: string | null; purpose: PurposeLiteral | null;
  retentionDuration: RetentionDuration | null; effectiveAt: string | null; eventId: string | null;
  revision: number | null; eventSequence: number | null;
}

export interface AppendConsentEventInput {
  domain: ConsentDomain; decision: ConsentDecision; provider: ProviderId | null;
  providerLegalRecipient: string | null; providerCountry: string | null; purpose: PurposeLiteral | null;
  retentionDuration: RetentionDuration | null; copyVersion: string; copyHash: string;
  disclosureSnapshotId: string; effectiveAt: string; idempotencyKey: string;
  correctionOfEventId: string | null; expectedRevision: number | null;
}

export function consentCopyPreimage(input: {
  domain: ConsentDomain; provider: ProviderId | null; providerLegalRecipient: string | null;
  providerCountry: string | null; purpose: PurposeLiteral | null; retentionDuration: RetentionDuration | null;
}): string {
  const copy = CONSENT_COPY[input.domain];
  const value = (item: string | null) => item ?? '<null>';
  return [
    `domain=${input.domain}`, `label=${copy.label}`, `copy=${copy.copy}`,
    `provider=${value(input.provider)}`, `providerLegalRecipient=${value(input.providerLegalRecipient)}`,
    `providerCountry=${value(input.providerCountry)}`, `purpose=${value(input.purpose)}`,
    `retentionDuration=${value(input.retentionDuration)}`,
  ].map((line) => line.normalize('NFC').replace(/[ \t]+$/u, '')).join('\n') + '\n';
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function consentRevision(entries: ConsentGateReceiptEntry[]): Promise<string> {
  return sha256Hex(canonicalizeJcs([...entries].sort((a, b) => a.domain.localeCompare(b.domain, 'en'))));
}
