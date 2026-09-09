import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import {
  WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField,
} from '@ccc/web/wire';
import { type BusinessError, safeError } from '../business/errors';
import {
  INTAKE_RESPONSES, INTAKE_RESPONSE_LABELS, INTAKE_STEPS, INTAKE_TABLES,
  type IntakeQuestion, type IntakeResponse, type IntakeTableName,
} from '../business/intake-form';
import type { IntakeContext, IntakeTableRow } from '../business/intake';
import type { Session } from '../business/session';

type AnswerDraft = Record<string, { response: IntakeResponse; text: string }>;
type TableDraft = Record<IntakeTableName, IntakeTableRow[]>;

const TABLE_NAMES: readonly IntakeTableName[] = ['debts', 'linkedOrgs', 'additionalItems'];
const EXTENDED_PII_LABELS: Record<'birthDate' | 'region' | 'emergencyContact' | 'gender', string> = {
  birthDate: '생년월일', region: '주소 또는 거주지역', emergencyContact: '긴급 연락처', gender: '성별',
};

function emptyTables(): TableDraft {
  return { debts: [], linkedOrgs: [], additionalItems: [] };
}

function QuestionField({ question, draft, disabled, onChange }: {
  question: IntakeQuestion;
  draft: { response: IntakeResponse; text: string };
  disabled: boolean;
  onChange: (next: { response: IntakeResponse; text: string }) => void;
}) {
  const answerId = `intake-${question.key}`;
  return <>
    {question.options === undefined
      ? <WireFormField label={question.label} htmlFor={answerId} hint={question.hint}
        control={question.long === true ? 'textarea' : 'input'}>
        {question.long === true
          ? <textarea id={answerId} rows={3} value={draft.text} disabled={disabled || draft.response !== 'answered'}
            onChange={(event) => onChange({ response: 'answered', text: event.target.value })} />
          : <input id={answerId} value={draft.text} disabled={disabled || draft.response !== 'answered'}
            onChange={(event) => onChange({ response: 'answered', text: event.target.value })} />}
      </WireFormField>
      : <WireFormField label={question.label} htmlFor={answerId} control="select" hint={question.hint}>
        <select id={answerId} value={draft.response === 'answered' ? draft.text : ''}
          disabled={disabled || draft.response !== 'answered'}
          onChange={(event) => onChange({ response: 'answered', text: event.target.value })}>
          <option value="">고르세요</option>
          {question.options.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </WireFormField>}
    <WireFormField label={`${question.label} 응답 종류`} htmlFor={`${answerId}-response`} control="select">
      <select id={`${answerId}-response`} value={draft.response} disabled={disabled}
        onChange={(event) => onChange({
          response: event.target.value as IntakeResponse,
          text: event.target.value === 'answered' ? draft.text : '',
        })}>
        {INTAKE_RESPONSES.map((response) => (
          <option key={response} value={response}>{INTAKE_RESPONSE_LABELS[response]}</option>
        ))}
      </select>
    </WireFormField>
  </>;
}

function TableEditor({ name, rows, disabled, onChange }: {
  name: IntakeTableName; rows: IntakeTableRow[]; disabled: boolean; onChange: (next: IntakeTableRow[]) => void;
}) {
  const table = INTAKE_TABLES[name];
  const columns = [table.required, ...table.optional];
  return <WireCardSection title={table.title}>
    <p className="wire-section-value">{table.hint}</p>
    {rows.length === 0 && <WireEmpty>적을 내용이 없으면 비워 둡니다.</WireEmpty>}
    {rows.map((row, index) => <WireCardSection key={`${name}-${index}`} title={`${index + 1}번째 줄`}>
      {columns.map((column) => <WireFormField key={column.key} label={column.label}
        htmlFor={`${name}-${index}-${column.key}`}>
        <input id={`${name}-${index}-${column.key}`} value={row[column.key] ?? ''} disabled={disabled}
          onChange={(event) => onChange(rows.map((entry, position) => (
            position === index ? { ...entry, [column.key]: event.target.value } : entry)))} />
      </WireFormField>)}
      <div className="business-actions">
        <WireButton variant="neutral" disabled={disabled}
          onClick={() => onChange(rows.filter((_, position) => position !== index))}>줄 삭제</WireButton>
      </div>
    </WireCardSection>)}
    <div className="business-actions">
      <WireButton variant="neutral" disabled={disabled}
        onClick={() => onChange([...rows, {}])}>{`${table.title} 줄 추가`}</WireButton>
    </div>
  </WireCardSection>;
}

export function IntakeScreen() {
  const session = useOutletContext<Session>();
  const navigate = useNavigate();
  const { beneficiaryId = '', supportCaseId = '' } = useParams();
  const [context, setContext] = useState<IntakeContext | null>(null);
  const [step, setStep] = useState(0);
  const [heldAt, setHeldAt] = useState('');
  const [answers, setAnswers] = useState<AnswerDraft>({});
  const [tables, setTables] = useState<TableDraft>(emptyTables);
  const [managerOpinion, setManagerOpinion] = useState('');
  const [extendedPii, setExtendedPii] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'created' | 'replayed' | 'updated' | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);
  // 재전송해도 인테이크가 두 번 생기지 않도록 이 폼 한 벌이 같은 제출 ID를 계속 쓴다.
  const submissionId = useMemo(() => crypto.randomUUID(), []);

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    void session.intake.context(supportCaseId).then((value) => {
      if (own !== generation.current) return;
      setContext(value);
      setAnswers((current) => {
        if (Object.keys(current).length > 0) return current;
        const next: AnswerDraft = {};
        for (const answer of value.saved?.answers ?? []) {
          next[answer.key] = { response: answer.response, text: answer.text ?? '' };
        }
        return next;
      });
      setTables((current) => (value.saved === null || current.debts.length + current.linkedOrgs.length
        + current.additionalItems.length > 0
        ? current
        : { debts: value.saved.debts, linkedOrgs: value.saved.linkedOrgs, additionalItems: value.saved.additionalItems }));
      setManagerOpinion((current) => (current === '' ? value.saved?.managerOpinion ?? '' : current));
      setHeldAt((current) => current);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session.intake, session.auth, supportCaseId]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const answerOf = (key: string) => answers[key] ?? { response: 'answered' as IntakeResponse, text: '' };

  const submit = async () => {
    if (busy || context === null || heldAt === '') return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const submission = {
        submissionId,
        heldAt: new Date(heldAt).toISOString(),
        answers: Object.entries(answers).map(([key, value]) => ({
          key, response: value.response, ...(value.response === 'answered' ? { text: value.text } : {}),
        })),
        tables,
        managerOpinion,
        ...(context.schedule === null
          ? {}
          : { schedule: { id: context.schedule.id, expectedVersion: context.schedule.version } }),
        extendedPii,
      };
      if (context.hasIntake) {
        await session.intake.update(supportCaseId, submission);
        setSaved('updated');
      } else {
        const result = await session.intake.create(supportCaseId, submission);
        setSaved(result.replayed ? 'replayed' : 'created');
      }
      load();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && context === null) {
    return <WireCard>
      <WireError>{error.message}</WireError>
      <div className="business-actions"><WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton></div>
    </WireCard>;
  }
  if (context === null) return <WireCard><WireEmpty live reserve>인테이크 화면을 불러오고 있습니다.</WireEmpty></WireCard>;

  const current = INTAKE_STEPS[step]!;
  const base = `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;

  return <WireCard title={context.hasIntake ? '인테이크 확인과 수정' : '인테이크 기록'}>
    {error && <WireError>{error.message}</WireError>}
    {saved !== null && <WireCallout tone="info" title={saved === 'updated' ? '수정했습니다' : '저장했습니다'}>
      {saved === 'replayed'
        ? '같은 제출을 다시 보냈고 서버가 기존 인테이크를 그대로 돌려줬습니다. 회차가 두 번 생기지 않았습니다.'
        : '저장 즉시 공식 기록입니다. AI 정리는 이 기록을 대신하지 않습니다.'}
    </WireCallout>}
    <WireDataRows>
      <WireDataRow label="당사자" value={context.participant.name ?? context.beneficiaryId} />
      <WireDataRow label="연락처" value={context.participant.phone ?? '등록되지 않음'} />
      <WireDataRow label="이메일" value={context.participant.email ?? '등록되지 않음'} />
      <WireDataRow label="상담 회차" value={`${context.sessionSequence}회차`} />
      <WireDataRow label="동의"
        value={`개인정보 ${context.consent.privacy ? '받음' : '없음'}, AI 녹취기록 ${context.consent.recordingAi ? '받음' : '없음'}`} />
      <WireDataRow label="전체 목표" value={context.overallGoal ?? '설정 전'} />
    </WireDataRows>
    <div className="business-actions">
      {INTAKE_STEPS.map((entry, index) => <WireButton key={entry.part} variant="neutral" disabled={busy}
        onClick={() => setStep(index)}>
        {`${entry.part}. ${entry.title}`}
      </WireButton>)}
      <WireBadge tone="lavender">{`${current.part} / 4 단계`}</WireBadge>
    </div>
    <form className="business-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <WireCardSection title={`${current.part}. ${current.title}`}>
        <p className="wire-section-value">{current.description}</p>
      </WireCardSection>
      {current.part === 1 && <WireCardSection title="1-1. 당사자 기본정보">
        <p className="wire-section-value">이름과 연락처는 당사자 등록 화면에서 관리합니다. 여기서는 금고에 저장할 추가 정보만 적습니다.</p>
        {(Object.keys(EXTENDED_PII_LABELS) as Array<keyof typeof EXTENDED_PII_LABELS>).map((field) => (
          <WireFormField key={field} label={EXTENDED_PII_LABELS[field]} htmlFor={`intake-pii-${field}`}
            hint={context.extendedPii[field] === null ? undefined : `현재 값: ${context.extendedPii[field]}`}>
            <input id={`intake-pii-${field}`} value={extendedPii[field] ?? ''} disabled={busy || context.hasIntake}
              onChange={(event) => setExtendedPii({ ...extendedPii, [field]: event.target.value })} />
          </WireFormField>
        ))}
      </WireCardSection>}
      {current.part === 1 && <WireFormField label="상담일시" htmlFor="intake-held-at" required
        hint="이 기기의 시간대로 입력합니다">
        <input id="intake-held-at" type="datetime-local" value={heldAt} required disabled={busy}
          onChange={(event) => setHeldAt(event.target.value)} />
      </WireFormField>}
      {current.sections.map((section) => <WireCardSection key={section.id} title={section.title}>
        {section.questions.map((question) => <QuestionField key={question.key} question={question}
          draft={answerOf(question.key)} disabled={busy}
          onChange={(next) => setAnswers({ ...answers, [question.key]: next })} />)}
      </WireCardSection>)}
      {current.part === 2 && <TableEditor name="debts" rows={tables.debts} disabled={busy}
        onChange={(rows) => setTables({ ...tables, debts: rows })} />}
      {current.part === 3 && <TableEditor name="linkedOrgs" rows={tables.linkedOrgs} disabled={busy}
        onChange={(rows) => setTables({ ...tables, linkedOrgs: rows })} />}
      {current.part === 4 && <TableEditor name="additionalItems" rows={tables.additionalItems} disabled={busy}
        onChange={(rows) => setTables({ ...tables, additionalItems: rows })} />}
      {current.part === 4 && <WireFormField label="담당 실무자 종합의견" htmlFor="intake-manager-opinion" control="textarea">
        <textarea id="intake-manager-opinion" rows={4} value={managerOpinion} disabled={busy}
          onChange={(event) => setManagerOpinion(event.target.value)} />
      </WireFormField>}
      <div className="business-actions">
        {step > 0 && <WireButton variant="neutral" disabled={busy} onClick={() => setStep(step - 1)}>이전 단계</WireButton>}
        {step < INTAKE_STEPS.length - 1
          && <WireButton variant="neutral" disabled={busy} onClick={() => setStep(step + 1)}>다음 단계</WireButton>}
        <WireButton type="submit" variant="primary" disabled={busy || heldAt === ''}>
          {context.hasIntake ? '인테이크 수정 저장' : '인테이크 저장'}
        </WireButton>
      </div>
    </form>
    {context.schedule !== null && <WireCallout tone="info" title="예정된 일정에 연결합니다">
      {`저장하면 ${context.schedule.scheduledAt} 일정을 이 회차로 넘깁니다.`}
    </WireCallout>}
    <div className="business-actions">
      <WireButton variant="neutral" href={`${base}/records`}>상담 기록 확인하기</WireButton>
      <WireButton variant="neutral" onClick={() => { void navigate(`${base}/briefing`); }}>15초 페이지</WireButton>
    </div>
  </WireCard>;
}
