import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import sharedCss from 'virtual:proto-shared-css';
import { api } from './lib/api';
import { LoginPage } from './pages/login';
import { ParticipantsPage } from './pages/participants';
import { ParticipantPage } from './pages/participant';
import { RecordPage } from './pages/record';
import { ReviewPage } from './pages/review';

function useHashRoute() {
  const [hash, setHash] = useState(location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#/, '') || '/');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

function App() {
  const route = useHashRoute();
  const [me, setMe] = useState<{ id: string; role: string; label: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null)).finally(() => setReady(true));
  }, []);

  if (!ready) return null;
  if (!me) return <LoginPage onLogin={setMe} />;

  const recordMatch = route.match(/^\/participants\/([^/]+)\/record$/);
  const reviewMatch = route.match(/^\/sessions\/([^/]+)\/review$/);
  const participantMatch = route.match(/^\/participants\/([^/]+)$/);

  return (
    <div className="memory-page-stack" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-6)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <a href="#/" style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>
          CCC 프로토타입
        </a>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--sub)' }}>
          {me.label}({me.id})
          <button
            style={{ marginLeft: 12 }}
            onClick={() => api.logout().then(() => setMe(null))}
          >
            로그아웃
          </button>
        </span>
      </header>
      {recordMatch ? (
        <RecordPage participantId={recordMatch[1]} me={me} />
      ) : reviewMatch ? (
        <ReviewPage sessionId={reviewMatch[1]} me={me} />
      ) : participantMatch ? (
        <ParticipantPage participantId={participantMatch[1]} me={me} />
      ) : (
        <ParticipantsPage me={me} />
      )}
    </div>
  );
}

const style = document.createElement('style');
style.textContent = sharedCss;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(<App />);
