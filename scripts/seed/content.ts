/**
 * 시드 콘텐츠 — 전원 가상 인물·가상 데이터.
 *
 * 실존 인물·기관과 무관하다. 이름·연락처·이메일·상담 메모는 모두 지어낸 것이며, 어떤
 * 실제 참여자·상담 기록과도 대응하지 않는다. 사업 맥락은 마이크로크레딧 씬파일러(thin filer,
 * 금융 이력이 부족해 제도권 신용 접근이 어려운 사람) 대상 금융지원·멘토링이다 — 소액 창업,
 * 저신용 자영업, 긴급 생계 지원 상황을 가정했다.
 *
 * 규칙:
 * - 메모에는 참여자 이름을 넣지 않는다(가명 체계 유지). 실존 인물·기관 실명 금지.
 * - 타임스탬프(intakeAt/heldAt/scheduledAt/dueDate)는 하드코딩 백데이트다.
 * - 목표별 GAS 점수는 시나리오 엔진이 trajectory 로 결정론적으로 만든다(여기서는 추이 유형만 지정).
 */
import type { FlagType } from '../../db/gateway';
import { COUNSELOR_IDS } from './preload-data';

export type Trajectory = 'improving' | 'plateau' | 'decline' | 'mixed';

export interface SeedScaleCriteria {
  '-2': string;
  '-1': string;
  '0': string;
  '1': string;
  '2': string;
}

export interface SeedGoal {
  key: string;
  title: string;
  /** 인테이크 목표는 게이트웨이(createCounselingSchedule intake)가 scale_criteria=NULL 로 만든다.
   *  이 값은 목표 교체(closeGoal successor) 경로에서만 실제로 저장된다(D12 데모). */
  scaleCriteria?: SeedScaleCriteria;
}

export interface SeedActionSpec {
  description: string;
  owner: 'counselor' | 'beneficiary' | 'org';
  dueDate?: string;
}

export interface SeedFlag {
  flagType: FlagType;
  quote: string;
}

export interface SeedRegular {
  heldAt: string;
  memo: string;
  /** 인라인 액션(미해결로 남는다). */
  actionItems?: SeedActionSpec[];
  /** 인라인 플래그(source=counselor, 생성 즉시 confirmed). */
  flags?: SeedFlag[];
  /** 세션 목표로 연결할 활성 케이스 목표 key(D28). */
  goalLinks?: string[];
  customQuestions?: string[];
}

export interface SeedGoalReplacement {
  /** 0=인테이크 직후, 1=정기 1회 직후 … 이 세션을 마친 뒤 목표를 교체한다. */
  afterSession: number;
  closeGoalKey: string;
  reason: string;
  newGoal: SeedGoal;
}

export interface SeedFutureSchedule {
  scheduledAt: string;
  goalLinks?: string[];
  customQuestions?: string[];
}

export interface SeedParticipant {
  name: string;
  phone: string;
  email: string;
  assigneeUserId: string;
  intakeAt: string;
  // D49: 동의 2종 — ② AI를 활용한 녹취기록(구 녹음 + 텍스트 AI 를 합침).
  consent: { recordingAi: boolean };
  trajectory: Trajectory;
  goals: SeedGoal[];
  intakeMemo: string;
  regulars: SeedRegular[];
  goalReplacement?: SeedGoalReplacement;
  resolvedActions?: SeedActionSpec[];
  standaloneFlag?: SeedFlag;
  futureSchedules?: SeedFutureSchedule[];
}

/**
 * 가상 상담사(users 에 email + 표시 이름 name 저장, D31). 고정 UUID 로 upsertUser 한다.
 *
 * 시드를 4명으로 줄이면서 비웠다 — 남긴 4명은 전원 ai00 담당이라 가상 상담사에게 배정된
 * 케이스가 하나도 없고, 프로비저닝만 하면 설정 화면 상담사 목록에 담당 0건인 이름 3개가
 * 뜬다. 배열이 비면 provisionVirtualCounselors 가 no-op 이 되고 리포트에는 0 으로 찍힌다.
 */
export const VIRTUAL_COUNSELORS: readonly {
  userId: string;
  email: string;
  displayName: string;
}[] = [];

function iso(year: number, month: number, day: number, hour = 10, minute = 0): string {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0)).toISOString();
}

function phone(n: number): string {
  return `010-0000-${String(n).padStart(4, '0')}`;
}

function email(n: number): string {
  return `seed${String(n).padStart(2, '0')}@example.com`;
}

