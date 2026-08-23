import type { LifeAreaKey, LifeAreaStatus } from './api';

// 생활 6영역 표시 순서·라벨(CCC-8). 근거: docs/intake/CCC-intake-required-vs-optional-questions.md §D.
// 작성 화면(life-area-fields)과 읽기 화면(기록 단일 뷰)이 같은 말을 쓰도록 여기 한 곳에서 정한다.
export const lifeAreaOrder: ReadonlyArray<readonly [LifeAreaKey, string]> = [
  ['economy', '경제·생계'],
  ['housing', '주거'],
  ['employment', '일·고용·학업'],
  ['health', '건강'],
  ['mental_health', '심리·정서'],
  ['family', '가족·관계·돌봄'],
];

export const lifeAreaStatusLabels: Record<LifeAreaStatus, string> = {
  okay: '괜찮음',
  strained: '긴장',
  crisis: '위기',
  not_applicable: '해당없음',
  declined: '답변거부',
};

export const lifeAreaStatusOptions: ReadonlyArray<readonly [LifeAreaStatus, string]> =
  (Object.entries(lifeAreaStatusLabels) as Array<[LifeAreaStatus, string]>);