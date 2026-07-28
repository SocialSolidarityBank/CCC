'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DraftRestorePrompt, DraftStatus } from '../../../../../../components/draft/draft-notice';
import { MetaRow } from '../../../../../../components/wire/meta-row';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { clearDraft, draftKey, readDraft, sweepExpiredDrafts, writeDraft } from '../../../../../../lib/form-draft';
import type {
  IntakeAnswerKey,
  IntakeAnswerResponse,
  IntakeExtendedPii,
  LifeAreaKey,
  LifeAreaStatus,
} from '../../../../../../lib/api';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';

// 6영역 고정 순서(lib/api 의 lifeAreaKeys 와 동일). lib/api 는 server-only 라 클라이언트 컴포넌트는
// 값 대신 이 로컬 상수를 쓴다 — 키·순서는 게이트웨이 CHECK(마이그레이션 0013)와 일치한다.
const LIFE_AREA_ORDER: readonly LifeAreaKey[] = ['economy', 'housing', 'employment', 'health', 'mental_health', 'family'];

// 6단계 인테이크 위저드(CCC-7 뼈대 → CCC-9 전 항목). 위저드 상태는 이 클라이언트 컴포넌트가
// 관리하고, 저장은 마지막 "완료"에서 게이트웨이 1회 호출(submit)로 일괄 처리한다 — 부분 저장
// 없음. P1(동의 2·원하는 도움 3문·6영역 상태·목표 1·행동 1)만 채우면 저장 성립하고, P2~P4는
// 전부 선택이다. 로컬 자동 저장은 CCC-12.

export interface IntakeWizardProps {
  beneficiaryId: string;
  supportCaseId: string;
  submissionId: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  // 금고에 이미 있는 추가 개인정보(재입력 없음, 설계 §0-5).
  extendedPii: IntakeExtendedPii;
  sessionSequence: number;
  recorderLabel: string;
  briefingHref: string;
  submit: (input: CreateIntakeRecordActionInput) => Promise<IntakeRecordActionResult>;
}

const CHANNELS = [
  ['in_person', '대면'],
  ['phone', '전화'],
  ['video', '화상'],
] as const;

const LIFE_AREA_LABELS: Record<LifeAreaKey, string> = {
  economy: '경제·생계',
  housing: '주거',
  employment: '일·고용·학업',
  health: '건강',
  mental_health: '심리·정서',
  family: '가족·관계·돌봄',
};

const LIFE_STATUS_LABELS: ReadonlyArray<readonly [LifeAreaStatus, string]> = [
  ['okay', '괜찮음'],
  ['strained', '긴장'],
  ['crisis', '위기'],
  ['not_applicable', '해당없음'],
  ['declined', '답변거부'],
];

const OWNERS = [
  ['counselor', '상담사'],
  ['beneficiary', '참여자'],
  ['org', '기관'],
] as const;

// 설계 v0.3 §0-5: 모든 질문에 답변거부·모름·해당없음. 서술형은 이 3종을 본문과 구분해 저장한다
// (빈 문자열과 "답변거부"가 저장에서 다르다). P1 질문은 저장 자체가 본문 필수라 같은 3종을
// 빠른 채움 버튼으로 제공한다.
const ANSWER_CHOICES: ReadonlyArray<readonly [Exclude<IntakeAnswerResponse, 'answered'>, string]> = [
  ['declined', '답변거부'],
  ['unknown', '모름'],
  ['not_applicable', '해당없음'],
];

const NOTICE_MESSAGES: Record<string, string> = {
  invalid_request: '입력한 내용을 다시 확인하세요.',
  validation_error: '필수 항목을 다시 확인하세요.',
  access_denied: '담당 중인 참여 사업에만 인테이크를 남길 수 있습니다.',
  forbidden: '담당 중인 참여 사업에만 인테이크를 남길 수 있습니다.',
  not_found: '참여자 또는 참여 사업을 찾을 수 없습니다.',
  conflict: '이 참여 사업에는 이미 인테이크 기록이 있습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 저장할 수 없습니다. 잠시 후 다시 시도하세요.',
};

function messageFor(status: string): string {
  return NOTICE_MESSAGES[status] ?? '인테이크를 저장하지 못했습니다.';
}

interface GoalDraft { title: string; criteria: string }
interface ActionDraft { description: string; owner: 'counselor' | 'beneficiary' | 'org'; dueDate: string }
interface AdditionalItemDraft { item: string; owner: string; dueDate: string }
interface AnswerDraft { response: IntakeAnswerResponse; text: string }
type LifeAreaState = Record<LifeAreaKey, { status: LifeAreaStatus | ''; note: string }>;
type AnswerState = Record<IntakeAnswerKey, AnswerDraft>;

/**
 * 로컬 임시본에 담는 값(CCC-12). 상담사가 이 화면에서 입력한 것만 담는다.
 *
 * `red` 금고에서 내려온 추가 개인정보 4종(birthDate·region·emergencyContact·gender)은
 * 여기에 없다 — props.extendedPii 로 미리 채워지는 값이라 임시본에 담으면 pii_vault 값을
 * 브라우저에 쓰게 된다. 되돌릴 때도 그 4종은 금고 값으로 다시 초기화되는 것이 맞다.
 * 필드를 늘릴 때 이 원칙을 먼저 확인할 것.
 */