/** 목표 교체 successor 에 붙일 5단계 척도 설명(대표 예시 재사용). */
const REPAYMENT_SCALE: SeedScaleCriteria = {
  '-2': '연체가 누적되고 상환 의지가 확인되지 않는다',
  '-1': '납부가 불규칙하고 약속한 금액에 미치지 못한다',
  '0': '월 상환액을 대체로 맞추나 여유가 없다',
  '1': '3개월 연속 정액 납부가 이어진다',
  '2': '정액 납부에 더해 추가 상환 여력이 생겼다',
};

const SAVINGS_SCALE: SeedScaleCriteria = {
  '-2': '적립을 중단하고 기존 잔액을 인출했다',
  '-1': '적립이 끊기는 달이 반복된다',
  '0': '소액이라도 매달 적립을 유지한다',
  '1': '목표 적립액을 안정적으로 채운다',
  '2': '목표를 초과 달성해 비상금 여력이 커졌다',
};

/**
 * 가상 참여자 4명. 배정·동의·추이·회차·이벤트 분포는 파일 하단 주석의 집계 목표를 충족한다.
 */
export const PARTICIPANTS: readonly SeedParticipant[] = [
  // ── 1 (ai00, improving, 목표2, 정기3, 미래일정) ──────────────────────────────
  {
    name: '김서준', phone: phone(1), email: email(1), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 4, 13), consent: { recordingAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '월 상환액 20만원을 3개월 연속 납부한다' },
      { key: 'ledger', title: '주 1회 매출 장부를 기록한다' },
    ],
    intakeMemo: '노점 분식 매출이 일정치 않아 카드 대출 상환이 밀려 있는 상황이다. 우선 고정 상환액을 정하고, 매출을 눈으로 확인할 수 있게 장부부터 시작하기로 했다.',
    regulars: [
      { heldAt: iso(2026, 5, 4), memo: '이번 달 상환은 약속한 금액을 맞췄다. 장부는 사흘에 한 번 정도 적고 있어 습관이 자리잡는 중이다.' },
      {
        heldAt: iso(2026, 5, 25), memo: '주말 매출이 늘면서 상환 여유가 조금 생겼다. 재료비를 미리 계산해두는 방식으로 지출을 줄여보기로 했다.',
        actionItems: [{ description: '다음 상담 전까지 주간 재료비 상한을 정해 온다', owner: 'beneficiary', dueDate: '2026-06-10' }],
        goalLinks: ['ledger'], customQuestions: ['장부 기록에서 가장 번거로운 부분은?'],
      },
      { heldAt: iso(2026, 6, 15), memo: '석 달째 정액 상환이 이어졌다. 비상금 적립도 시작해보고 싶다고 해서 다음 회차에 목표를 함께 검토하기로 했다.' },
    ],
    futureSchedules: [{ scheduledAt: iso(2026, 7, 21, 4), goalLinks: ['repay'], customQuestions: ['적립 목표를 새로 잡을지 이야기해봅시다'] }],
  },
  // ── 2 (ai00, plateau, 목표1, 정기2, resolvedActions2, 미래일정) ───────────────
  {
    name: '이하은', phone: phone(2), email: email(2), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 5, 11), consent: { recordingAi: true }, trajectory: 'plateau',
    goals: [{ key: 'attend', title: '멘토링에 월 2회 참석한다' }],
    intakeMemo: '온라인 판매를 준비 중이나 어디서부터 손대야 할지 막막해한다. 멘토링을 통해 실행 순서를 잡는 것을 첫 목표로 삼았다.',
    regulars: [
      { heldAt: iso(2026, 6, 1), memo: '멘토링에는 두 번 다 참석했다. 다만 배운 내용을 실제로 적용하는 단계에서 멈춰 있어 부담을 느낀다.' },
      { heldAt: iso(2026, 6, 22), memo: '참석은 유지되고 있으나 성과 체감이 낮아 동기가 떨어진 모습이다. 작은 실행 과제를 쪼개 주기로 했다.' },
    ],
    resolvedActions: [
      { description: '멘토가 추천한 상품 등록 절차 문서를 함께 읽는다', owner: 'counselor', dueDate: '2026-06-05' },
      { description: '판매 채널 후보 3곳을 비교해 온다', owner: 'beneficiary', dueDate: '2026-06-18' },
    ],
    futureSchedules: [{ scheduledAt: iso(2026, 7, 19, 5) }],
  },
  // ── 3 (ai00, improving, 목표3, 정기4, 목표교체 afterSession2, 미래일정) ─────────
  {
    name: '박도윤', phone: phone(3), email: email(3), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 4, 6), consent: { recordingAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '월 상환액 15만원을 정기 납부한다' },
      { key: 'save', title: '비상금 50만원을 적립한다' },
      { key: 'sales', title: '주간 매출을 기록해 흐름을 파악한다' },
    ],
    intakeMemo: '중고 거래 기반 소매를 하며 부채와 생활비가 뒤섞여 있어 구분이 어렵다. 상환·적립·매출 세 축을 나눠 관리하기로 정리했다.',
    regulars: [
      { heldAt: iso(2026, 4, 20), memo: '상환 계좌를 분리하니 관리가 한결 수월해졌다. 매출 기록도 시작했다.' },
      { heldAt: iso(2026, 5, 11), memo: '적립은 아직 어렵지만 상환과 매출 기록은 자리잡았다. 적립 방식을 현실적으로 다시 잡기로 했다.', goalLinks: ['save'] },
      { heldAt: iso(2026, 6, 1), memo: '매출 흐름이 눈에 들어오면서 비수기 대비 감각이 생겼다. 매출 기록 목표는 사실상 달성돼 새 목표로 전환하기로 합의했다.' },
      { heldAt: iso(2026, 6, 22), memo: '재고 회전 관리로 목표를 옮긴 뒤 실행이 구체화됐다. 상환·적립도 안정적이다.' },
    ],
    goalReplacement: {
      afterSession: 3, closeGoalKey: 'sales', reason: '매출 기록 습관이 정착되어 재고 회전 관리로 목표를 전환',
      newGoal: { key: 'stock', title: '주간 재고 회전율을 점검해 과잉 매입을 줄인다', scaleCriteria: SAVINGS_SCALE },
    },
    futureSchedules: [{ scheduledAt: iso(2026, 7, 23, 3), goalLinks: ['repay', 'save'] }],
  },
  // ── 4 (ai00, decline, 목표2, 정기2, 인라인액션·플래그 debt) ─────────────────────
  {
    name: '최시우', phone: phone(4), email: email(4), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 5, 13), consent: { recordingAi: true }, trajectory: 'decline',
    goals: [
      { key: 'repay', title: '카드 리볼빙 잔액을 매달 10만원씩 줄인다' },
      { key: 'budget', title: '주간 생활비 예산을 세워 지킨다' },
    ],
    intakeMemo: '리볼빙과 현금서비스가 얽혀 이자 부담이 크다. 우선 잔액을 조금씩 줄이는 것과 생활비 통제를 목표로 잡았다.',
    regulars: [
      {
        heldAt: iso(2026, 6, 3), memo: '예상치 못한 병원비로 이번 달 상환이 어려웠고 리볼빙이 다시 늘었다. 지출 우선순위를 함께 다시 짰다.',
        actionItems: [{ description: '고정지출 항목을 정리해 다음 상담 때 가져온다', owner: 'beneficiary', dueDate: '2026-07-19' }],
        flags: [{ flagType: 'debt_deterioration', quote: '이번 달은 도저히 못 갚아서 리볼빙으로 또 넘겼어요.' }],
      },
      { heldAt: iso(2026, 6, 24), memo: '생활비 예산은 세웠으나 지키지 못한 주가 많았다. 부채 규모가 커지며 심리적 위축이 보인다.' },
    ],
  },
];

/*
 * 집계 목표(검증 기준):
 * - 참여자 4명. 주담당은 전원 ai00 — 미리보기 고정 데모 실무자(PREVIEW_ACTOR_EMAIL)가 ai00 이고,
 *   실무자는 자신이 담당인 케이스만 열 수 있어(D7) 다른 상담사에게 배정하면 화면이 빈다.
 * - 동의(D49): 4명 전원 ② AI 녹취기록 동의. 미동의(수기 폴백, D5) 케이스는 없다.
 * - GAS 추이: 개선 2(1·3) / 정체 1(2) / 악화 1(4).
 * - 목표 교체(D12): 1케이스(3) — closeGoal successor 로 scale_criteria JSON 저장.
 * - 미해결 인라인 액션: 2건(1·4). 해결된 액션: 2건(2×2).
 * - confirmed 플래그 1건: 인라인 1(4 debt) — 브리핑 리스크 배너(D9)의 유일한 시연 케이스.
 * - 향후 예정 일정 3건: 1·2·3 (전원 ai00 담당).
 * - 세션: 인테이크 4 + 정기 11 = 15. 세션당 sessions_manual_submission_audit 트리거 감사 15건.
 */
