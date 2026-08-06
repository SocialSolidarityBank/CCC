'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon } from '../../../../../../components/wire/wire-icon';
import { useRouter } from 'next/navigation';
import { DraftRestorePrompt, DraftStatus } from '../../../../../../components/draft/draft-notice';
import { MetaRow } from '../../../../../../components/wire/meta-row';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { DateTimePickerControl, isCompleteDateTime } from '../../../../../../components/wire/date-picker-control';
import { WireFormField } from '../../../../../../components/wire/wire-form-field';
import { clearDraft, draftKey, readDraft, sweepExpiredDrafts, writeDraft } from '../../../../../../lib/form-draft';
import type {
  IntakeAnswerKey,
  IntakeAnswerResponse,
  IntakeExtendedPii,
} from '../../../../../../lib/api';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';
import {
  ACTIVE_QUESTIONS,
  NOT_APPLICABLE_CODE,
  NOT_APPLICABLE_OPTION,
  NO_RESPONSE_CODE,
  NO_RESPONSE_OPTION,
  STEP_GROUPS,
  STEP_TITLES,
  channelForMethod,
  type IntakeQuestion,
} from './intake-questions';

/**
 * 인테이크 위저드 — 정본 질문지(D41)의 4부와 1:1인 4단계(D42, 구 6단계 대체).
 *
 * 이 화면이 하지 않는 것 4가지를 먼저 적는다. 전부 의도된 삭제다.
 *  ① 기본정보(이름·생년월일·연락처·이메일·주소·성별) 입력 — 저장은 당사자 등록(금고)만.
 *     여기서는 읽어서 보여주기만 한다(D42 ① · R3: 세션 기록에 PII 미저장).
 *  ② 동의 입력 — 당사자 등록 화면 몫이다(D42 ② · D23). 여기서는 기록 여부만 표시한다.
 *  ③ 목표·GAS 기준 입력 — 통째로 빠졌다(D42 ③ · D43 GAS 보류).
 *  ④ 원하는 도움 3문·6영역 상태·다음 행동·다음 만남 — 정본 질문지에 없는 항목이라 보내지
 *     않는다. 게이트웨이도 이 5종을 선택으로 받는다.
 *
 * 저장은 마지막 "완료"에서 게이트웨이 1회 호출이고 부분 저장은 없다. 전 항목 필수이며
 * '무응답'을 고르는 것이 곧 답이다(정본 작성 원칙) — 그 강제는 이 화면의 필수 카운트가 한다.
 */

export interface IntakeWizardProps {
  beneficiaryId: string;
  supportCaseId: string;
  submissionId: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  /** 금고에 있는 기본정보(생년월일·주소/거주지역·성별 등). 표시 전용. */
  extendedPii: IntakeExtendedPii;
  /** 동의 기록 여부(표시 전용). 입력은 당사자 등록 화면. */
  consent: { privacy: boolean; recordingAi: boolean };
  sessionSequence: number;
  recorderLabel: string;
  briefingHref: string;
  /** 동의를 고치러 가는 곳(당사자 정보 허브의 참여 사업 카드, D44). */
  participantHref: string;
  /** 1-1 기본정보를 고치러 가는 곳(당사자 기본정보 수정 화면, CCC-37). */
  basicInfoHref: string;
  submit: (input: CreateIntakeRecordActionInput) => Promise<IntakeRecordActionResult>;
}

const NOTICE_MESSAGES: Record<string, string> = {
  invalid_request: '입력한 내용을 다시 확인하세요.',
  validation_error: '필수 항목을 다시 확인하세요.',
  access_denied: '담당 중인 참여 사업에만 인테이크를 남길 수 있습니다.',
  forbidden: '담당 중인 참여 사업에만 인테이크를 남길 수 있습니다.',
  not_found: '당사자 또는 참여 사업을 찾을 수 없습니다.',
  conflict: '이 참여 사업에는 이미 인테이크 기록이 있습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인하세요.',
  service_unavailable: '지금 저장할 수 없습니다. 잠시 후 다시 시도하세요.',
};

function messageFor(status: string): string {
  return NOTICE_MESSAGES[status] ?? '인테이크를 저장하지 못했습니다.';
}

