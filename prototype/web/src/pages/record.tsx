import { useState } from 'react';
import { api } from '../lib/api';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireFormField } from '../../../../apps/web/app/components/wire/wire-form-field';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';

export function RecordPage({ participantId, me }: { participantId: string; me: { role: string } }) {
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [kind, setKind] = useState('basic');
  const [memo, setMemo] = useState('');
  const [audio, setAudio] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (me.role !== 'staff') {
    return <WireCard tone="info">실무자만 기록을 작성할 수 있습니다.</WireCard>;
  }

  return (
    <>
      <PageTitle>상담 기록하기</PageTitle>
      <WireCard>
        <form
          className="memory-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const session = await api.createSession({
                participant_id: participantId,
                occurred_at: new Date(occurredAt).toISOString(),
                kind,
              });
              const form = new FormData();
              if (audio) form.append('audio', audio);
              if (memo.trim()) form.append('memo', memo);
              await api.process(session.session_id, form);
              location.hash = `#/sessions/${session.session_id}/review`;
            } catch (err) {
              setError(err instanceof Error ? err.message : '처리 실패');
              setBusy(false);
            }
          }}
        >
          <WireFormField label="상담 일시" required>
            <div className="wire-input-box">
              <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
            </div>
          </WireFormField>
          <WireFormField label="상담 유형" required>
            <div className="wire-input-box">
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="basic">기본 상담</option>
                <option value="intake">인테이크</option>
              </select>
            </div>
          </WireFormField>
          <WireFormField label="녹음 파일" hint="테스트 녹음만 사용하세요. 원음은 저장되지 않고 처리 뒤 삭제됩니다.">
            <div className="wire-input-box">
              <input type="file" accept="audio/*" onChange={(e) => setAudio(e.target.files?.[0] ?? null)} />
            </div>
          </WireFormField>
          <WireFormField label="수기 메모" hint="녹음이 없으면 메모만으로 AI 정리가 돌아갑니다.">
            <div className="wire-input-box" data-control="textarea">
              <textarea rows={6} value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          </WireFormField>
          {error && <p style={{ color: 'var(--risk)', fontSize: 'var(--text-sm)' }}>{error}</p>}
          <WireButton type="submit" variant="primary" disabled={busy || (!audio && !memo.trim())}>
            {busy ? '처리 중… (STT·마스킹·AI 정리)' : '기록 처리하기'}
          </WireButton>
        </form>
      </WireCard>
    </>
  );
}
