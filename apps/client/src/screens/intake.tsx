import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import {
  Icon, WireBadge, WireButton, WireCallout, WireCard, WireCardSection, WireChoice, WireDataRow, WireDataRows,
  WireEmpty, WireError, WireFormField,
} from '@ccc/wire';
import {
  INTAKE_AREAS, INTAKE_AREA_LABELS, INTAKE_QUESTIONS, INTAKE_RESPONSE_CODES, INTAKE_SCHEMA_VERSION,
  intakeAnswerDisplayText, requiredIntakeQuestionKeys, type IntakeQuestion, type IntakeQuestionKey,
  type IntakeResponseCode, type IntakeCreateRequest,
} from '@ccc/contracts/intake';
import { CONSENT_DOMAIN_LABELS, CONSENT_STATE_LABELS } from '../business/consent';
import { BusinessError, safeError } from '../business/errors';
import {
  INTAKE_RESPONSE_LABELS, INTAKE_TABLE_FIELDS, buildIntakeQuestionnaire, emptyAnswer, intakeDraft, selectedIntakeAreas,
  type AnswerDraft, type IntakeDraft, type IntakeTableName, type TableDraft,
} from '../business/intake-form';
import type { IntakeContext } from '../business/intake';
import type { Session } from '../business/session';

const CHANNEL_LABELS = { in_person: '대면', phone: '전화', video: '화상' } as const;
const localDateTime = (instant: string) => {
  if (!instant) return '';
  const date = new Date(instant);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1);
};

function QuestionField({ questionKey, draft, disabled, onChange }: {
  questionKey: IntakeQuestionKey; draft: AnswerDraft; disabled: boolean; onChange: (next: AnswerDraft) => void;
}) {
  const question: IntakeQuestion = INTAKE_QUESTIONS[questionKey];
  const id = `intake-${questionKey}`;
  const answered = draft.response === 'answered';
  const choiceLabel = (choice: string) => question.options === INTAKE_AREAS
    ? INTAKE_AREA_LABELS[choice as keyof typeof INTAKE_AREA_LABELS] : choice;
  return <WireCardSection title={question.label}>
    <WireFormField label={`${question.label} 응답 종류`} htmlFor={`${id}-response`} control="select" required>
      <select id={`${id}-response`} value={draft.response} disabled={disabled}
        onChange={(event) => onChange({ ...emptyAnswer(), response: event.target.value as IntakeResponseCode | '' })}>
        <option value="">응답 종류를 고르세요</option>
        {INTAKE_RESPONSE_CODES.map((response) => <option key={response} value={response}>{INTAKE_RESPONSE_LABELS[response]}</option>)}
      </select>
    </WireFormField>
    {question.kind === 'multiple' ? <>
      {(question.options ?? []).map((choice) => <WireChoice key={choice} type="checkbox" id={`${id}-${choice}`}
        label={choiceLabel(choice)} checked={draft.choices.includes(choice)} disabled={disabled || !answered}
        onChange={(checked) => onChange({ ...draft, choices: checked ? [...draft.choices, choice] : draft.choices.filter((value) => value !== choice) })} />)}
    </> : question.kind === 'single' ? <>
      {(question.options ?? []).map((choice) => <WireChoice key={choice} type="radio" name={id} id={`${id}-${choice}`}
        label={choiceLabel(choice)} value={choice} checked={draft.text === choice} disabled={disabled || !answered}
        onChange={() => onChange({ ...draft, text: choice })} />)}
    </> : <WireFormField label={question.label} htmlFor={id} control={question.kind === 'text' ? 'textarea' : 'input'}>
      {question.kind === 'money' ? <input id={id} type="number" inputMode="numeric" min="0" step="1"
        value={draft.amount} disabled={disabled || !answered} onChange={(event) => onChange({ ...draft, amount: event.target.value })} />
        : <textarea id={id} rows={3} maxLength={4000} value={draft.text} disabled={disabled || !answered}
          onChange={(event) => onChange({ ...draft, text: event.target.value })} />}
    </WireFormField>}
  </WireCardSection>;
}

