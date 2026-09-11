# ccc-releases 릴리스 출처

`scripts/release/release-origin.mjs`가 고정한 `https://ccc-releases.account-855.workers.dev`를 제공하는 Cloudflare Worker다.
정적 자산 세 종류만 byte 그대로 내보내고 redirect·목록·질의문자열을 허용하지 않는다.

| 경로 | 내용 |
|---|---|
| `/.well-known/ccc/release-bundle.json` | `build-bundle`이 만든 서명 bundle |
| `/manifests/<artifact>.manifest.json` | 서명 release manifest |
| `/artifacts/<artifact>.tar.gz` | 서명 artifact |

게시 절차: `build-bundle` 출력물을 `public/` 아래 위 경로로 복사한 뒤
`pnpm exec wrangler deploy --config apps/release-origin/wrangler.toml`를 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 주입 아래 실행한다.
`public/`은 커밋하지 않는다. 배포 뒤 `curl -sI <origin>/.well-known/ccc/release-bundle.json`으로 200과 `date` 헤더를 확인한다.
