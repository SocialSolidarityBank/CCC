import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { wireStyles } from '@ccc/web/wire-styles';
import { composeSharedCss, repoRoot } from './build/shared-styles.mjs';
import { trialFixtures } from './build/trial-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// 공유 CSS 는 가상 모듈 하나로 들어온다. 문자열을 그대로 <style> 에 넣는 방식은
// apps/web 의 RootLayout 과 같아서 캐스케이드가 운영과 어긋나지 않는다.
const SHARED_CSS_ID = 'virtual:ccc-shared-css';
const RESOLVED_SHARED_CSS_ID = `\0${SHARED_CSS_ID}`;

// 내부 시험 API 는 같은 origin 이어야 하므로 개발 중에는 로컬 서버로 프록시한다.
// 백엔드 기본 포트는 CCC_STT_TRIAL_PORT=8790 이다.
const localApi = process.env.CCC_STT_LOCAL_API ?? 'http://127.0.0.1:8790';

export default defineConfig({
  root: here,
  oxc: { jsx: { runtime: 'automatic' } },
  // WireButton 이 링크 렌더러 경계를 갖게 되어 next/link alias 와 shim 은 사라졌다.
  // 이 앱은 렌더러를 끼우지 않으므로 기본 <a> 로 렌더된다.
  server: {
    // 로컬 전용. LAN 에 열지 않는다.
    host: '127.0.0.1',
    fs: { allow: [repoRoot] },
    proxy: {
      // 백엔드는 Host 와 Origin 이 자기 원점일 때만 받는다(host_not_allowed, origin_not_allowed).
      // changeOrigin 이 Host 를, headers 가 Origin 을 대상 원점으로 바꾼다. dev 프록시에만 있는
      // 문제이고, 빌드 산출물을 백엔드가 직접 서빙하면 애초에 프록시가 없다.
      //
      // 이 재작성은 백엔드의 출처 검사를 대신 짊어진다. 그래서 아래 origin guard 가 프록시보다
      // 먼저 서서 남의 출처 요청을 막는다. 둘은 한 벌이다. 하나만 두면 안 된다.
      '/internal': {
        target: localApi,
        changeOrigin: true,
        headers: { Origin: localApi },
      },
    },
  },
  plugins: [
    {
      // 프록시보다 먼저 서는 출처 검사. configureServer 본문에서 등록한 미들웨어는
      // Vite 내부 미들웨어(프록시 포함)보다 앞에 선다.
      //
      // 브라우저는 남의 출처에서 온 요청에만 Origin 을 붙인다. 그 Origin 의 host 가 이 개발
      // 서버의 host 와 다르면 프록시가 Origin 을 신뢰값으로 갈아 끼우기 전에 막는다.
      name: 'ccc-internal-origin-guard',
      configureServer(server) {
        server.middlewares.use('/internal', (req, res, next) => {
          const origin = req.headers.origin;
          const host = req.headers.host;
          if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
            let sameOrigin = false;
            try {
              sameOrigin = new URL(origin).host === host;
            } catch {
              sameOrigin = false;
            }
            if (!sameOrigin) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'origin_not_allowed' }));
              return;
            }
          }
          next();
        });
      },
    },
    // 화면 검수용 더미. 환경변수를 켜지 않으면 null 이라 플러그인 목록에서 사라진다.
    // 출처 검사 뒤, 프록시 앞에 선다.
    trialFixtures(process.env.CCC_STT_TRIAL_FIXTURES),
    {
      name: 'ccc-shared-css',
      resolveId(id) {
        return id === SHARED_CSS_ID ? RESOLVED_SHARED_CSS_ID : null;
      },
      load(id) {
        if (id !== RESOLVED_SHARED_CSS_ID) return null;
        return `export default ${JSON.stringify(composeSharedCss(wireStyles))};`;
      },
    },
  ],
});
