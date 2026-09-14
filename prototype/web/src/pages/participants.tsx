import { useEffect, useState } from 'react';
import { api, type Participant } from '../lib/api';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireFormField } from '../../../../apps/web/app/components/wire/wire-form-field';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';
import { WireEmpty } from '../../../../apps/web/app/components/wire/wire-state';

export function ParticipantsPage({ me }: { me: { id: string; role: string } }) {
  const [list, setList] = useState<Participant[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', birth_date: '' });
  const [error, setError] = useState('');

  const load = () => api.participants().then(setList).catch((e) => setError(e.message));
  useEffect(load, []);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <PageTitle>당사자 목록</PageTitle>
        <WireButton variant="primary" onClick={() => setShowForm((v) => !v)}>
          당사자 등록
        </WireButton>
      </div>
      {error && <WireCard tone="info">{error}</WireCard>}
      {showForm && (
        <WireCard title="당사자 등록">
          <form
            className="memory-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.createParticipant(form);
              setShowForm(false);
              setForm({ name: '', phone: '', email: '', birth_date: '' });
              load();
            }}
          >
            <WireFormField label="이름" required>
              <div className="wire-input-box"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            </WireFormField>
            <WireFormField label="연락처">
              <div className="wire-input-box"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="010-0000-0000" /></div>
            </WireFormField>
            <WireFormField label="이메일">
              <div className="wire-input-box"><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </WireFormField>
            <WireFormField label="생년월일">
              <div className="wire-input-box"><input value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} placeholder="1990-01-01" /></div>
            </WireFormField>
            <WireButton type="submit" variant="primary">등록</WireButton>
          </form>
        </WireCard>
      )}
      {list === null ? null : list.length === 0 ? (
        <WireEmpty>등록된 당사자가 없습니다.</WireEmpty>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {list.map((p) => (
            <a key={p.participant_id} href={`#/participants/${p.participant_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <WireCard>
                <strong style={{ fontSize: 'var(--text-lg)' }}>{p.name || p.participant_id}</strong>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)', marginTop: 4 }}>
                  {p.phone} {p.email && `· ${p.email}`}
                </div>
              </WireCard>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
