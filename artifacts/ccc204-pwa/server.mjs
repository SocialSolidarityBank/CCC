import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const evidence = process.argv[2];
const { snapshot } = JSON.parse(readFileSync(join(evidence, 'runtime-setup.json'), 'utf8'));
const require = createRequire(join(snapshot, 'apps/client/package.json'));
const { preview } = await import(pathToFileURL(require.resolve('vite')));
const server = await preview({
  configFile: join(snapshot, 'apps/client/vite.config.ts'),
  preview: { host: '127.0.0.1', port: 46173, strictPort: true, open: false },
  plugins: [{
    name: 'ccc204-loopback-synthetic-response-probes',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, 'http://127.0.0.1:46173');
        if (!url.pathname.startsWith('/__ccc204_audit__/')) return next();
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.statusCode = url.pathname.endsWith('/denied') ? 401 : 200;
        response.end(JSON.stringify({ synthetic: true, marker: 'ccc204-synthetic-response-canary', authorizationPresent: Boolean(request.headers.authorization) }));
      });
    },
  }],
});
console.log('CCC204_PWA_READY http://127.0.0.1:46173');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.httpServer.close(() => process.exit(0)));