interface AnswerDraft { response: IntakeAnswerResponse; text: string }
type AnswerState = Record<string, AnswerDraft>;
/** 반복 행 표(2-1 부채 · 3-3 연계 기관 · 4-2 추가 확인사항) 한 줄. 열 이름이 곧 키다. */
type TableRow = Record<string, string>;

interface IntakeDraftValues {
  step: number;
  heldAt: string;
  answers: AnswerState;
  debts: TableRow[];
  linkedOrgs: TableRow[];
  additionalItems: TableRow[];
  managerOpinion: string;
}

interface ColumnSpec { key: string; label: string; placeholder?: string }

// 2-1 대출·부채 현황: 채무별 기관·채권자, 구분, 잔액, 월 상환액, 연체 여부·상태.
const DEBT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'creditor', label: '기관·채권자', placeholder: '예: OO은행 / 해당 없음' },
  { key: 'kind', label: '구분', placeholder: '예: 신용대출' },
  { key: 'balance', label: '잔액', placeholder: '예: 1,200만원' },
  { key: 'monthlyPayment', label: '월 상환액', placeholder: '예: 30만원' },
  { key: 'arrearsStatus', label: '연체 여부·상태', placeholder: '예: 3개월 연체' },
];

// 3-3 현재 연계된 기관·서비스.
const LINKED_ORG_COLUMNS: readonly ColumnSpec[] = [
  { key: 'orgName', label: '기관명', placeholder: '예: OO구 주민센터 / 해당 없음' },
  { key: 'serviceName', label: '사업·서비스명', placeholder: '예: 긴급복지 생계지원' },
  { key: 'supportDetail', label: '지원내용·금액', placeholder: '예: 생계비 713,100원' },
  { key: 'usagePeriod', label: '이용기간', placeholder: '예: 2026.07~2026.09' },
  { key: 'progressStatus', label: '진행상태·담당자', placeholder: '예: 심사 중 / 김OO 주무관' },
];

// 4-2 추가 확인사항.
const ADDITIONAL_COLUMNS: readonly ColumnSpec[] = [
  { key: 'item', label: '추가 확인사항', placeholder: '예: 전체 채무 잔액' },
  { key: 'reason', label: '필요한 이유', placeholder: '예: 채무조정 가능성 판단' },
  { key: 'method', label: '확인 방법', placeholder: '예: 신용정보조회서 확인' },
  { key: 'dueNote', label: '확인 예정 시점', placeholder: '예: 다음 상담 전' },
];

const stackStyle: CSSProperties = { display: 'grid', gap: 20 };
const headingStyle: CSSProperties = { margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--ink)' };
// 소절 제목은 WireCard 의 title 슬롯(h3)이 그린다 — 구 subHeadingStyle 삭제(2026-08-05).
// 입력 라벨은 값 위에 두고 14/700 --sub 로 쓴다(DESIGN.md §9 완화).
const labelStyle: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'var(--sub)' };
const captionStyle: CSSProperties = { margin: 0, fontSize: 14, color: 'var(--sub)' };
const errorStyle: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--risk)' };
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
// 소절 패널은 WireCard 가 그린다(2026-08-05 컴포넌트화 · ADR-0030 — 구 panelStyle 손 상자
// 삭제. 정기 기록지와 같은 카드 어휘가 된다).
const checkboxRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12 };

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function emptyAnswers(): AnswerState {
  return ACTIVE_QUESTIONS.reduce<AnswerState>((state, question) => {
    state[question.key] = { response: 'answered', text: '' };
    return state;
  }, {});
}

function emptyRow(columns: readonly ColumnSpec[]): TableRow {
  return columns.reduce<TableRow>((row, column) => {
    row[column.key] = '';
    return row;
  }, {});
}

function normalizeRows(raw: unknown, columns: readonly ColumnSpec[], seed = false): TableRow[] {
  const rows = !Array.isArray(raw) ? [] : raw.filter(isRecordObject).map((entry) => {
    const row = emptyRow(columns);
    for (const column of columns) row[column.key] = textOf(entry[column.key]);
    return row;
  });
  // 2-1·3-3 은 정본이 "없으면 첫 행에 '해당 없음'"이라고 정한다 — 적을 줄이 항상 하나는 있어야 한다.
  return seed && rows.length === 0 ? [emptyRow(columns)] : rows;
}

