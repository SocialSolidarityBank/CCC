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
 * - 타임스탬프(intakeAt/heldAt/scheduledAt/dueDate)는 **기준일 상대 오프셋**이다 —
 *   `at(일수[, 시, 분])` · `dueDate: day(일수)`. 음수는 지난 일, 양수는 앞으로 올 일정이다.
 *   절대값으로 박으면 시드가 시간이 지나면서 낡는다(SEED_ANCHOR_DATE 주석 참고).
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

/**
 * 기준일 — 아래 모든 날짜가 이 날에서 상대 계산된다(`YYYY-MM-DD`).
 *
 * 기본값은 **시드를 만드는 날(기관 시간대)**이다. 절대값으로 박아 두면 시간이 흐를수록
 * '다가오는 일정'(오늘 + 향후 7일)이 비어, 새로 만든 시드도 태어날 때부터 그 섹션이 빈다.
 * `SEED_ANCHOR_DATE` 로 고정하면 과거 산출물을 그대로 재현할 수 있다(전환 검증에 쓴 값:
 * `2026-08-01`).
 *
 * UTC 가 아니라 기관 시간대인 이유: '다가오는 일정' 판정이 기관 시간대로 이뤄지므로, UTC
 * 날짜를 쓰면 자정~09:00 사이에 시드를 만들 때 기준일이 KST 로는 이미 어제가 되고 '오늘'
 * 일정이 창 밖으로 떨어진다.
 *
 * `yellow` **이미 넣은 DB 는 이 값으로 고쳐지지 않는다** — 그쪽은
 * `scripts/seed/reschedule-upcoming.mjs`(`pnpm seed:reschedule`)가 담당한다.
 */
export const SEED_ANCHOR_DATE: string = resolveAnchorDate();

function resolveAnchorDate(): string {
  const override = process.env.SEED_ANCHOR_DATE;
  if (override === undefined || override.length === 0) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(override) || Number.isNaN(Date.parse(`${override}T00:00:00.000Z`))) {
    throw new Error(`[seed] SEED_ANCHOR_DATE 는 YYYY-MM-DD 형식이어야 합니다: ${override}`);
  }
  return override;
}

const ANCHOR_MS = Date.parse(`${SEED_ANCHOR_DATE}T00:00:00.000Z`);
const DAY_MS = 86_400_000;

/** 기준일 + `dayOffset` 일의 시각(UTC ISO). 음수는 과거 — 지난 회차는 전부 음수다. */
function at(dayOffset: number, hour = 10, minute = 0): string {
  return new Date(ANCHOR_MS + dayOffset * DAY_MS + hour * 3_600_000 + minute * 60_000).toISOString();
}

