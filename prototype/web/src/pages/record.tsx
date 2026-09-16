import { useState } from 'react';
import { api } from '../lib/api';
import { WireCard, WireCardDetails } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireFormField, WireChoice } from '../../../../apps/web/app/components/wire/wire-form-field';
import { WireBadge } from '../../../../apps/web/app/components/wire/wire-badge';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';
import { ParticipantContext } from '../components/participant-context';
import { localDateTimeInputValue } from '../lib/datetime';
import { DateTimePickerControl } from '../../../../apps/web/app/components/wire/date-picker-control';

const FLAG_TYPES = [
  ['crisis_utterance', '위기 발언'],
  ['contact_loss_risk', '연락 두절 위험'],
  ['housing_livelihood_shock', '주거·생계·건강 급변'],
  ['debt_deterioration', '부채 악화'],
  ['repeated_noncompliance', '약속 불이행 반복'],
  ['violence_exploitation', '폭력·착취 피해'],
] as const;

const LIFE_AREAS = [
  ['economy', '경제·생계'],
  ['housing', '주거'],
  ['employment', '일·고용·학업'],
  ['health', '건강'],
  ['mental_health', '심리·정서'],
  ['family', '가족·관계·돌봄'],
] as const;

const LIFE_STATUS = [
  ['okay', '괜찮음'],
  ['strained', '긴장'],
  ['crisis', '위기'],
  ['not_applicable', '해당없음'],
  ['declined', '답변거부'],
] as const;

const CHANNELS = [
  ['in_person', '대면'],
  ['phone', '전화'],
  ['video', '화상'],
] as const;

interface ActionRow {
  description: string;
  assignee: string;
  due: string;
}

