import 'virtual:ccc-shared.css';
import './business/business.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, matchRoutes } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { appRoutes } from './app';
import { captureInviteUrlBeforeRender } from './business/auth';

captureInviteUrlBeforeRender(window.location, window.history);
// Router aliases must not bypass the exact-path invitation capture contract.
const pathname = window.location.pathname;
if (pathname !== '/auth/invite' && pathname !== '/staff/join'
  && matchRoutes(appRoutes, { pathname })?.some(({ route }) => route.path === 'auth/invite' || route.path === 'staff/join')) {
  try { window.history.replaceState(window.history.state, '', pathname); }
  finally { throw new Error('invite_bootstrap_invalid'); }
}

const router = createBrowserRouter(appRoutes);
if (import.meta.hot) import.meta.hot.dispose(() => { void router.dispose(); });

const container = document.getElementById('root');
if (container === null) throw new Error('root 요소가 없습니다.');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
