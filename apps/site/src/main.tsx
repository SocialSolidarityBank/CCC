import { createRoot } from 'react-dom/client';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import 'virtual:ccc-shared.css';
import configuredBusinessOrigin from 'virtual:ccc-site-config';
import { businessClientOrigin } from './business-origin';
import { WelcomePage } from './welcome-page';

const root = document.getElementById('root');
if (!root) throw new Error('site_root_missing');

createRoot(root).render(
  <WelcomePage loginOrigin={businessClientOrigin(configuredBusinessOrigin, window.location.origin)} />,
);
