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
  consent: { recording: boolean; textAi: boolean };
  trajectory: Trajectory;
  goals: SeedGoal[];
  intakeMemo: string;
  regulars: SeedRegular[];
  goalReplacement?: SeedGoalReplacement;
  resolvedActions?: SeedActionSpec[];
  standaloneFlag?: SeedFlag;
  futureSchedules?: SeedFutureSchedule[];
}

/** 가상 상담사 3명(users 에 email + 표시 이름 name 저장, D31). 고정 UUID 로 upsertUser 한다. */
export const VIRTUAL_COUNSELORS = [
  { userId: 'c0a80101-0000-4000-8000-000000000001', email: 'virtual-01@example.test', displayName: '박은영' },
  { userId: 'c0a80101-0000-4000-8000-000000000002', email: 'virtual-02@example.test', displayName: '정민철' },
  { userId: 'c0a80101-0000-4000-8000-000000000003', email: 'virtual-03@example.test', displayName: '오하늘' },
] as const;

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
 * 가상 참여자 20명. 배정·동의·추이·회차·이벤트 분포는 파일 하단 주석의 집계 목표를 충족한다.
 */
export const PARTICIPANTS: readonly SeedParticipant[] = [
  // ── 1 (ai00, improving, 목표2, 정기3, 미래일정) ──────────────────────────────
  {
    name: '김서준', phone: phone(1), email: email(1), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 4, 13), consent: { recording: true, textAi: true }, trajectory: 'improving',
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
    intakeAt: iso(2026, 5, 11), consent: { recording: true, textAi: true }, trajectory: 'plateau',
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
    intakeAt: iso(2026, 4, 6), consent: { recording: true, textAi: true }, trajectory: 'improving',
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
    intakeAt: iso(2026, 5, 13), consent: { recording: true, textAi: true }, trajectory: 'decline',
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
  // ── 5 (ai00, improving, 목표2, 정기3, resolvedAction1, 미래일정) ────────────────
  {
    name: '정예은', phone: phone(5), email: email(5), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 4, 15), consent: { recording: true, textAi: true }, trajectory: 'improving',
    goals: [
      { key: 'sales', title: '월 매출 200만원을 안정적으로 유지한다' },
      { key: 'save', title: '매달 10만원을 비상금으로 적립한다' },
    ],
    intakeMemo: '수제 액세서리 온라인 판매를 시작한 단계다. 매출 변동이 커서 안정화와 소액 적립을 병행 목표로 삼았다.',
    regulars: [
      { heldAt: iso(2026, 5, 6), memo: '초기 주문이 늘어 매출이 올랐다. 다만 재료 수급이 불안정해 대비가 필요하다.' },
      { heldAt: iso(2026, 5, 27), memo: '매출이 목표선에 근접했고 적립도 두 달째 유지 중이다. 포장·배송 비용을 줄이는 방법을 찾아보기로 했다.', goalLinks: ['sales'], customQuestions: ['이번 달 가장 큰 지출 항목은 무엇이었나요?'] },
      { heldAt: iso(2026, 6, 17), memo: '매출이 안정 구간에 들어섰고 적립도 순조롭다. 다음 단계로 소규모 광고를 시험해보기로 했다.' },
    ],
    resolvedActions: [{ description: '배송비 절감안을 조사해 공유한다', owner: 'counselor', dueDate: '2026-05-20' }],
    futureSchedules: [{ scheduledAt: iso(2026, 7, 24, 6), goalLinks: ['sales'] }],
  },
  // ── 6 (ai00, plateau, 목표1, 정기1, 인라인액션) ────────────────────────────────
  {
    name: '강지호', phone: phone(6), email: email(6), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 6, 15), consent: { recording: true, textAi: true }, trajectory: 'plateau',
    goals: [{ key: 'ledger', title: '매일 지출을 기록해 새는 돈을 파악한다' }],
    intakeMemo: '배달 일과 단기 아르바이트를 병행하며 수입이 들쭉날쭉하다. 우선 지출 파악부터 시작하기로 했다.',
    regulars: [
      {
        heldAt: iso(2026, 7, 6), memo: '기록은 시작했으나 며칠 빠지는 날이 있어 흐름이 끊긴다. 알림을 설정해 습관화를 돕기로 했다.',
        actionItems: [{ description: '지출 기록 알림을 매일 저녁 9시에 설정한다', owner: 'beneficiary' }],
      },
    ],
  },
  // ── 7 (ai00, mixed, 목표2, 정기2, 텍스트만 동의, 인라인액션) ────────────────────
  {
    name: '윤채원', phone: phone(7), email: email(7), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: iso(2026, 5, 18), consent: { recording: false, textAi: true }, trajectory: 'mixed',
    goals: [
      { key: 'repay', title: '소상공인 대출 원금을 매달 상환한다' },
      { key: 'mentor', title: '경영 멘토링을 월 2회 이수한다' },
    ],
    intakeMemo: '작은 공방을 운영하며 대출 상환과 운영 개선을 병행하려 한다. 녹음은 원치 않아 수기 기록으로 진행한다.',
    regulars: [
      {
        heldAt: iso(2026, 6, 8), memo: '상환은 맞췄으나 멘토링 일정이 겹쳐 한 번 빠졌다. 다음 달은 요일을 고정하기로 했다.',
        actionItems: [{ description: '멘토링 고정 요일을 정해 캘린더에 등록한다', owner: 'beneficiary', dueDate: '2026-06-20' }],
      },
      { heldAt: iso(2026, 6, 29), memo: '멘토링은 회복했으나 비수기로 매출이 줄어 상환 압박이 커졌다. 성과와 부담이 엇갈리는 국면이다.' },
    ],
  },
  // ── 8 (counselor01, improving, 목표3, 정기3, 미래일정) ───────────────────────────
  {
    name: '임하준', phone: phone(8), email: email(8), assigneeUserId: COUNSELOR_IDS.counselor01,
    intakeAt: iso(2026, 4, 20), consent: { recording: true, textAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '월 상환액 25만원을 정기 납부한다' },
      { key: 'save', title: '비상금 30만원을 적립한다' },
      { key: 'ledger', title: '주 1회 손익을 정리한다' },
    ],
    intakeMemo: '중고차 부품 소매를 하며 계절 변동이 크다. 상환·적립·손익정리 세 축으로 재무를 정돈하기로 했다.',
    regulars: [
      { heldAt: iso(2026, 5, 11), memo: '상환과 손익정리는 시작 단계지만 방향은 잡혔다. 적립은 다음 달부터 소액으로 시작한다.' },
      { heldAt: iso(2026, 6, 1), memo: '손익정리가 습관이 되어 재고 판단이 빨라졌다. 상환도 안정적이다.', goalLinks: ['ledger'] },
      { heldAt: iso(2026, 6, 22), memo: '세 목표 모두 궤도에 올랐다. 적립액을 조금 올려도 될지 검토하기로 했다.' },
    ],
    futureSchedules: [{ scheduledAt: iso(2026, 7, 22, 3), goalLinks: ['save'] }],
  },
  // ── 9 (counselor01, decline, 목표2, 정기4, 목표교체 afterSession1, 인라인플래그 contact) ──
  {
    name: '한서연', phone: phone(9), email: email(9), assigneeUserId: COUNSELOR_IDS.counselor01,
    intakeAt: iso(2026, 4, 8), consent: { recording: true, textAi: true }, trajectory: 'decline',
    goals: [
      { key: 'repay', title: '연체된 통신·공과금을 3개월 내 정리한다' },
      { key: 'income', title: '주 20시간 이상 안정적으로 근로한다' },
    ],
    intakeMemo: '단기 일자리를 전전하며 공과금 연체가 쌓였다. 연체 정리와 근로 안정화를 목표로 잡았다.',
    regulars: [
      { heldAt: iso(2026, 4, 22), memo: '연체 일부를 정리했으나 근로 시간이 들쭉날쭉해 소득이 불안정하다.' },
      {
        heldAt: iso(2026, 5, 13), memo: '연락이 며칠 닿지 않다가 재개됐다. 건강 문제로 근로가 끊긴 기간이 있었다. 근로 목표를 현실적인 시간으로 조정했다.',
        flags: [{ flagType: 'contact_loss_risk', quote: '요즘 몸이 안 좋아서 연락을 잘 못 받았어요.' }],
      },
      { heldAt: iso(2026, 6, 3), memo: '조정한 근로 목표는 지키고 있으나 소득이 여전히 부족해 연체가 다시 늘 위험이 있다.' },
      { heldAt: iso(2026, 6, 24), memo: '연체 정리가 정체됐다. 공공 지원 연계를 함께 알아보기로 했다.' },
    ],
    goalReplacement: {
      afterSession: 1, closeGoalKey: 'income', reason: '건강 문제로 기존 근로시간 목표가 비현실적이 되어 하향 조정',
      newGoal: { key: 'income2', title: '주 12시간 근로를 꾸준히 유지한다', scaleCriteria: REPAYMENT_SCALE },
    },
  },
  // ── 10 (counselor02, improving, 목표2, 정기2, 인라인액션, 미래일정) ────────────────────
  {
    name: '오지안', phone: phone(10), email: email(10), assigneeUserId: COUNSELOR_IDS.counselor02,
    intakeAt: iso(2026, 5, 20), consent: { recording: true, textAi: true }, trajectory: 'improving',
    goals: [
      { key: 'sales', title: '주말 플리마켓 매출을 월 4회 기록한다' },
      { key: 'save', title: '매출의 10%를 적립한다' },
    ],
    intakeMemo: '수공예 소품을 주말 마켓에서 판매한다. 매출 기록과 적립 습관을 만드는 것이 첫 목표다.',
    regulars: [
      {
        heldAt: iso(2026, 6, 10), memo: '마켓 매출을 빠짐없이 기록했다. 적립도 시작했으나 비율 맞추기가 아직 어렵다.',
        actionItems: [{ description: '적립 자동이체를 매출일 다음 날로 설정한다', owner: 'beneficiary', dueDate: '2026-07-21' }],
        goalLinks: ['save'],
      },
      { heldAt: iso(2026, 7, 1), memo: '자동이체 설정 후 적립이 안정됐다. 매출도 완만히 늘고 있다.' },
    ],
    futureSchedules: [{ scheduledAt: iso(2026, 7, 25, 4) }],
  },
  // ── 11 (counselor02, plateau, 목표1, 정기1, 텍스트만 동의, 인라인액션) ─────────────────
  {
    name: '서유나', phone: phone(11), email: email(11), assigneeUserId: COUNSELOR_IDS.counselor02,
    intakeAt: iso(2026, 6, 17), consent: { recording: false, textAi: true }, trajectory: 'plateau',
    goals: [{ key: 'repay', title: '카드 대금을 매달 정액 상환한다' }],
    intakeMemo: '프리랜서 디자인 수입이 불규칙해 카드 대금 관리가 어렵다. 정액 상환 습관을 목표로 삼았고 녹음은 원치 않아 수기로 진행한다.',
    regulars: [
      {
        heldAt: iso(2026, 7, 8), memo: '정액 상환은 맞췄으나 수입 공백기 대비가 필요하다. 완충용 소액 적립을 검토했다.',
        actionItems: [{ description: '월 수입 변동 폭을 3개월치 정리해 온다', owner: 'beneficiary' }],
      },
    ],
  },
  // ── 12 (counselor03, plateau, 목표3, 정기3, 목표교체 afterSession1) ────────────────────
  {
    name: '신건우', phone: phone(12), email: email(12), assigneeUserId: COUNSELOR_IDS.counselor03,
    intakeAt: iso(2026, 4, 22), consent: { recording: true, textAi: true }, trajectory: 'plateau',
    goals: [
      { key: 'repay', title: '사업자 대출을 월 20만원씩 상환한다' },
      { key: 'ledger', title: '일 매출·매입을 매일 기록한다' },
      { key: 'mentor', title: '세무 멘토링을 월 1회 받는다' },
    ],
    intakeMemo: '동네 반찬가게를 운영하며 세무 처리에 어려움을 겪는다. 상환·기록·세무멘토링을 함께 목표로 잡았다.',
    regulars: [
      { heldAt: iso(2026, 5, 13), memo: '기록은 자리잡았고 상환도 유지된다. 세무 멘토링은 일정 조율이 필요하다.' },
      { heldAt: iso(2026, 6, 3), memo: '세무 멘토링 대신 실무 회계 교육이 더 시급하다고 판단해 목표를 바꾸기로 했다. 기록·상환은 안정적이다.', goalLinks: ['ledger'] },
      { heldAt: iso(2026, 6, 24), memo: '회계 교육으로 전환한 목표가 잘 맞는다. 부가세 개념을 실제 장부에 적용하기 시작했다.' },
    ],
    goalReplacement: {
      afterSession: 1, closeGoalKey: 'mentor', reason: '세무 멘토링보다 기초 회계 실무 교육이 우선이라 목표를 전환',
      newGoal: { key: 'accounting', title: '기초 회계 실무 교육을 4주 과정으로 이수한다', scaleCriteria: REPAYMENT_SCALE },
    },
  },
  // ── 13 (counselor03, mixed, 목표2, 정기2, 미동의, 독립 플래그 repeated) ────────────────
  {
    name: '조민서', phone: phone(13), email: email(13), assigneeUserId: COUNSELOR_IDS.counselor03,
    intakeAt: iso(2026, 5, 25), consent: { recording: false, textAi: false }, trajectory: 'mixed',
    goals: [
      { key: 'repay', title: '월 상환 계획을 세워 지킨다' },
      { key: 'attend', title: '재무 상담에 격주로 참석한다' },
    ],
    intakeMemo: '녹음·텍스트 AI 정리 모두 원치 않아 수기 기록만으로 진행한다. 상환 계획 이행과 상담 참석을 목표로 삼았다.',
    regulars: [
      { heldAt: iso(2026, 6, 15), memo: '상환 계획은 세웠으나 약속한 상담 일정을 두 차례 미뤘다. 참석 방식을 유연하게 바꿔보기로 했다.' },
      { heldAt: iso(2026, 7, 6), memo: '상환은 일부 이행했으나 참석 약속이 반복적으로 지켜지지 않는다. 연락 방식을 재점검했다.' },
    ],
    standaloneFlag: { flagType: 'repeated_noncompliance', quote: '이번에도 상담 시간에 다른 일이 생겨서 못 왔어요.' },
  },
  // ── 14 (counselor04, improving, 목표2, 정기3, 인라인액션, 미래일정) ────────────────
  {
    name: '권하율', phone: phone(14), email: email(14), assigneeUserId: COUNSELOR_IDS.counselor04,
    intakeAt: iso(2026, 4, 27), consent: { recording: true, textAi: true }, trajectory: 'improving',
    goals: [
      { key: 'sales', title: '월 매출 목표 150만원을 달성한다' },
      { key: 'ledger', title: '주간 손익을 기록해 점검한다' },
    ],
    intakeMemo: '온라인 반찬 정기배송을 시작했다. 매출 목표 달성과 손익 기록을 병행 목표로 삼았다.',
    regulars: [
      { heldAt: iso(2026, 5, 18), memo: '정기배송 구독이 늘며 매출이 상승세다. 손익 기록도 시작했다.' },
      {
        heldAt: iso(2026, 6, 8), memo: '매출 목표에 근접했고 재구매율이 안정적이다. 포장 자동화로 시간을 아끼는 방안을 논의했다.',
        actionItems: [{ description: '포장 공정 개선안을 다음 상담 전까지 정리한다', owner: 'beneficiary', dueDate: '2026-06-22' }],
        goalLinks: ['sales'],
      },
      { heldAt: iso(2026, 6, 29), memo: '매출 목표를 달성했고 손익 기록으로 마진 관리가 가능해졌다. 다음 분기 확장을 조심스럽게 검토했다.' },
    ],
    futureSchedules: [{ scheduledAt: iso(2026, 7, 20, 4), goalLinks: ['sales', 'ledger'] }],
  },
  // ── 15 (counselor04, plateau, 목표1, 정기1, 텍스트만 동의) ────────────────────────
  {
    name: '배시윤', phone: phone(15), email: email(15), assigneeUserId: COUNSELOR_IDS.counselor04,
    intakeAt: iso(2026, 6, 22), consent: { recording: false, textAi: true }, trajectory: 'plateau',
    goals: [{ key: 'budget', title: '월 고정지출을 정리해 예산 안에서 생활한다' }],
    intakeMemo: '소규모 세탁 대행업을 하며 고정지출 관리가 어렵다. 예산 수립과 준수를 목표로 삼았다. 녹음은 원치 않아 수기로 진행한다.',
    regulars: [
      { heldAt: iso(2026, 7, 13), memo: '고정지출 목록은 정리했으나 변동비 관리가 아직 약하다. 다음 달 예산표를 함께 만들기로 했다.' },
    ],
  },
  // ── 16 (counselor05, improving, 목표2, 정기2, resolvedAction1) ───────────────────
  {
    name: '남주원', phone: phone(16), email: email(16), assigneeUserId: COUNSELOR_IDS.counselor05,
    intakeAt: iso(2026, 5, 27), consent: { recording: true, textAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '소액 대출 잔액을 6개월 내 절반으로 줄인다' },
      { key: 'save', title: '매달 5만원을 비상금으로 적립한다' },
    ],
    intakeMemo: '편의점 야간 근무와 소일거리를 병행한다. 대출 잔액 축소와 소액 적립을 목표로 삼았다.',
    regulars: [
      { heldAt: iso(2026, 6, 17), memo: '상환 속도가 계획보다 빠르다. 적립도 두 달째 유지 중이다.', goalLinks: ['repay'] },
      { heldAt: iso(2026, 7, 8), memo: '잔액이 눈에 띄게 줄었고 적립 습관이 안정됐다. 다음 목표로 신용점수 관리를 이야기했다.' },
    ],
    resolvedActions: [{ description: '신용점수 조회 방법과 관리 팁을 정리해 전달한다', owner: 'counselor', dueDate: '2026-07-01' }],
  },
  // ── 17 (counselor05, mixed, 목표2, 정기2, 미동의, 인라인플래그 housing) ───────────
  {
    name: '문가온', phone: phone(17), email: email(17), assigneeUserId: COUNSELOR_IDS.counselor05,
    intakeAt: iso(2026, 6, 1), consent: { recording: false, textAi: false }, trajectory: 'mixed',
    goals: [
      { key: 'income', title: '주 3일 이상 안정적으로 일한다' },
      { key: 'budget', title: '월세와 생활비 예산을 분리해 관리한다' },
    ],
    intakeMemo: '녹음·텍스트 AI 모두 원치 않아 수기 기록으로 진행한다. 근로 안정과 주거비 관리를 목표로 삼았다.',
    regulars: [
      {
        heldAt: iso(2026, 6, 22), memo: '근로일수는 늘었으나 갑작스러운 월세 인상 통보로 주거 불안이 커졌다. 지원 제도를 함께 찾아보기로 했다.',
        flags: [{ flagType: 'housing_livelihood_shock', quote: '집주인이 다음 달부터 월세를 갑자기 올린다고 했어요.' }],
      },
      { heldAt: iso(2026, 7, 13), memo: '주거 지원 상담을 연계했다. 근로는 유지되나 주거 문제로 예산 관리가 흔들린다.' },
    ],
  },
  // ── 18 (박은영 virtual, improving, 목표1, 정기1, 미래일정) ──────────────────────
  {
    name: '유서아', phone: phone(18), email: email(18), assigneeUserId: VIRTUAL_COUNSELORS[0].userId,
    intakeAt: iso(2026, 6, 24), consent: { recording: true, textAi: true }, trajectory: 'improving',
    goals: [{ key: 'sales', title: '첫 3개월 내 월 매출 100만원을 만든다' }],
    intakeMemo: '홈베이킹 소량 판매를 막 시작했다. 초기 매출 기반을 만드는 것을 첫 목표로 삼았다.',
    regulars: [
      { heldAt: iso(2026, 7, 15), memo: '입소문으로 주문이 늘기 시작했다. 재료 원가 계산을 정교화하기로 했다.', goalLinks: ['sales'] },
    ],
    futureSchedules: [{ scheduledAt: iso(2026, 7, 22, 6), goalLinks: ['sales'], customQuestions: ['원가 계산에서 빠뜨리기 쉬운 항목을 점검해봅시다'] }],
  },
  // ── 19 (정민철 virtual, plateau, 목표2, 정기2) ─────────────────────────────────
  {
    name: '고라온', phone: phone(19), email: email(19), assigneeUserId: VIRTUAL_COUNSELORS[1].userId,
    intakeAt: iso(2026, 6, 3), consent: { recording: true, textAi: true }, trajectory: 'plateau',
    goals: [
      { key: 'repay', title: '생활비 대출을 매달 정액 상환한다' },
      { key: 'ledger', title: '가계부를 매주 정리한다' },
    ],
    intakeMemo: '택배 상하차 일과 소일거리를 병행한다. 정액 상환과 가계부 습관을 목표로 삼았다.',
    regulars: [
      { heldAt: iso(2026, 6, 24), memo: '상환과 가계부 모두 유지되나 뚜렷한 개선은 더디다. 지출 항목을 세분화해보기로 했다.' },
      { heldAt: iso(2026, 7, 15), memo: '가계부 세분화 후 새는 지출을 일부 찾았다. 상환은 안정적으로 이어진다.' },
    ],
  },
  // ── 20 (오하늘 virtual, decline, 목표1, 정기1, 미동의, 인라인액션) ──────────────
  {
    name: '진하윤', phone: phone(20), email: email(20), assigneeUserId: VIRTUAL_COUNSELORS[2].userId,
    intakeAt: iso(2026, 7, 10), consent: { recording: false, textAi: false }, trajectory: 'decline',
    goals: [{ key: 'income', title: '월 소득 100만원 이상을 회복한다' }],
    intakeMemo: '녹음·텍스트 AI 모두 원치 않아 수기 기록으로 진행한다. 실직 후 소득 회복을 첫 목표로 삼았다.',
    regulars: [
      {
        heldAt: iso(2026, 7, 16), memo: '구직 활동을 시작했으나 성과가 없어 위축돼 있다. 단기 일자리라도 우선 연계하기로 했다.',
        actionItems: [{ description: '단기 일자리 연계 기관 목록을 전달한다', owner: 'counselor', dueDate: '2026-07-22' }],
      },
    ],
  },
];

/*
 * 집계 목표(검증 기준):
 * - 참여자 20명. 주담당: ai00 7 / counselor01~05 각 2 / 가상 3명 각 1.
 * - 동의(D15): 녹음+텍스트 14(1·2·3·4·5·6·8·9·10·12·14·16·18·19), 텍스트만 3(7·11·15), 미동의 3(13·17·20).
 * - GAS 추이: 개선 8 / 정체 6 / 악화 3 / 혼조 3.
 * - 목표 교체(D12): 3케이스(3·9·12) — closeGoal successor 로 scale_criteria JSON 저장.
 * - 미해결 인라인 액션: 8건(1·4·6·7·10·11·14·20). 해결된 액션: 4건(2×2, 5, 16).
 * - confirmed 플래그 4건: 인라인 3(4 debt·9 contact·17 housing) + 독립 createFlag 1(13 repeated).
 * - 향후 7일(07-19~25) 예정 일정 8건: ai00 4(1·2·3·5) + 그 외 4(8·10·14·18).
 * - 세션: 인테이크 20 + 정기 44 = 64. 세션당 sessions_manual_submission_audit 트리거 감사 64건.
 */
