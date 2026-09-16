import { useEffect, useState } from 'react';
import { api, type Participant } from '../lib/api';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireFormField } from '../../../../apps/web/app/components/wire/wire-form-field';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';
import { WireEmpty } from '../../../../apps/web/app/components/wire/wire-state';
import { SearchInput } from '../../../../apps/web/app/components/wire/search-input';

export function ParticipantsPage({ me, register = false }: { me: { id: string; role: string }; register?: boolean }) {
  const [list, setList] = useState<Participant[] | null>(null);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', birth_date: '' });
  const [error, setError] = useState('');

  const load = () => { api.participants().then(setList).catch((e) => setError(e.message)); };
  useEffect(load, []);
  if (register && me.role !== 'staff') {
    return (
      <>
        <PageTitle>당사자 등록</PageTitle>
        <WireCard tone="info">실무자만 당사자를 등록할 수 있습니다.</WireCard>
      </>
    );
  }
  if (register) {
    return (
      <>
        <PageTitle>당사자 등록</PageTitle>
        <WireCard>
          <p className="record-writing-help">실제 당사자 정보가 아닌 테스트 데이터만 입력하세요.</p>
          <form
            className="memory-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.createParticipant(form);
              location.hash = '#/participants';
            }}
          >
            <WireFormField label="이름" required>
              <div className="wire-input-box"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
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
      </>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? (list ?? []).filter((p) =>
        [p.name, p.phone, p.email, p.participant_id].some((v) => (v ?? '').toLowerCase().includes(q)),
      )
    : list ?? [];

  return (
    <>
      <PageTitle>당사자 목록</PageTitle>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <SearchInput
            label="검색"
            value={query}
            onChange={setQuery}
            placeholder="이름, 연락처, 이메일, ID"
          />
        </div>
        {me.role === 'staff' && (
          <WireButton variant="primary" href="#/participants/new">당사자 등록</WireButton>
        )}
      </div>
      {error && <WireCard tone="info">{error}</WireCard>}
      {list === null ? null : filtered.length === 0 ? (
        <WireEmpty>{q ? '검색 결과가 없습니다.' : '등록된 당사자가 없습니다.'}</WireEmpty>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-3)', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
          {filtered.map((p) => (
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
