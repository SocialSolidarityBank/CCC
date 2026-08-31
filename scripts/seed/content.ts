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
import type { FlagType, GoalCloseReason } from '../../db/gateway';
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
   *  이 값은 목표 교체(closeGoal+createGoal, D62 §5) 경로에서만 실제로 저장된다. */
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
  /** D62 §5: closed_reason 은 선택값 3종만 저장한다(달성/중단/재설정). */
  reason: GoalCloseReason;
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

/**
 * 기준일 + `dayOffset` 일의 시각(UTC ISO). 음수는 과거이고 지난 회차는 전부 음수다.
 *
 * `hour` 는 **UTC** 다. 기관 시간대(KST, +9)로 업무시간에 두려면 **0~8** 을 쓴다(09:00~17:00).
 * 9 이상을 넣으면 화면에 저녁으로 뜨고, 15 이상은 다음 날로 넘어가 일정이 하루 밀린다
 * (2026-08-31 프리뷰 실측: at(1, 11) 이 '오후 8:00' 로, at(20, 16) 이 다음 날로 떨어졌다).
 */
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

/** 목표 교체 신설분(createGoal)에 붙일 5단계 척도 설명(대표 예시 재사용). */
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
 * 운영 정본 참여자 4명. 배정·동의·추이·회차·이벤트 분포는 파일 하단 주석의 집계 목표를 충족한다.
 *
 * **이 배열은 늘리지 않는다.** 화면을 보려고 데이터를 늘리는 것은 프리뷰의 일이고, 운영 D1 에
 * 들어가는 가상 데이터는 적을수록 좋다(실서비스 개시 전 정리 대상이라서다). 사례를 더 보고
 * 싶으면 아래 PREVIEW_ONLY_PARTICIPANTS 에 넣고 SEED_PROFILE=preview 로 만든다.
 */