export function RecordPage({ participantId, me }: { participantId: string; me: { role: string } }) {
  const [occurredAt, setOccurredAt] = useState(localDateTimeInputValue);
  const [channel, setChannel] = useState('in_person');
  const [sessionGoals, setSessionGoals] = useState<string[]>(['']);
  const [memo, setMemo] = useState('');
  const [lifeStatus, setLifeStatus] = useState<Record<string, string>>({});
  const [lifeNotes, setLifeNotes] = useState<Record<string, string>>({});
  const [safetyNote, setSafetyNote] = useState('');
  const [flags, setFlags] = useState<string[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([{ description: '', assignee: '', due: '' }]);
  const [changeSinceLast, setChangeSinceLast] = useState('');
  const [opinion, setOpinion] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (me.role !== 'staff') {
    return <WireCard tone="info">실무자만 기록을 작성할 수 있습니다.</WireCard>;
  }

  const hasCrisis = Object.values(lifeStatus).includes('crisis');

  function flatten(): string {
    const lines: string[] = [`상담 방식: ${CHANNELS.find(([v]) => v === channel)?.[1] ?? channel}`];
    const goals = sessionGoals.filter((g) => g.trim());
    if (goals.length) lines.push(`이번 상담에서 확인할 것: ${goals.join(' / ')}`);
    if (memo.trim()) lines.push(`수기 메모:\n${memo}`);
    const changed = LIFE_AREAS.filter(([k]) => lifeStatus[k] && lifeStatus[k] !== 'okay');
    if (changed.length) {
      lines.push('생활 영역 변화:');
      for (const [k, label] of changed) {
        const st = LIFE_STATUS.find(([v]) => v === lifeStatus[k])?.[1] ?? lifeStatus[k];
        lines.push(`  ${label}: ${st}${lifeNotes[k] ? `, ${lifeNotes[k]}` : ''}`);
      }
    }
    if (safetyNote.trim()) lines.push(`위기·안전 확인: ${safetyNote}`);
    if (flags.length) lines.push(`리스크 플래그: ${flags.map((f) => FLAG_TYPES.find(([v]) => v === f)?.[1] ?? f).join(', ')}`);
    const acts = actions.filter((a) => a.description.trim());
    if (acts.length) {
      lines.push('새 액션:');
      for (const a of acts) lines.push(`  ${a.description}${a.assignee ? ` (담당 ${a.assignee})` : ''}${a.due ? ` 기한 ${a.due}` : ''}`);
    }
    if (changeSinceLast.trim()) lines.push(`지난 상담 이후 달라진 일: ${changeSinceLast}`);
    if (opinion.trim()) lines.push(`담당 실무자 의견: ${opinion}`);
    return lines.join('\n');
  }

  const requiredItems = [
    { label: '수기 메모', done: memo.trim().length > 0 },
    { label: '상담 일시', done: occurredAt.trim().length > 0 },
    { label: '상담 방식', done: channel.trim().length > 0 },
  ];
  const filledCount = requiredItems.filter((i) => i.done).length;

  return (
    <>
      <PageTitle>상담 기록하기</PageTitle>
      <div className="wire-container rail-grid record-grid" data-grid="true">
        <aside className="record-side" aria-label="작성 진척도">
          <ParticipantContext participantId={participantId} />
          <WireCard
            title={(
              <div className="wire-card-head">
                <span>체크리스트</span>
                <WireBadge tone="lavender">필수 {filledCount}/{requiredItems.length}</WireBadge>
              </div>
            )}
          >
            <ul className="record-rail-list">
              {requiredItems.map((item) => (
                <li key={item.label} data-done={item.done}>
                  <span className="wire-checkbox" data-checked={item.done} aria-hidden="true" />
                  <span>{item.label}</span>
                  <span className="record-rail-state">{item.done ? ' 채움' : ' 남음'}</span>
                </li>
              ))}
            </ul>
            <p className="panel-meta record-writing-help">
              수기 메모 하나만 채워도 저장됩니다.
            </p>
            <div className="record-rail-actions">
              <WireButton type="submit" form="record-form" variant="primary" disabled={busy || !memo.trim()}>
                {busy ? '처리 중… (STT·마스킹·AI 정리)' : '기록 저장·처리'}
              </WireButton>
            </div>
          </WireCard>
        </aside>
        <div className="record-main">
      <form
        id="record-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const session = await api.createSession({
              participant_id: participantId,
              occurred_at: new Date(occurredAt).toISOString(),
              kind: 'basic',
            });
            const fd = new FormData();
            if (audio) fd.append('audio', audio);
            fd.append('text', flatten());
            fd.append(
              'form',
              JSON.stringify({
                channel, session_goals: sessionGoals.filter((g) => g.trim()),
                memo, life_status: lifeStatus, life_notes: lifeNotes,
                safety_note: safetyNote, flags,
                actions: actions.filter((a) => a.description.trim()),
                change_since_last: changeSinceLast, opinion,
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
        {/* 이번 상담에서 확인할 것 */}
        <WireCard title="이번 상담에서 확인할 것">
          {sessionGoals.map((g, i) => (
            <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <span className="wire-input-box" data-control="input" style={{ flex: 1 }}>
                <input
                  type="text"
                  aria-label={`확인할 내용 ${i + 1}`}
                  value={g}
                  placeholder={`확인할 내용 ${i + 1}`}
                  onChange={(e) => setSessionGoals((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                />
              </span>
              {sessionGoals.length > 1 && (
                <button type="button" aria-label={`확인할 내용 ${i + 1} 삭제`} onClick={() => setSessionGoals((prev) => prev.filter((_, j) => j !== i))}>×</button>
              )}
            </div>
          ))}
          <WireButton type="button" variant="neutral" onClick={() => setSessionGoals((prev) => [...prev, ''])}>
            항목 추가
          </WireButton>
        </WireCard>

        {/* 오늘 상담 내용 */}
        <WireCard title="오늘 상담 내용">
          <WireFormField label="수기 메모" required control="textarea"
            hint="사실과 상담 내용을 직접 작성합니다. 저장 즉시 공식 기록입니다.">
            <textarea rows={10} value={memo} onChange={(e) => setMemo(e.target.value)} required />
          </WireFormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <WireFormField label="상담 일시" required htmlFor="record-occurred-at">
              <DateTimePickerControl
                id="record-occurred-at"
                value={occurredAt}
                onChange={setOccurredAt}
                required
                fieldLabel="상담 일시"
              />
            </WireFormField>
            <WireFormField label="상담 방식" control="select">
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </WireFormField>
          </div>
          <WireFormField label="녹음 파일" hint="테스트 녹음만 사용하세요. 원음은 저장되지 않고 처리 뒤 삭제됩니다.">
            <input type="file" accept="audio/*" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
          </WireFormField>
        </WireCard>

        {/* 생활 6영역 변화 확인 */}
        <WireCard title="생활 6영역 변화 확인">
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)', marginBottom: 'var(--space-3)' }}>
            기본값은 '괜찮음'입니다. 달라진 영역만 상태를 선택하세요.
          </p>
          {LIFE_AREAS.map(([key, label]) => (
            <div key={key} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, minWidth: 110 }}>{label}</span>
                {LIFE_STATUS.map(([v, l]) => (
                  <WireChoice
                    key={v}
                    type="radio"
                    name={`life_${key}`}
                    label={l}
                    checked={(lifeStatus[key] ?? 'okay') === v}
                    onChange={() => setLifeStatus((prev) => ({ ...prev, [key]: v }))}
                  />
                ))}
              </div>
              {lifeStatus[key] && lifeStatus[key] !== 'okay' && (
                <span className="wire-input-box" data-control="input" style={{ marginTop: 'var(--space-2)', display: 'block' }}>
                  <input
                    type="text"
                    placeholder="한 줄 메모"
                    value={lifeNotes[key] ?? ''}
                    onChange={(e) => setLifeNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </span>
              )}
            </div>
          ))}
        </WireCard>

        {/* '위기' 선택 시 위기와 안전 확인을 자동으로 펼친다. */}
        <WireCardDetails
          title="위기·안전 확인"
          open={hasCrisis || undefined}
          badge={hasCrisis ? <WireBadge tone="risk">확인 필요</WireBadge> : undefined}
        >
          {hasCrisis && (
            <p className="record-writing-help" style={{ color: 'var(--risk)', margin: 0 }}>
              6영역에서 '위기'를 선택했습니다. 안전 확인 내용을 적어 두세요.
            </p>
          )}
          <WireFormField label="위기·안전 확인 내용" control="textarea"
            hint="당사자의 안전과 관련해 확인한 사실을 그대로 적습니다. 판단이나 진단은 적지 않습니다.">
            <textarea rows={4} value={safetyNote} onChange={(e) => setSafetyNote(e.target.value)} />
          </WireFormField>
        </WireCardDetails>

        {/* 리스크 플래그 */}
        <WireCardDetails title="리스크 플래그" badge={<WireBadge>조건부</WireBadge>}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)', marginBottom: 'var(--space-2)' }}>
            사전 정의된 유형만 실무자가 직접 표시합니다.
          </p>
          <div className="wire-choice-group" data-layout="stack">
            {FLAG_TYPES.map(([v, l]) => (
              <WireChoice
                key={v}
                type="checkbox"
                label={l}
                checked={flags.includes(v)}
                onChange={(c) => setFlags((prev) => (c ? [...prev, v] : prev.filter((f) => f !== v)))}
              />
            ))}
          </div>
        </WireCardDetails>

        {/* 새 액션 · 다음 만남 */}
        <WireCardDetails title="새 액션 · 다음 만남">
          {actions.map((a, i) => (
            <div key={i} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
              <span className="wire-input-box" data-control="input" style={{ flex: '2 1 220px', minWidth: 0 }}>
                <input type="text" aria-label={`액션 ${i + 1} 내용`} placeholder="액션 내용" value={a.description}
                  onChange={(e) => setActions((prev) => prev.map((r, j) => (j === i ? { ...r, description: e.target.value } : r)))} />
              </span>
              <span className="wire-input-box" data-control="input" style={{ flex: '1 1 120px', minWidth: 0 }}>
                <input type="text" aria-label={`액션 ${i + 1} 담당`} placeholder="담당" value={a.assignee}
                  onChange={(e) => setActions((prev) => prev.map((r, j) => (j === i ? { ...r, assignee: e.target.value } : r)))} />
              </span>
              <span className="wire-input-box" data-control="input" style={{ flex: '1 1 150px', minWidth: 0 }}>
                <input type="date" aria-label={`액션 ${i + 1} 기한`} value={a.due}
                  onChange={(e) => setActions((prev) => prev.map((r, j) => (j === i ? { ...r, due: e.target.value } : r)))} />
              </span>
              {actions.length > 1 && (
                <button type="button" aria-label={`액션 ${i + 1} 삭제`} onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}>×</button>
              )}
            </div>
          ))}
          <WireButton type="button" variant="neutral" onClick={() => setActions((prev) => [...prev, { description: '', assignee: '', due: '' }])}>
            액션 추가
          </WireButton>
          <WireFormField label="지난 상담 이후 달라진 일">
            <input type="text" value={changeSinceLast} onChange={(e) => setChangeSinceLast(e.target.value)} />
          </WireFormField>
        </WireCardDetails>

        {/* 담당 실무자 의견 */}
        <WireCard title="담당 실무자 의견">
          <WireFormField label="종합 판단" control="textarea"
            hint="실무자의 종합 판단을 당사자 발언과 구분해 남깁니다.">
            <textarea rows={4} value={opinion} onChange={(e) => setOpinion(e.target.value)} />
          </WireFormField>
        </WireCard>

        {error && <p style={{ color: 'var(--risk)', fontSize: 'var(--text-sm)' }}>{error}</p>}
      </form>
        </div>
      </div>
    </>
  );
}