/** 표의 첫 열(필수 열)이 채워진 줄이 하나라도 있는지. 정본의 '해당 없음' 규칙을 이걸로 강제한다. */
function firstColumnFilled(rows: TableRow[], columns: readonly ColumnSpec[]): boolean {
  const first = columns[0];
  if (first === undefined) return true;
  return rows.some((row) => (row[first.key] ?? '').trim().length > 0);
}

const RESPONSE_CODES: readonly IntakeAnswerResponse[] = ['answered', 'declined', 'unknown', 'not_applicable'];

/**
 * 임시본은 배포를 건너뛰고 살아남는다(보관 12시간). 필드가 빠지거나 모양이 달라진 임시본을
 * 그대로 상태에 부으면 화면이 렌더 중에 죽는다 — 되돌리기 전에 항상 기본값 위에 얹어 정규화한다.
 */
function normalizeDraft(raw: unknown): IntakeDraftValues | null {
  if (!isRecordObject(raw)) return null;

  const answers = emptyAnswers();
  const storedAnswers = isRecordObject(raw.answers) ? raw.answers : {};
  for (const question of ACTIVE_QUESTIONS) {
    const answer = storedAnswers[question.key];
    if (!isRecordObject(answer)) continue;
    const response = answer.response;
    const known = RESPONSE_CODES.includes(response as IntakeAnswerResponse);
    answers[question.key] = {
      response: known ? (response as IntakeAnswerResponse) : 'answered',
      text: textOf(answer.text),
    };
  }

  const step = typeof raw.step === 'number' && Number.isInteger(raw.step) && raw.step >= 1 && raw.step <= STEP_TITLES.length
    ? raw.step
    : 1;

  return {
    step,
    heldAt: textOf(raw.heldAt),
    answers,
    debts: normalizeRows(raw.debts, DEBT_COLUMNS, true),
    linkedOrgs: normalizeRows(raw.linkedOrgs, LINKED_ORG_COLUMNS, true),
    additionalItems: normalizeRows(raw.additionalItems, ADDITIONAL_COLUMNS),
    managerOpinion: textOf(raw.managerOpinion),
  };
}

function rowHasContent(rows: TableRow[]): boolean {
  return rows.some((row) => Object.values(row).some((value) => value.trim().length > 0));
}

/**
 * 상담 일시는 화면을 여는 순간 자동으로 채워진다. 그것만으로 임시본을 만들면 아무것도 안 쓰고
 * 나갔다 온 사람에게 이어쓰기 배너가 뜬다 — 실제 입력이 있을 때만 저장한다.
 */
function hasContent(values: IntakeDraftValues): boolean {
  if (values.managerOpinion.trim().length > 0) return true;
  if (rowHasContent(values.debts) || rowHasContent(values.linkedOrgs) || rowHasContent(values.additionalItems)) return true;
  return ACTIVE_QUESTIONS.some((question) => {
    const answer = values.answers[question.key];
    return answer !== undefined && (answer.response !== 'answered' || answer.text.trim().length > 0);
  });
}

/** 선택값 문자열 ↔ 저장 어휘. '무응답'·'해당 없음'은 본문이 아니라 응답 코드로 남는다. */
function draftFromOption(value: string): AnswerDraft {
  if (value === NO_RESPONSE_OPTION) return { response: NO_RESPONSE_CODE, text: '' };
  if (value === NOT_APPLICABLE_OPTION) return { response: NOT_APPLICABLE_CODE, text: '' };
  return { response: 'answered', text: value };
}

function optionFromDraft(draft: AnswerDraft): string {
  if (draft.response === NO_RESPONSE_CODE) return NO_RESPONSE_OPTION;
  if (draft.response === NOT_APPLICABLE_CODE) return NOT_APPLICABLE_OPTION;
  return draft.text;
}

function isFilled(draft: AnswerDraft | undefined): boolean {
  if (draft === undefined) return false;
  return draft.response !== 'answered' || draft.text.trim().length > 0;
}

/** 브라우저 로컬 시각을 datetime-local 입력 형식(YYYY-MM-DDTHH:mm)으로. */
function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 접힘 묶음. 동의 안내문과 같은 아코디언 패턴을 재사용한다 — 새 스타일 없음. */
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