export const OPERATIONAL_PARTICIPANTS: readonly SeedParticipant[] = [
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
      // 매출 기록 습관이 정착되어 재고 회전 관리로 목표를 전환하는 시나리오다(사유: 재설정).
      afterSession: 3, closeGoalKey: 'sales', reason: 'reset',
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

/**
 * 프리뷰 전용 참여자 10명(2026-08-30 Q "텍스트가 풍부하고 여러 가지 사례를 고루 볼 수 있는
 * 데이터를 다량으로, 프리뷰사이트에서만").
 *
 * **운영 시드에는 들어가지 않는다**: SEED_PROFILE=preview 일 때만 합쳐진다(파일 끝 PARTICIPANTS).
 * 프리뷰 D1 은 가상 데이터 전용이고 통째로 다시 세우는 것이 정상 절차라(RUNBOOK §5) 여기서
 * 사례를 늘려도 운영에 번지지 않는다.
 *
 * 고르게 덮는 축:
 * - 리스크 플래그 6종 전부(D72): 위기 발언·연락 두절·주거·생계·건강 급변·부채 악화·
 *   약속 불이행 반복·폭력·착취 피해. 브리핑 리스크 배너와 회차 카드 '이 회차에서 나온 것'이
 *   여섯 유형 모두에서 어떻게 읽히는지 한 화면씩 볼 수 있다.
 * - 녹취 미동의 1명(5): 수기 폴백(D5)만으로 브리핑이 서는 모양. 운영 시드에는 없던 축이다.
 * - 목표 닫기 사유 3종(D62 §5): 달성(11)·중단(12)·재설정(운영 3에 이미 있다).
 * - 추이 4종: 개선·정체·악화·혼재.
 * - 회차 수 2~6: 회차별 정리 목록이 짧을 때와 길 때, 접힘·펼침 리듬.
 * - 메모 길이: 두 줄짜리와 여섯 줄짜리를 섞었다. 카드 폭에서 줄바꿈·말줄임이 어떻게
 *   걸리는지 보려면 긴 문장이 실제로 있어야 한다.
 */
export const PREVIEW_ONLY_PARTICIPANTS: readonly SeedParticipant[] = [
  // ── 5 (녹취 미동의 · plateau · 수기 폴백만으로 브리핑) ─────────────────────────
  {
    name: '정하윤', phone: phone(5), email: email(5), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-96), consent: { recordingAi: false }, trajectory: 'plateau',
    goals: [{ key: 'ledger', title: '매일 지출을 한 줄로 적는다' }],
    intakeMemo: '반찬가게에서 일하며 밤에는 배달을 뛴다. 두 일을 합쳐도 월세와 관리비를 내면 남는 것이 거의 없다고 한다. 녹음은 부담스럽다고 분명히 말해 동의를 받지 않았고, 기록은 상담 중 손으로 적는 메모로만 남기기로 합의했다. 우선 돈이 어디로 나가는지 눈으로 보는 것부터 시작한다.',
    regulars: [
      { heldAt: at(-75), memo: '한 줄 기록을 열흘쯤 이어갔다. 커피와 편의점 지출이 생각보다 크다는 것을 본인이 먼저 발견했다.', goalLinks: ['ledger'] },
      {
        heldAt: at(-54), memo: '기록은 유지되지만 지출이 줄지는 않았다. 배달 수입이 들쭉날쭉해 예산을 세워도 무너진다고 한다. 수입이 적은 주를 기준으로 최소 예산을 먼저 잡아보기로 했다.', goalLinks: ['ledger'],
        customQuestions: ['수입이 가장 적었던 주에는 무엇을 먼저 포기하게 되나요?'],
      },
    ],
    futureSchedules: [{ scheduledAt: at(1, 2), customQuestions: ['최소 예산안을 함께 손봅시다'] }],
  },
  // ── 6 (위기 발언 플래그 · decline · 미해결 액션) ───────────────────────────────
  {
    name: '오세라', phone: phone(6), email: email(6), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-71), consent: { recordingAi: true }, trajectory: 'decline',
    goals: [
      { key: 'repay', title: '연체된 통신비와 공과금을 순서대로 정리한다' },
      { key: 'support', title: '주 1회는 사람을 만나 이야기한다' },
    ],
    intakeMemo: '온라인 쇼핑몰을 접은 뒤 남은 재고와 미납금이 함께 남았다. 가족과 연락을 끊은 상태로 혼자 지내며, 낮에는 거의 눈을 붙이지 못한다고 한다. 돈 문제와 고립이 함께 있어 정리 순서와 사람 만나는 일을 같이 목표로 잡았다.',
    regulars: [
      {
        heldAt: at(-50), memo: '통신비는 분할 납부로 돌렸다. 대화 중 "다 정리하고 사라지고 싶다"는 말이 나와 그 자리에서 안전 확인을 했고, 지역 상담센터 연락처를 함께 저장했다. 다음 상담까지 매주 안부 연락을 하기로 약속했다.', goalLinks: ['repay'],
        actionItems: [{ description: '주 1회 안부 연락(실무자 발신)과 응답 여부를 기록한다', owner: 'counselor', dueDate: day(3) }],
        flags: [{ flagType: 'crisis_utterance', quote: '다 정리하고 그냥 사라지고 싶다는 생각이 자주 들어요.' }],
      },
      { heldAt: at(-29), memo: '안부 연락에는 대체로 답했다. 공과금 한 건은 아직 손대지 못했고, 사람 만나는 일은 지역 모임 한 번 참석으로 시작했다.', goalLinks: ['support'] },
      {
        heldAt: at(-8), memo: '수면이 조금 나아졌다고 한다. 다만 재고 처분이 진행되지 않아 조바심이 크다.', goalLinks: ['repay', 'support'],
        customQuestions: ['이번 주에 연락하고 지낸 사람이 있었나요?'],
      },
    ],
    futureSchedules: [{ scheduledAt: at(3, 5), goalLinks: ['support'] }],
  },
  // ── 7 (연락 두절 위험 · mixed · 해결된 액션) ───────────────────────────────────
  {
    name: '강민재', phone: phone(7), email: email(7), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-64), consent: { recordingAi: true }, trajectory: 'mixed',
    goals: [{ key: 'contact', title: '상담 일정을 미리 확인하고 변경은 하루 전에 알린다' }],
    intakeMemo: '일용직 현장을 옮겨 다니며 일한다. 일이 잡히면 연락이 끊기고 없으면 다시 오는 식이 반복돼, 우선 연락 리듬을 만드는 것을 목표로 잡았다.',
    regulars: [
      {
        heldAt: at(-43), memo: '두 차례 무응답 뒤 세 번째 연락에 답했다. 현장이 지방으로 잡히면 전화를 받기 어렵다고 해, 문자로 먼저 남기는 방식으로 바꿨다.', goalLinks: ['contact'],
        flags: [{ flagType: 'contact_loss_risk', quote: '전화를 못 받으면 그냥 잊어버려요. 다시 연락 안 하실 줄 알았어요.' }],
      },
      { heldAt: at(-15), memo: '문자로 바꾼 뒤 응답이 붙었다. 일정 변경도 하루 전에 알려 왔다.', goalLinks: ['contact'] },
    ],
    resolvedActions: [
      { description: '문자 우선 연락으로 바꾸고 응답 방식을 케이스에 기록한다', owner: 'counselor', dueDate: day(-40) },
      { description: '다음 현장 일정이 잡히면 날짜를 미리 알려 준다', owner: 'beneficiary', dueDate: day(-20) },
    ],
    futureSchedules: [{ scheduledAt: at(5, 1), goalLinks: ['contact'] }],
  },
  // ── 8 (주거·생계·건강 급변 · decline · 정기 3) ─────────────────────────────────
  {
    name: '서지우', phone: phone(8), email: email(8), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-88), consent: { recordingAi: true }, trajectory: 'decline',
    goals: [
      { key: 'housing', title: '이번 달 안에 거주지 계약 상태를 확인해 정리한다' },
      { key: 'budget', title: '고정지출을 한 장으로 정리한다' },
    ],
    intakeMemo: '작은 인쇄소를 운영하다 기계 고장으로 두 달을 쉬었다. 그 사이 월세가 밀리고 보증금에서 차감되기 시작했다. 거주 문제가 가장 급해 그것부터 목표로 올렸다.',
    regulars: [
      { heldAt: at(-67), memo: '집주인과 분할 상환을 구두로 합의했다. 고정지출 정리는 시작만 해 둔 상태다.', goalLinks: ['housing'] },
      {
        heldAt: at(-46), memo: '허리 통증으로 열흘을 일하지 못해 합의한 금액을 다시 넘겼다. 보증금이 두 달치 더 깎였고, 계약 종료가 두 달 앞이라 대안을 알아봐야 한다.', goalLinks: ['housing'],
        flags: [{ flagType: 'housing_livelihood_shock', quote: '보증금에서 계속 까이니까 나갈 때 남는 게 없을 것 같아요.' }],
        actionItems: [{ description: '주거 지원 제도 두 곳의 신청 요건을 확인해 정리한다', owner: 'org', dueDate: day(6) }],
      },
      { heldAt: at(-25), memo: '통증은 나아졌지만 일감이 줄어 수입이 회복되지 않았다. 고정지출 표는 절반쯤 채웠다.', goalLinks: ['budget'] },
    ],
    futureSchedules: [{ scheduledAt: at(7, 6), goalLinks: ['housing'] }],
  },
  // ── 9 (약속 불이행 반복 · plateau · 정기 4) ────────────────────────────────────
  {
    name: '문가온', phone: phone(9), email: email(9), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-121), consent: { recordingAi: true }, trajectory: 'plateau',
    goals: [
      { key: 'plan', title: '상담에서 정한 할 일을 다음 상담까지 하나는 마친다' },
      { key: 'sales', title: '주 3회 이상 가게 문을 정시에 연다' },
    ],
    intakeMemo: '수선집을 물려받아 운영한다. 손기술은 좋지만 문 여는 시간이 일정하지 않아 단골이 빠졌다. 약속을 작게 쪼개는 방식으로 접근하기로 했다.',
    regulars: [
      { heldAt: at(-100), memo: '개점 시간을 오전 10시로 정했다. 첫 주는 세 번 지켰다.', goalLinks: ['sales'] },
      {
        heldAt: at(-79), memo: '가져오기로 한 매출 메모를 이번에도 잊었다. 세 번째 미이행이라 이유를 함께 짚었다. 종이 대신 사진으로 찍어 보내기로 방식을 바꿨다.', goalLinks: ['plan'],
        flags: [{ flagType: 'repeated_noncompliance', quote: '적어 놓긴 했는데 어디 뒀는지 못 찾겠어요. 매번 이래요.' }],
      },
      { heldAt: at(-58), memo: '사진 전송으로 바꾼 뒤 두 주는 들어왔다. 개점 시간은 다시 흔들렸다.', goalLinks: ['sales'] },
      {
        heldAt: at(-37), memo: '문 여는 시간은 주 3회 기준을 맞췄다. 할 일 하나 마치기는 절반 정도 지켜진다.', goalLinks: ['plan'],
        customQuestions: ['다음 상담까지 딱 하나만 하기로 하면 무엇을 고르겠어요?'],
      },
    ],
    futureSchedules: [{ scheduledAt: at(9, 2), goalLinks: ['plan'] }],
  },
  // ── 10 (폭력·착취 피해 · mixed · 담담한 인용) ──────────────────────────────────
  {
    name: '배유진', phone: phone(10), email: email(10), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-59), consent: { recordingAi: true }, trajectory: 'mixed',
    goals: [{ key: 'safety', title: '본인 명의 계좌와 급여 입금 경로를 분리해 확인한다' }],
    intakeMemo: '친척이 운영하는 가게에서 일하며 급여를 현금으로 받아 왔다. 일한 시간에 비해 받은 금액이 맞지 않는데 문제를 제기하기 어려운 관계라고 한다. 우선 본인 명의 통장으로 급여를 받는 것부터 정리한다.',
    regulars: [
      {
        heldAt: at(-38), memo: '급여 일부를 친척이 보관해 왔고 요청해도 돌려받지 못한 달이 있었다고 한다. 근로 조건과 지급 내역을 시간 순으로 적어 두기로 했고, 상담 기록으로 남기는 것에 동의받았다.', goalLinks: ['safety'],
        flags: [{ flagType: 'violence_exploitation', quote: '제 몫이라고 말하면 관계가 끊길 것 같아서 그냥 넘겼어요.' }],
        actionItems: [{ description: '지급 내역과 근무 시간을 달별로 정리해 온다', owner: 'beneficiary', dueDate: day(2) }],
      },
      { heldAt: at(-17), memo: '본인 명의 계좌를 새로 만들었다. 급여 입금 경로 변경은 아직 이야기하지 못했다.', goalLinks: ['safety'] },
    ],
    futureSchedules: [{ scheduledAt: at(11, 4), goalLinks: ['safety'] }],
  },
  // ── 11 (목표 달성으로 닫기 · improving · 정기 5) ───────────────────────────────
  {
    name: '신태리', phone: phone(11), email: email(11), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-146), consent: { recordingAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '월 상환액 25만원을 정기 납부한다' },
      { key: 'ledger', title: '주 1회 매출과 지출을 함께 적는다' },
    ],
    intakeMemo: '아동복 온라인 판매를 2년째 한다. 매출은 있으나 카드 정산 주기와 상환일이 어긋나 매달 돌려막기를 해 왔다. 정산일을 기준으로 상환일을 옮기는 것부터 손봤다.',
    regulars: [
      { heldAt: at(-125), memo: '상환일을 정산 다음 날로 옮기자 돌려막기가 사라졌다.', goalLinks: ['repay'] },
      { heldAt: at(-104), memo: '두 달 연속 정액 납부. 기록은 주 1회 리듬이 잡혔다.', goalLinks: ['repay', 'ledger'] },
      { heldAt: at(-83), memo: '세 달 연속. 상환 목표는 사실상 자리를 잡아 다음 단계를 이야기했다.', goalLinks: ['repay'] },
      { heldAt: at(-62), memo: '납부는 안정적이고 기록도 유지된다. 상환 목표를 달성으로 닫고 재고 관리로 옮기기로 정했다.', goalLinks: ['ledger'] },
      {
        heldAt: at(-41), memo: '새 목표로 옮긴 뒤 사입 주기를 2주로 줄였다. 재고가 쌓이는 품목이 눈에 보인다고 한다.', goalLinks: ['stock'],
        customQuestions: ['2주 주기로 바꾼 뒤 남는 재고가 줄었나요?'],
      },
    ],
    goalReplacement: {
      afterSession: 4, closeGoalKey: 'repay', reason: 'achieved',
      newGoal: { key: 'stock', title: '사입 주기를 2주로 줄여 재고를 관리한다', scaleCriteria: REPAYMENT_SCALE },
    },
    futureSchedules: [{ scheduledAt: at(13, 1), goalLinks: ['ledger'] }],
  },
  // ── 12 (목표 중단으로 닫기 · mixed · 정기 3) ───────────────────────────────────
  {
    name: '홍은수', phone: phone(12), email: email(12), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-102), consent: { recordingAi: true }, trajectory: 'mixed',
    goals: [
      { key: 'class', title: '바리스타 자격 과정을 수료한다' },
      { key: 'budget', title: '월 고정지출을 10만원 줄인다' },
    ],
    intakeMemo: '카페 창업을 준비하며 자격 과정을 등록했다. 수강료와 생활비가 겹쳐 부담이 커진 상태다.',
    regulars: [
      { heldAt: at(-81), memo: '과정 절반을 들었다. 고정지출은 통신 요금제를 바꿔 조금 줄였다.', goalLinks: ['class'] },
      {
        heldAt: at(-60), memo: '야간 근무가 늘어 수업을 두 번 빠졌다. 과정을 지금 이어가는 것이 무리라고 판단해 중단으로 닫고, 대신 생활비 목표에 집중하기로 정했다.', goalLinks: ['budget'],
      },
      { heldAt: at(-39), memo: '고정지출은 두 달째 목표를 맞췄다. 자격 과정은 다음 분기에 다시 보기로 했다.', goalLinks: ['shift', 'budget'] },
    ],
    goalReplacement: {
      afterSession: 2, closeGoalKey: 'class', reason: 'stopped',
      newGoal: { key: 'shift', title: '야간 근무를 주 2회 이하로 조정한다', scaleCriteria: SAVINGS_SCALE },
    },
    futureSchedules: [{ scheduledAt: at(16, 5), goalLinks: ['budget'] }],
  },
  // ── 13 (회차 6 · 부채 악화 단독 플래그 · improving) ────────────────────────────
  {
    name: '유선호', phone: phone(13), email: email(13), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-165), consent: { recordingAi: true }, trajectory: 'improving',
    goals: [
      { key: 'repay', title: '대출 두 건을 한 건으로 정리한다' },
      { key: 'ledger', title: '월말에 수입과 지출을 맞춰 본다' },
      { key: 'save', title: '비상금 30만원을 적립한다' },
    ],
    intakeMemo: '트럭으로 과일을 받아다 판다. 성수기와 비수기 격차가 커서 비수기에 대출을 늘려 버티는 방식이 반복됐다. 대출을 합치는 것과 월말 정산 습관을 함께 목표로 잡았다.',
    regulars: [
      { heldAt: at(-144), memo: '두 건 중 이자가 높은 쪽을 먼저 갈아탈 조건을 알아봤다.', goalLinks: ['repay'] },
      { heldAt: at(-123), memo: '갈아타기를 마쳤다. 월 이자 부담이 줄어 상환 여력이 생겼다.', goalLinks: ['repay'] },
      { heldAt: at(-102), memo: '월말 정산을 두 달 이어갔다. 비수기 대비 금액을 계산해 봤다.', goalLinks: ['ledger'] },
      { heldAt: at(-81), memo: '적립을 시작했다. 금액은 작지만 끊기지 않는 것을 우선했다.', goalLinks: ['save'] },
      { heldAt: at(-60), memo: '성수기 수입으로 적립을 두 배로 늘렸다. 정산 습관은 유지된다.', goalLinks: ['save'] },
      {
        heldAt: at(-39), memo: '비수기에 접어들며 매출이 줄었지만 대출을 늘리지 않고 적립분으로 버텼다. 처음 있는 일이라고 한다.', goalLinks: ['ledger', 'save'],
        customQuestions: ['올해 비수기는 지난해와 무엇이 달랐나요?'],
      },
    ],
    standaloneFlag: { flagType: 'debt_deterioration', quote: '작년 이맘때는 카드로 돌려서 버텼는데 올해는 안 그랬어요.' },
    futureSchedules: [{ scheduledAt: at(18, 0), goalLinks: ['repay', 'save'] }],
  },
  // ── 14 (장문 인테이크 · plateau · 정기 2) ──────────────────────────────────────
  {
    name: '임채원', phone: phone(14), email: email(14), assigneeUserId: COUNSELOR_IDS.ai00,
    intakeAt: at(-77), consent: { recordingAi: true }, trajectory: 'plateau',
    goals: [{ key: 'income', title: '고정 수입원 하나를 만든다' }],
    intakeMemo: '프리랜서로 간판 도안을 그린다. 일이 들어오는 달과 없는 달의 차이가 커서 한 달은 여유가 있고 다음 달은 카드로 버티는 식이 3년째 이어졌다. 큰 일감 하나에 기대는 구조라 그 일감이 밀리면 생활이 함께 밀린다고 한다. 작은 일감을 꾸준히 받는 쪽으로 방향을 바꾸고 싶지만, 단가가 낮아 시간만 쓰고 남는 것이 없을까 걱정한다고 했다. 우선 매달 들어오는 고정 수입 한 줄을 만드는 것을 목표로 잡고, 기존 거래처 중 정기 발주가 가능한 곳을 추려 보기로 했다.',
    regulars: [
      { heldAt: at(-56), memo: '거래처 두 곳에 정기 발주 가능성을 물었다. 한 곳은 월 1회 소량이라도 가능하다고 답했다.', goalLinks: ['income'] },
      {
        heldAt: at(-35), memo: '월 1회 발주가 두 번 들어왔다. 금액은 작지만 처음으로 예측 가능한 수입이 생겼다.', goalLinks: ['income'],
        customQuestions: ['고정 발주를 한 곳 더 늘릴 여지가 있을까요?'],
      },
    ],
    futureSchedules: [{ scheduledAt: at(20, 7), goalLinks: ['income'] }],
  },
];

