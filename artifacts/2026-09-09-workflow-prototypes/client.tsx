import React from '../../apps/web/node_modules/react/index.js';
import { hydrateRoot } from '../../apps/web/node_modules/react-dom/client.js';
import { pageComponent } from './prototype-app.tsx';

const root = document.getElementById('prototype-root');
const page = document.body.dataset.prototypePage;
if (root && page) hydrateRoot(root, pageComponent(page));
