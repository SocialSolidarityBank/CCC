import { isRecord } from './guards';

export const INTAKE_SCHEMA_VERSION = 2 as const;
export const INTAKE_RESPONSE_CODES = ['answered', 'declined', 'unknown', 'not_applicable'] as const;
export type IntakeResponseCode = typeof INTAKE_RESPONSE_CODES[number];
export const INTAKE_AREA_LABELS = {
  economy: '경제·재정', employment: '일·고용', housing: '주거', physical_health: '신체건강',
  mental_health: '심리·정서', family_relationships: '가족·관계', care_parenting: '돌봄·양육',
  legal_administrative: '법률·행정', other: '기타',
} as const;
export type IntakeArea = keyof typeof INTAKE_AREA_LABELS;
export const INTAKE_AREAS = Object.keys(INTAKE_AREA_LABELS) as IntakeArea[];

export interface IntakeQuestion {
  label: string;
  kind: 'text' | 'single' | 'multiple' | 'money';
  options?: readonly string[];
  area?: IntakeArea;
}
// Common questions are required independently of the selected area modules.
export const INTAKE_QUESTIONS = {
  public_benefits: { label: '받고 있는 공적급여', kind: 'multiple', options: ['생계급여', '의료급여', '주거급여', '교육급여', '차상위', '한부모', '장애인연금', '기초연금'] },
  counsel_method: { label: '상담 방법', kind: 'single', options: ['대면', '전화', '온라인 화상', '가정·현장 방문', '기타'] },
  referral_path: { label: '상담 신청과 유입 경로', kind: 'single', options: ['본인 신청', '가족·지인 소개', '기관 의뢰', '온라인·홍보물', '기존 이용자 재상담', '기타'] },
  contact_time: { label: '주요 연락 가능 시간', kind: 'single', options: ['평일 오전', '평일 오후', '평일 저녁', '주말', '시간 협의 필요'] },
  contact_caution: { label: '연락 시 주의사항', kind: 'text' },
  application_reason: { label: '상담을 신청한 주된 사유', kind: 'single', options: INTAKE_AREAS },
  application_reason_detail: { label: '구체적인 신청 배경', kind: 'text' },
  difficulty_areas: { label: '현재 어려움 관련 영역', kind: 'multiple', options: INTAKE_AREAS },
  need_primary: { label: '1순위 지원욕구', kind: 'single', options: INTAKE_AREAS },
  need_secondary: { label: '2순위 지원욕구', kind: 'single', options: INTAKE_AREAS },
  need_detail: { label: '필요한 도움 상세', kind: 'text' },
  previous_support_detail: { label: '이전 지원 경험', kind: 'text' },
  strength_relational: { label: '도움을 요청할 사람', kind: 'text' },
  strength_personal: { label: '본인의 강점', kind: 'text' },
  strength_detail: { label: '강점과 자원 상세', kind: 'text' },
  participation_barrier: { label: '참여 방해요인', kind: 'single', options: ['없음', '근무시간', '돌봄 부담', '이동 어려움', '건강 문제', '연락 어려움', '디지털 사용 어려움', '비용 부담', '복수 요인', '기타'] },
  participation_preferred_method: { label: '선호 상담 방식', kind: 'single', options: ['대면', '전화', '온라인 화상', '방문', '혼합'] },
  participation_detail: { label: '참여 여건 상세', kind: 'text' },
  summary_urgency: { label: '위기도', kind: 'single', options: ['안정', '주의', '위기'] },
  summary_direction: { label: '주요 지원방향', kind: 'single', options: ['정보 제공', '기관 연계', '사례관리 진행', '단기 집중지원', '전문상담 의뢰', '추가 사정 후 결정'] },
  managerOpinion: { label: '담당 실무자 종합의견', kind: 'text' },
  economy_income_type: { label: '주된 소득 유형', kind: 'single', area: 'economy', options: ['근로소득', '사업소득', '공적급여', '연금', '가족·지인 지원', '소득 없음', '복수 소득'] },
  economy_arrears: { label: '연체와 미납 여부', kind: 'single', area: 'economy', options: ['없음', '있음', '상환 유예·조정 중'] },
  economy_monthly_income: { label: '월평균 소득(원)', kind: 'money', area: 'economy' },
  economy_monthly_expense: { label: '월 지출(원)', kind: 'money', area: 'economy' },
  economy_debt_types: { label: '대출과 부채 종류', kind: 'multiple', area: 'economy', options: ['금융기관 대출', '카드대금', '임대료·관리비', '공과금·통신비', '거래처 미지급금', '가족·지인 차용', '기타'] },
  economy_detail: { label: '경제와 재정 상세', kind: 'text', area: 'economy' },
  employment_status: { label: '현재 경제활동 상태', kind: 'single', area: 'employment', options: ['상용근로', '임시·일용근로', '자영업·프리랜서', '구직 중', '휴직·병가', '비경제활동'] },
  employment_income_stability: { label: '소득 안정성', kind: 'single', area: 'employment', options: ['안정적', '다소 불안정', '매우 불안정', '소득 없음'] },
  employment_detail: { label: '일과 고용 상세', kind: 'text', area: 'employment' },
  housing_type: { label: '주거 형태', kind: 'single', area: 'housing', options: ['자가', '전세', '보증부 월세', '월세', '공공임대', '가족·지인 거주지', '고시원·숙박시설', '시설·임시거처'] },
  housing_instability: { label: '주거 불안 수준', kind: 'single', area: 'housing', options: ['문제 없음', '비용 부담', '퇴거·이사 가능성', '주거환경 문제', '긴급 주거위기'] },
  housing_detail: { label: '주거 상세', kind: 'text', area: 'housing' },
  health_physical: { label: '신체 건강상태', kind: 'single', area: 'physical_health', options: ['양호', '만성질환 관리 중', '치료 필요', '일상생활 제한 있음'] },
  health_care_barrier: { label: '치료 접근 어려움', kind: 'single', area: 'physical_health', options: ['없음', '비용', '시간', '이동', '돌봄 공백', '기타'] },
  physical_health_detail: { label: '신체건강 상세', kind: 'text', area: 'physical_health' },
  health_stress: { label: '스트레스 수준', kind: 'single', area: 'mental_health', options: ['낮음', '보통', '높음', '매우 높음'] },
  health_daily_impact: { label: '일상생활 영향', kind: 'single', area: 'mental_health', options: ['영향 없음', '수면', '식사', '외출', '관계', '근로', '복합 영향'] },
  mental_health_detail: { label: '심리와 정서 상세', kind: 'text', area: 'mental_health' },
  family_household_type: { label: '가구 형태', kind: 'single', area: 'family_relationships', options: ['1인 가구', '부부 가구', '부모·자녀 가구', '한부모 가구', '조손 가구', '다세대 가구', '기타'] },
  family_relationship_conflict: { label: '관계 갈등 유무', kind: 'single', area: 'family_relationships', options: ['없음', '있음'] },
  family_relationships_detail: { label: '가족과 관계 상세', kind: 'text', area: 'family_relationships' },
  care_recipient: { label: '돌봄 대상', kind: 'single', area: 'care_parenting', options: ['아동', '노인', '장애', '환자', '없음'] },
  care_burden: { label: '돌봄 부담', kind: 'single', area: 'care_parenting', options: ['없음', '있음'] },
  care_parenting_detail: { label: '돌봄과 양육 상세', kind: 'text', area: 'care_parenting' },
  legal_problem_type: { label: '문제 유형', kind: 'single', area: 'legal_administrative', options: ['소송·채무조정', '행정 서류', '체류·자격', '기타'] },
  legal_progress: { label: '진행 상태', kind: 'single', area: 'legal_administrative', options: ['시작 전', '진행 중', '완료'] },
  legal_administrative_detail: { label: '법률과 행정 상세', kind: 'text', area: 'legal_administrative' },
  other_detail: { label: '기타 상세', kind: 'text', area: 'other' },
} as const satisfies Record<string, IntakeQuestion>;
export type IntakeQuestionKey = keyof typeof INTAKE_QUESTIONS;
export type IntakeAnswer = { key: IntakeQuestionKey } & (
  | { response: 'answered'; text: string }
  | { response: 'answered'; choices: string[] }
  | { response: 'answered'; amount: number }
  | { response: Exclude<IntakeResponseCode, 'answered'> }
);
export type IntakeTable<Row> = { response: 'answered'; rows: Row[] }
  | { response: Exclude<IntakeResponseCode, 'answered'> };
