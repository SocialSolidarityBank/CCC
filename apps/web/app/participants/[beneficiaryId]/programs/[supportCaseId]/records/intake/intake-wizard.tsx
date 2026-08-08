'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../../../../../components/wire/wire-icon';
import { useRouter } from 'next/navigation';
import { DraftRestorePrompt, DraftStatus } from '../../../../../../components/draft/draft-notice';
import { MetaRow } from '../../../../../../components/wire/meta-row';
import { PageTitle } from '../../../../../../components/wire/page-title';
import { WireCallout } from '../../../../../../components/wire/wire-callout';
import { WireButton } from '../../../../../../components/wire/wire-button';
import { WireRepeatActions } from '../../../../../../components/wire/wire-repeat-actions';
import { WireCard } from '../../../../../../components/wire/wire-card';
import { DateTimePickerControl, isCompleteDateTime } from '../../../../../../components/wire/date-picker-control';
import { WireChoice, WireFormField } from '../../../../../../components/wire/wire-form-field';
import { formatKoreanDateTime } from '../../../../../../lib/format-korean-date';
import { clearDraft, draftKey, readDraft, sweepExpiredDrafts, writeDraft } from '../../../../../../lib/form-draft';
import type {
  IntakeAnswerInput,
  IntakeAnswerKey,
  IntakeAnswerResponse,
  IntakeExtendedPii,
} from '../../../../../../lib/api';
import type { CreateIntakeRecordActionInput, IntakeRecordActionResult } from '../../../../../../actions';
import {
  ACTIVE_QUESTIONS,
  ADDITIONAL_COLUMNS,
  DEBT_COLUMNS,
  LINKED_ORG_COLUMNS,
  NOT_APPLICABLE_CODE,
  NOT_APPLICABLE_OPTION,
  NO_RESPONSE_CODE,
  NO_RESPONSE_OPTION,
  STEP_GROUPS,
  STEP_TITLES,
  channelForMethod,
  type IntakeQuestion,
  type IntakeTableColumn,
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
  /**
   * 완료로 넘길 연결 일정(CCC-57). 예정 건이 없으면 null 이고, 그때는 조작 칸을 그리지
   * 않는다. **작성 모드에서만 온다.** 수정 경로에는 일정 연결이 없다.
   */
  schedule?: { id: string; scheduledAt: string; version: number } | null;
  /** 수정 모드(2026-08-08 Q "확인/수정"). 저장된 인테이크를 미리 채우고 덮어쓴다. */
  mode?: 'create' | 'edit';
  /** 수정 모드의 프리필 재료 — 서버의 saved 를 페이지가 이 모양으로 바꿔 준다. */
  initial?: IntakeInitialValues;
}

/** 수정 모드 프리필 값. heldAt 은 ISO UTC 그대로 받고 화면이 로컬 표기로 바꾼다. */
export interface IntakeInitialValues {
  heldAt: string;
  answers: IntakeAnswerInput[];
  debts: TableRow[];
  linkedOrgs: TableRow[];
  additionalItems: TableRow[];
  managerOpinion: string | null;
}

const NOTICE_MESSAGES: Record<string, string> = {
  invalid_request: '입력한 내용을 다시 확인하세요.',
  validation_error: '필수 항목을 다시 확인하세요.',
  access_denied: '담당 중인 참여 사업에만 인테이크를 남길 수 있습니다.',
  forbidden: '담당 중인 참여 사업에만 인테이크를 남길 수 있습니다.',
  not_found: '당사자 또는 참여 사업을 찾을 수 없습니다.',
  // CCC-57: 이 코드는 두 가지 원인에서 온다. 인테이크 중복, 그리고 연결된 일정이 그
  // 사이 바뀐 경우(버전 불일치). 서버가 둘을 다른 코드로 주지 않으므로 문구가 둘 다 덮는다.
  conflict: '이 참여 사업에 이미 인테이크 기록이 있거나, 연결된 상담 일정이 그 사이 변경되었습니다. 화면을 새로 열어 확인하세요.',
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
  /**
   * 연결 일정을 완료로 넘길 것인가(CCC-57). 임시본에 담지 않으면 체크를 푼 사실이 복원에서
   * 사라진다. 완료 버튼은 단계와 무관하게 늘 떠 있으므로, 1단계에서 복원하고 그대로 저장하면
   * "완료하지 않겠다"가 조용히 뒤집힌다. 켜는 쪽으로 뒤집히는 것이라 더 눈에 안 띈다.
   */
  completeSchedule: boolean;
}

