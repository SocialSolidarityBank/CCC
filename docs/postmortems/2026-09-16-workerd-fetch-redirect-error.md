# 운영 업무 화면 전면 503 — workerd 미지원 fetch 옵션 (2026-09-16)

## 결론 한 줄

`adapters/identity-supabase/src/verifier.ts` 의 JWKS fetch 가 `redirect: 'error'` 를 썼는데
workerd 는 그 값을 구현하지 않아 TypeError 를 던진다. 그 예외가 `IdentityStoreUnavailableError`
로 감싸져 모든 Supabase 로그인 요청이 503 이 됐고, 웹 화면은 "불러올 수 없습니다. 접근 권한을
확인하세요" 로 표시했다. **로그인은 됐는데 업무 화면이 전부 안 뜬 이유다.**

## 왜 테스트가 못 잡았나

API 계약 테스트는 Node(undici)에서 돌고, undici 는 `redirect: 'error'` 를 지원한다.
운영 런타임은 workerd 다. **테스트 런타임과 운영 런타임이 달라서** 결함이 배포까지 갔다.
`cache: 'no-store'` 도 같은 이유로 오래된 compat date 에서는 던지지만, 이 저장소의
compat date(2026-07-06 이상)에서는 지원돼 무관했다 — 실측으로 가른다.

## 증거

- 실제 Supabase 토큰(magiclink 발급)의 claim·서명은 verifier 의 모든 검사를 통과한다 —
  Node 에서 실제 JWKS 로 검증해 확인.
- 같은 fetch init 을 miniflare(workerd)에서 실행하면 `TypeError: Invalid redirect value,
  must be one of "follow" or "manual"` 이다. compat date·플래그와 무관하게 'error' 는
  구현 계획 자체가 없다(workerd 오류 메시지 원문).
- `redirect: 'manual'` 로 바꾸면 3xx 가 그대로 돌아오고 기존 `!response.ok` 검사가 걸러낸다 —
  "리다이렉트를 따라가지 않는다"는 원래 의도가 보존된다.

## 고침

- `verifier.ts` JWKS fetch: `redirect: 'error'` → `'manual'` (한 줄 + 주석).
- 회귀 테스트 `apps/api/test/supabase-workerd.test.ts`: 실제 워커 엔트리 배선
  (`createWorkerSupabaseIdentity` + `adaptD1Environment`)을 esbuild 로 묶어 miniflare 안의
  진짜 workerd 에서 돌린다. JWKS 는 `fetchMock` 이 가로채 네트워크는 나가지 않는다.
  수정 전 503(두 테스트 모두 실패), 수정 후 200·403(연결된 subject 통과, 미연결 거부).
- `notify.ts` 웹훅 fetch: 같은 `redirect: 'error'` → `'manual'`. 회귀 테스트
  `apps/api/test/notify-workerd.test.ts` 가 workerd 안에서 웹훅 POST 가 실제로
  나가는지 본문까지 검사한다.

## 같은 결함이 잠든 자리

| 파일 | 런타임 | 영향 | 처리 |
|---|---|---|---|
| `packages/core/src/notify.ts:37` | **workerd** (ccc-api 크론 → scheduled-job-runner → notifyAdmins) | 워치독 웹훅 발송이 항상 TypeError → catch 되어 "network error" 로만 기록. 운영 알림이 조용히 죽어 있었다 | **같은 배포에서 고쳤다** |
| `adapters/audio-signer/src/index.ts:119` | Node (community-cloud 의존) | 무관 | 그대로 |
| `apps/community-cloud/src/storage-signer.ts:161,554` | Node | 무관 | 그대로 |
| `apps/api/eval/run-memory-trial.ts` | Node (로컬 eval) | 무관 | 그대로 |
| `apps/client/src/business/*.ts` | Node (데스크톱 클라이언트) | 무관 | 그대로 |
| `apps/web/app/lib/api.ts` 등 `cache: 'no-store'` | workerd (웹 워커) | compat date 2026-07-15 에서 지원됨 — 무관 | 그대로 |

## 교훈

**워커에서 도는 코드는 workerd 에서 검증한다.** Node 테스트는 fetch·Request·Response 의
런타임 차이를 잡지 못한다. 신원·보안 경로처럼 운영에서만 도는 코드는 miniflare 수준의
회귀 테스트가 필요하다 — 이번에 추가한 `supabase-workerd.test.ts` 가 그 모범이다.
