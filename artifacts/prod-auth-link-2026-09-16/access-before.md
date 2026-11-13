# Cloudflare Access 변경 전 구성 (2026-09-16)

조회 방법: Infisical prod `/` 의 `CCC_ACCESS_SETUP_API_KEY` 로 Cloudflare API
`GET /accounts/{acct}/access/apps` + `/policies`. 값 출력 없음.
계정 ID: `8855a07cd6da28d8f6120fa95081854e`, 팀 도메인: `socialsolidaritybank.cloudflareaccess.com`.

## 애플리케이션 2개

### 1) `ccc` (웹 워커) — 이번에 걷어낼 대상

- id: `08ef0ef1-0a17-4cf6-acd1-6144fe631305`
- domain: `ccc.account-855.workers.dev`
- type: `self_hosted`
- aud: `52d5b26bf947ea0e6964336ed57dde622f8e8b6ac7f5f452edf1ebd0ac89c2b7`
- 정책:
  - `관리자` (id `70e77a4d-b671-4417-a1c2-8ef1fd4afd3c`, precedence 1, allow): 개별 이메일 1개
  - `CCC 파일럿 상담사` (id `1d5414d4-2c3d-404e-9e13-4a42fee37c29`, precedence 2, allow): 개별 이메일 6개
    - heeureka@bss.or.kr, seongqkim@bss.or.kr, loveoofy@bss.or.kr, jiin@bss.or.kr, kimi@bss.or.kr, ai00@ggbss.or.kr

### 2) `CCC API` — 유지 대상 (건드리지 않는다)

- id: `1252314f-5737-4c5e-9b56-ba4738064c29`
- domain: `ccc-api.account-855.workers.dev`
- type: `self_hosted`
- aud: `3dbacf213494f7624c00676ce62742c414528997fd2a23c21e926c16d79404d2`
- 정책:
  - `관리자` (id `36b3b251-1280-40a8-9b27-403c084fbd52`, precedence 1, allow): 개별 이메일 1개
  - `Pipeline service token` (id `ebbb30bc-a6f1-4009-85b5-61a6c6cfff04`, precedence 2, non_identity): 서비스 토큰 `92512594-4809-4553-9015-333c5d3ba8c9` (ccc-pipeline-laptop)

## 참고

- `ACCESS_AUD` vars(apps/api/wrangler.toml)는 두 aud 를 쉼표로 함께 검증한다 — 웹 앱을 걷어내도 vars 는 지우지 않는다.
- 되돌림: 웹 앱 `ccc` 를 같은 id/도메인/정책으로 재생성하거나, 삭제 대신 비활성 방식을 택했다면 그 조치를 되돌린다.
