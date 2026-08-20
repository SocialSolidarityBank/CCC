'use client';

import { useEffect } from 'react';
import { clearDraft, draftKey } from '../../../../../lib/form-draft';

/**
 * 제출 성공 시 임시본 정리(P0-9 · CCC-111, form-draft 보관 규율 2·5).
 *
 * 기록 저장은 서버 액션 + 리다이렉트라 작성 화면(record-onepage)이 성공을 직접 알 수 없다 —
 * 그래서 지금까지는 'submitting' 표시가 남은 임시본을 다음 방문에 사람이 지웠다. 성공이
 * 확실해지는 첫 화면이 여기다: 저장·재전송 성공만 notice=record_submission_processed 를
 * 달고 이 목록으로 온다(records/new/page.tsx 의 historyDestination). 그 신호가 있을 때
 * 해당 참여 사업의 기록 임시본 키를 지운다 — 비민감 필드만 남는 형식이지만, 서버에 들어간
 * 내용의 사본을 기기에 둘 이유가 없다.
 */
export function RecordDraftCleanup({
  notice,
  supportCaseId,
}: {
  notice: string | undefined;
  supportCaseId: string | null;
}) {
  useEffect(() => {
    if (notice !== 'record_submission_processed' || supportCaseId === null) return;
    clearDraft(draftKey('record', supportCaseId));
  }, [notice, supportCaseId]);

  return null;
}