// 표 3종의 열 정의는 intake-questions.ts 가 단일 원천이다(CCC-58 — 조회 화면과 공유).
type ColumnSpec = IntakeTableColumn;

// 2026-08-09 Q: 인라인 스타일 객체 10종을 공용 클래스·부품으로 옮겼다. 상담 등록 위저드에
// 같은 블록이 복사돼 있어 두 화면을 함께 옮긴다 — 한쪽만 고치면 지금 똑같은 두 화면이 갈라진다.
// guard:tokens 는 layout.tsx·wire-styles.ts 두 파일만 훑으므로 인라인 값은 검사 밖이었고,
// 실제로 제목이 계단에 없는 20px 로(다른 화면 h2 는 18), 기본정보 값이 버튼 전용 하프스텝
// 15px 로 서 있었다.
//   stackStyle → .wizard-stack · headingStyle → 그냥 h2(전역 18/600) · fieldStyle → .wizard-field ·
//   labelStyle·inputStyle·textareaStyle → WireFormField(§5 입력칸 계약) · captionStyle → .panel-meta ·
//   errorStyle → .wire-field-error · rowActionsStyle·checkboxRowStyle → .wizard-actions ·
//   읽기 전용 줄 → .wire-field-label/.wire-field-value(§5 정보 필드) ·
//   여러 개 고르기 → WireChoice(§5 선택지 행 — 누를 면적 40, 라벨 16)
// 소절 제목은 WireCard 의 title 슬롯(h3)이 그린다 — 구 subHeadingStyle 삭제(2026-08-05).
// 소절 패널도 WireCard 가 그린다(2026-08-05 컴포넌트화 · ADR-0030 — 구 panelStyle 손 상자 삭제).

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
    // 이 키가 없는 옛 임시본은 새 폼과 같은 기본값(켬)으로 읽는다. 끈 사실만 저장돼 있다.
    completeSchedule: raw.completeSchedule !== false,
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

/** 읽기 전용 한 줄(기본정보·동의). 입력 컨트롤을 두지 않는 것이 이 부품의 계약이다.
 *  라벨은 민트다(2026-08-07 Q 9차 "태그에 컬러" — 사람·기록 축, .record-block>h3 과
 *  같은 계약). 값(--ink)과 색으로 갈라져 짝이 한눈에 읽힌다. */
