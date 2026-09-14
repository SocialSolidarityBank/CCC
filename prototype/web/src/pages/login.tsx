import { useState } from 'react';
import { api } from '../lib/api';
import { WireCard } from '../../../../apps/web/app/components/wire/wire-card';
import { WireButton } from '../../../../apps/web/app/components/wire/wire-button';
import { WireFormField } from '../../../../apps/web/app/components/wire/wire-form-field';
import { PageTitle } from '../../../../apps/web/app/components/wire/page-title';

export function LoginPage({ onLogin }: { onLogin: (me: { id: string; role: string; label: string }) => void }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ maxWidth: 400, margin: '15vh auto 0' }}>
      <WireCard title={<PageTitle>로그인</PageTitle>}>
        <form
          className="memory-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              onLogin(await api.login(id, pw));
            } catch (err) {
              setError(err instanceof Error ? err.message : '로그인 실패');
            } finally {
              setBusy(false);
            }
          }}
        >
          <WireFormField label="아이디" required>
            <div className="wire-input-box">
              <input value={id} onChange={(e) => setId(e.target.value)} autoFocus />
            </div>
          </WireFormField>
          <WireFormField label="비밀번호" required error={error || undefined}>
            <div className="wire-input-box">
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
          </WireFormField>
          <WireButton type="submit" variant="primary" disabled={busy}>
            {busy ? '확인 중…' : '로그인'}
          </WireButton>
        </form>
      </WireCard>
    </div>
  );
}
