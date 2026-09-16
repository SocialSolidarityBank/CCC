/**
 * notify-workerd.test.ts 가 esbuild 로 묶어 miniflare(workerd) 안에서 돌리는 엔트리.
 * notifyAdmins 를 실제로 호출하고, 웹훅 URL 은 바인딩(WEBHOOK_URL)으로 받는다.
 */
import { notifyAdmins } from '@ccc/core/notify';
import type { CoreSecretStore } from '@ccc/contracts/runtime';

interface TestEnv {
  WEBHOOK_URL: string;
}

export default {
  async fetch(_request: Request, env: TestEnv): Promise<Response> {
    const secretStore: CoreSecretStore = {
      async get(name) {
        return name === 'NOTIFY_WEBHOOK_URL' ? env.WEBHOOK_URL : null;
      },
      async getBytesWithVersion() {
        return null;
      },
    };
    await notifyAdmins({ secretStore }, 'workerd webhook probe');
    return Response.json({ status: 200 });
  },
};
