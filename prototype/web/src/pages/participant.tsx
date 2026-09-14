import { useEffect, useState } from 'react';
import { api, type ParticipantDetail } from '../lib/api';
import { ParticipantHeroCard } from '../../../../apps/web/app/components/wire/participant-hero-card';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireBadge } from '../../../../apps/web/app/components/wire/wire-badge';
import { WireEmpty } from '../../../../apps/web/app/components/wire/wire-state';

const KIND_LABEL: Record<string, string> = { intake: '인테이크', basic: '기본 상담' };

export function ParticipantPage({ participantId, me }: { participantId: string; me: { role: string } }) {
  const [data, setData] = useState<ParticipantDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.participant(participantId).then(setData).catch((e) => setError(e.message));
  }, [participantId]);

  if (error) return <WireCard tone="info">{error}</WireCard>;
  if (!data) return null;

  const pending = data.sessions.filter((s) => s.draft && !s.approved_at);
  const approved = data.sessions.filter((s) => s.approved_at);

  return (
    <>
      <ParticipantHeroCard
        name={data.name || null}
        beneficiaryId={data.participant_id}
        details={[
          { label: 'ID', value: data.participant_id },
          { label: '연락처', value: data.phone || '—', tone: 'mint' },
          { label: '이메일', value: data.email || '—', tone: 'mint' },
          { label: '생년월일', value: data.birth_date || '—' },
        ]}
        actions={
          me.role === 'staff' ? (
            <WireButton variant="primary" href={`#/participants/${participantId}/record`}>
              상담 기록하기
            </WireButton>
          ) : undefined
        }
      />

      {pending.length > 0 && (
        <WireCard tone="lavender" title={`승인 대기 ${pending.length}건`}>
          {pending.map((s) => (
            <div key={s.session_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0' }}>
              <span>{s.occurred_at.slice(0, 10)} · {KIND_LABEL[s.kind] ?? s.kind}</span>
              <WireButton href={`#/sessions/${s.session_id}/review`}>검토</WireButton>
            </div>
          ))}
        </WireCard>
      )}

      <WireCard title="상담 내용 회차별 정리">
        {approved.length === 0 && data.sessions.length === 0 ? (
          <WireEmpty>기록이 없습니다.</WireEmpty>
        ) : (
          data.sessions.map((s) => (
            <div key={s.session_id} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)' }}>{s.occurred_at.slice(0, 10)}</span>
                <WireBadge tone={s.kind === 'intake' ? 'lavender' : 'mint'}>{KIND_LABEL[s.kind] ?? s.kind}</WireBadge>
                {!s.approved_at && <WireBadge tone="neutral">수기·미승인</WireBadge>}
              </div>
              <div style={{ marginTop: 4 }}>
                {s.draft?.one_liner ?? (s.masked_text ? s.masked_text.slice(0, 80) : '처리 전')}
              </div>
            </div>
          ))
        )}
      </WireCard>
    </>
  );
}
