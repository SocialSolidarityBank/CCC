# E2-1 Screen/API Probe Implementation Plan

**Goal:** S3의 30개 화면, 93개 endpoint, 47개 PII DTO.field 행을 현재 소스와 오프라인으로 양방향 대조한다. 빈 key 목록은 우회 조건이 아니며 `void`, `{}`, 배열, 객체, scalar를 명시적으로 구분한다.

**Owned files:**

- `scripts/verify-screen-api-map.mjs`
- `scripts/verify-screen-api-map.test.mjs`
- `scripts/fixtures/e2-1-screen-api-fixture.json`
- 이 계획 문서

**Out of scope:** 화면, API handler, gateway, S3 정본, root `package.json` 변경과 네트워크·DB·브라우저 실행.

## Success criteria

- [x] `route-inventory.json`과 같은 30개 route를 22 operating + 5 public + 2 redirect + 1 kit으로 명시한다.
- [x] 93개 endpoint마다 method, path, wire DTO, response kind, exact wire keys, client DTO, projection kind, exact projection keys를 명시한다.
- [x] 실제 204 응답 두 개만 `responseKind: "void"`로 둔다. `{}`는 `responseKind: "object"`와 빈 key 집합으로 검사한다.
- [x] required, optional(`?`), nullable(`|null`), array(`[]`), 중첩 key를 TypeScript AST와 type checker로 비교한다.
- [x] route별 page loader, 각 named action의 call set, rendered component action, root inherited edge, admin inherited edge를 별도 표면으로 기록한다.
- [x] `apps/web/app/lib/api.ts`의 호출 인수와 literal header 이름·값을 검사한다. public client의 Access/Bearer 사용을 금지하고 fixture에 적힌 public/Preview header만 허용한다.
- [x] S3 PII matrix를 47개 DTO.field 행으로 펼치고 각 serialized wire field를 endpoint branch, gateway 함수, guard symbol, page route에 연결한다.
- [x] expected/observed PII 행을 양방향 비교하고 미등록 민감 필드 직렬화와 Actor guard 변경을 각각 실패시킨다.
- [x] endpoint identity를 `method path [wireDto]`로 유지하고 route call, client projection, handler wire shape를 양방향 대조한다.
- [x] `POST /ai/provider/activate-runtime`은 실제 wire 객체와 body를 버리는 `void` client projection을 서로 다른 계약으로 기록한다.
- [x] `fixture` sentinel과 빈 key 일반 우회 분기를 제거한다.
- [ ] 요청에 따라 이 작업 세션에서는 focused suite, smoke, lint, typecheck를 실행하지 않는다.

## Implementation map

### 1. Source discovery and provenance

`page.tsx`, root/admin layout, 상대 import closure, rendered JSX component, `actions.ts`, `theme-action.ts`, `logout-action.ts`, `preview/unlock/route.ts`, API handler와 gateway를 읽는다. 페이지 기본 함수에서 도달 가능한 loader call과 action/component 경계를 분리한다. 같은 endpoint 총집합이어도 다른 표면으로 옮기면 `route-action-surface-mismatch`로 실패한다.

### 2. Endpoint and DTO contracts

API client의 method/path와 함수 반환 DTO를 읽고 request-handler의 성공 응답을 찾는다. TypeScript type을 await한 뒤 object/array/scalar/void로 분류하고 모든 scope의 exact key, optional, nullable, array 의미를 비교한다. endpoint catalog와 source branch 어느 한쪽에만 있는 method/path도 실패한다.

### 3. Public authentication boundary

`Headers` 생성자, object/tuple header initializer, `headers` 속성, `.set()`/`.append()`, API 호출 인수를 AST로 읽는다. public client는 `Authorization`, Bearer, Cloudflare Access header와 `accessHeaders()` 전이를 사용할 수 없다. header 이름과 값은 projection별 fixture 목록과 exact match한다.

### 4. PII structural trace

47개 행 각각에 DTO.field, serialized wire field, Actor 설명, page route, endpoint, gateway 함수, guard symbol을 둔다. 중첩 DTO가 여러 wire 위치에 쓰이면 trace별 `wireField`를 둔다. 실제 응답 field 누락과 추가 민감 field를 모두 검사하고 service/잘못된 human guard 대체를 허용하지 않는다.

### 5. Regression diagnostics

Focused test는 다음 source-only mutation이 서로 다른 code를 내는지 고정한다.

- method/path: `endpoint-method-path-mismatch`
- DTO: `endpoint-dto-mismatch`
- wire key/kind/optional/null: `endpoint-wire-shape-mismatch`
- client projection key/kind/optional/null: `endpoint-projection-mismatch`
- cross-surface action 이동: `route-action-surface-mismatch`
- 미등록 PII field: `pii-unauthorized-field`
- Actor/gateway guard 변경: `pii-actor-guard-mismatch`
- public Access/Bearer literal: `public-auth-leak`과 `public-header-mismatch`

## Deferred verification

사용자 지시에 따라 구현 후 명령은 정의만 하고 실행하지 않는다.

```bash
node --test scripts/verify-screen-api-map.test.mjs
```

Focused suite에는 synthetic valid map, 독립 mutation, zero-key object, 47-row PII 양방향 검사와 실제 저장소 offline smoke(`ok === true`, networkRequests `0`)가 포함된다. 다음 검증 세션에서 위 명령을 실행한 뒤 필요하면 저장소 공통 gate를 별도로 실행한다.
