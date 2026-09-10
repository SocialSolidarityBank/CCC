// PWA 자산 생성 (D80 업무 클라이언트, 2026-09-10).
//
// 프레임워크나 새 의존성 없이 빌드가 직접 만든다. 캐시 목록은 이 빌드가 실제로 낸 파일
// 이름을 그대로 적은 정확한 허용 목록이고, 그 목록에 없는 요청은 워커가 손대지 않는다.
// API, 인증, 설치 정보, 부트스트랩, 개인정보, 원음은 경로와 무관하게 캐시하지 않는다.
//
// 갱신은 사용자가 안전하게 다시 열 때까지 기다린다. skipWaiting 도 강제 새로고침도 없다.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tokensPath = join(here, '..', '..', '..', 'design', 'tokens.css');

/** 아이콘 색은 정본 토큰에서 읽는다. 화면 색값을 새로 정하지 않는다. */
function brandPair() {
  const tokens = readFileSync(tokensPath, 'utf8');
  const match = /--gradient-brand:\s*linear-gradient\(90deg,\s*(#[0-9A-Fa-f]{6})\s*0%,\s*(#[0-9A-Fa-f]{6})\s*100%\)/
    .exec(tokens);
  if (match === null) throw new Error('gradient-brand 토큰을 읽지 못했습니다.');
  return { from: match[1], to: match[2] };
}

function iconSvg() {
  const { from, to } = brandPair();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="192" height="192" rx="36" fill="url(#g)"/>
  <text x="96" y="124" font-family="system-ui, sans-serif" font-size="88" font-weight="600"
    text-anchor="middle" fill="#ffffff">R</text>
</svg>
`;
}

/**
 * 설치 매니페스트. 시작 주소는 업무 진입점이고 내부 시험 화면(`/`)이 아니다.
 * 시험 화면은 범위 안에 있어도 시작 주소로 삼지 않는다.
 */
const manifest = {
  name: 'Relayer',
  short_name: 'Relayer',
  lang: 'ko',
  start_url: '/schedule',
  scope: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#ffffff',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
};

function serviceWorker(assets, version) {
  return `// 빌드가 만든 정적 셸 워커입니다. 손으로 고치지 않습니다.
// 캐시 대상은 아래 목록에 적힌 이 빌드의 정적 파일뿐입니다.
// 업무 API, 인증, 설치 정보, 부트스트랩, 개인정보, 원음은 어떤 경로로 와도 캐시하지 않습니다.

const CACHE = 'ccc-shell-${version}';
const ASSETS = ${JSON.stringify(assets, null, 2)};
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  // skipWaiting 없음. 새 워커는 사용자가 안전하게 다시 열 때까지 대기 상태로 남습니다.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith('ccc-shell-')) await caches.delete(key);
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 화면 이동은 셸 하나로 답합니다. 자료가 아니라 껍데기입니다.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const shell = await caches.match(SHELL);
        if (shell !== undefined) return shell;
        throw new Error('offline');
      }
    })());
    return;
  }

  // 목록에 적힌 정적 파일만 캐시에서 답합니다. 그 밖은 워커가 손대지 않습니다.
  if (!ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const hit = await caches.match(url.pathname);
    return hit ?? fetch(request);
  })());
});
`;
}

/** Vite 플러그인. 빌드에서만 돈다. */
export function pwaAssets() {
  return {
    name: 'ccc-pwa-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      const emitted = Object.values(bundle)
        .map((chunk) => `/${chunk.fileName}`)
        .filter((name) => name.endsWith('.js') || name.endsWith('.css'));
      const assets = ['/index.html', '/manifest.webmanifest', '/icon.svg', ...emitted].sort();
      // 캐시 이름은 이 빌드의 파일 목록에서 나온다. 목록이 같으면 갱신도 없다.
      const version = [...assets.join('|')]
        .reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 0xffffffff, 7)
        .toString(16);
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) });
      this.emitFile({ type: 'asset', fileName: 'icon.svg', source: iconSvg() });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(assets, version) });
    },
  };
}