/**
 * 시드 프로파일. 기본은 운영 정본(4명)이고 `SEED_PROFILE=preview` 일 때만 프리뷰 사례가 붙는다.
 *
 * 환경변수 하나로 가르는 이유: 산출물(seed.sql)이 어느 DB 로 갈지는 만드는 사람이 알고 있고,
 * 프리뷰용 데이터가 운영 산출물에 섞이는 사고는 그 한 줄로 막힌다. 검증 기대치
 * (verify.sql·manifest)는 전부 이 배열 길이에서 파생하므로 프로파일을 바꿔도 따라온다.
 */
export const SEED_PROFILE: 'operational' | 'preview' =
  process.env.SEED_PROFILE === 'preview' ? 'preview' : 'operational';

export const PARTICIPANTS: readonly SeedParticipant[] = SEED_PROFILE === 'preview'
  ? [...OPERATIONAL_PARTICIPANTS, ...PREVIEW_ONLY_PARTICIPANTS]
  : OPERATIONAL_PARTICIPANTS;

/*
 * 집계 목표(검증 기준). 운영 프로파일(기본, 4명):
 * - 참여자 4명. 주담당은 전원 ai00 이다. 미리보기 고정 데모 실무자(PREVIEW_ACTOR_EMAIL)가 ai00 이고,
 *   실무자는 자신이 담당인 케이스만 열 수 있어(D7) 다른 상담사에게 배정하면 화면이 빈다.
 * - 동의(D49): 4명 전원 ② AI 녹취기록 동의. 미동의(수기 폴백, D5) 케이스는 없다.
 * - GAS 추이: 개선 2(1·3) / 정체 1(2) / 악화 1(4).
 * - 목표 교체(D62 §5): 1케이스(3). closeGoal(reset)+createGoal 로 scale_criteria JSON 저장.
 * - 미해결 인라인 액션: 2건(1·4). 해결된 액션: 2건(2×2).
 * - confirmed 플래그 1건: 인라인 1(4 debt). 브리핑 리스크 배너(D9)의 유일한 시연 케이스.
 * - 예정 일정 4건: 사람당 정확히 1건. 일정 화면에서 같은 사람이 여러 줄로
 *   반복되지 않게 한다(2026-07-31 Q 지적: 프리뷰에서 한 명이 일정 9건으로 아홉 번 나왔다).
 * - 세션: 인테이크 4 + 정기 11 = 15. 세션당 sessions_manual_submission_audit 트리거 감사 15건.
 *
 * 프리뷰 프로파일(SEED_PROFILE=preview, 14명 = 4 + 10):
 * - 리스크 플래그 6종 전부 등장(위기 발언 6 · 연락 두절 7 · 주거·생계·건강 급변 8 ·
 *   약속 불이행 반복 9 · 폭력·착취 피해 10 · 부채 악화 4와 13).
 * - 녹취 미동의 1명(5): 브리핑이 수기 메모만으로 서는 폴백(D5)을 화면에서 볼 수 있다.
 * - 목표 닫기 사유 3종: 달성(11) · 중단(12) · 재설정(3).
 * - 추이 4종 전부: 개선(1·3·11·13) · 정체(2·5·9·14) · 악화(4·6·8) · 혼재(7·10·12).
 * - 회차 수 2~6: 가장 긴 케이스는 13(정기 6 + 인테이크 1).
 * - 예정 일정도 사람당 1건이고 기준일 +0 ~ +20 일에 흩어 둔다(일간·주간·월간 뷰가 모두
 *   비지 않게).
 */
