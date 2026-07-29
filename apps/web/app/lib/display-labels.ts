import 'server-only';

import { cache } from 'react';
import { ApiError, getOrganizationProfile } from './api';
import type { ParticipantProgramType } from './api';
import { DEFAULT_PROGRAM_TYPE, ORG_LABEL, PROGRAM_LABELS } from './labels';

/**
 * 화면이 실제로 보여줄 기관·사업 표시 이름 (CCC-32 · 스펙 #78 US 2).
 *
 * 온보딩이 저장한 이름이 있으면 그것을, 없으면 labels.ts 하드코딩 라벨을 쓴다 — 그래서
 * 온보딩을 거치지 않은 환경(테스트·기존 시드)은 지금까지와 똑같이 보인다. API 가 안 열리는
 * 상황(미인증 토큰 경로·프리뷰 게이트 앞)에서도 같은 폴백으로 떨어져 셸이 깨지지 않는다.
 *
 * `cache()` 는 한 요청 안의 중복 호출을 1회로 접는다 — 루트 레이아웃(사이드바)과 본문
 * 페이지가 각자 불러도 API 왕복은 한 번이다.
 */
export const getDisplayLabels = cache(async (): Promise<{
  orgLabel: string;
  programLabels: Record<ParticipantProgramType, string>;
}> => {
  try {
    const profile = await getOrganizationProfile();
    return {
      orgLabel: profile.orgName ?? ORG_LABEL,
      programLabels: {
        ...PROGRAM_LABELS,
        [DEFAULT_PROGRAM_TYPE]: profile.programDisplayName ?? PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE],
      },
    };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { orgLabel: ORG_LABEL, programLabels: PROGRAM_LABELS };
  }
});
