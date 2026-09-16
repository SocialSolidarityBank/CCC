import { useState } from 'react';
import { api } from '../lib/api';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireFormField, WireChoice } from '../../../../apps/web/app/components/wire/wire-form-field';
import { WireCallout } from '../../../../apps/web/app/components/wire/wire-callout';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';
import { ParticipantContext } from '../components/participant-context';
import { localDateTimeInputValue } from '../lib/datetime';
import { DateTimePickerControl } from '../../../../apps/web/app/components/wire/date-picker-control';
import {
  STEP_GROUPS,
  STEP_TITLES,
  DEBT_COLUMNS,
  LINKED_ORG_COLUMNS,
  ADDITIONAL_COLUMNS,
  type IntakeTableColumn,
} from '../../../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-questions';
import { IntakeStepRail, type IntakeStepRailItem } from '../../../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/intake/intake-step-rail';

type Answers = Record<string, string | string[]>;
type TableRows = Record<string, string>[];

/** 표 반복 행. 첫 행은 항상 보이고, 행 추가로 늘린다. */
function RepeatTable({
  columns,
  rows,
  onChange,
}: {
  columns: readonly IntakeTableColumn[];
  rows: TableRows;
  onChange: (rows: TableRows) => void;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: 'left', padding: 'var(--space-2)', borderBottom: '1px solid var(--line)', fontWeight: 600 }}>
                {c.label}
              </th>
            ))}
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} style={{ padding: 'var(--space-1)', borderBottom: '1px solid var(--line)' }}>
                  <input
                    type="text"
                    aria-label={`${i + 1}행 ${c.label}`}
                    placeholder={c.placeholder}
                    value={row[c.key] ?? ''}
                    onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, [c.key]: e.target.value } : r)))}
                    style={{ width: '100%' }}
                  />
                </td>
              ))}
              <td>
                {rows.length > 1 && (
                  <button type="button" aria-label={`${i + 1}행 삭제`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <WireButton type="button" variant="neutral" onClick={() => onChange([...rows, {}])}>
          행 추가
        </WireButton>
      </div>
    </div>
  );
}
const rowHasValue = (row: Record<string, string>, columns: readonly IntakeTableColumn[]) =>
  columns.some((column) => (row[column.key] ?? '').trim());

export function IntakePage({ participantId, me }: { participantId: string; me: { role: string } }) {
  const [step, setStep] = useState(1);
  const [occurredAt, setOccurredAt] = useState(localDateTimeInputValue);
  const [answers, setAnswers] = useState<Answers>({});
  const [debts, setDebts] = useState<TableRows>([{}]);
  const [linkedOrgs, setLinkedOrgs] = useState<TableRows>([{}]);
  const [additional, setAdditional] = useState<TableRows>([{}]);
  const [overallGoal, setOverallGoal] = useState('');
  const [opinion, setOpinion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  if (me.role !== 'staff') {
    return <WireCard tone="info">실무자만 기록을 작성할 수 있습니다.</WireCard>;
  }

  const set = (key: string, value: string | string[]) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  const toggleMulti = (key: string, option: string, checked: boolean) => {
    const cur = (answers[key] as string[] | undefined) ?? [];
    set(key, checked ? [...cur, option] : cur.filter((o) => o !== option));
  };

  const answered = (v: string | string[] | undefined) =>
    v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

  /** 단계별 채움 수. 추가 필수 1개씩: 1단계 상담일, 2단계 부채 표, 3단계 연계 표, 4단계 종합의견. */
  const stepProgress: IntakeStepRailItem[] = STEP_GROUPS.map((groups, i) => {
    const required = groups.reduce((n, g) => n + g.questions.length, 0) + 1;
    const filledQs = groups.reduce(
      (n, g) => n + g.questions.filter((q) => answered(answers[q.key])).length,
      0,
    );
    const extraDone =
      i === 0 ? occurredAt.trim().length > 0
      : i === 1 ? rowHasValue(debts[0] ?? {}, DEBT_COLUMNS)
      : i === 2 ? rowHasValue(linkedOrgs[0] ?? {}, LINKED_ORG_COLUMNS)
      : opinion.trim().length > 0;
    const filled = filledQs + (extraDone ? 1 : 0);
    const number = i + 1;
    const done = filled >= required;
    const state = submitAttempted && !done
      ? 'missing'
      : step === number ? 'current' : done ? 'done' : 'waiting';
    return {
      countLabel: `${filled}/${required}`,
      ariaCount: `${filled}/${required} 완료`,
      state,
    };
  });

  /** 폼 → AI 재료용 평탄 텍스트. 라벨: 값 한 줄씩. */
  function flatten(): string {
    const lines: string[] = [];
    for (const groups of STEP_GROUPS) {
      for (const group of groups) {
        for (const q of group.questions) {
          const v = answers[q.key];
          if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
          lines.push(`${q.label}: ${Array.isArray(v) ? v.join(', ') : v}`);
        }
      }
    }
    const tableText = (name: string, cols: readonly IntakeTableColumn[], rows: TableRows) => {
      const filled = rows.filter((r) => cols.some((c) => (r[c.key] ?? '').trim()));
      if (!filled.length) return;
      lines.push(`${name}:`);
      for (const r of filled) {
        lines.push('  ' + cols.flatMap((c) => {
          const value = (r[c.key] ?? '').trim();
          return value ? [`${c.label} ${value}`] : [];
        }).join(' | '));
      }
    };
    tableText('대출·부채 현황', DEBT_COLUMNS, debts);
    tableText('현재 연계된 기관·서비스', LINKED_ORG_COLUMNS, linkedOrgs);
    tableText('추가 확인사항', ADDITIONAL_COLUMNS, additional);
    if (overallGoal.trim()) lines.push(`전체 목표: ${overallGoal}`);
    if (opinion.trim()) lines.push(`담당 실무자 종합의견: ${opinion}`);
    return lines.join('\n');
  }

  const firstMissingStep = () => {
    const idx = stepProgress.findIndex((item, i) => {
      const groups = STEP_GROUPS[i];
      const required = groups.reduce((n, g) => n + g.questions.length, 0) + 1;
      return Number(item.countLabel.split('/')[0]) < required;
    });
    return idx === -1 ? null : idx + 1;
  };

  return (
    <>
      <PageTitle>인테이크 기록</PageTitle>
      <WireCallout tone="lavender" title="입력 원칙">
        모든 항목이 필수입니다. 확인되지 않았거나 답하지 않은 항목은 &lsquo;무응답&rsquo;을 고르세요.
      </WireCallout>
      <div className="wire-container rail-grid intake-grid" data-grid="true">
        <IntakeStepRail
          currentStep={step}
          items={stepProgress}
          onSelect={(next) => { setStep(next); setError(''); }}
        />
        <section className="wizard-stack">
          <ParticipantContext participantId={participantId} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSubmitAttempted(true);
              const missing = firstMissingStep();
              if (missing !== null) {
                setStep(missing);
                setError("필수 항목을 모두 작성하세요. 해당 사항이 없으면 '해당 없음' 또는 '무응답'을 선택하거나 입력하세요.");
                return;
              }
              setBusy(true);
              setError('');
              try {
                const session = await api.createSession({
                  participant_id: participantId,
                  occurred_at: new Date(occurredAt).toISOString(),
                  kind: 'intake',
                });
                const fd = new FormData();
                fd.append('text', flatten());
                fd.append(
                  'form',
                  JSON.stringify({
                    answers, debts, linked_orgs: linkedOrgs, additional,
                    overall_goal: overallGoal, opinion,
                  }),
                );
                await api.process(session.session_id, fd);
                location.hash = `#/sessions/${session.session_id}/review`;
              } catch (err) {
                setError(err instanceof Error ? err.message : '처리 실패');
                setBusy(false);
              }
            }}
          >
            {step === 1 && (
              <WireCard title="상담 일시">
                <WireFormField label="상담일" required htmlFor="intake-occurred-at">
                  <DateTimePickerControl
                    id="intake-occurred-at"
                    value={occurredAt}
                    onChange={setOccurredAt}
                    required
                    fieldLabel="상담일"
                  />
                </WireFormField>
              </WireCard>
            )}

            {STEP_GROUPS[step - 1].map((group) => (
              <WireCard key={group.title} title={group.title}>
                {group.questions.map((q) => {
                  if (q.kind === 'select') {
                    return (
                      <WireFormField key={q.key} label={q.label} required control="select" hint={q.hint}>
                        <select
                          value={(answers[q.key] as string) ?? ''}
                          onChange={(e) => set(q.key, e.target.value)}
                        >
                          <option value="">선택</option>
                          {q.options?.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      </WireFormField>
                    );
                  }
                  if (q.kind === 'multi') {
                    return (
                      <WireFormField key={q.key} label={q.label} required hint={q.hint}>
                        <div className="wire-choice-group" data-layout="stack" role="group" aria-label={q.label} aria-required="true">
                          {q.options?.map((o) => (
                            <WireChoice
                              key={o}
                              type="checkbox"
                              label={o}
                              checked={((answers[q.key] as string[]) ?? []).includes(o)}
                              onChange={(c) => toggleMulti(q.key, o, c)}
                            />
                          ))}
                        </div>
                      </WireFormField>
                    );
                  }
                  return (
                    <WireFormField key={q.key} label={q.label} required hint={q.hint}>
                      <input
                        type="text"
                        value={(answers[q.key] as string) ?? ''}
                        onChange={(e) => set(q.key, e.target.value)}
                      />
                    </WireFormField>
                  );
                })}
                {group.title === '2-1. 경제·부채상황' && (
                  <WireFormField label="채무별 상세" hint="채무가 없으면 첫 행에 '해당 없음'을 기입합니다.">
                    <RepeatTable columns={DEBT_COLUMNS} rows={debts} onChange={setDebts} />
                  </WireFormField>
                )}
              </WireCard>
            ))}

            {step === 3 && (
              <WireCard title="3-3. 현재 연계된 기관·서비스">
                <RepeatTable columns={LINKED_ORG_COLUMNS} rows={linkedOrgs} onChange={setLinkedOrgs} />
              </WireCard>
            )}
            {step === 4 && (
              <>
                <WireCard title="4-2. 추가 확인사항">
                  <RepeatTable columns={ADDITIONAL_COLUMNS} rows={additional} onChange={setAdditional} />
                </WireCard>
                <WireCard title="전체 목표">
                  <WireFormField label="전체 목표" hint="당사자와 합의한 이번 사례의 전체 목표 한 줄.">
                    <input type="text" value={overallGoal} onChange={(e) => setOverallGoal(e.target.value)} />
                  </WireFormField>
                </WireCard>
                <WireCard title="담당 실무자 종합의견">
                  <WireFormField label="종합의견" required control="textarea"
                    hint="예: 채무 연체와 주거불안이 동시에 있어 우선순위가 높음.">
                    <textarea rows={4} value={opinion} onChange={(e) => setOpinion(e.target.value)} />
                  </WireFormField>
                </WireCard>
              </>
            )}

            {error && <p role="alert" style={{ color: 'var(--risk)', fontSize: 'var(--text-sm)' }}>{error}</p>}
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
              <WireButton type="button" variant="neutral" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>
                이전
              </WireButton>
              {step < 4 ? (
                <WireButton type="button" variant="primary" onClick={() => setStep((s) => s + 1)}>
                  다음
                </WireButton>
              ) : (
                <WireButton type="submit" variant="primary" disabled={busy}>
                  {busy ? '처리 중… (마스킹·AI 정리)' : '인테이크 저장·처리'}
                </WireButton>
              )}
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