export interface IntakeLinkedOrg { orgName: string; serviceName?: string; supportDetail?: string; usagePeriod?: string; progressStatus?: string }
export interface IntakeAdditionalItem { item: string; dueNote?: string }
export interface IntakeDebt { creditor: string; kind?: string; balance?: string; monthlyPayment?: string; arrearsStatus?: string }
export interface IntakeModuleSnapshot { programId: string; programVersion: number; financialSupportEnabled: boolean }
export interface IntakeQuestionnaire {
  schemaVersion: 2;
  moduleSnapshot: IntakeModuleSnapshot;
  answers: IntakeAnswer[];
  linkedOrgs: IntakeTable<IntakeLinkedOrg>;
  additionalItems: IntakeTable<IntakeAdditionalItem>;
  debts: IntakeTable<IntakeDebt> | null;
}
export interface IntakeCreateRequest {
  schemaVersion: 2;
  submissionId: string;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  questionnaire: IntakeQuestionnaire;
  scheduleId?: string;
  expectedScheduleVersion?: number;
}
export interface IntakeUpdateRequest {
  schemaVersion: 2;
  expectedRevision: number;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  questionnaire: IntakeQuestionnaire;
  conversion?: { confirmed: true; sourceRevision: number };
}

export class IntakeContractError extends Error {
  constructor() { super('intake contract is invalid'); this.name = 'IntakeContractError'; }
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) throw new IntakeContractError();
  return value;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
}
function nonanswer(value: Record<string, unknown>): boolean {
  if (!INTAKE_RESPONSE_CODES.includes(value.response as IntakeResponseCode)) throw new IntakeContractError();
  return value.response !== 'answered';
}
function table(value: unknown, columns: readonly string[]): void {
  const entry = object(value, ['response', 'rows']);
  if (nonanswer(entry)) {
    if (Object.hasOwn(entry, 'rows')) throw new IntakeContractError();
    return;
  }
  if (!Array.isArray(entry.rows) || entry.rows.length < 1 || entry.rows.length > 20) throw new IntakeContractError();
  for (const row of entry.rows) {
    const fields = object(row, columns);
    if (!text(fields[columns[0]!]) || !Object.values(fields).every(text)) throw new IntakeContractError();
  }
}
export function requiredIntakeQuestionKeys(areas: readonly IntakeArea[]): IntakeQuestionKey[] {
  return (Object.entries(INTAKE_QUESTIONS) as [IntakeQuestionKey, IntakeQuestion][])
    .filter(([, question]) => question.area === undefined || areas.includes(question.area)).map(([key]) => key);
}
export function parseIntakeQuestionnaire(value: unknown): IntakeQuestionnaire {
  const form = object(value, ['schemaVersion', 'moduleSnapshot', 'answers', 'linkedOrgs', 'additionalItems', 'debts']);
  if (form.schemaVersion !== 2) throw new IntakeContractError();
  const snapshot = object(form.moduleSnapshot, ['programId', 'programVersion', 'financialSupportEnabled']);
  if (!text(snapshot.programId) || !Number.isSafeInteger(snapshot.programVersion) || Number(snapshot.programVersion) < 1
    || typeof snapshot.financialSupportEnabled !== 'boolean') throw new IntakeContractError();
  if (!Array.isArray(form.answers) || form.answers.length > Object.keys(INTAKE_QUESTIONS).length) throw new IntakeContractError();
  const seen = new Set<string>();
  let areas: IntakeArea[] = [];
  for (const raw of form.answers) {
    const answer = object(raw, ['key', 'response', 'text', 'choices', 'amount']);
    if (typeof answer.key !== 'string' || !Object.hasOwn(INTAKE_QUESTIONS, answer.key) || seen.has(answer.key)) throw new IntakeContractError();
    seen.add(answer.key);
    if (nonanswer(answer)) {
      if (Object.keys(answer).length !== 2) throw new IntakeContractError();
      continue;
    }
    const question: IntakeQuestion = INTAKE_QUESTIONS[answer.key as IntakeQuestionKey];
    if (Object.keys(answer).length !== 3) throw new IntakeContractError();
    if (question.kind === 'money') {
      if (!Number.isSafeInteger(answer.amount) || Number(answer.amount) < 0) throw new IntakeContractError();
    } else if (question.kind === 'multiple') {
      if (!Array.isArray(answer.choices) || answer.choices.length < 1
        || new Set(answer.choices).size !== answer.choices.length
        || !answer.choices.every(choice => typeof choice === 'string' && question.options?.includes(choice))) throw new IntakeContractError();
      if (answer.key === 'difficulty_areas') areas = answer.choices as IntakeArea[];
    } else if (!text(answer.text) || (question.kind === 'single' && !question.options?.includes(answer.text))) {
      throw new IntakeContractError();
    }
  }
  if (!requiredIntakeQuestionKeys(areas).every(key => seen.has(key))) throw new IntakeContractError();
  table(form.linkedOrgs, ['orgName', 'serviceName', 'supportDetail', 'usagePeriod', 'progressStatus']);
  table(form.additionalItems, ['item', 'dueNote']);
  if (snapshot.financialSupportEnabled && areas.includes('economy')) {
    table(form.debts, ['creditor', 'kind', 'balance', 'monthlyPayment', 'arrearsStatus']);
  } else if (form.debts !== null) throw new IntakeContractError();
  return form as unknown as IntakeQuestionnaire;
}