interface IntakeDraftValues {
  step: number;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  consentPrivacy: boolean;
  consentRecordingAi: boolean;
  todayHelp: string;
  hardestPoint: string;
  desiredChange: string;
  lifeAreas: LifeAreaState;
  goals: GoalDraft[];
  actions: ActionDraft[];
  managerOpinion: string;
  answers: AnswerState;
  additionalItems: AdditionalItemDraft[];
  nextMeetingAt: string;
  nextMeetingChannel: 'in_person' | 'phone' | 'video';
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function channelOf(value: unknown): 'in_person' | 'phone' | 'video' {
  return value === 'phone' || value === 'video' ? value : 'in_person';
}

function ownerOf(value: unknown): ActionDraft['owner'] {
  return value === 'beneficiary' || value === 'org' ? value : 'counselor';
}

/**
 * 임시본은 배포를 건너뛰고 살아남는다(보관 12시간). 필드가 빠지거나 모양이 달라진 임시본을
 * 그대로 상태에 부으면 화면이 렌더 중에 죽는다 — 실제로 answers 가 빈 객체인 임시본에서
 * AnswerField 가 터졌다. 그래서 되돌리기 전에 항상 기본값 위에 얹어 정규화한다.
 */
function normalizeDraft(raw: unknown): IntakeDraftValues | null {
  if (!isRecordObject(raw)) return null;

  const lifeAreas = emptyLifeAreas();
  const storedAreas = isRecordObject(raw.lifeAreas) ? raw.lifeAreas : {};
  for (const key of LIFE_AREA_ORDER) {
    const area = storedAreas[key];
    if (!isRecordObject(area)) continue;
    const status = area.status;
    lifeAreas[key] = {
      status: LIFE_STATUS_LABELS.some(([code]) => code === status) ? (status as LifeAreaStatus) : '',
      note: textOf(area.note),
    };
  }

  const answers = emptyAnswers();
  const storedAnswers = isRecordObject(raw.answers) ? raw.answers : {};
  for (const key of ANSWER_KEYS) {
    const answer = storedAnswers[key];
    if (!isRecordObject(answer)) continue;
    const response = answer.response;
    const known = response === 'answered' || ANSWER_CHOICES.some(([code]) => code === response);
    answers[key] = { response: known ? (response as IntakeAnswerResponse) : 'answered', text: textOf(answer.text) };
  }

  const goals = Array.isArray(raw.goals)
    ? raw.goals.filter(isRecordObject).map((goal) => ({ title: textOf(goal.title), criteria: textOf(goal.criteria) }))
    : [];
  const actions: ActionDraft[] = Array.isArray(raw.actions)
    ? raw.actions.filter(isRecordObject).map((action) => ({
      description: textOf(action.description),
      owner: ownerOf(action.owner),
      dueDate: textOf(action.dueDate),
    }))
    : [];
  const additionalItems = Array.isArray(raw.additionalItems)
    ? raw.additionalItems.filter(isRecordObject).map((entry) => ({
      item: textOf(entry.item), owner: textOf(entry.owner), dueDate: textOf(entry.dueDate),
    }))
    : [];

  const step = typeof raw.step === 'number' && Number.isInteger(raw.step) && raw.step >= 1 && raw.step <= STEP_TITLES.length
    ? raw.step
    : 1;

  return {
    step,
    heldAt: textOf(raw.heldAt),
    channel: channelOf(raw.channel),
    consentPrivacy: raw.consentPrivacy === true,
    consentRecordingAi: raw.consentRecordingAi === true,
    todayHelp: textOf(raw.todayHelp),
    hardestPoint: textOf(raw.hardestPoint),
    desiredChange: textOf(raw.desiredChange),
    lifeAreas,
    // 목표·행동 칸은 최소 1줄이 있어야 화면이 성립한다(빈 배열이면 입력할 자리가 없다).
    goals: goals.length > 0 ? goals : [{ title: '', criteria: '' }],
    actions: actions.length > 0 ? actions : [{ description: '', owner: 'counselor', dueDate: '' }],
    managerOpinion: textOf(raw.managerOpinion),
    answers,
    additionalItems,
    nextMeetingAt: textOf(raw.nextMeetingAt),
    nextMeetingChannel: channelOf(raw.nextMeetingChannel),
  };
}

/**
 * 상담 일시·상담 방법은 화면을 여는 순간 자동으로 채워진다. 그것만으로 임시본을 만들면
 * 아무것도 안 쓰고 나갔다 온 사람에게 이어쓰기 배너가 뜬다 — 실제 입력이 있을 때만 저장한다.
 */
function hasContent(values: IntakeDraftValues): boolean {
  if (values.consentPrivacy || values.consentRecordingAi) return true;
  if ([values.todayHelp, values.hardestPoint, values.desiredChange, values.managerOpinion, values.nextMeetingAt]
    .some((text) => text.trim().length > 0)) return true;
  if (LIFE_AREA_ORDER.some((key) => values.lifeAreas[key].status !== '' || values.lifeAreas[key].note.trim().length > 0)) return true;
  if (values.goals.some((goal) => goal.title.trim().length > 0 || goal.criteria.trim().length > 0)) return true;
  if (values.actions.some((action) => action.description.trim().length > 0 || action.dueDate.trim().length > 0)) return true;
  if (values.additionalItems.some((entry) => entry.item.trim().length > 0)) return true;
  return ANSWER_KEYS.some((key) => {
    const answer = values.answers[key];
    return answer.response !== 'answered' || answer.text.trim().length > 0;
  });
}

const ANSWER_KEYS: readonly IntakeAnswerKey[] = [
  'referral_path', 'referral_org', 'referral_reason',
  'more_since', 'more_trigger', 'more_focus',
  'life_detail_economy', 'life_detail_housing', 'life_detail_employment',
  'life_detail_health', 'life_detail_mental_health', 'life_detail_family',
  'crisis_immediate_risk', 'crisis_needed_connection', 'crisis_safety_status', 'crisis_emergency_contact',
  'strength_personal', 'strength_relational', 'strength_past_coping', 'strength_resources',
  'participation_availability', 'participation_transport', 'participation_constraint',
];

const ANSWER_LABELS: Record<IntakeAnswerKey, string> = {
  referral_path: '어떻게 알고 오셨나요? (유입 경로)',
  referral_org: '의뢰 기관',
  referral_reason: '의뢰 사유',
  more_since: '언제부터 이런 상황이었나요?',
  more_trigger: '상황이 나빠진 계기가 있었나요?',
  more_focus: '오늘 꼭 정리하고 싶은 한 가지는?',
  life_detail_economy: '경제·생계 자세히 (소득·지출·부채)',
  life_detail_housing: '주거 자세히 (거주 형태·안정성)',
  life_detail_employment: '일·고용·학업 자세히',
  life_detail_health: '건강 자세히',
  life_detail_mental_health: '심리·정서 자세히',
  life_detail_family: '가족·관계·돌봄 자세히',
  crisis_immediate_risk: '지금 당장 위험하다고 느끼는 상황이 있나요?',
  crisis_needed_connection: '오늘 바로 필요한 연결이 있나요?',
  crisis_safety_status: '지금 안전한 상태인가요?',
  crisis_emergency_contact: '위급할 때 연락할 수 있는 사람·기관',
  strength_personal: '스스로 잘한다고 생각하는 점',
  strength_relational: '도움을 주고받는 사람',
  strength_past_coping: '전에 비슷한 어려움을 넘겼던 방법',
  strength_resources: '지금 쓸 수 있는 제도·자원',
  participation_availability: '상담 가능한 요일·시간대',
  participation_transport: '방문 이동 수단·소요 시간',
  participation_constraint: '참여에 걸림돌이 되는 것',
};

const LIFE_DETAIL_KEYS: Record<LifeAreaKey, IntakeAnswerKey> = {
  economy: 'life_detail_economy',
  housing: 'life_detail_housing',
  employment: 'life_detail_employment',
  health: 'life_detail_health',
  mental_health: 'life_detail_mental_health',
  family: 'life_detail_family',
};

const CRISIS_KEYS: readonly IntakeAnswerKey[] = [
  'crisis_immediate_risk', 'crisis_needed_connection', 'crisis_safety_status', 'crisis_emergency_contact',
];
const STRENGTH_KEYS: readonly IntakeAnswerKey[] = [
  'strength_personal', 'strength_relational', 'strength_past_coping', 'strength_resources',
];
const PARTICIPATION_KEYS: readonly IntakeAnswerKey[] = [
  'participation_availability', 'participation_transport', 'participation_constraint',
];
const MORE_KEYS: readonly IntakeAnswerKey[] = ['more_since', 'more_trigger', 'more_focus'];
const REFERRAL_KEYS: readonly IntakeAnswerKey[] = ['referral_path', 'referral_org', 'referral_reason'];

const STEP_TITLES = ['시작', '동의', '원하는 도움', '생활 상황', '정리', '담당자 의견'] as const;

const stackStyle: CSSProperties = { display: 'grid', gap: 20 };
const headingStyle: CSSProperties = { margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--ink)' };
const subHeadingStyle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--ink)' };
// 입력 라벨은 값 위에 두고 14/700 --sub 로 쓴다 — 입력 경계선(흰 위 1.28)에만 기대지 않기
// 위한 규칙이다(DESIGN.md §9 완화).
const labelStyle: CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--sub)' };
const captionStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--sub)' };
// 오류는 --risk 글자 + 메시지 텍스트를 함께 둔다(§5 입력 오류).
const errorStyle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--risk)' };
const inputStyle: CSSProperties = {
  width: '100%', minHeight: 'var(--control-height)', padding: '0 var(--space-3)', background: 'var(--panel)',
  border: '1px solid var(--line-control)', borderRadius: 'var(--radius-control)', color: 'var(--ink)', fontSize: 16,
};
const textareaStyle: CSSProperties = {
  width: '100%', minHeight: 88, padding: 'var(--space-3)', background: 'var(--panel)',
  border: '1px solid var(--line-control)', borderRadius: 'var(--radius-control)', color: 'var(--ink)',
  fontSize: 16, resize: 'vertical', fontFamily: 'inherit',
};
const rowActionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };
const fieldStyle: CSSProperties = { display: 'grid', gap: 8 };
// 단락을 나누는 패널은 장식 경계이므로 --line 을 쓴다(컨트롤 경계 --line-control 과 구분).
const panelStyle: CSSProperties = {
  display: 'grid', gap: 16, padding: 16,
  border: '1px solid var(--line)', borderRadius: 'var(--radius-card)',
};
// 강조는 균일 테두리로만 한다 — 좌측 액센트 띠는 금지 패턴(이슈 #49).
// 위기 영역은 확인된 리스크와 같은 축이라 --risk 를 쓴다(D9).
const emphasisPanelStyle: CSSProperties = {
  ...panelStyle,
  border: '1.5px solid var(--risk)',
  background: 'var(--risk-tint-solid)',
};

