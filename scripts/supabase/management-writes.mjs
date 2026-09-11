/**
 * 설치 apply의 Supabase Management API 쓰기. 읽기는 hosted-inspector.mjs가 소유한다.
 *
 * 확인한 계약(https://api.supabase.com/api/v1 의 OpenAPI 문서 https://api.supabase.com/api/v1-json, 2026-09-12):
 * - `POST /v1/projects/{ref}/secrets` (operationId `v1-bulk-create-secrets`): requestBody는
 *   `application/json`의 `CreateSecretBody` = `[{ name, value }]` 배열이다. `maxItems: 100`,
 *   `name`은 `maxLength: 256`이고 pattern이 `^(?!SUPABASE_).*` 이므로 `SUPABASE_`로 시작하는 이름은
 *   공급자가 거부한다. `value`는 `maxLength: 24576`이다. 성공 응답은 201이고 본문 schema가 없다.
 * - `POST /v1/projects/{ref}/functions/deploy` (operationId `v1-deploy-a-function`): query `slug`,
 *   requestBody는 `multipart/form-data`의 `FunctionDeployBody` = 필수 `file`(binary 배열)과 필수
 *   `metadata`(object)이며 `metadata.entrypoint_path`만 필수, `metadata.verify_jwt`·`metadata.name`·
 *   `metadata.import_map_path`·`metadata.static_patterns`는 선택이다. 문서의 example은
 *   `{ file: ['./supabase/functions/hello-world/index.ts'], metadata: { entrypoint_path: 'index.ts', ... } }`로
 *   파일 이름과 entrypoint_path를 같은 이름으로 맞춘다. import map을 쓰지 않으므로 `import_map_path`를 보내지 않는다.
 *   성공 응답은 201의 `DeployFunctionResponse`이며 필수 필드는 `id`, `slug`, `name`, `status`(ACTIVE|REMOVED|THROTTLED),
 *   `version`(integer)이고 `verify_jwt`·`import_map`·`ezbr_sha256`는 선택이다.
 * - `GET /v1/projects/{ref}/functions/{function_slug}`: 같은 함수 필드를 읽는 read-only 관찰용이다.
 *
 * 어떤 경로에서도 secret 값, 응답 본문, URL을 오류나 로그로 내보내지 않는다.
 */
const BASE = 'https://api.supabase.com';
const MAX_SECRETS = 100;
const MAX_SECRET_NAME_LENGTH = 256;
const MAX_SECRET_VALUE_LENGTH = 24_576;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,127}$/u;
const PROJECT_REF = /^[a-z][a-z0-9-]{2,63}$/u;
const SLUG = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const ENTRYPOINT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function requireManagement(management) {
  const fetchImpl = management?.fetch;
  const accessToken = management?.accessToken;
  if (typeof fetchImpl !== 'function' || typeof accessToken !== 'string'
    || accessToken.length === 0 || /[^\x21-\x7e]/u.test(accessToken)) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  return { fetchImpl, accessToken };
}

function requireProjectRef(projectRef) {
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef)) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  return encodeURIComponent(projectRef);
}

async function send(management, path, init, { allowMissing = false } = {}) {
  const { fetchImpl, accessToken } = requireManagement(management);
  let response;
  try {
    response = await fetchImpl(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${accessToken}`, ...init.headers },
    });
  } catch {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  if (allowMissing && response.status === 404) return null;
  if (response.status !== 200 && response.status !== 201) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  return response;
}

async function jsonBody(response) {
  try {
    return await response.json();
  } catch {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
}

function requireFunctionPayload(payload, slug) {
  if (typeof payload?.id !== 'string' || payload.id.length === 0 || payload.id.length > 256
    || payload.slug !== slug || payload.status !== 'ACTIVE'
    || !Number.isSafeInteger(payload.version) || payload.version < 1
    || payload.verify_jwt !== false || payload.import_map === true) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  return { id: payload.id, slug, version: payload.version, status: payload.status };
}

/** 주입받은 이름/값만 묶는다. 값은 반환하지도 기록하지도 않는다. */
export async function bindEdgeSecrets({ management, projectRef, secrets }) {
  const ref = requireProjectRef(projectRef);
  if (!Array.isArray(secrets) || secrets.length === 0 || secrets.length > MAX_SECRETS) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  const body = [];
  for (const secret of secrets) {
    const name = secret?.name;
    const value = secret?.value;
    if (typeof name !== 'string' || name.length > MAX_SECRET_NAME_LENGTH || !SECRET_NAME.test(name)
      || name.startsWith('SUPABASE_')
      || typeof value !== 'string' || value.length === 0 || value.length > MAX_SECRET_VALUE_LENGTH) {
      throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
    }
    body.push({ name, value });
  }
  const names = body.map(entry => entry.name);
  if (new Set(names).size !== names.length) throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  await send(management, `/v1/projects/${ref}/secrets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return [...names].sort();
}

/** staged bytes만 배포한다. verify_jwt=false가 응답으로 확인되지 않으면 실패로 닫는다. */
export async function deployEdgeFunction({
  management, projectRef, slug, functionName, entrypointPath, bytes,
}) {
  const ref = requireProjectRef(projectRef);
  if (typeof slug !== 'string' || !SLUG.test(slug)
    || typeof functionName !== 'string' || functionName.length === 0 || functionName.length > 128
    || typeof entrypointPath !== 'string' || !ENTRYPOINT.test(entrypointPath)
    || !(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  const metadata = {
    entrypoint_path: entrypointPath,
    name: functionName,
    verify_jwt: false,
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([bytes], { type: 'application/javascript' }), entrypointPath);
  const response = await send(
    management,
    `/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    { method: 'POST', body: form },
  );
  return requireFunctionPayload(await jsonBody(response), slug);
}

/** 완료된 step을 재확인하는 read-only 관찰. 없으면 null이다. */
export async function readEdgeFunction({ management, projectRef, slug }) {
  const ref = requireProjectRef(projectRef);
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  const response = await send(
    management,
    `/v1/projects/${ref}/functions/${encodeURIComponent(slug)}`,
    { method: 'GET' },
    { allowMissing: true },
  );
  if (response === null) return null;
  return requireFunctionPayload(await jsonBody(response), slug);
}
