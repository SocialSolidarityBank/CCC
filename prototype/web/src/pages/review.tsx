import { useEffect, useState } from 'react';
import { api, type Session } from '../lib/api';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireBadge } from '../../../../apps/web/app/components/wire/wire-badge';
import { WireCallout, WireQuote } from '../../../../apps/web/app/components/wire/wire-callout';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';
import { formatLocalDateTime } from '../lib/datetime';

const FLAG_LABEL: Record<string, string> = {
  crisis_utterance: '위기 발언',
  contact_loss_risk: '연락 두절 위험',
  housing_livelihood_shock: '주거·생계·건강 급변',
  debt_deterioration: '부채 악화',
  repeated_noncompliance: '약속 불이행 반복',
  violence_exploitation: '폭력·착취 피해',
};

export function ReviewPage({ sessionId, me }: { sessionId: string; me: { role: string } }) {
  const [session, setSession] = useState<Session | null>(null);
  const [participantName, setParticipantName] = useState('');
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    // 세션은 participant 상세에서만 읽히므로 목록에서 찾는다.
    api.participants().then(async (ps) => {
      for (const p of ps) {
        const detail = await api.participant(p.participant_id);
        const found = detail.sessions.find((s) => s.session_id === sessionId);
        if (found) {
          setSession(found);
          setParticipantName(detail.name);
          setApproved(Boolean(found.approved_at));
          return;
        }
      }
      setError('회차를 찾을 수 없습니다');
    }).catch((e) => setError(e.message));
  }, [sessionId]);

  if (error) return <WireCard tone="info">{error}</WireCard>;
  if (!session) return null;
  const draft = session.draft;

  return (
    <>
      <PageTitle>기록 검토</PageTitle>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)' }}>
        당사자 {participantName || session.participant_id}, {formatLocalDateTime(session.occurred_at)}, 작성자 {session.author}
        {approved && <WireBadge tone="mint" className="ml-2">AI 정리 승인됨</WireBadge>}
      </div>

      {session.masked_text && (
        <WireCard title="가림 처리된 원문">
          <pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', fontSize: 'var(--text-sm)', margin: 0 }}>
            {session.masked_text}
          </pre>
        </WireCard>
      )}

      {!draft && (
        <WireCallout
          tone="lavender"
          title={session.masked_text || session.form_json ? 'AI 정리를 만들지 못했습니다' : '기록 처리를 마치지 못했습니다'}
        >
          {session.masked_text || session.form_json
            ? '수기 기록은 저장되었습니다. 다시 처리하려면 당사자 페이지에서 새 기록을 작성하세요.'
            : '저장된 상담 내용이 없습니다. 당사자 페이지에서 기록을 다시 작성하세요.'}
        </WireCallout>
      )}

      {draft && (
        <>
          <WireCard title="핵심 한 줄">
            <p style={{ margin: 0, fontSize: 'var(--text-md)' }}>{draft.one_liner}</p>
          </WireCard>

          <WireCard title="정리">
            {draft.claims.goal_discussions.length > 0 && (
              <Section title="목표 관련 논의" items={draft.claims.goal_discussions} />
            )}
            {draft.claims.other_topics.length > 0 && (
              <Section title="주요 내용" items={draft.claims.other_topics} />
            )}
            {draft.claims.promises.length > 0 && (
              <Section title="약속·할 일" items={draft.claims.promises} />
            )}
          </WireCard>

          {draft.questions.length > 0 && (
            <WireCard title="다음 상담 전 확인할 것">
              {draft.questions.map((q, i) => (
                <div key={i} style={{ padding: 'var(--space-2) 0' }}>
                  <strong>{q.title}</strong>
                  <p style={{ margin: '4px 0', fontSize: 'var(--text-sm)', color: 'var(--sub)' }}>{q.reason}</p>
                  <WireQuote>{q.evidence}</WireQuote>
                </div>
              ))}
            </WireCard>
          )}

          {draft.flag_suggestions.length > 0 && (
            <WireCallout tone="info" title="리스크 플래그 제안">
              {draft.flag_suggestions.map((f, i) => (
                <div key={i} style={{ padding: 'var(--space-2) 0' }}>
                  <WireBadge tone="risk">{FLAG_LABEL[f.flag_type] ?? f.flag_type}</WireBadge>
                  <WireQuote>{f.quote}</WireQuote>
                </div>
              ))}
            </WireCallout>
          )}
        </>
      )}

      {!approved && draft && me.role === 'staff' && (
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <WireButton
            variant="primary"
            onClick={async () => {
              await api.approve(sessionId);
              setApproved(true);
            }}
          >
            AI 정리 승인
          </WireButton>
          <WireButton href={`#/participants/${session.participant_id}`}>돌아가기</WireButton>
        </div>
      )}
      {(approved || !draft) && (
        <WireButton href={`#/participants/${session.participant_id}`}>당사자 페이지로</WireButton>
      )}
    </>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--sub)', marginBottom: 4 }}>{title}</div>
      <ul className="wire-bullets" style={{ margin: 0 }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}
