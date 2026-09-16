import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import sharedCss from 'virtual:proto-shared-css';
import { api } from './lib/api';
import { Shell } from './components/shell';
import { LoginPage } from './pages/login';
import { ParticipantsPage } from './pages/participants';
import { ParticipantPage } from './pages/participant';
import { RecordPage } from './pages/record';
import { IntakePage } from './pages/intake';
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
  const intakeMatch = route.match(/^\/participants\/([^/]+)\/intake$/);
  const reviewMatch = route.match(/^\/sessions\/([^/]+)\/review$/);
  const newMatch = route === '/participants/new';
  const participantMatch = route.match(/^\/participants\/([^/]+)$/);

  return (
    <Shell route={route} me={me} onLogout={() => setMe(null)}>
      {recordMatch ? (
        <RecordPage participantId={recordMatch[1]} me={me} />
      ) : intakeMatch ? (
        <IntakePage participantId={intakeMatch[1]} me={me} />
      ) : reviewMatch ? (
        <ReviewPage sessionId={reviewMatch[1]} me={me} />
      ) : newMatch ? (
        <ParticipantsPage me={me} register />
      ) : participantMatch ? (
        <ParticipantPage participantId={participantMatch[1]} me={me} />
      ) : (
        <ParticipantsPage me={me} />
      )}
    </Shell>
  );
}

const style = document.createElement('style');
style.textContent = sharedCss;
document.head.appendChild(style);

createRoot(document.getElementById('root')!).render(<App />);