function TableEditor({ name, draft, disabled, readOnly, onChange }: {
  name: IntakeTableName; draft: TableDraft; disabled: boolean; readOnly: boolean; onChange: (next: TableDraft) => void;
}) {
  const table = INTAKE_TABLE_FIELDS[name];
  return <WireCardSection title={table.title}>
    {readOnly ? <WireDataRows><WireDataRow label="응답" value={draft.response === '' ? '기록 없음' : INTAKE_RESPONSE_LABELS[draft.response]} /></WireDataRows>
      : <WireFormField label={`${table.title} 응답 종류`} htmlFor={`intake-${name}-response`} control="select" required>
        <select id={`intake-${name}-response`} value={draft.response} disabled={disabled}
          onChange={(event) => onChange({ response: event.target.value as IntakeResponseCode | '', rows: event.target.value === 'answered' ? [{}] : [] })}>
          <option value="">응답 종류를 고르세요</option>
          {INTAKE_RESPONSE_CODES.map((response) => <option key={response} value={response}>{INTAKE_RESPONSE_LABELS[response]}</option>)}
        </select>
      </WireFormField>}
    {draft.response === 'answered' && draft.rows.map((row, index) => <WireCardSection key={index} title={`${index + 1}번째 줄`}>
      {readOnly ? <WireDataRows>{table.columns.map(([key, label]) => <WireDataRow key={key} label={label} value={row[key] ?? '기록 없음'} />)}</WireDataRows>
        : table.columns.map(([key, label], column) => <WireFormField key={key} label={label} htmlFor={`${name}-${index}-${key}`} required={column === 0}>
          <input id={`${name}-${index}-${key}`} value={row[key] ?? ''} maxLength={4000} disabled={disabled}
            onChange={(event) => onChange({ ...draft, rows: draft.rows.map((entry, position) => position === index ? { ...entry, [key]: event.target.value } : entry) })} />
        </WireFormField>)}
      {!readOnly && <div className="business-actions"><WireButton variant="neutral" disabled={disabled}
        onClick={() => onChange({ ...draft, rows: draft.rows.filter((_, position) => position !== index) })}>줄 삭제</WireButton></div>}
    </WireCardSection>)}
    {!readOnly && draft.response === 'answered' && <div className="business-actions">
      <WireButton variant="neutral" disabled={disabled || draft.rows.length >= 20}
        onClick={() => onChange({ ...draft, rows: [...draft.rows, {}] })}>{table.title} 줄 추가</WireButton>
    </div>}
  </WireCardSection>;
}

// Legacy/history keys and values remain literal, never mapped into the v2 taxonomy.
function storedRows(detailsJson: string | null) {
  let value: unknown;
  try { value = detailsJson === null ? null : JSON.parse(detailsJson); }
  catch { return <WireDataRows><WireDataRow label="저장된 원문" value={detailsJson} /></WireDataRows>; }
  const fields: Array<[string, unknown]> = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value) : [['저장된 원문', value]];
  return <WireDataRows>{fields.map(([key, entry]) => <WireDataRow key={key} label={key}
    value={typeof entry === 'string' ? entry : JSON.stringify(entry)} />)}</WireDataRows>;
}

export function IntakeScreen() {
  const { beneficiaryId = '', supportCaseId = '' } = useParams();
  return <IntakeForm key={`${beneficiaryId}/${supportCaseId}`} beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} />;
}

