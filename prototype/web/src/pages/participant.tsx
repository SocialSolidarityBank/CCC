import { useEffect, useState } from 'react';
import { api, type ParticipantDetail, type Session } from '../lib/api';
import { ParticipantHeroCard } from '../../../../apps/web/app/components/wire/participant-hero-card';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireBadge } from '../../../../apps/web/app/components/wire/wire-badge';
import { WireEmpty } from '../../../../apps/web/app/components/wire/wire-state';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';
import { formatLocalDate } from '../lib/datetime';

const KIND_LABEL: Record<string, string> = { intake: '인테이크', basic: '기본 상담' };

const FLAG_LABEL: Record<string, string> = {
  crisis_utterance: '위기 발언',
  contact_loss_risk: '연락 두절 위험',
  housing_livelihood_shock: '주거·생계·건강 급변',
  debt_deterioration: '부채 악화',
  repeated_noncompliance: '약속 불이행 반복',
  violence_exploitation: '폭력·착취 피해',
};

interface FlagItem {
  key: string;
  label: string;
  sessionId: string;
}

interface ActionItem {
  key: string;
  description: string;
  assignee: string;
  due: string;
  sessionId: string;
  occurredAt: string;
}

function collectFlags(sessions: Session[]): FlagItem[] {
  const out: FlagItem[] = [];
  for (const s of sessions) {
    for (const f of (s.form?.flags as string[] | undefined) ?? []) {
      out.push({
        key: `${s.session_id}-staff-${f}`,
        label: FLAG_LABEL[f] ?? f,
        sessionId: s.session_id,
      });
    }
  }
  return out;
}

function collectActions(sessions: Session[]): ActionItem[] {
  const out: ActionItem[] = [];
  for (const s of sessions) {
    const acts = (s.form?.actions as { description?: string; assignee?: string; due?: string }[] | undefined) ?? [];
    acts.forEach((a, i) => {
      if (!a.description?.trim()) return;
      out.push({
        key: `${s.session_id}-${i}`,
        description: a.description,
        assignee: a.assignee ?? '',
        due: a.due ?? '',
        sessionId: s.session_id,
        occurredAt: s.occurred_at,
      });
    });
  }
  return out;
}

function latestOverallGoal(sessions: Session[]): string {
  // 인테이크 폼의 overall_goal이 전체 목표의 출처다. 최신 인테이크부터 본다.
  for (const s of sessions) {
    if (s.kind !== 'intake') continue;
    const goal = s.form?.overall_goal;
    if (typeof goal === 'string' && goal.trim()) return goal;
  }
  return '';
}

function latestQuestions(sessions: Session[]) {
  // AI 제안은 승인된 공식 기록에서만 브리핑에 나온다.
  return sessions.find((s) => s.approved_at && s.draft?.questions?.length)?.draft?.questions ?? [];
}

