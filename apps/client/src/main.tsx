import 'virtual:ccc-shared.css';
import './business/business.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { appRoutes } from './app';

const router = createBrowserRouter(appRoutes);
if (import.meta.hot) import.meta.hot.dispose(() => { void router.dispose(); });

const container = document.getElementById('root');
if (container === null) throw new Error('root 요소가 없습니다.');

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