/** 읽기 전용 한 줄(기본정보·동의). 입력 컨트롤을 두지 않는 것이 이 부품의 계약이다. */
function ReadOnlyRow(props: { label: string; value: string }) {
  return (
    <div style={fieldStyle} data-testid="intake-readonly-row">
      <span style={labelStyle}>{props.label}</span>
      <p style={{ ...captionStyle, fontSize: 15, color: 'var(--ink)' }}>{props.value}</p>
    </div>
  );
}

/**
 * 질문 1문. 고르기(select)·여러 개 고르기(multi)·서술(text)을 한 부품이 처리한다 —
 * 질문마다 분기를 복제하지 않는 것이 이 어휘 설계의 목적이다.
 */
function QuestionField(props: { question: IntakeQuestion; value: AnswerDraft; onChange: (next: AnswerDraft) => void }) {
  const { question, value, onChange } = props;

  if (question.kind === 'select') {
    return (
      <label style={fieldStyle}>
        <span style={labelStyle}>{question.label}</span>
        <select
          aria-label={question.label}
          data-answer-key={question.key}
          value={optionFromDraft(value)}
          onChange={(event) => onChange(draftFromOption(event.target.value))}
          style={inputStyle}
        >
          <option value="">선택하세요</option>
          {(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    );
  }

  if (question.kind === 'multi') {
    const selected = optionFromDraft(value).split(', ').filter((entry) => entry.length > 0);
    const toggle = (option: string) => {
      const next = selected.includes(option)
        ? selected.filter((entry) => entry !== option)
        : [...selected, option];
      onChange(draftFromOption(next.join(', ')));
    };
    return (
      <div style={fieldStyle} data-answer-key={question.key}>
        <span style={labelStyle}>{question.label}</span>
        <div style={checkboxRowStyle} role="group" aria-label={question.label}>
          {(question.options ?? []).map((option) => (
            <label key={option} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
              <input
                type="checkbox"
                aria-label={`${question.label} ${option}`}
                checked={selected.includes(option)}
                onChange={() => toggle(option)}
              />
              {option}
            </label>
          ))}
        </div>
      </div>
    );
  }

  const answered = value.response === 'answered';
  return (
    <div style={fieldStyle}>
      <label style={fieldStyle}>
        <span style={labelStyle}>{question.label}</span>
        <textarea
          aria-label={question.label}
          data-answer-key={question.key}
          placeholder={question.hint}
          value={answered ? value.text : ''}
          disabled={!answered}
          onChange={(event) => onChange({ response: 'answered', text: event.target.value })}
          style={textareaStyle}
        />
      </label>
      <div style={rowActionsStyle}>
        {([[NO_RESPONSE_OPTION, NO_RESPONSE_CODE], [NOT_APPLICABLE_OPTION, NOT_APPLICABLE_CODE]] as const).map(
          ([optionLabel, code]) => (
            <WireButton
              key={code}
              onClick={() => onChange(value.response === code ? { response: 'answered', text: '' } : { response: code, text: '' })}
            >
              {value.response === code ? <><Icon name="check" size={14} /> {optionLabel}</> : optionLabel}
            </WireButton>
          ),
        )}
      </div>
    </div>
  );
}

/** 반복 행 표. 첫 열만 있으면 그 줄이 저장된다(정본: 없으면 첫 행에 '해당 없음'). */
function RowTable(props: {
  title: string;
  hint: string;
  columns: readonly ColumnSpec[];
  rows: TableRow[];
  onChange: (rows: TableRow[]) => void;
  testId: string;
}) {
  const { columns, rows, onChange } = props;
  return (
    <WireCard title={<h3>{props.title}</h3>} testId={props.testId}>
      <p style={captionStyle}>{props.hint}</p>
      {rows.map((row, index) => (
        <div key={index} style={fieldStyle}>
          {columns.map((column) => (
            <label key={column.key} style={fieldStyle}>
              <span style={labelStyle}>{`${column.label} ${index + 1}`}</span>
              <input
                aria-label={`${column.label} ${index + 1}`}
                value={row[column.key] ?? ''}
                placeholder={column.placeholder}
                onChange={(event) => onChange(rows.map((entry, entryIndex) => (
                  entryIndex === index ? { ...entry, [column.key]: event.target.value } : entry
                )))}
                style={inputStyle}
              />
            </label>
          ))}
          <WireButton onClick={() => onChange(rows.filter((_, entryIndex) => entryIndex !== index))}>
            이 줄 삭제
          </WireButton>
        </div>
      ))}
      <div style={rowActionsStyle}>
        <WireButton onClick={() => onChange([...rows, emptyRow(columns)])}>줄 추가</WireButton>
      </div>
    </WireCard>
  );
}

export function IntakeWizard(props: IntakeWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [heldAt, setHeldAt] = useState('');
  const [answers, setAnswers] = useState<AnswerState>(emptyAnswers);
  const [debts, setDebts] = useState<TableRow[]>(() => [emptyRow(DEBT_COLUMNS)]);
  const [linkedOrgs, setLinkedOrgs] = useState<TableRow[]>(() => [emptyRow(LINKED_ORG_COLUMNS)]);
  const [additionalItems, setAdditionalItems] = useState<TableRow[]>([]);
  const [managerOpinion, setManagerOpinion] = useState('');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 상담일(1-3)은 화면을 연 시각으로 채운다(실무자가 바꿀 수 있음). 서버·클라이언트 시각 차이로
  // 생기는 하이드레이션 불일치를 피하려고 마운트 후에 채운다.
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

  // 금고에서 내려온 기본정보(props.extendedPii·participant)는 이 객체에 없다 — 임시본에 담으면
  // pii_vault 값을 브라우저에 쓰게 된다. 1단계가 표시 전용이 된 뒤로는 더더욱 담을 이유가 없다.
  const draftValues: IntakeDraftValues = useMemo(() => ({
    step, heldAt, answers, debts, linkedOrgs, additionalItems, managerOpinion,
  }), [step, heldAt, answers, debts, linkedOrgs, additionalItems, managerOpinion]);

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
    // 배너가 떠 있는 동안에는 저장하지 않는다 — 실무자가 고르기 전에 임시본을 덮어쓰면 안 된다.
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
    setAnswers(values.answers);
    setDebts(values.debts);
    setLinkedOrgs(values.linkedOrgs);
    setAdditionalItems(values.additionalItems);
    setManagerOpinion(values.managerOpinion);
    // 금고 값은 되돌리지 않는다 — 임시본에 담기지 않았고, props 가 정본이다.
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

  // 단계별 필수 채움 카운트(필수 개수 / 채워진 개수). 전 항목 필수 + 무응답 원칙을 여기서 센다.
  // 질문 말고도 필수인 것 3개를 함께 센다: 2-1 부채 표·3-3 연계 기관 표의 첫 열(정본의
  // "없으면 첫 행에 '해당 없음'")과 4-3 담당 실무자 종합의견.
  const progress = useMemo(() => STEP_GROUPS.map((groups, index) => {
    const questions = groups.flatMap((group) => group.questions);
    let required = questions.length;
    let filled = questions.filter((q) => isFilled(answers[q.key])).length;
    if (index === 1) {
      required += 1;
      if (firstColumnFilled(debts, DEBT_COLUMNS)) filled += 1;
    }
    if (index === 2) {
      required += 1;
      if (firstColumnFilled(linkedOrgs, LINKED_ORG_COLUMNS)) filled += 1;
    }
    if (index === 3) {
      required += 1;
      if (managerOpinion.trim().length > 0) filled += 1;
    }
    return { required, filled };
  }), [answers, debts, linkedOrgs, managerOpinion]);

  const missingSteps = progress
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => entry.filled < entry.required)
    .map((entry) => `${entry.index + 1}. ${STEP_TITLES[entry.index]}`);
  // D48: 날짜·시각 두 칸이라 '비어 있지 않다'로는 반쪽 값(`2026-08-12T`)을 걸러내지 못한다.
  const heldAtMissing = !isCompleteDateTime(heldAt);
  const canComplete = missingSteps.length === 0 && !heldAtMissing;

  function collectedAnswers() {
    return ACTIVE_QUESTIONS
      .map((question) => ({ key: question.key, draft: answers[question.key] }))
      .filter((entry): entry is { key: IntakeAnswerKey; draft: AnswerDraft } => isFilled(entry.draft))
      .map(({ key, draft }) => (draft.response === 'answered'
        ? { key, response: draft.response, text: draft.text.trim() }
        : { key, response: draft.response }));
  }

  /** 표 한 줄 → 저장 페이로드. 첫 열이 빈 줄은 버리고, 빈 칸은 아예 키를 만들지 않는다. */
  function collectedRows(rows: TableRow[], columns: readonly ColumnSpec[]) {
    const [required, ...optional] = columns;
    if (required === undefined) return [];
    return rows
      .filter((row) => (row[required.key] ?? '').trim().length > 0)
      .map((row) => optional.reduce<TableRow>((entry, column) => {
        const value = (row[column.key] ?? '').trim();
        if (value.length > 0) entry[column.key] = value;
        return entry;
      }, { [required.key]: (row[required.key] ?? '').trim() }));
  }

  async function complete() {
    if (!canComplete) {
      setError('필수 항목이 남아 있습니다. 스테퍼에서 표시된 단계를 확인하세요.');
      return;
    }
    setBusy(true);
    const collected = collectedAnswers();
    const debtRows = collectedRows(debts, DEBT_COLUMNS);
    const linkedRows = collectedRows(linkedOrgs, LINKED_ORG_COLUMNS);
    const extraRows = collectedRows(additionalItems, ADDITIONAL_COLUMNS);
    const opinion = managerOpinion.trim();
    const payload: CreateIntakeRecordActionInput = {
      beneficiaryId: props.beneficiaryId,
      supportCaseId: props.supportCaseId,
      submissionId: props.submissionId,
      heldAt,
      // 정본 1-3 상담 방법은 6종이고 DB 채널은 3종이다 — 문구는 counsel_method 답변에 그대로
      // 남고, 채널 컬럼에는 좁힌 값이 들어간다(마이그레이션 없이 정본 문구를 잃지 않는 방법).
      channel: channelForMethod(optionFromDraft(answers.counsel_method ?? { response: 'answered', text: '' })),
    };
    if (collected.length > 0) payload.answers = collected;
    if (debtRows.length > 0) payload.debts = debtRows as unknown as NonNullable<CreateIntakeRecordActionInput['debts']>;
    if (linkedRows.length > 0) payload.linkedOrgs = linkedRows as unknown as NonNullable<CreateIntakeRecordActionInput['linkedOrgs']>;
    if (extraRows.length > 0) payload.additionalItems = extraRows as unknown as NonNullable<CreateIntakeRecordActionInput['additionalItems']>;
    if (opinion.length > 0) payload.managerOpinion = opinion;
    const result = await props.submit(payload);
    setBusy(false);
    if (result.status !== 'saved' && result.status !== 'replayed') {
      setError(messageFor(result.status));
      return;
    }
    setError(null);
    // 서버에 남았으니 임시본을 지운다 — 남겨 두면 다음 기록에 섞인다(CCC-12).
    clearDraft(storageKey);
    // 저장 직후 브리핑으로 직행한다(스펙 #78 US 17 · CCC-31).
    router.push(props.briefingHref);
  }

  const participantParts = [props.participant.name ?? props.beneficiaryId, props.participant.phone, props.participant.email]
    .filter((part): part is string => typeof part === 'string' && part.length > 0);

  // 정본(PRD/intake-questionnaire-v1.md)에서 한 소절인데 일부 항목이 자동 채움인 경우가 있다.
  // 그 자동 항목을 별도 상자로 빼면 같은 번호가 화면에 두 번 뜨므로(구 결함), 소절 제목을
  // 열쇠로 삼아 **그 소절 안 맨 위에** 끼워 넣는다. 번호는 언제나 소절 하나에 하나다.
  function renderGroups(
    groups: readonly { title: string; questions: readonly IntakeQuestion[] }[],
    extras: Readonly<Record<string, ReactNode>> = {},
  ) {
    return groups.map((group) => (
      <WireCard key={group.title} title={<h3>{group.title}</h3>}>
        {extras[group.title] ?? null}
        {group.questions.map((question) => (
          <QuestionField
            key={question.key}
            question={question}
            value={answers[question.key] ?? { response: 'answered', text: '' }}
            onChange={(next) => setAnswer(question.key, next)}
          />
        ))}
      </WireCard>
    ));
  }

  const consentRows: ReadonlyArray<readonly [string, boolean]> = [
    ['개인정보 수집·이용 동의', props.consent.privacy],
    ['AI를 활용한 녹취기록 동의', props.consent.recordingAi],
  ];
  const consentMissing = consentRows.some(([, recorded]) => !recorded);

  return (
    <main className="page-content">
      <div className="wire-container" data-grid="true" style={{ padding: 0, gap: 24 }}>
        {/* alignContent 가 없으면 grid 행들이 본문 길이만큼 늘어난 컬럼 높이를 균등 분배해
            단계 버튼 하나가 500px 넘게 벌어진다 — 진행 표시는 위에 붙어 있어야 한다. */}
        <nav className="wire-col-4" aria-label="단계 진행" style={{ ...stackStyle, gap: 8, alignContent: 'start' }}>
          <h2 style={headingStyle}>진행 단계</h2>
          {STEP_TITLES.map((title, index) => {
            const stepNumber = index + 1;
            const entry = progress[index]!;
            const done = entry.filled >= entry.required;
            const state = step === stepNumber ? 'current' : done ? 'done' : 'waiting';
            // 아이콘은 SVG 공용 부품이다(CCC-49) — 문자 글리프는 §7 락 5 위반.
            const mark = done ? <Icon name="check" size={14} /> : step === stepNumber ? <Icon name="dot" size={14} /> : <Icon name="dot-empty" size={14} />;
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
                  fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                <span>{mark} {stepNumber}. {title}</span>
                <span style={captionStyle}>{entry.filled}/{entry.required}</span>
              </button>
            );
          })}
        </nav>

        <section className="wire-col-8" style={stackStyle}>
          <p style={captionStyle}>
            <MetaRow items={[`${step} / 4 단계`, `회차 ${props.sessionSequence}회`, `실무자 ${props.recorderLabel}`]} />
          </p>
          <p style={captionStyle}>모든 항목이 필수입니다. 확인되지 않았거나 답하지 않은 항목은 &lsquo;무응답&rsquo;을 고르세요.</p>
          {/* 별도 임시 저장 버튼이 없다 — 자동 저장이 곧 임시 저장이므로 상태를 상시 보여준다. */}
          <DraftStatus savedAt={draftSavedAt} available={draftAvailable} />
          {restorable === null
            ? null
            : <DraftRestorePrompt savedAt={restorable} onResume={resumeDraft} onDiscard={discardDraft} />}
          {error !== null ? <p role="alert" style={errorStyle}>{error}</p> : null}

          {step === 1 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>1. 상담 신청 및 기본정보</h2>

              <WireCard title={<h3>1-1. 당사자 기본정보</h3>} testId="intake-basic-info">
                <p style={captionStyle}>
                  당사자 등록에 저장된 값입니다. 이 화면에서는 고칠 수 없고 상담 기록에도 남지 않습니다.{' '}
                  <a href={props.basicInfoHref}>당사자 등록 정보에서 수정</a>
                </p>
                <ReadOnlyRow label="이름" value={props.participant.name ?? '미입력'} />
                <ReadOnlyRow label="생년월일" value={props.extendedPii.birthDate ?? '미입력'} />
                <ReadOnlyRow label="휴대전화번호" value={props.participant.phone ?? '미입력'} />
                <ReadOnlyRow label="이메일" value={props.participant.email ?? '미입력'} />
                <ReadOnlyRow label="주소 또는 거주지역" value={props.extendedPii.region ?? '미입력'} />
                <ReadOnlyRow label="성별" value={props.extendedPii.gender ?? '미입력'} />
              </WireCard>

              <WireCard title={<h3>동의 기록</h3>} testId="intake-consent-status">
                {consentRows.map(([label, recorded]) => (
                  <ReadOnlyRow key={label} label={label} value={recorded ? '기록됨' : '미기록'} />
                ))}
                {consentMissing ? (
                  // D44: 동의는 등록 때 받고 당사자 정보 페이지에서 고친다. 인테이크는 읽기만 한다.
                  <p style={captionStyle}>
                    동의는 당사자 정보 페이지에서 기록·수정합니다. <a href={props.participantHref}>당사자 정보로 이동</a>
                  </p>
                ) : null}
              </WireCard>

              {renderGroups(STEP_GROUPS[0]!, {
                // 정본 1-3 의 첫 세 항목(상담일·실무자·상담 회차)이다 — 앞의 둘은 자동으로 채워진다.
                '1-3. 상담 운영정보': (
                  <>
                    {/* D48: 네이티브 datetime-local 은 표기가 보는 사람의 브라우저 언어를 따라
                        팀원마다 달랐다(R6). 달력 + 직접 입력 병행으로 바꾼다(KRDS).
                        WireFormField 로 감싼다(2026-08-05) — 맨몸으로 두면 입력 상자의
                        테두리·포커스 링이 없어 입력칸으로 보이지 않았다. */}
                    <WireFormField label="상담일" htmlFor="intake-held-at">
                      <DateTimePickerControl id="intake-held-at" fieldLabel="상담일" value={heldAt} onChange={setHeldAt} />
                    </WireFormField>
                    <ReadOnlyRow label="실무자" value={props.recorderLabel} />
                    <ReadOnlyRow label="상담 회차" value={`${props.sessionSequence}회`} />
                  </>
                ),
              })}
            </div>
          ) : null}

          {step === 2 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>2. 현재 생활상황</h2>
              {renderGroups(STEP_GROUPS[1]!)}
              <Collapse
                title="대출·부채 현황 표"
                open={openSections.debts ?? true}
                onToggle={(open) => toggleSection('debts', open)}
              >
                <RowTable
                  title="채무별 상세"
                  hint="채무별로 기관·채권자, 구분, 잔액, 월 상환액, 연체 여부와 상태를 기록합니다. 채무가 없으면 첫 행에 '해당 없음'을 기입합니다."
                  columns={DEBT_COLUMNS}
                  rows={debts}
                  onChange={setDebts}
                  testId="intake-debt-table"
                />
              </Collapse>
            </div>
          ) : null}

          {step === 3 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>3. 필요한 도움과 활용 가능한 자원</h2>
              {renderGroups(STEP_GROUPS[2]!)}
              <RowTable
                title="3-3. 현재 연계된 기관·서비스"
                hint="이용 중이거나 연결이 진행 중인 자원을 기록합니다. 연계 자원이 없으면 첫 행에 '해당 없음'을 기입합니다."
                columns={LINKED_ORG_COLUMNS}
                rows={linkedOrgs}
                onChange={setLinkedOrgs}
                testId="intake-linked-org-table"
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div style={stackStyle}>
              <h2 style={headingStyle}>4. 상담 정리와 후속관리</h2>
              {renderGroups(STEP_GROUPS[3]!)}
              <RowTable
                title="4-2. 추가 확인사항"
                hint="다음 상담 전에 확인할 것을 적습니다."
                columns={ADDITIONAL_COLUMNS}
                rows={additionalItems}
                onChange={setAdditionalItems}
                testId="intake-additional-table"
              />
              <WireCard title={<h3>담당 실무자 종합의견</h3>}>
                <p style={captionStyle}>실무자의 종합 판단을 당사자 발언과 구분해 남깁니다.</p>
                <label style={fieldStyle}>
                  <span style={labelStyle}>담당 실무자 종합의견</span>
                  <textarea
                    aria-label="담당 실무자 종합의견"
                    value={managerOpinion}
                    onChange={(event) => setManagerOpinion(event.target.value)}
                    style={textareaStyle}
                  />
                </label>
              </WireCard>
            </div>
          ) : null}

          {!canComplete ? (
            <p style={captionStyle} data-testid="intake-missing">
              완료하려면 남은 필수 항목을 채우세요: {[heldAtMissing ? '1. 상담일' : null, ...missingSteps].filter((entry) => entry !== null).join(', ')}
            </p>
          ) : null}

          <p style={captionStyle} data-testid="intake-participant">
            <MetaRow items={participantParts} />
          </p>

          <div style={rowActionsStyle}>
            {step > 1 ? <WireButton onClick={() => { setStep(step - 1); setError(null); }}>이전</WireButton> : null}
            {step < STEP_TITLES.length
              ? <WireButton chevron onClick={() => { setStep(step + 1); setError(null); }}>다음: {STEP_TITLES[step]}</WireButton>
              : null}
            <WireButton size="large" disabled={busy || !canComplete} onClick={complete}>완료</WireButton>
          </div>
        </section>
      </div>
    </main>
  );
}