export function ParticipantPage({ participantId, me }: { participantId: string; me: { role: string } }) {
  const [data, setData] = useState<ParticipantDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.participant(participantId).then(setData).catch((e) => setError(e.message));
  }, [participantId]);

  if (error) return <WireCard tone="info">{error}</WireCard>;
  if (!data) return null;

  const pending = data.sessions.filter((s) => s.draft && !s.approved_at);
  const flags = collectFlags(data.sessions);
  const actions = collectActions(data.sessions);
  const overallGoal = latestOverallGoal(data.sessions);
  const questions = latestQuestions(data.sessions);
  const lastSession = data.sessions[0];

  return (
    <div className="briefing-page">
      <PageTitle>15초 페이지</PageTitle>
      <ParticipantHeroCard
        name={data.name || null}
        beneficiaryId={data.participant_id}
        details={[
          { label: '당사자 ID', value: data.participant_id },
          { label: '연락처', value: data.phone || '없음', tone: 'mint' },
          { label: '이메일', value: data.email || '없음', tone: 'mint' },
          { label: '생년월일', value: data.birth_date || '없음' },
          { label: '기록 현황', value: `${data.sessions.length}회차까지 기록됨` },
          { label: '최근 상담', value: lastSession ? formatLocalDate(lastSession.occurred_at) : '없음' },
          { label: '진행 상태', value: '진행 중' },
        ]}
        actions={
          me.role === 'staff' ? (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <WireButton variant="primary" href={`#/participants/${participantId}/record`}>
                상담 기록하기
              </WireButton>
              <WireButton href={`#/participants/${participantId}/intake`}>
                인테이크 기록
              </WireButton>
            </div>
          ) : undefined
        }
      />

      {flags.length > 0 && (
        <aside className="risk-banner" role="alert" aria-label="리스크 경고">
          <div className="risk-banner-head">
            <svg
              className="risk-banner-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 3 2.5 20h19L12 3Z" />
              <path d="M12 9.5v5" />
              <path d="M12 17.5h.01" />
            </svg>
            <p className="risk-banner-title">리스크 플래그 {flags.length}건</p>
          </div>
          <ul className="risk-banner-list">
            {flags.map((flag) => (
              <li key={flag.key}>
                <div className="risk-banner-item-head">
                  <span className="risk-banner-flag">{flag.label}</span>
                  <span className="panel-meta" style={{ marginLeft: 'auto' }}>
                    실무자 기록 · {formatLocalDate(
                      data.sessions.find((s) => s.session_id === flag.sessionId)?.occurred_at ?? '',
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <WireCard title="전체 목표">
        {overallGoal ? (
          <p style={{ margin: 0 }}>{overallGoal}</p>
        ) : (
          <WireEmpty>설정 전입니다. 인테이크에서 전체 목표를 작성합니다.</WireEmpty>
        )}
      </WireCard>

      {pending.length > 0 && (
        <WireCard tone="lavender" title={`승인 대기 ${pending.length}건`}>
          {pending.map((s) => (
            <div key={s.session_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0' }}>
              <span>{formatLocalDate(s.occurred_at)} · {KIND_LABEL[s.kind] ?? s.kind}</span>
              <WireButton href={`#/sessions/${s.session_id}/review`}>검토</WireButton>
            </div>
          ))}
        </WireCard>
      )}

      <WireCard title="상담 전 꼭 봐야할 내용">
        {questions.length === 0 ? (
          <WireEmpty>AI 제안이 없습니다. 기록을 처리하면 다음 상담 전 확인할 것이 여기에 나옵니다.</WireEmpty>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-3)' }}>
            {questions.map((q, i) => (
              <li key={i} style={{ borderBottom: i < questions.length - 1 ? '1px solid var(--line)' : 'none', paddingBottom: 'var(--space-3)' }}>
                <div style={{ fontWeight: 600 }}>{q.title}</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)', marginTop: 2 }}>{q.reason}</div>
                {q.evidence && (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)', marginTop: 2 }}>
                    근거: {q.evidence}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </WireCard>

      <WireCard title="미해결 액션">
        {actions.length === 0 ? (
          <WireEmpty>등록된 액션이 없습니다.</WireEmpty>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 'var(--space-3)' }}>
            {actions.map((a) => (
              <li key={a.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <span>{a.description}</span>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)' }}>
                  {a.assignee && `담당 ${a.assignee}`}
                  {a.assignee && a.due && ' · '}
                  {a.due && `기한 ${a.due}`}
                  {(a.assignee || a.due) && ' · '}
                  <a href={`#/sessions/${a.sessionId}/review`} style={{ color: 'var(--blue-deep)' }}>
                    {formatLocalDate(a.occurredAt)} 회차
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </WireCard>

      <WireCard title="상담 내용 회차별 정리">
        {data.sessions.length === 0 ? (
          <WireEmpty>기록이 없습니다.</WireEmpty>
        ) : (
          data.sessions.map((s) => (
            <div
              key={s.session_id}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--line)' }}
            >
              <div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)' }}>{formatLocalDate(s.occurred_at)}</span>
                  <WireBadge tone={s.kind === 'intake' ? 'lavender' : 'mint'}>{KIND_LABEL[s.kind] ?? s.kind}</WireBadge>
                  {!s.approved_at && <WireBadge tone="neutral">수기</WireBadge>}
                </div>
                <div style={{ marginTop: 4 }}>
                  {s.approved_at && s.draft
                    ? s.draft.one_liner
                    : s.masked_text
                      ? s.masked_text.slice(0, 80)
                      : '처리 전'}
                </div>
              </div>
              <WireButton href={`#/sessions/${s.session_id}/review`}>보기</WireButton>
            </div>
          ))
        )}
      </WireCard>
    </div>
  );
}