function IntakeForm({ beneficiaryId, supportCaseId }: { beneficiaryId: string; supportCaseId: string }) {
  const session = useOutletContext<Session>();
  const [context, setContext] = useState<IntakeContext | null>(null);
  const [draft, setDraft] = useState<IntakeDraft>(() => intakeDraft(null));
  const [heldAt, setHeldAt] = useState('');
  const [channel, setChannel] = useState<IntakeCreateRequest['channel']>('in_person');
  const [conversionConfirmed, setConversionConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState<'saved' | 'replayed' | null>(null);
  const [error, setError] = useState<BusinessError | null>(null);
  const generation = useRef(0);
  const submissionId = useMemo(() => crypto.randomUUID(), []);
  const base = `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;

  const load = useCallback(() => {
    const own = ++generation.current;
    setError(null);
    setContext(null);
    void session.intake.context(supportCaseId).then((value) => {
      if (own !== generation.current) return;
      if (value.beneficiaryId !== beneficiaryId) throw new BusinessError('invalid_response');
      setContext(value);
      setDraft(intakeDraft(value.saved?.schemaVersion === 2 ? value.saved.questionnaire : null));
      setHeldAt(value.saved?.heldAt ?? '');
      setChannel(value.saved?.channel ?? 'in_person');
      setConversionConfirmed(false);
      setConflict(false);
    }).catch((cause: unknown) => {
      if (own !== generation.current) return;
      const safe = safeError(cause);
      if (safe.code === 'session_changed') return;
      setError(safe);
      if (safe.status === 401) void session.auth.signOut(safe);
    });
  }, [session, beneficiaryId, supportCaseId]);
  useEffect(() => { load(); return () => { generation.current += 1; }; }, [load]);

  const legacy = context?.saved?.schemaVersion === 1;
  const editable = context?.canWrite === true && (!legacy || conversionConfirmed);
  const areas = selectedIntakeAreas(draft);
  const requiredKeys = requiredIntakeQuestionKeys(areas);
  const submit = async () => {
    if (busyRef.current || !editable || conflict || context === null || heldAt === '') return;
    busyRef.current = true;
    setBusy(true); setError(null); setSaved(null);
    try {
      const common = { schemaVersion: INTAKE_SCHEMA_VERSION, heldAt, channel,
        questionnaire: buildIntakeQuestionnaire(draft, context.moduleSnapshot) };
      const result = context.saved === null
        ? await session.intake.create(supportCaseId, { ...common, submissionId,
          ...(context.schedule === null ? {} : { scheduleId: context.schedule.id, expectedScheduleVersion: context.schedule.version }) })
        : await session.intake.update(supportCaseId, { ...common, expectedRevision: context.saved.revision,
          ...(context.saved.schemaVersion === 1 ? { conversion: { confirmed: true as const, sourceRevision: context.saved.revision } } : {}) });
      setSaved(result.replayed ? 'replayed' : 'saved');
      load();
    } catch (cause) {
      const safe = safeError(cause);
      setError(safe);
      if (safe.status === 409) setConflict(true);
      if (safe.status === 401) void session.auth.signOut(safe);
    } finally { busyRef.current = false; setBusy(false); }
  };

  if (context === null) return <WireCard>{error ? <>
    <WireError>{error.message}</WireError>
    <WireButton variant="neutral" onClick={load}>다시 불러오기</WireButton>
  </> : <WireEmpty live reserve>첫 상담 기록을 불러오고 있어요.</WireEmpty>}</WireCard>;

  const table = (name: IntakeTableName, readOnly: boolean) => <TableEditor name={name} draft={draft.tables[name]}
    disabled={busy || conflict} readOnly={readOnly} onChange={(next) => setDraft({ ...draft, tables: { ...draft.tables, [name]: next } })} />;
  const question = (key: IntakeQuestionKey) => <QuestionField key={key} questionKey={key}
    draft={draft.answers[key] ?? emptyAnswer()} disabled={busy || conflict}
    onChange={(next) => setDraft({ ...draft, answers: { ...draft.answers, [key]: next } })} />;

  return <>
    <WireCard title="첫 상담 기록">
      <p className="wire-section-value">첫 상담 기록(인테이크)은 당사자의 상황과 필요한 도움을 함께 정리하는 기록이에요. 저장 즉시 공식 기록이 돼요.</p>
      {error && <WireError>{error.message}</WireError>}
      {saved && <WireCallout tone="info" title={saved === 'replayed' ? '기존 제출을 확인했어요' : '저장했어요'}>
        수기 기록은 승인 없이 공식 기록으로 남아요.
      </WireCallout>}
      {!context.canWrite && <WireCallout tone="info" title="읽기 전용이에요">저장된 기록을 읽을 수 있어요. 수정은 진행 중인 사례의 담당 실무자만 할 수 있어요.</WireCallout>}
      {conflict && <WireCallout tone="info" title="최신 기록과 다시 맞춰야 해요">
        작성 중인 내용은 화면에 남아 있고 다시 보내지 않아요. 아래 버튼을 누르면 작성 중인 내용 대신 최신 저장본과 사업 설정을 불러와요.
        <div className="business-actions"><WireButton variant="neutral" onClick={load}>작성 내용 대신 최신 기록 불러오기</WireButton></div>
      </WireCallout>}
      <WireDataRows>
        <WireDataRow label="당사자" value={context.participant.name ?? context.beneficiaryId} />
        <WireDataRow label="연락처" value={context.participant.phone ?? '등록되지 않음'} />
        <WireDataRow label="이메일" value={context.participant.email ?? '등록되지 않음'} />
        <WireDataRow label="생년월일" value={context.extendedPii.birthDate ?? '등록되지 않음'} />
        <WireDataRow label="주소 또는 거주지역" value={context.extendedPii.region ?? '등록되지 않음'} />
        <WireDataRow label="긴급 연락처" value={context.extendedPii.emergencyContact ?? '등록되지 않음'} />
        <WireDataRow label="성별" value={context.extendedPii.gender ?? '등록되지 않음'} />
        <WireDataRow label="상담 회차" value={`${context.sessionSequence}회차`} />
        <WireDataRow label="동의" value={context.consent.map((entry) => `${CONSENT_DOMAIN_LABELS[entry.domain]} ${CONSENT_STATE_LABELS[entry.state]}`).join(', ')} />
        <WireDataRow label="장기목표" value={context.overallGoal ?? '설정 전'} />
        <WireDataRow label="현재 사업 모듈" value={context.moduleSnapshot.financialSupportEnabled ? '금융지원 사용' : '금융지원 사용 안 함'} />
        <WireDataRow label="사업 설정 버전" value={String(context.moduleSnapshot.programVersion)} />
        {context.saved && <WireDataRow label="저장된 기록 버전" value={`${context.saved.schemaVersion}형식, 수정 ${context.saved.revision}`} />}
        {context.saved && <WireDataRow label="저장된 상담일시" value={context.saved.heldAt} />}
        {context.saved && <WireDataRow label="저장된 상담 방식" value={CHANNEL_LABELS[context.saved.channel]} />}
      </WireDataRows>
      <div className="business-actions"><WireButton variant="neutral" href={`${base}/records`}>상담 기록</WireButton>
        <WireButton variant="neutral" href={`/participants/${encodeURIComponent(beneficiaryId)}`}>당사자 정보</WireButton></div>
    </WireCard>
    {context.saved?.schemaVersion === 1 && <WireCard title="이전 양식 원본">
      <WireCallout tone="info" title="이전 값은 그대로 보존해요">저장 당시의 항목 이름과 값을 그대로 보여 줘요. 현재 영역이나 위기도로 자동 분류하지 않아요.</WireCallout>
      {storedRows(context.saved.legacyDetailsJson)}
      {context.canWrite && <WireChoice type="checkbox" id="intake-conversion" checked={conversionConfirmed} disabled={busy || conflict}
        label="이전 원본을 보존하고 새 양식에 직접 작성해 전환할 것을 확인했어요" onChange={(checked) => {
          setConversionConfirmed(checked); setDraft(intakeDraft(null));
        }} />}
    </WireCard>}
    {editable && <WireCard title={legacy ? '새 양식으로 전환' : context.saved ? '첫 상담 기록 수정' : '첫 상담 기록 작성'}>
      <form className="business-form" noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <WireFormField label="상담일시" htmlFor="intake-held-at" required hint="이 기기의 시간대로 입력해요">
          <input id="intake-held-at" type="datetime-local" step="0.001" value={localDateTime(heldAt)} disabled={busy || conflict}
            onChange={(event) => setHeldAt(event.target.value === '' ? '' : new Date(event.target.value).toISOString())} />
        </WireFormField>
        <WireFormField label="상담 방식" htmlFor="intake-channel" control="select" required>
          <select id="intake-channel" value={channel} disabled={busy || conflict}
            onChange={(event) => setChannel(event.target.value as IntakeCreateRequest['channel'])}>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </WireFormField>
        <WireCardSection title="공통 질문" action={<WireBadge tone="neutral">{requiredIntakeQuestionKeys([]).length}개 필수</WireBadge>}>
          {requiredIntakeQuestionKeys([]).map(question)}
        </WireCardSection>
        {areas.map((area) => <WireCardSection key={area} title={INTAKE_AREA_LABELS[area]}>
          {requiredKeys.filter((key) => (INTAKE_QUESTIONS[key] as IntakeQuestion).area === area).map(question)}
        </WireCardSection>)}
        {table('linkedOrgs', false)}{table('additionalItems', false)}
        {context.moduleSnapshot.financialSupportEnabled && areas.includes('economy') && table('debts', false)}
        <div className="business-actions"><WireButton type="submit" variant="primary" icon={<Icon name="check" />} disabled={busy || conflict || heldAt === ''}>저장</WireButton></div>
      </form>
    </WireCard>}
    {!editable && context.saved?.schemaVersion === 2 && <WireCard title="저장된 첫 상담 기록">
      <WireDataRows><WireDataRow label="저장 당시 사업 설정 버전" value={String(context.saved.questionnaire.moduleSnapshot.programVersion)} />
        {context.saved.questionnaire.answers.map((answer) => <WireDataRow key={answer.key} label={INTAKE_QUESTIONS[answer.key].label}
          value={answer.response === 'answered' ? intakeAnswerDisplayText(answer) : INTAKE_RESPONSE_LABELS[answer.response]} />)}
      </WireDataRows>
      {table('linkedOrgs', true)}{table('additionalItems', true)}{context.saved.questionnaire.debts !== null && table('debts', true)}
    </WireCard>}
    {context.saved?.history.map((revision) => <WireCard key={revision.revision} title={`이전 기록 ${revision.revision}`}>
      <WireDataRows><WireDataRow label="양식 버전" value={String(revision.schemaVersion)} />
        <WireDataRow label="상담일시" value={revision.heldAt} /><WireDataRow label="상담 방식" value={CHANNEL_LABELS[revision.channel]} />
        <WireDataRow label="기록자" value={revision.actorId ?? '기록 없음'} /><WireDataRow label="기록 시각" value={revision.recordedAt} />
        <WireDataRow label="전환한 원본 수정 번호" value={revision.convertedFromRevision === null ? '해당 없음' : String(revision.convertedFromRevision)} />
      </WireDataRows>{storedRows(revision.detailsJson)}
    </WireCard>)}
  </>;
}
