// AI 정리 승인 검토 화면의 API 경계 (P5).
// 초안은 승인 전까지 공식 기록이 아니다(R2). 이 모듈은 초안을 읽고 승인 또는 반려만 보낸다.
// 사업자 활성화, 생성 실행, 원음 업로드는 이 화면의 범위가 아니다.

import { isNullableString, isOpaqueIdentifier, record } from './api';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

export const CLAIM_SECTION_LABELS: Record<string, string> = {
  session_goal_discussion: '이번 상담 목표별 논의',
  other_topics: '목표 밖 주요 내용',
  next_session_commitments: '다음 회차까지의 약속',
};
export const CONTRAST_AXES = ['missing_from_memo', 'missing_from_transcript', 'undiscussed_session_goal'] as const;
export type ContrastAxis = (typeof CONTRAST_AXES)[number];
export const CONTRAST_STATUSES = ['applied', 'no_transcript', 'no_text', 'no_session_goal'] as const;
export type ContrastStatus = (typeof CONTRAST_STATUSES)[number];
export const CONTRAST_AXIS_LABELS = {
  missing_from_memo: '메모에서 누락된 것',
  undiscussed_session_goal: '다루지 않은 목표',
} as const;
export const CONTRAST_UNAVAILABLE_LABELS: Record<Exclude<ContrastStatus, 'applied'>, string> = {
  no_transcript: '전사 기록 재료가 없어 대조하지 못했어요.',
  no_text: '수기 메모와 목표의 텍스트 재료가 없어 대조하지 못했어요.',
  no_session_goal: '이번 상담 목표가 없어 목표 대조를 적용하지 않았어요.',
};

export interface AiDraft {
  version: number;
  origin: string;
  creationMode: string;
  summaryText: string;
  oneLiner: string | null;
  reviewDecision: string | null;
  /** 서버가 판단한 재생성 가능 여부와 그대로 되돌려 보낼 저장 스냅샷 ID. */
  regenerateAvailable: boolean;
  regenerateSourceSnapshotId: string | null;
  claims: Array<{ claimKey: string; section: string; text: string }>;
  questions: Array<{ title: string; reason: string | null }>;
  evidence: Array<{ id: string; claimKey: string; quote: string }>;
  contrast: Array<{
    axis: ContrastAxis;
    status: ContrastStatus;
    findings: Array<{ description: string; materialKind: 'transcript' | 'text_context'; quote: string }>;
  }>;
}

export function decodeAiDraft(value: unknown): AiDraft {
  const row = record(value);
  if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
    || typeof row.origin !== 'string' || typeof row.creationMode !== 'string'
    || typeof row.summaryText !== 'string' || !isNullableString(row.oneLiner)
    || !isNullableString(row.reviewDecision)
    || !(row.regenerateAvailable === undefined || typeof row.regenerateAvailable === 'boolean')
    || !(row.regenerateSourceSnapshotId === undefined || isNullableString(row.regenerateSourceSnapshotId))
    || !Array.isArray(row.claims) || !Array.isArray(row.questions)
    || !Array.isArray(row.evidence) || !Array.isArray(row.contrast)) throw new BusinessError('invalid_response');
  return {
    version: row.version, origin: row.origin, creationMode: row.creationMode,
    summaryText: row.summaryText, oneLiner: row.oneLiner, reviewDecision: row.reviewDecision,
    regenerateAvailable: row.regenerateAvailable === true,
    regenerateSourceSnapshotId: row.regenerateSourceSnapshotId === undefined ? null : row.regenerateSourceSnapshotId,
    claims: row.claims.map((entry) => {
      const claim = record(entry);
      if (typeof claim.claimKey !== 'string' || typeof claim.section !== 'string' || typeof claim.text !== 'string') {
        throw new BusinessError('invalid_response');
      }
      return { claimKey: claim.claimKey, section: claim.section, text: claim.text };
    }),
    questions: row.questions.map((entry) => {
      const question = record(entry);
      if (typeof question.title !== 'string' || !isNullableString(question.reason)) {
        throw new BusinessError('invalid_response');
      }
      return { title: question.title, reason: question.reason };
    }),
    evidence: row.evidence.map((entry) => {
      const item = record(entry);
      if (!isOpaqueIdentifier(item.id) || typeof item.claimKey !== 'string' || typeof item.quote !== 'string') {
        throw new BusinessError('invalid_response');
      }
      return { id: item.id, claimKey: item.claimKey, quote: item.quote };
    }),
    contrast: row.contrast.map((entry) => {
      const axis = record(entry);
      if (!(CONTRAST_AXES as readonly unknown[]).includes(axis.axis)
        || !(CONTRAST_STATUSES as readonly unknown[]).includes(axis.status)
        || !Array.isArray(axis.findings) || (axis.status !== 'applied' && axis.findings.length !== 0)) {
        throw new BusinessError('invalid_response');
      }
      return {
        axis: axis.axis as ContrastAxis, status: axis.status as ContrastStatus,
        findings: axis.findings.map((value) => {
          const finding = record(value);
          if (typeof finding.description !== 'string'
            || (finding.materialKind !== 'transcript' && finding.materialKind !== 'text_context')
            || typeof finding.quote !== 'string') {
            throw new BusinessError('invalid_response');
          }
          return { description: finding.description, materialKind: finding.materialKind, quote: finding.quote };
        }),
      };
    }),
  };
}

export class AiReviewApi {
  constructor(private readonly transport: BusinessTransport) {}

  /** 초안이 없으면 null이다. AI가 꺼져 있거나 아직 생성되지 않은 회차를 실패로 그리지 않는다. */
  async draft(sessionId: string): Promise<AiDraft | null> {
    if (!isOpaqueIdentifier(sessionId)) throw new BusinessError('invalid_request', 400);
    try {
      return decodeAiDraft(await this.transport.request(`/sessions/${encodeURIComponent(sessionId)}/ai`));
    } catch (error) {
      if (error instanceof BusinessError && error.status === 404) return null;
      throw error;
    }
  }

  /** 새 마스킹 스냅샷이 있을 때만 서버가 true 로 연다(D69). hosted provider 상태를 화면이 추측하지 않는다. */
  async regenerate(sessionId: string, sourceSnapshotId: string): Promise<AiDraft> {
    if (!isOpaqueIdentifier(sessionId) || !isOpaqueIdentifier(sourceSnapshotId)) {
      throw new BusinessError('invalid_request', 400);
    }
    return decodeAiDraft(await this.transport.request(
      `/sessions/${encodeURIComponent(sessionId)}/ai/generate`, 'POST', { sourceSnapshotId },
    ));
  }

  /** 승인은 공식화다(R2). 반려는 공식 기록을 만들지 않는다. 화자 확인은 별도 확언으로 보낸다. */
  async review(sessionId: string, input: {
    expectedVersion: number; decision: 'approved' | 'rejected'; speakerMappingConfirmed: boolean;
  }): Promise<AiDraft> {
    if (!isOpaqueIdentifier(sessionId) || !Number.isSafeInteger(input.expectedVersion)) {
      throw new BusinessError('invalid_request', 400);
    }
    return decodeAiDraft(await this.transport.request(
      `/sessions/${encodeURIComponent(sessionId)}/ai/drafts/${input.expectedVersion}/review`, 'POST',
      { expectedVersion: input.expectedVersion, decision: input.decision, speakerMappingConfirmed: input.speakerMappingConfirmed },
    ));
  }
}
