# RELAYER2 세션 인계 메모: 자격 로테이션과 Infisical 재배열

## 1. 한 줄 사정

2026-09-15 에 자격 로테이션과 Infisical 폴더 재배열이 진행됐다. RELAYER2 개발 세션이 같은 값이나 이전 경로를 쓰고 있으면 끊길 수 있다.

## 2. 지금 끊기는 것

옛 값이 즉시 무효가 되는 세 개다.

| 이름 | 발급 서비스 | 새 값 가져오는 방법 |
|---|---|---|
| `CLOUDFLARE_WORKERS_API_TOKEN` | Cloudflare (토큰 Roll) | Infisical `RELAYER` / `Production` 에서 같은 이름을 다시 읽는다 |
| `CCC_LINEAR_API_KEY` | Linear (새 키 발급, 옛 키 폐기) | Infisical `RELAYER` / `Production` 에서 같은 이름을 다시 읽는다 |
| `AZURE_SPEECH_KEY` | Azure `ccc-stt-koreacentral` 의 KEY 1 재생성 (KEY 2 는 그대로) | Infisical `RELAYER` / `Production` 에서 같은 이름을 다시 읽는다 |

값은 여기 적지 않는다. 새 값은 Infisical 에서 읽는다.

## 3. 경로가 바뀐 것

폴더 이름이 소문자에서 대문자로 바뀌었다.

| 이전 | 지금 |
|---|---|
| `install` | `INSTALL` |
| `api` | `API` |
| `onboarding` | `ONBOARDING` |
| `preview` | `PREVIEW` |
| `unused` | `UNUSED` |
| `current` | `CURRENT` |

루트에 있던 16개 계열이 `CURRENT` 폴더로 옮겨졌다. `CCC_INSTALL_*`, `CCC_BETA_*`, `CCC_PROVIDER_BASELINE`, `CCC_ORGANIZATION_ID`, `CCC_RELEASE_*`, `CCC_API_DATABASE_PASSWORD` 계열이다. [확인 필요: 정확한 16개 이름 목록은 계열 단위로만 확인했다]

다른 이동도 있다.

- `PREVIEW_*` 4개 → `PREVIEW`
- `RELAYER_ONBOARDING_*` 4개 → `ONBOARDING`
- `RELAYER_PII_ENC_KEY`, `RELAYER_SCHEDULER_SECRET` → `API`
- 미사용 `SUPABASE_*` 4개 → `UNUSED`

이전 경로(소문자 폴더 이름, 루트 경로)를 박아 쓴 설정이나 스크립트가 있으면 그것이 끊긴다.

## 4. 끊기지 않는 것

새로 만든 `RELAYER_BETA_*` 네 개는 덮어쓰기가 아니라 새 이름으로 들어갔다. 기존 소비자를 건드리지 않는다.

- `RELAYER_BETA_SUPABASE_SECRET_KEY`
- `RELAYER_BETA_API_DATABASE_PASSWORD`
- `RELAYER_BETA_SCHEDULER_SECRET`
- `RELAYER_BETA_PII_ENC_KEY`

루트 `PII_ENC_KEY` 와 `SCHEDULER_SECRET` 도 그대로 남아 있다.

## 5. Supabase 쓰는 경우 주의

기존 프로젝트 이름이 `Relayer` 에서 `Relayer_legacy` 로 바뀌었다. 이름으로 프로젝트를 골라 쓰는 설정이 있으면 엉뚱한 것을 가리킬 수 있다. 이름이 아니라 참조 문자열로 가리키는 것을 권한다.

- 새 프로젝트 `Relayer` (이번 출고 대상): 참조가 `qlzwas` 로 시작, 서울 리전
- 기존 프로젝트 `Relayer_legacy`: 참조가 `wtbdqy` 로 시작, 데이터와 설치가 살아 있다
- `Relayer2` 라는 별도 프로젝트는 이번 작업에서 건드리지 않았다

---

끊긴 것을 발견하면 먼저 Infisical 에서 같은 이름을 다시 읽어 본다. 그래도 안 되면 이 메모를 남긴 사람에게 물어본다.