function ReadOnlyRow(props: { label: string; value: string }) {
  // 값은 16(--text-md)이다 — 구 15 는 §2-1 의 **버튼 전용** 하프스텝(--text-btn)이라 버튼 밖에
  // 쓰면 계단 밖 값이다. 라벨·값 색은 §5 '정보 필드' 계약(.wire-field-label/.wire-field-value)이 갖는다.
  return (
    <div className="wizard-field" data-testid="intake-readonly-row">
      <span className="wire-field-label">{props.label}</span>
      <p className="wire-field-value">{props.value}</p>
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
    // 공용 입력칸 부품을 쓴다(2026-08-07 Q 11차 "선택창 V 여백 안맞음" — 맨몸 select 는
    // §5 계약(네이티브 화살표 끄고 꺽쇠를 우측 12 에 직접 그림)을 벗어나 브라우저 기본
    // V 가 제멋대로 앉았다. 등록 폼과 같은 WireFormField(control select)로 고친다).
    return (
      <WireFormField label={question.label} control="select">
        <select
          aria-label={question.label}
          data-answer-key={question.key}
          value={optionFromDraft(value)}
          onChange={(event) => onChange(draftFromOption(event.target.value))}
        >
          <option value="">선택하세요</option>
          {(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </WireFormField>
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
    // 보기는 공용 선택지 행(WireChoice)이다 — 손으로 그린 14px 라벨 + 기본 체크박스는 §5
    // '선택지 행'(누를 면적 40 · 라벨 16)과 §5 체크박스(켬 = 면 채움)를 둘 다 벗어나 있었다.
    // 접근 이름은 그대로 `질문 보기`다 — 한 화면에 '무응답' 체크박스가 여럿이라 보기 낱말만으로는
    // 어느 질문의 것인지 가려지지 않는다(WireChoice 의 ariaLabel).
    return (
      <div className="wizard-field" data-answer-key={question.key}>
        <span className="wire-form-label">{question.label}</span>
        <div className="wizard-choice-row" role="group" aria-label={question.label}>
          {(question.options ?? []).map((option) => (
            <WireChoice
              key={option}
              type="checkbox"
              label={option}
              ariaLabel={`${question.label} ${option}`}
              checked={selected.includes(option)}
              onChange={() => toggle(option)}
            />
          ))}
        </div>
      </div>
    );
  }

  const answered = value.response === 'answered';
  return (
    <div className="wizard-field">
      <WireFormField label={question.label} control="textarea">
        <textarea
          aria-label={question.label}
          data-answer-key={question.key}
          placeholder={question.hint}
          rows={3}
          value={answered ? value.text : ''}
          disabled={!answered}
          onChange={(event) => onChange({ response: 'answered', text: event.target.value })}
        />
      </WireFormField>
      <div className="wizard-actions">
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
      <p className="panel-meta">{props.hint}</p>
      {rows.map((row, index) => (
        <div key={index} className="wizard-field">
          {columns.map((column) => (
            <WireFormField key={column.key} label={`${column.label} ${index + 1}`}>
              <input
                aria-label={`${column.label} ${index + 1}`}
                value={row[column.key] ?? ''}
                placeholder={column.placeholder}
                onChange={(event) => onChange(rows.map((entry, entryIndex) => (
                  entryIndex === index ? { ...entry, [column.key]: event.target.value } : entry
                )))}
              />
            </WireFormField>
          ))}
          {/* 추가·삭제는 공용 세트다(2026-08-09 Q). 추가는 **마지막 줄에만** 붙고, 삭제는
              줄이 둘 이상일 때만 붙는다 — 정본이 "없으면 첫 행에 '해당 없음'" 이라
              적을 줄이 하나는 남아야 한다. */}
          <WireRepeatActions
            itemLabel="줄"
            onAdd={index === rows.length - 1 ? () => onChange([...rows, emptyRow(columns)]) : undefined}
            onRemove={rows.length > 1 ? () => onChange(rows.filter((_, entryIndex) => entryIndex !== index)) : undefined}
          />
        </div>
      ))}
      {/* 줄이 하나도 없는 표(4-3 추가 확인사항)는 추가 버튼이 붙을 줄 자체가 없다 — 그
          경우에만 세트를 카드 바닥에 따로 세운다. */}
      {rows.length === 0 && (
        <WireRepeatActions itemLabel="줄" onAdd={() => onChange([...rows, emptyRow(columns)])} />
      )}
    </WireCard>
  );
}

/** 저장된 답변 목록 → 화면 상태. 빈 판(전 질문 키) 위에 저장분을 덮는다 — 상태 모양이
 *  작성 모드와 같아야 진행 카운트·필드 렌더가 분기 없이 동작한다. */
function answersFromInitial(initial: IntakeInitialValues): AnswerState {
  const state = emptyAnswers();
  for (const answer of initial.answers) {
    state[answer.key] = { response: answer.response, text: answer.text ?? '' };
  }
  return state;
}

export function IntakeWizard(props: IntakeWizardProps) {
  const router = useRouter();
  const editing = props.mode === 'edit';
  const initial = editing ? props.initial : undefined;
  const [step, setStep] = useState(1);
  const [heldAt, setHeldAt] = useState('');
  const [answers, setAnswers] = useState<AnswerState>(() => (initial === undefined ? emptyAnswers() : answersFromInitial(initial)));
  const [debts, setDebts] = useState<TableRow[]>(() => (
    initial !== undefined && initial.debts.length > 0 ? initial.debts : [emptyRow(DEBT_COLUMNS)]
  ));
  const [linkedOrgs, setLinkedOrgs] = useState<TableRow[]>(() => (
    initial !== undefined && initial.linkedOrgs.length > 0 ? initial.linkedOrgs : [emptyRow(LINKED_ORG_COLUMNS)]
  ));
  const [additionalItems, setAdditionalItems] = useState<TableRow[]>(() => initial?.additionalItems ?? []);
  const [managerOpinion, setManagerOpinion] = useState(() => initial?.managerOpinion ?? '');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 연결 일정 완료(CCC-57). 기본은 켬이다. 인테이크를 마쳤는데 그 약속이 계속 '예정'으로
  // 남는 것이 이 티켓이 고치는 오작동이다. 실무자가 끄면 일정은 그대로 둔다.
  // 수정 모드에는 이 배선이 없으므로(위 prop 주석) 예정 건이 있어도 링크를 잡지 않는다.
  const linkedSchedule = editing ? null : props.schedule ?? null;
  const [completeSchedule, setCompleteSchedule] = useState(true);

  // 상담일(1-3)은 화면을 연 시각으로 채운다(실무자가 바꿀 수 있음). 서버·클라이언트 시각 차이로
  // 생기는 하이드레이션 불일치를 피하려고 마운트 후에 채운다. 수정 모드는 저장된 상담일을
  // 로컬 표기로 바꿔 채운다 — 이것도 시간대가 클라이언트 것이라 마운트 후여야 한다.
  const initialHeldAt = initial?.heldAt;
  useEffect(() => {
    setHeldAt((current) => {
      if (current !== '') return current;
      return initialHeldAt !== undefined ? localDateTimeValue(new Date(initialHeldAt)) : localDateTimeValue(new Date());
    });
  }, [initialHeldAt]);

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
    step, heldAt, answers, debts, linkedOrgs, additionalItems, managerOpinion, completeSchedule,
  }), [step, heldAt, answers, debts, linkedOrgs, additionalItems, managerOpinion, completeSchedule]);

  useEffect(() => {
    // 수정 모드는 임시본을 켜지 않는다 — 서버 저장본이 정본이고, 작성 모드의 임시본과
    // 저장소 키가 같아 섞이면 복원 배너가 수정 화면을 옛 작성 초안으로 덮는다.
    if (editing) return;
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
  }, [storageKey, editing]);

  useEffect(() => {
    if (editing) return;
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
  }, [draftValues, restorable, storageKey, editing]);

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
    setCompleteSchedule(values.completeSchedule);
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
  // 일괄 검토 A7 (2026-08-08): 단계 이름만으로는 45문항에서 빈 곳을 못 찾는다 — 남은 항목의
  // **이름까지** 모아 완료 안내에 그대로 보여준다.
  const progress = useMemo(() => STEP_GROUPS.map((groups, index) => {
    const questions = groups.flatMap((group) => group.questions);
    let required = questions.length;
    let filled = questions.filter((q) => isFilled(answers[q.key])).length;
    const missing = questions.filter((q) => !isFilled(answers[q.key])).map((q) => q.label);
    if (index === 1) {
      required += 1;
      if (firstColumnFilled(debts, DEBT_COLUMNS)) filled += 1;
      else missing.push("대출·부채 표 첫 행(없으면 '해당 없음')");
    }
    if (index === 2) {
      required += 1;
      if (firstColumnFilled(linkedOrgs, LINKED_ORG_COLUMNS)) filled += 1;
      else missing.push("연계 기관 표 첫 행(없으면 '해당 없음')");
    }
    if (index === 3) {
      required += 1;
      if (managerOpinion.trim().length > 0) filled += 1;
      else missing.push('담당 실무자 종합의견');
    }
    return { required, filled, missing };
  }), [answers, debts, linkedOrgs, managerOpinion]);

  const missingDetails = progress
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => entry.filled < entry.required);
  const missingSteps = missingDetails.map((entry) => `${entry.index + 1}. ${STEP_TITLES[entry.index]}`);
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
    // 연결 일정 완료(CCC-57). 두 값은 언제나 함께 실린다. 서버가 버전으로 다시 확인한다.
    if (linkedSchedule !== null && completeSchedule) {
      payload.scheduleId = linkedSchedule.id;
      payload.expectedScheduleVersion = linkedSchedule.version;
    }
    const result = await props.submit(payload);
    setBusy(false);
    if (result.status !== 'saved' && result.status !== 'replayed') {
      setError(editing && result.status === 'conflict'
        ? '인테이크를 지금 수정할 수 없습니다. 참여 사업 상태를 확인하세요.'
        : messageFor(result.status));
      return;
    }
    setError(null);
    // 서버에 남았으니 임시본을 지운다 — 남겨 두면 다음 기록에 섞인다(CCC-12).
    if (!editing) clearDraft(storageKey);
    // 저장 직후 이동: 작성은 브리핑 직행(스펙 #78 US 17 · CCC-31), 수정은 페이지가
    // 같은 prop 에 상담 기록 목록을 실어 보낸다.
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
      {/* 페이지 타이틀(2026-08-08 Q — 화면 이름은 '인테이크'다. 작성·수정 모두 같은 이름). */}
      <div className="page-header"><PageTitle>인테이크</PageTitle></div>
      <div className="wire-container rail-grid" data-grid="true">
        {/* alignContent 가 없으면 grid 행들이 본문 길이만큼 늘어난 컬럼 높이를 균등 분배해
            단계 버튼 하나가 500px 넘게 벌어진다 — 진행 표시는 위에 붙어 있어야 한다.
            .intake-step-nav: 스크롤해도 화면에 남는다(2026-08-07 Q 9차, 768 이상). */}
        <nav className="wire-col-4 intake-step-nav" aria-label="단계 진행">
          <h2>진행 단계</h2>
          {STEP_TITLES.map((title, index) => {
            const stepNumber = index + 1;
            const entry = progress[index]!;
            const done = entry.filled >= entry.required;
            const state = step === stepNumber ? 'current' : done ? 'done' : 'waiting';
            // 아이콘은 SVG 공용 부품이다(CCC-49) — 문자 글리프는 §7 락 5 위반.
            const mark = done ? <Icon name="check" size={14} /> : step === stepNumber ? <Icon name="dot" size={14} /> : <Icon name="dot-empty" size={14} />;
            // 옷은 .intake-step 이 갖는다(2026-08-09 인라인 정리) — 현재 단계 색은 data-step-state 가 가른다.
            return (
              <button
                key={title}
                type="button"
                className="intake-step"
                onClick={() => { setStep(stepNumber); setError(null); }}
                aria-current={step === stepNumber ? 'step' : undefined}
                data-step-state={state}
              >
                <span>{mark} {stepNumber}. {title}</span>
                <span className="intake-step-count">{entry.filled}/{entry.required}</span>
              </button>
            );
          })}
        </nav>

        <section className="wire-col-8 wizard-stack">
          {/* 맥락 카드(2026-08-07 Q 9차·10차 개정): 누구의 인테이크인지(구 맨 아래 당사자
              줄을 위로 올림) + 단계·회차·실무자 + 작성 원칙 안내를 한 카드에 모은다.
              static 이다 — 스크롤하면 함께 사라진다(10차 Q, 구 9차 sticky 대체). */}
          <WireCard testId="intake-context">
            <p className="intake-participant-line" data-testid="intake-participant">
              <MetaRow items={participantParts} />
            </p>
            <p className="panel-meta">
              {/* 수정 모드의 '회차 N회'는 다음 회차 자동값이라 거짓 정보다 — 자리 자체를 수정 표시로 바꾼다. */}
              <MetaRow items={[`${step} / 4 단계`, editing ? '저장된 인테이크 수정' : `회차 ${props.sessionSequence}회`, `실무자 ${props.recorderLabel}`]} />
            </p>
            <p className="panel-meta">모든 항목이 필수입니다. 확인되지 않았거나 답하지 않은 항목은 &lsquo;무응답&rsquo;을 고르세요.</p>
          </WireCard>
          {/* 별도 임시 저장 버튼이 없다 — 자동 저장이 곧 임시 저장이므로 상태를 상시 보여준다.
              수정 모드는 임시본이 없으므로 두 줄 다 그리지 않는다. */}
          {editing ? null : <DraftStatus savedAt={draftSavedAt} available={draftAvailable} />}
          {editing || restorable === null
            ? null
            : <DraftRestorePrompt savedAt={restorable} onResume={resumeDraft} onDiscard={discardDraft} />}
          {error !== null ? <p role="alert" className="wire-field-error">{error}</p> : null}

          {step === 1 ? (
            <div className="wizard-stack">
              <h2>1. 상담 신청 및 기본정보</h2>

              <WireCard title={<h3>1-1. 당사자 기본정보</h3>} testId="intake-basic-info">
                <p className="panel-meta">
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
                  <p className="panel-meta">
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
            <div className="wizard-stack">
              <h2>2. 현재 생활상황</h2>
              {renderGroups(STEP_GROUPS[1]!)}
              <Collapse
                title="대출·부채 현황 표"
                open={openSections.debts ?? true}
                onToggle={(open) => toggleSection('debts', open)}
              >
                <RowTable
                  title="채무별 상세"
                  hint="채무별로 기관·채권자, 구분, 잔액, 월 상환액, 연체 여부와 상태를 기록합니다. 채무가 없으면 첫 행에 '해당 없음'을 기입합니다. 첫 칸은 필수라 비워 두면 완료할 수 없습니다."
                  columns={DEBT_COLUMNS}
                  rows={debts}
                  onChange={setDebts}
                  testId="intake-debt-table"
                />
              </Collapse>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="wizard-stack">
              <h2>3. 필요한 도움과 활용 가능한 자원</h2>
              {renderGroups(STEP_GROUPS[2]!)}
              <RowTable
                title="3-3. 현재 연계된 기관·서비스"
                hint="이용 중이거나 연결이 진행 중인 자원을 기록합니다. 연계 자원이 없으면 첫 행에 '해당 없음'을 기입합니다. 첫 칸은 필수라 비워 두면 완료할 수 없습니다."
                columns={LINKED_ORG_COLUMNS}
                rows={linkedOrgs}
                onChange={setLinkedOrgs}
                testId="intake-linked-org-table"
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div className="wizard-stack">
              <h2>4. 상담 정리와 후속관리</h2>
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
                <p className="panel-meta">실무자의 종합 판단을 당사자 발언과 구분해 남깁니다.</p>
                <WireFormField label="담당 실무자 종합의견" control="textarea">
                  <textarea
                    aria-label="담당 실무자 종합의견"
                    rows={3}
                    value={managerOpinion}
                    onChange={(event) => setManagerOpinion(event.target.value)}
                  />
                </WireFormField>
              </WireCard>
              {/* 연결 일정 완료(CCC-57). 예정 건이 있을 때만 그린다. 없으면 이 카드 자체가
                  없다. 정기 기록지의 '완료할 일정'과 같은 성격이고, 거기와 마찬가지로
                  기본이 켬이라 실무자가 저장 전에 눈으로 보고 끌 수 있어야 한다. */}
              {linkedSchedule === null ? null : (
                <WireCard title={<h3>연결된 상담 일정</h3>} testId="intake-schedule-completion">
                  <p className="panel-meta">
                    이 인테이크로 완료 처리할 예정 일정입니다. 체크를 풀면 일정은 예정 그대로 남습니다.
                  </p>
                  <WireChoice
                    type="checkbox"
                    label={`${formatKoreanDateTime(linkedSchedule.scheduledAt)} 일정을 완료로 표시`}
                    checked={completeSchedule}
                    onChange={setCompleteSchedule}
                  />
                </WireCard>
              )}
            </div>
          ) : null}

          {/* 남은 필수 항목은 콜아웃(안내줄 카드)이다(2026-08-07 Q 11차 "경고 카드 규칙
              사용" — 구 9차 알약 배지 대체: 알약은 읽기 전용 배지 전유물이고 문장이 길다).
              라벤더 = 주의·대기 축(D34). 리스크 레드는 확인된 플래그·오류 전용이라 안 쓴다(D9).
              내용은 A7(2026-08-08)의 "항목 이름까지" 목록이다.

              2026-08-09: 줄 단위 span 을 **진짜 목록**(콜아웃 items 슬롯)으로 바꿨다. 구 방식은
              콜아웃 본문이 p 하나라 ul 을 못 넣어 span[display:block] 으로 흉내 낸 것인데,
              줄 사이가 행간뿐이라 네 단계가 다 비면 한 덩어리로 뭉쳤고 줄바꿈된 둘째 줄이
              번호 아래로 들어가 단계 경계가 사라졌다. 목록은 단계 이름을 굵게 세워
              "어느 단계에 무엇이 남았나"가 한눈에 갈린다. */}
          {!canComplete ? (
            <WireCallout
              tone="lavender"
              role="status"
              testId="intake-missing"
              title="완료하려면 남은 필수 항목을 채우세요"
              items={[
                ...(heldAtMissing ? [<><strong>1. 상담일</strong></>] : []),
                ...missingDetails.map((entry) => (
                  <><strong>{entry.index + 1}. {STEP_TITLES[entry.index]}</strong> {entry.missing.join(', ')}</>
                )),
              ]}
            />
          ) : null}

          <div className="wizard-actions">
            {step > 1 ? <WireButton onClick={() => { setStep(step - 1); setError(null); }}>이전</WireButton> : null}
            {step < STEP_TITLES.length
              ? <WireButton chevron onClick={() => { setStep(step + 1); setError(null); }}>다음: {STEP_TITLES[step]}</WireButton>
              : null}
            <WireButton size="large" disabled={busy || !canComplete} onClick={complete}>{editing ? '저장' : '완료'}</WireButton>
          </div>
        </section>
      </div>
    </main>
  );
}
