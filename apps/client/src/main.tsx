import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import sharedCss from 'virtual:ccc-shared-css';
import { SttTrialPage } from './stt-trial/stt-trial-page';
import { WireEmpty } from '@ccc/web/wire';

const BusinessPage = lazy(() => import('./business/business-page'));
const businessRoute = window.location.pathname === '/settings' || window.location.pathname === '/login';

// 운영 셸과 같은 방식이다. RootLayout 이 <style> 하나에 넣는 것과 같은 문자열, 같은 순서다.
// 색 토큰도 그 문자열 앞머리에 들어 있다(build/shared-styles.mjs 가 정본을 읽는다).
const style = document.createElement('style');
style.textContent = sharedCss;
document.head.append(style);

const container = document.getElementById('root');
if (container === null) throw new Error('root 요소가 없습니다.');

createRoot(container).render(
  <StrictMode>
    {businessRoute ? <Suspense fallback={<WireEmpty>로그인 화면을 불러오고 있습니다.</WireEmpty>}>
      <BusinessPage />
    </Suspense> : <SttTrialPage />}
  </StrictMode>,
);