function emptyLifeAreas(): LifeAreaState {
  return LIFE_AREA_ORDER.reduce((state, key) => {
    state[key] = { status: '', note: '' };
    return state;
  }, {} as LifeAreaState);
}

function emptyAnswers(): AnswerState {
  return ANSWER_KEYS.reduce((state, key) => {
    state[key] = { response: 'answered', text: '' };
    return state;
  }, {} as AnswerState);
}

/** 브라우저 로컬 시각을 datetime-local 입력 형식(YYYY-MM-DDTHH:mm)으로. */
function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 접힘 묶음(P3·P4). 동의 안내문과 같은 아코디언 패턴을 재사용한다 — 새 스타일 없음. */
function Collapse(props: { title: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  return (
    <details className="consent-detail" open={props.open} onToggle={(event) => props.onToggle(event.currentTarget.open)}>
      <summary className="consent-detail-summary">
        <span>{props.title}</span>
        <span className="briefing-card-arrow" aria-hidden="true" />
      </summary>
      <div className="consent-detail-body">{props.children}</div>
    </details>
  );
}

/**
 * 서술형 답변 1문. 본문 서술 또는 답변거부·모름·해당없음 중 하나를 고른다. 같은 버튼을 다시
 * 누르면 서술로 돌아온다. 질문마다 분기를 복제하지 않도록 위저드 전체가 이 하나를 쓴다.
 */
function AnswerField(props: { label: string; value: AnswerDraft; onChange: (next: AnswerDraft) => void }) {
  const answered = props.value.response === 'answered';
  return (
    <div style={fieldStyle}>
      <label style={fieldStyle}>
        <span style={labelStyle}>{props.label}</span>
        <textarea
          aria-label={props.label}
          value={answered ? props.value.text : ''}
          disabled={!answered}
          onChange={(event) => props.onChange({ response: 'answered', text: event.target.value })}
          style={textareaStyle}
        />
      </label>
      <div style={rowActionsStyle}>
        {ANSWER_CHOICES.map(([code, text]) => (
          <WireButton
            key={code}
            onClick={() => props.onChange(
              props.value.response === code ? { response: 'answered', text: '' } : { response: code, text: '' },
            )}
          >
            {props.value.response === code ? `✓ ${text}` : text}
          </WireButton>
        ))}
      </div>
    </div>
  );
}

export function IntakeWizard(props: IntakeWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [heldAt, setHeldAt] = useState('');
  const [channel, setChannel] = useState<'in_person' | 'phone' | 'video'>('in_person');
  const [consentPrivacy, setConsentPrivacy] = useState(false);
  const [consentRecordingAi, setConsentRecordingAi] = useState(false);
  const [todayHelp, setTodayHelp] = useState('');
  const [hardestPoint, setHardestPoint] = useState('');
  const [desiredChange, setDesiredChange] = useState('');
  const [lifeAreas, setLifeAreas] = useState<LifeAreaState>(emptyLifeAreas);
  const [goals, setGoals] = useState<GoalDraft[]>([{ title: '', criteria: '' }]);
  const [actions, setActions] = useState<ActionDraft[]>([{ description: '', owner: 'counselor', dueDate: '' }]);
  const [managerOpinion, setManagerOpinion] = useState('');
  const [answers, setAnswers] = useState<AnswerState>(emptyAnswers);
  const [birthDate, setBirthDate] = useState(props.extendedPii.birthDate ?? '');
  const [region, setRegion] = useState(props.extendedPii.region ?? '');
  const [emergencyContact, setEmergencyContact] = useState(props.extendedPii.emergencyContact ?? '');
  const [gender, setGender] = useState(props.extendedPii.gender ?? '');
  const [additionalItems, setAdditionalItems] = useState<AdditionalItemDraft[]>([]);
  const [nextMeetingAt, setNextMeetingAt] = useState('');
  const [nextMeetingChannel, setNextMeetingChannel] = useState<'in_person' | 'phone' | 'video'>('in_person');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ① 시작 P2 자동 입력: 상담 일시는 화면을 연 시각으로 채운다(상담사가 바꿀 수 있음).
  // 서버·클라이언트 시각이 달라 생기는 하이드레이션 불일치를 피하려고 마운트 후에 채운다.
  useEffect(() => {
    setHeldAt((current) => (current === '' ? localDateTimeValue(new Date()) : current));
  }, []);

  // ── 로컬 임시본(CCC-12) ────────────────────────────────────────────────────
  const storageKey = draftKey('intake', props.supportCaseId);
  const [restorable, setRestorable] = useState<number | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftAvailable, setDraftAvailable] = useState(true);
  const pendingDraft = useRef<IntakeDraftValues | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftValues: IntakeDraftValues = useMemo(() => ({
    step, heldAt, channel, consentPrivacy, consentRecordingAi,
    todayHelp, hardestPoint, desiredChange, lifeAreas, goals, actions,
    managerOpinion, answers, additionalItems, nextMeetingAt, nextMeetingChannel,
  }), [
    step, heldAt, channel, consentPrivacy, consentRecordingAi,
    todayHelp, hardestPoint, desiredChange, lifeAreas, goals, actions,
    managerOpinion, answers, additionalItems, nextMeetingAt, nextMeetingChannel,
  ]);

  // 저장은 마지막 완료 1회이므로(부분 저장 없음) 되돌릴 임시본이 있으면 곧 뜨는 배너로만 알린다.
  useEffect(() => {
    sweepExpiredDrafts();
    const stored = readDraft<unknown>(storageKey);
    if (stored === null) return;
    const values = normalizeDraft(stored.values);
    if (values === null) {
      clearDraft(storageKey);
      return;
    }
    pendingDraft.current = values;
    setRestorable(stored.savedAt);
  }, [storageKey]);

  useEffect(() => {
    // 배너가 떠 있는 동안에는 저장하지 않는다 — 상담사가 고르기 전에 임시본을 덮어쓰면 안 된다.
    if (restorable !== null) return;
    if (!hasContent(draftValues)) return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const written = writeDraft(storageKey, draftValues, 'editing');
      if (written === null) setDraftAvailable(false);
      else setDraftSavedAt(written);
    }, 800);
    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    };
  }, [draftValues, restorable, storageKey]);

  function resumeDraft() {
    const values = pendingDraft.current;
    pendingDraft.current = null;
    setRestorable(null);
    if (values === null) return;
    setStep(values.step);
    setHeldAt(values.heldAt);
    setChannel(values.channel);
    setConsentPrivacy(values.consentPrivacy);
    setConsentRecordingAi(values.consentRecordingAi);
    setTodayHelp(values.todayHelp);
    setHardestPoint(values.hardestPoint);
    setDesiredChange(values.desiredChange);
    setLifeAreas(values.lifeAreas);
    setGoals(values.goals);
    setActions(values.actions);
    setManagerOpinion(values.managerOpinion);
    setAnswers(values.answers);
    setAdditionalItems(values.additionalItems);
    setNextMeetingAt(values.nextMeetingAt);
    setNextMeetingChannel(values.nextMeetingChannel);
    // 금고에서 온 4종은 되돌리지 않는다 — 임시본에 담기지 않았고, props 초기값이 정본이다.
  }

  function discardDraft() {
    clearDraft(storageKey);
    pendingDraft.current = null;
    setRestorable(null);
    setDraftSavedAt(null);
  }

  function setAnswer(key: IntakeAnswerKey, next: AnswerDraft) {
    setAnswers((prev) => ({ ...prev, [key]: next }));
  }

  function toggleSection(key: string, open: boolean) {
    setOpenSections((prev) => ({ ...prev, [key]: open }));
  }

  // 단계별 P1 필수 채움 카운트(필수 개수 / 채워진 개수). 스테퍼·완료 버튼 로직 공통 원천.
  const progress = useMemo(() => {
    const consentFilled = (consentPrivacy ? 1 : 0) + (consentRecordingAi ? 1 : 0);
    const narrativeFilled = [todayHelp, hardestPoint, desiredChange].filter((text) => text.trim().length > 0).length;
    const areaFilled = LIFE_AREA_ORDER.filter((key) => lifeAreas[key].status !== '').length;
    const hasGoal = goals.some((goal) => goal.title.trim().length > 0);
    const hasAction = actions.some((action) => action.description.trim().length > 0);
    const summaryFilled = (hasGoal ? 1 : 0) + (hasAction ? 1 : 0);
    return {
      steps: [
        { required: 0, filled: 0 },
        { required: 2, filled: consentFilled },
        { required: 3, filled: narrativeFilled },
        { required: 6, filled: areaFilled },
        { required: 2, filled: summaryFilled },
        { required: 0, filled: 0 },
      ],
    };
  }, [consentPrivacy, consentRecordingAi, todayHelp, hardestPoint, desiredChange, lifeAreas, goals, actions]);

  const missingSteps = progress.steps
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => entry.filled < entry.required)
    .map((entry) => `${entry.index + 1}. ${STEP_TITLES[entry.index]}`);
  const heldAtMissing = heldAt.trim().length === 0;
  const canComplete = missingSteps.length === 0 && !heldAtMissing;

  // 생활 영역에 '위기'가 하나라도 있으면 위기·안전 블록을 자동으로 펼치고 강조한다(설계 ⑤).
  // 위기가 선택된 동안에는 접을 수 없다 — 리스크는 접힘 불가라는 D9 원칙을 입력 화면에 적용.
  const crisisAreas = LIFE_AREA_ORDER.filter((key) => lifeAreas[key].status === 'crisis');
  const hasCrisis = crisisAreas.length > 0;
  const crisisOpen = hasCrisis || (openSections.crisis ?? false);

  function updateArea(key: LifeAreaKey, patch: Partial<{ status: LifeAreaStatus | ''; note: string }>) {
    setLifeAreas((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function collectedAnswers() {
    return ANSWER_KEYS
      .map((key) => ({ key, draft: answers[key] }))
      .filter(({ draft }) => draft.response !== 'answered' || draft.text.trim().length > 0)
      .map(({ key, draft }) => (draft.response === 'answered'
        ? { key, response: draft.response, text: draft.text.trim() }
        : { key, response: draft.response }));
  }

  function collectedExtendedPii() {
    const patch: Record<string, string> = {};
    if (birthDate.trim().length > 0) patch.birthDate = birthDate.trim();
    if (region.trim().length > 0) patch.region = region.trim();
    if (emergencyContact.trim().length > 0) patch.emergencyContact = emergencyContact.trim();
    if (gender.trim().length > 0) patch.gender = gender.trim();
    return patch;
  }

  async function complete() {
    if (!canComplete) {
      setError('필수 항목이 남아 있습니다. 스테퍼에서 표시된 단계를 확인하세요.');
      return;
    }
    setBusy(true);
    const collected = collectedAnswers();
    const extendedPii = collectedExtendedPii();
    const extras = additionalItems
      .filter((entry) => entry.item.trim().length > 0)
      .map((entry) => ({
        item: entry.item.trim(),
        ...(entry.owner.trim().length > 0 ? { owner: entry.owner.trim() } : {}),
        ...(entry.dueDate.trim().length > 0 ? { dueDate: entry.dueDate } : {}),
      }));
    const hasNextMeeting = nextMeetingAt.trim().length > 0;
    const result = await props.submit({
      beneficiaryId: props.beneficiaryId,
      supportCaseId: props.supportCaseId,
      submissionId: props.submissionId,
      heldAt,
      channel,
      consent: { privacy: consentPrivacy, recordingAi: consentRecordingAi },
      helpNarrative: { todayHelp, hardestPoint, desiredChange },
      lifeAreas: LIFE_AREA_ORDER.map((key) => {
        const area = lifeAreas[key];
        const note = area.note.trim();
        return note.length > 0
          ? { areaKey: key, status: area.status as LifeAreaStatus, note }
          : { areaKey: key, status: area.status as LifeAreaStatus };
      }),
      goals: goals
        .filter((goal) => goal.title.trim().length > 0)
        .map((goal) => (goal.criteria.trim().length > 0
          ? { title: goal.title.trim(), scaleCriteria: { definition: goal.criteria.trim() } }
          : { title: goal.title.trim() })),
      actions: actions
        .filter((action) => action.description.trim().length > 0)
        .map((action) => (action.dueDate.trim().length > 0
          ? { description: action.description.trim(), owner: action.owner, dueDate: action.dueDate }
          : { description: action.description.trim(), owner: action.owner })),
      ...(collected.length > 0 ? { answers: collected } : {}),
      ...(Object.keys(extendedPii).length > 0 ? { extendedPii } : {}),
      ...(extras.length > 0 ? { additionalItems: extras } : {}),
      ...(hasNextMeeting ? { nextMeeting: { heldAt: nextMeetingAt, channel: nextMeetingChannel } } : {}),
      ...(managerOpinion.trim().length > 0 ? { managerOpinion } : {}),
    });
    setBusy(false);
    if (result.status !== 'saved' && result.status !== 'replayed') {
      setError(messageFor(result.status));
      return;
    }
    setError(null);
    // 서버에 남았으니 임시본을 지운다 — 남겨 두면 다음 기록에 섞인다(CCC-12).
    clearDraft(storageKey);
    // 저장 직후 브리핑으로 직행한다 — "기록이 브리핑이 된다"를 눈으로 확인하는 동선이다
    // (스펙 #78 US 17 · CCC-31). 다음 만남은 제출 페이로드에 남아 기록으로 저장되고,
    // 다음 상담 등록은 브리핑 상단 안내줄의 버튼이 이어받는다.
    router.push(props.briefingHref);
  }

  const participantParts = [props.participant.name ?? props.beneficiaryId, props.participant.phone, props.participant.email]
    .filter((part): part is string => typeof part === 'string' && part.length > 0);
  const participantMeta = <MetaRow items={participantParts} />;

  return (
    <main className="page-content">
      <div className="wire-container" data-grid="true" style={{ padding: 0, gap: 24 }}>
        <nav className="wire-col-4" aria-label="단계 진행" style={{ ...stackStyle, gap: 8 }}>
          <h2 style={headingStyle}>진행 단계</h2>
          {STEP_TITLES.map((title, index) => {
            const stepNumber = index + 1;
            const entry = progress.steps[index]!;
            const done = entry.required > 0 && entry.filled >= entry.required;
            const state = step === stepNumber ? 'current' : done ? 'done' : 'waiting';
            const mark = done ? '✓' : step === stepNumber ? '●' : '○';
            return (
              <button
                key={title}
                type="button"
                onClick={() => { setStep(stepNumber); setError(null); }}
                aria-current={step === stepNumber ? 'step' : undefined}
                data-step-state={state}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 8, textAlign: 'left',
                  padding: '10px 12px', border: '1px solid var(--line-control)',
                  borderRadius: 'var(--radius-control)',
                  // 현재 단계는 시간·진행 축이므로 블루 계열이다(§1-5 배정표).
                  background: step === stepNumber ? 'var(--blue-tint)' : 'transparent',
                  color: step === stepNumber ? 'var(--blue-deep)' : 'var(--ink)',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                <span>{mark} {stepNumber}. {title}</span>
                {entry.required > 0 ? <span style={captionStyle}>{entry.filled}/{entry.required}</span> : null}
              </button>
            );
          })}
        </nav>

        <section className="wire-col-8" style={stackStyle}>
          <p style={captionStyle}>
            <MetaRow items={[`${step} / 6 단계`, <>참여자 {participantMeta}</>]} />
          </p>
          {/* 별도 임시 저장 버튼이 없다 — 자동 저장이 곧 임시 저장이므로 상태를 상시 보여준다. */}
          <DraftStatus savedAt={draftSavedAt} available={draftAvailable} />
          {restorable === null
            ? null
            : <DraftRestorePrompt savedAt={restorable} onResume={resumeDraft} onDiscard={discardDraft} />}
          {error !== null ? <p role="alert" style={errorStyle}>{error}</p> : null}

          {step === 1 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>① 시작</h2>
              <p style={captionStyle}><MetaRow items={[`회차 ${props.sessionSequence}회`, `기록자 ${props.recorderLabel}`]} /> 상담 일시는 화면을 연 시각으로 채웠습니다. 참여자 정보는 등록 데이터입니다(재입력 없음).</p>
              <div style={fieldStyle}><span style={labelStyle}>참여자</span><p style={{ ...captionStyle, fontSize: 15 }}>{participantMeta}</p></div>
              <label style={fieldStyle}>
                <span style={labelStyle}>상담 일시</span>
                <input type="datetime-local" aria-label="상담 일시" value={heldAt} onChange={(event) => setHeldAt(event.target.value)} style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                <span style={labelStyle}>상담 방법</span>
                <select aria-label="상담 방법" value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)} style={inputStyle}>
                  {CHANNELS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>

              <Collapse
                title="기본정보 더 적기 (선택)"
                open={openSections.basic ?? false}
                onToggle={(open) => toggleSection('basic', open)}
              >
                <p style={captionStyle}>생년월일·거주 지역·긴급 연락처·성별은 실명·연락처와 같은 암호화 금고에 저장됩니다. 조회는 전건 기록에 남습니다.</p>
                <label style={fieldStyle}>
                  <span style={labelStyle}>생년월일</span>
                  <input type="date" aria-label="생년월일" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} style={inputStyle} />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>거주 지역</span>
                  <input aria-label="거주 지역" value={region} onChange={(event) => setRegion(event.target.value)} style={inputStyle} />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>긴급 연락처</span>
                  <input aria-label="긴급 연락처" value={emergencyContact} onChange={(event) => setEmergencyContact(event.target.value)} style={inputStyle} />
                </label>
                <label style={fieldStyle}>
                  <span style={labelStyle}>성별</span>
                  <input aria-label="성별" value={gender} onChange={(event) => setGender(event.target.value)} style={inputStyle} />
                </label>
                <h3 style={subHeadingStyle}>유입·의뢰 경로</h3>
                {REFERRAL_KEYS.map((key) => (
                  <AnswerField key={key} label={ANSWER_LABELS[key]} value={answers[key]} onChange={(next) => setAnswer(key, next)} />
                ))}
              </Collapse>
            </div>
          ) : null}

          {step === 2 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>② 동의</h2>
              <div style={panelStyle}>
                <h3 style={subHeadingStyle}>수집·이용 안내</h3>
                <p style={captionStyle}>
                  [안내문 자리표시] 상담 기록은 참여자 지원을 위해 수집·이용하며, 실명·연락처 등 개인정보는 암호화해 보관합니다.
                  비밀보장이 원칙이나 법에서 정한 예외(생명·안전에 관한 긴급 상황 등)가 있습니다. 보관 기간이 지나면 열람이 제한됩니다.
                  최종 문안은 법률 검토 후 확정합니다(D15).
                </p>
                <Collapse
                  title="자세히 읽어보기"
                  open={openSections.consentDetail ?? false}
                  onToggle={(open) => toggleSection('consentDetail', open)}
                >
                  <div className="consent-detail-section">
                    <h3>수집 항목</h3>
                    <p>실명·연락처·이메일, 상담 중 알게 된 생활 상황, 그리고 선택 입력한 생년월일·거주 지역·긴급 연락처·성별.</p>
                  </div>
                  <div className="consent-detail-section">
                    <h3>이용 목적</h3>
                    <p>상담 기록과 지원 계획 수립, 그리고 상담 준비 화면의 요약 제공.</p>
                  </div>
                  <div className="consent-detail-section">
                    <h3>비밀보장의 한계</h3>
                    <p>본인이나 타인의 생명·안전에 관한 긴급 상황, 법령에 따른 요청이 있을 때는 필요한 범위에서 공개될 수 있습니다.</p>
                  </div>
                  <div className="consent-detail-section">
                    <h3>보유·파기</h3>
                    <p>보관 기간이 지나면 일반 조회에서 제외되고, 동의 철회·본인 요청 등이 있으면 파기합니다.</p>
                  </div>
                  <p className="consent-detail-disclaimer">위 문안은 자리표시입니다. 법률 검토 결과로 대체됩니다.</p>
                </Collapse>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', ...labelStyle }}>
                <input type="checkbox" aria-label="개인정보 수집·이용 동의" checked={consentPrivacy} onChange={(event) => setConsentPrivacy(event.target.checked)} />
                안내를 확인했으며 개인정보 수집·이용에 동의합니다
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', ...labelStyle }}>
                <input type="checkbox" aria-label="녹음·AI 정리 동의" checked={consentRecordingAi} onChange={(event) => setConsentRecordingAi(event.target.checked)} />
                상담 녹음·분석과 기록의 정리·요약에 동의합니다
              </label>
            </div>
          ) : null}

          {step === 3 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>③ 원하는 도움</h2>
              {/*
                P1 3문은 게이트웨이가 본문(비어 있지 않은 문자열)을 요구하므로 답변거부·모름·
                해당없음을 선택지 버튼으로 두지 않는다. 버튼이 라벨 문자열을 본문에 적어 넣으면
                참여자가 실제로 그렇게 말한 경우와 저장에서 구분되지 않고, 브리핑·AI 정리의
                입력 원문이 UI 라벨로 오염된다. 이 3문의 거부 표현은 스키마 결정이 필요한
                미결이다(설계 v0.3 §5).
              */}
              <label style={fieldStyle}><span style={labelStyle}>오늘 어떤 도움을 받고 싶어서 오셨나요?</span>
                <textarea aria-label="오늘 어떤 도움" value={todayHelp} onChange={(event) => setTodayHelp(event.target.value)} style={textareaStyle} /></label>
              <label style={fieldStyle}><span style={labelStyle}>지금 가장 힘든 점 / 먼저 해결하고 싶은 것은?</span>
                <textarea aria-label="가장 힘든 점" value={hardestPoint} onChange={(event) => setHardestPoint(event.target.value)} style={textareaStyle} /></label>
              <label style={fieldStyle}><span style={labelStyle}>상황이 어떻게 달라지면 좋겠나요?</span>
                <textarea aria-label="어떻게 달라지면" value={desiredChange} onChange={(event) => setDesiredChange(event.target.value)} style={textareaStyle} /></label>

              <Collapse
                title="더 묻기 (선택)"
                open={openSections.more ?? false}
                onToggle={(open) => toggleSection('more', open)}
              >
                {MORE_KEYS.map((key) => (
                  <AnswerField key={key} label={ANSWER_LABELS[key]} value={answers[key]} onChange={(next) => setAnswer(key, next)} />
                ))}
              </Collapse>
            </div>
          ) : null}

          {step === 4 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>④ 생활 상황</h2>
              <p style={captionStyle}>6영역 각각의 지금 상태를 고르고 한 줄로 적습니다. 이 상태는 상담사가 직접 기입하며 감정 점수가 아닙니다. 긴장·위기를 고르면 심화 질문이 자동으로 열립니다(금전지원형은 경제·생계 기본 펼침).</p>
              {LIFE_AREA_ORDER.map((key) => {
                const status = lifeAreas[key].status;
                const detailKey = LIFE_DETAIL_KEYS[key];
                // 긴장·위기면 자동 펼침, 금전지원형 템플릿 v1 은 경제 심화를 기본 펼침으로 둔다.
                const autoOpen = status === 'strained' || status === 'crisis' || key === 'economy';
                const open = autoOpen || (openSections[`life_${key}`] ?? false);
                return (
                  <div key={key} style={fieldStyle}>
                    <label style={fieldStyle}>
                      <span style={labelStyle}>{LIFE_AREA_LABELS[key]}</span>
                      <select aria-label={`${LIFE_AREA_LABELS[key]} 상태`} value={status} onChange={(event) => updateArea(key, { status: event.target.value as LifeAreaStatus | '' })} style={inputStyle}>
                        <option value="">상태 선택</option>
                        {LIFE_STATUS_LABELS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                      </select>
                    </label>
                    <input aria-label={`${LIFE_AREA_LABELS[key]} 한 줄`} value={lifeAreas[key].note} onChange={(event) => updateArea(key, { note: event.target.value })} placeholder="한 줄 메모 (선택)" style={inputStyle} />
                    <Collapse
                      title={`${LIFE_AREA_LABELS[key]} 심화 (선택)`}
                      open={open}
                      onToggle={(next) => toggleSection(`life_${key}`, next)}
                    >
                      <AnswerField label={ANSWER_LABELS[detailKey]} value={answers[detailKey]} onChange={(next) => setAnswer(detailKey, next)} />
                    </Collapse>
                  </div>
                );
              })}
            </div>
          ) : null}

          {step === 5 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>⑤ 정리</h2>
              <p style={captionStyle}>목표는 측정 가능한 문장으로 최대 3개. GAS 기준(-2~+2)은 상담사가 직접 적습니다. 목표 문구는 나중에 수정할 수 없고 종료+신설만 가능합니다(D12).</p>
              {goals.map((goal, index) => (
                <div key={index} style={fieldStyle}>
                  <label style={fieldStyle}><span style={labelStyle}>목표 {index + 1}</span>
                    <input aria-label={`목표 ${index + 1}`} value={goal.title} onChange={(event) => setGoals((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, title: event.target.value } : item)))} style={inputStyle} /></label>
                  <label style={fieldStyle}><span style={labelStyle}>목표 {index + 1} GAS 기준</span>
                    <textarea aria-label={`목표 ${index + 1} GAS 기준`} value={goal.criteria} onChange={(event) => setGoals((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, criteria: event.target.value } : item)))} style={textareaStyle} /></label>
                  {goals.length > 1 ? <WireButton onClick={() => setGoals((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>이 목표 삭제</WireButton> : null}
                </div>
              ))}
              {goals.length < 3 ? <div style={rowActionsStyle}><WireButton onClick={() => setGoals((prev) => [...prev, { title: '', criteria: '' }])}>목표 추가</WireButton></div> : null}

              <h3 style={subHeadingStyle}>다음 행동</h3>
              {actions.map((action, index) => (
                <div key={index} style={fieldStyle}>
                  <label style={fieldStyle}><span style={labelStyle}>다음 행동 {index + 1}</span>
                    <input aria-label={`다음 행동 ${index + 1}`} value={action.description} onChange={(event) => setActions((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, description: event.target.value } : item)))} style={inputStyle} /></label>
                  <label style={fieldStyle}><span style={labelStyle}>담당</span>
                    <select aria-label={`다음 행동 ${index + 1} 담당`} value={action.owner} onChange={(event) => setActions((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, owner: event.target.value as ActionDraft['owner'] } : item)))} style={inputStyle}>
                      {OWNERS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select></label>
                  {actions.length > 1 ? <WireButton onClick={() => setActions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>이 행동 삭제</WireButton> : null}
                </div>
              ))}
              <div style={rowActionsStyle}><WireButton onClick={() => setActions((prev) => [...prev, { description: '', owner: 'counselor', dueDate: '' }])}>행동 추가</WireButton></div>

              <div style={hasCrisis ? emphasisPanelStyle : panelStyle} data-testid="intake-crisis-block" data-emphasis={hasCrisis ? 'true' : 'false'}>
                <h3 style={subHeadingStyle}>위기·안전 확인</h3>
                {hasCrisis ? (
                  <p role="alert" style={errorStyle} data-testid="intake-crisis-alert">
                    생활 상황에서 &lsquo;위기&rsquo;를 고른 영역이 있습니다({crisisAreas.map((key) => LIFE_AREA_LABELS[key]).join(', ')}). 아래 확인을 먼저 마치세요.
                  </p>
                ) : null}
                <Collapse
                  title="위기·안전 질문"
                  open={crisisOpen}
                  onToggle={(open) => toggleSection('crisis', open)}
                >
                  {CRISIS_KEYS.map((key) => (
                    <AnswerField key={key} label={ANSWER_LABELS[key]} value={answers[key]} onChange={(next) => setAnswer(key, next)} />
                  ))}
                  <p style={captionStyle}>여기 적힌 위험 내용은 상담사가 검토해 리스크 플래그로 확정합니다(D9). 이 화면은 플래그를 자동으로 만들지 않습니다.</p>
                </Collapse>
              </div>

              <Collapse
                title="강점·자원 (선택)"
                open={openSections.strength ?? false}
                onToggle={(open) => toggleSection('strength', open)}
              >
                {STRENGTH_KEYS.map((key) => (
                  <AnswerField key={key} label={ANSWER_LABELS[key]} value={answers[key]} onChange={(next) => setAnswer(key, next)} />
                ))}
              </Collapse>

              <Collapse
                title="참여 여건 (선택)"
                open={openSections.participation ?? false}
                onToggle={(open) => toggleSection('participation', open)}
              >
                {PARTICIPATION_KEYS.map((key) => (
                  <AnswerField key={key} label={ANSWER_LABELS[key]} value={answers[key]} onChange={(next) => setAnswer(key, next)} />
                ))}
              </Collapse>

              <Collapse
                title="추가 확인 필요 정보 (선택)"
                open={openSections.additional ?? false}
                onToggle={(open) => toggleSection('additional', open)}
              >
                {additionalItems.map((entry, index) => (
                  <div key={index} style={fieldStyle}>
                    <label style={fieldStyle}><span style={labelStyle}>확인할 내용 {index + 1}</span>
                      <input aria-label={`확인할 내용 ${index + 1}`} value={entry.item} onChange={(event) => setAdditionalItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, item: event.target.value } : item)))} style={inputStyle} /></label>
                    <label style={fieldStyle}><span style={labelStyle}>누가 확인 {index + 1}</span>
                      <input aria-label={`누가 확인 ${index + 1}`} value={entry.owner} onChange={(event) => setAdditionalItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, owner: event.target.value } : item)))} style={inputStyle} /></label>
                    <label style={fieldStyle}><span style={labelStyle}>언제까지 {index + 1}</span>
                      <input type="date" aria-label={`언제까지 ${index + 1}`} value={entry.dueDate} onChange={(event) => setAdditionalItems((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, dueDate: event.target.value } : item)))} style={inputStyle} /></label>
                    <WireButton onClick={() => setAdditionalItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>이 줄 삭제</WireButton>
                  </div>
                ))}
                <div style={rowActionsStyle}>
                  <WireButton onClick={() => setAdditionalItems((prev) => [...prev, { item: '', owner: '', dueDate: '' }])}>확인할 내용 추가</WireButton>
                </div>
              </Collapse>

              <div style={panelStyle}>
                <h3 style={subHeadingStyle}>다음 만남</h3>
                <p style={captionStyle}>일시를 적고 저장하면 상담 일정 등록 화면으로 이어집니다.</p>
                <label style={fieldStyle}><span style={labelStyle}>다음 만남 일시</span>
                  <input type="datetime-local" aria-label="다음 만남 일시" value={nextMeetingAt} onChange={(event) => setNextMeetingAt(event.target.value)} style={inputStyle} /></label>
                <label style={fieldStyle}><span style={labelStyle}>다음 만남 방식</span>
                  <select aria-label="다음 만남 방식" value={nextMeetingChannel} onChange={(event) => setNextMeetingChannel(event.target.value as typeof nextMeetingChannel)} style={inputStyle}>
                    {CHANNELS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select></label>
              </div>
            </div>
          ) : null}

          {step === 6 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>⑥ 담당자 의견</h2>
              <p style={captionStyle}>상담사의 종합 판단을 참여자 발언과 구분해 남깁니다(선택).</p>
              <label style={fieldStyle}><span style={labelStyle}>담당자 의견</span>
                <textarea aria-label="담당자 의견" value={managerOpinion} onChange={(event) => setManagerOpinion(event.target.value)} style={textareaStyle} /></label>
            </div>
          ) : null}

          {!canComplete ? (
            <p style={captionStyle} data-testid="intake-missing">
              완료하려면 남은 필수 항목을 채우세요: {[heldAtMissing ? '1. 시작(상담 일시)' : null, ...missingSteps].filter((entry) => entry !== null).join(', ')}
            </p>
          ) : null}

          <div style={rowActionsStyle}>
            {step > 1 ? <WireButton onClick={() => { setStep(step - 1); setError(null); }}>이전</WireButton> : null}
            {step < 6 ? <WireButton chevron onClick={() => { setStep(step + 1); setError(null); }}>다음: {STEP_TITLES[step]}</WireButton> : null}
            <WireButton size="large" disabled={busy || !canComplete} onClick={complete}>완료</WireButton>
          </div>
        </section>
      </div>
    </main>
  );
}
