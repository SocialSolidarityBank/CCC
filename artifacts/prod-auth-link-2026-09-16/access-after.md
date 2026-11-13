# Cloudflare Access 변경 후 상태 (2026-09-16)

## 변경 내용

웹 앱 `ccc`(id `08ef0ef1-0a17-4cf6-acd1-6144fe631305`)에 bypass 정책 하나를 추가했다.

- name: `앱 자체 로그인으로 이관(임시 바이패스)`
- id: `ffcbd8b9-efbd-4660-9b38-76333309413f`
- decision: `bypass`, precedence: 3, include: everyone
- 기존 allow 정책 2개(관리자·CCC 파일럿 상담사)는 그대로 — 되돌릴 때 이 정책만 삭제하면 된다.
- API 앱 `CCC API`·`ACCESS_TEAM_DOMAIN`·`ACCESS_AUD` vars 미변경.

## 실측 결과 (미로그인)

| 경로 | 결과 |
|---|---|
| `/login` | 200, 우리 로그인 화면(title 'CCC 사례관리 로그인') |
| `/` | 307 → `/login?next=%2F` |
| `/participants` | 로그인 페이지만 |
| `/participants/some-id` | 로그인 페이지만 |
| `/schedule` | 로그인 페이지만 |
| `/settings` | 로그인 페이지만 |
| `/admin` | 로그인 페이지만 |
| `/admin/staff` | 로그인 페이지만 |
| `/admin/invites` | 로그인 페이지만 |
| `/records` | 로그인 페이지만 |
| API `/me` | 302 (Access 유지) |
| API `/health` | 302 (Access 유지) |

업무 자료 문자열·기관명·사용자 이름·이메일 노출 0건. `next` 파라미터 되울림은 설계된 동작.

## 배포

- run 35054634570 성공, v0.9.0 · 9403c6b2
- 스모크: 웹 GET / → 302, API 무인증 → 302(fail-closed), 크론 3종 재등록
- GitHub secret CLOUDFLARE_API_TOKEN 을 Infisical prod /CLOUDFLARE 의 유효 토큰으로 갱신(로테이션 누락분)