/** 기준일 + `dayOffset` 일의 날짜만(`YYYY-MM-DD`). 액션 기한은 시각이 없는 값이다. */
function day(dayOffset: number): string {
  return at(dayOffset, 0, 0).slice(0, 10);
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
    intakeAt: at(-110), consent: { recordingAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '월 상환액 20만원을 3개월 연속 납부한다' },
      { key: 'ledger', title: '주 1회 매출 장부를 기록한다' },
    ],
    intakeMemo: '분식 노점을 혼자 꾸린다. 날씨에 따라 하루 매출이 세 배까지 벌어져 카드 대출 상환이 두 달 밀렸다. 감으로 하던 장사를 숫자로 보는 것부터 시작하고, 매달 낼 수 있는 금액을 먼저 고정하기로 했다.',
    regulars: [
      { heldAt: at(-89), memo: '약속한 20만원을 이번 달은 맞췄다. 장부는 사흘에 한 번꼴이지만 적는 날이 늘고 있다.' },
      {
        heldAt: at(-68), memo: '주말 매출이 오르며 상환에 숨통이 트였다. 재료를 그날그날 사다 보니 남겨서 버리는 일이 잦다고 해, 주간 상한을 정해보기로 했다.',
        actionItems: [{ description: '다음 상담 전까지 주간 재료비 상한을 정해 온다', owner: 'beneficiary', dueDate: day(-52) }],
        goalLinks: ['ledger'], customQuestions: ['장부를 적다가 가장 귀찮은 대목은 어디인가요?'],
      },
      { heldAt: at(-47), memo: '석 달 연속 정액 상환이 이어졌다. 비상금을 모으고 싶다는 이야기를 먼저 꺼냈다.' },
    ],
    futureSchedules: [{ scheduledAt: at(0, 4), goalLinks: ['repay'], customQuestions: ['적립을 새 목표로 넣을지 함께 정해봅시다'] }],
  },
  // ── 2 (ai00, plateau, 목표1, 정기2, resolvedActions2, 미래일정) ───────────────
  {
    name: '이하은', phone: phone(2), email: email(2), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-82), consent: { recordingAi: true }, trajectory: 'plateau',
    goals: [{ key: 'attend', title: '멘토링에 월 2회 참석한다' }],
    intakeMemo: '손뜨개 소품을 온라인에 올려 팔아보려 하지만 어디부터 손대야 할지 모르겠다고 한다. 계획을 혼자 세우다 지쳤다고 해, 멘토링에 꾸준히 나가는 것을 첫 목표로 잡았다.',
    regulars: [
      { heldAt: at(-61), memo: '두 번 다 참석했다. 다만 배운 것을 자기 물건에 적용하는 단계에서 막혀 부담스러워한다.' },
      {
        heldAt: at(-40), memo: '참석은 지키고 있으나 매출로 이어지지 않아 의욕이 눈에 띄게 떨어졌다. 과제를 한 주에 하나씩으로 줄였다.',
        customQuestions: ['이번 달 멘토링에서 바로 써먹은 것이 하나라도 있었나요?'],
      },
    ],
    resolvedActions: [
      { description: '멘토가 추천한 상품 등록 절차 문서를 함께 읽는다', owner: 'counselor', dueDate: day(-57) },
      { description: '판매 채널 후보 3곳을 비교해 온다', owner: 'beneficiary', dueDate: day(-44) },
    ],
    futureSchedules: [{ scheduledAt: at(2, 5), customQuestions: ['판매 채널을 한 곳으로 좁혀볼지 이야기해봅시다'] }],
  },
  // ── 3 (ai00, improving, 목표3, 정기4, 목표교체 afterSession2, 미래일정) ─────────
  {
    name: '박도윤', phone: phone(3), email: email(3), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-117), consent: { recordingAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '월 상환액 15만원을 정기 납부한다' },
      { key: 'save', title: '비상금 50만원을 적립한다' },
      { key: 'sales', title: '주간 매출을 기록해 흐름을 파악한다' },
    ],
    intakeMemo: '중고 물품을 매입해 되파는 일을 한다. 생활비와 사업비가 한 통장에서 섞여 얼마를 버는지 본인도 모르는 상태다. 상환·적립·매출 세 갈래로 나눠 관리하기로 정리했다.',
    regulars: [
      { heldAt: at(-103), memo: '상환용 통장을 따로 만들자 관리가 한결 쉬워졌다. 매출도 그날그날 적기 시작했다.' },
      { heldAt: at(-82), memo: '적립까지는 아직 손이 못 미치지만 상환과 매출 기록은 자리를 잡았다. 적립 금액을 현실적으로 낮춰 다시 잡기로 했다.', goalLinks: ['save'] },
      { heldAt: at(-61), memo: '매출 흐름이 눈에 들어오면서 비수기를 미리 대비하게 됐다. 기록은 이미 습관이 되어 목표를 바꾸자는 이야기가 본인에게서 나왔다.' },
      {
        heldAt: at(-40), memo: '재고 회전으로 목표를 옮긴 뒤 할 일이 구체적이 됐다. 상환·적립 모두 흔들림이 없다.',
        customQuestions: ['안 팔리고 오래 남는 물건은 주로 어떤 종류인가요?'],
      },
    ],
    goalReplacement: {
      afterSession: 3, closeGoalKey: 'sales', reason: '매출 기록 습관이 정착되어 재고 회전 관리로 목표를 전환',
      newGoal: { key: 'stock', title: '주간 재고 회전율을 점검해 과잉 매입을 줄인다', scaleCriteria: SAVINGS_SCALE },
    },
    futureSchedules: [{ scheduledAt: at(15, 3), goalLinks: ['repay', 'save'] }],
  },
  // ── 4 (ai00, decline, 목표2, 정기2, 인라인액션·플래그 debt) ─────────────────────
  {
    name: '최시우', phone: phone(4), email: email(4), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-80), consent: { recordingAi: true }, trajectory: 'decline',
    goals: [
      { key: 'repay', title: '카드 리볼빙 잔액을 매달 10만원씩 줄인다' },
      { key: 'budget', title: '주간 생활비 예산을 세워 지킨다' },
    ],
    intakeMemo: '리볼빙과 현금서비스가 겹쳐 매달 이자만 빠져나간다. 잔액을 조금씩이라도 줄이는 것과, 생활비를 손에 쥐고 쓰는 것을 목표로 삼았다.',
    regulars: [
      {
        heldAt: at(-59), memo: '갑작스러운 병원비로 이번 달 상환을 넘겼고 리볼빙이 다시 늘었다. 무엇부터 낼지 순서를 함께 다시 적었다.',
        actionItems: [{ description: '고정지출 항목을 정리해 다음 상담 때 가져온다', owner: 'beneficiary', dueDate: day(4) }],
        flags: [{ flagType: 'debt_deterioration', quote: '이번 달은 도저히 못 갚아서 리볼빙으로 또 넘겼어요.' }],
      },
      {
        heldAt: at(-38), memo: '예산은 세웠지만 지킨 주가 절반이 안 된다. 빚이 늘면서 말수가 눈에 띄게 줄었다.',
        customQuestions: ['예산을 넘긴 주에는 주로 어떤 지출이 있었나요?'],
      },
    ],
    futureSchedules: [{ scheduledAt: at(8, 6), goalLinks: ['budget'] }],
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
 * - 예정 일정 4건(08-03·04·05·06): 사람당 정확히 1건 — 일정 화면에서 같은 사람이 여러 줄로
 *   반복되지 않게 한다(2026-07-31 Q 지적: 프리뷰에서 한 명이 일정 9건으로 아홉 번 나왔다).
 * - 세션: 인테이크 4 + 정기 11 = 15. 세션당 sessions_manual_submission_audit 트리거 감사 15건.
 */
