import { redirect } from 'next/navigation';
import { ApiError, getLastProgramType } from './lib/api';
import { DEFAULT_PROGRAM_TYPE, isKnownProgramType } from './lib/labels';

// `/`는 **마지막에 보던 사업**의 일정으로 곧장 보낸다 (D35 · ADR-0014 §2·'개정' 2번).
//
// 구 홈은 조직 아코디언 → 사업 한 줄 → 상담 카드였는데, 사업이 1개뿐인 지금 그 아코디언은
// 항상 같은 곳으로 가는 빈 클릭이었다. 워크스페이스 복귀는 이제 사이드바가 상시 담당한다.
//
// 저장 위치는 브라우저가 아니라 **계정 설정(DB)**이다(2026-07-26 Q 결정) — 집 컴퓨터와
// 사무실에서 같은 사업으로 들어가야 한다.
//
// 폴백은 세 갈래 모두 첫 사업이다: ① 아직 고른 적 없음(null) ② 저장된 사업이 사라짐
// ③ 신원을 못 읽음. **어느 경우에도 404 를 내지 않는다** — 홈이 막히면 앱 전체가 막힌다.
export default async function HomePage() {
  let stored: string | null = null;
  try {
    stored = await getLastProgramType();
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    // 신원 조회가 실패해도 홈은 열려야 한다. 접근 권한 문제라면 목적지 화면이 다시 판정한다.
  }
  const target = stored !== null && isKnownProgramType(stored) ? stored : DEFAULT_PROGRAM_TYPE;
  redirect(`/programs/${target}/schedule`);
}