function requestBase(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const request = object(value, keys);
  if (request.schemaVersion !== 2 || !text(request.heldAt)
    || !Number.isFinite(Date.parse(request.heldAt))
    || new Date(request.heldAt).toISOString() !== request.heldAt
    || typeof request.channel !== 'string'
    || !['in_person', 'phone', 'video'].includes(request.channel)) throw new IntakeContractError();
  parseIntakeQuestionnaire(request.questionnaire);
  return request;
}
export function parseIntakeCreateRequest(value: unknown): IntakeCreateRequest {
  const request = requestBase(value, ['schemaVersion', 'submissionId', 'heldAt', 'channel', 'questionnaire', 'scheduleId', 'expectedScheduleVersion']);
  if (!text(request.submissionId)) throw new IntakeContractError();
  if (Object.hasOwn(request, 'scheduleId') || Object.hasOwn(request, 'expectedScheduleVersion')) {
    if (!text(request.scheduleId) || !Number.isSafeInteger(request.expectedScheduleVersion) || Number(request.expectedScheduleVersion) < 1) throw new IntakeContractError();
  }
  return request as unknown as IntakeCreateRequest;
}
export function parseIntakeUpdateRequest(value: unknown): IntakeUpdateRequest {
  const request = requestBase(value, ['schemaVersion', 'expectedRevision', 'heldAt', 'channel', 'questionnaire', 'conversion']);
  if (!Number.isSafeInteger(request.expectedRevision) || Number(request.expectedRevision) < 1) throw new IntakeContractError();
  if (Object.hasOwn(request, 'conversion')) {
    const conversion = object(request.conversion, ['confirmed', 'sourceRevision']);
    if (conversion.confirmed !== true || conversion.sourceRevision !== request.expectedRevision) throw new IntakeContractError();
  }
  return request as unknown as IntakeUpdateRequest;
}
export interface IntakeRevision {
  revision: number;
  schemaVersion: 1 | 2;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  /** Null for pre-versioning edits whose editor was not recorded. */
  actorId: string | null;
  recordedAt: string;
  convertedFromRevision: number | null;
  /** Exact stored JSON, including historical keys and values not in the new questionnaire. */
  detailsJson: string | null;
}
export type IntakeSavedRecord = {
  sessionId: string;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  revision: number;
  history: IntakeRevision[];
} & (
  | { schemaVersion: 1; questionnaire: null; legacyDetailsJson: string | null }
  | { schemaVersion: 2; questionnaire: IntakeQuestionnaire; legacyDetailsJson: null }
);

/** Display only: stored codes remain unchanged, and nonanswers never become empty facts. */
export function intakeAnswerDisplayText(answer: IntakeAnswer): string | null {
  if (answer.response !== 'answered') return null;
  const label = (value: string) => Object.hasOwn(INTAKE_AREA_LABELS, value) ? INTAKE_AREA_LABELS[value as IntakeArea] : value;
  if ('choices' in answer) return answer.choices.map(label).join(', ');
  if ('amount' in answer) return String(answer.amount);
  const question = INTAKE_QUESTIONS[answer.key];
  return 'options' in question && question.options === INTAKE_AREAS ? label(answer.text) : answer.text;
}

export interface IntakeMutationResponse {
  schemaVersion: 2;
  revision: number;
  record: { id: string; heldAt: string; channel: 'in_person' | 'phone' | 'video'; kind: 'intake' };
  replayed: boolean;
}
