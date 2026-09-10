# Community Cloud 베타 배포 실행 순서

Supabase 값이 도착한 다음 총괄이 그대로 실행하는 순서다. 값은 승인된 주입 경로로만 읽고 화면과 기록에 남기지
않는다. 이미 만들어 둔 자원은 리소스 그룹 `ccc-beta-krc`(한국 중부), 레지스트리 `cccbetakrc0470`,
Container Apps 환경 `ccc-beta-env`, 이미지 `ccc-community-cloud:0.9.0`, 예산 알림 `ccc-beta-monthly`다.

## 0. 값이 갖춰졌는지 확인

RELAYER prod `/` 에 다음 이름이 새 프로젝트 값으로 있어야 한다. 값은 읽지 않고 존재만 확인한다.

- `CCC_DATABASE_URL` : Session pooler(IPv4) 접속 문자열. 소유자 계정이 아니라 제한 역할용으로 쓸 것이다.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CCC_SUPABASE_PROJECT_REF`
- `PII_ENC_KEY` : 이미 있다.

## 1. 변경 없는 사전 점검 (D84 · ADR-0042)

```sh
node scripts/supabase/bootstrap.mjs plan
```

리전, 읽기 권한, 기존 데이터, RLS, Auth, Storage를 읽기 전용으로 확인한다. 실행 전후 지문이 같아야 통과다.
여기서 막히면 배포로 넘어가지 않는다.

## 2. 스키마 적용과 제한 역할 준비

소유자 자격으로 `migrations/postgres/*.sql` 을 번호 순서대로 적용한다. 그다음 `ccc_api` 역할에 로그인 자격을
부여하고, 업무 런타임에 줄 접속 문자열은 그 역할로만 만든다. 소유자 문자열은 런타임에 넣지 않는다.

적용 뒤 확인할 것은 셋이다. 표 개수, `0006_rls_default_deny.sql` 이후의 기본 거부, 그리고 `ccc_api` 로 붙은
연결에서 보호 테이블 직접 접근이 거부되는지다.

## 3. 설치 매니페스트 서명

`packages/contracts/src/install-manifest.ts` 의 `signInstallManifest` 로 Community Cloud 매니페스트를 만든다.
`mode`는 `community-cloud`, `apiBase`는 배포될 Container App 주소 + `/api/v1`, `clientOrigin`과
`allowedOrigins`는 클라이언트가 서비스될 주소, `supabaseAuthOrigin`은 `SUPABASE_URL`, `scheme`은 `https`다.
서명 공개키 묶음이 `CCC_INSTALL_SIGNING_KEYS`가 된다. 개인키는 저장하지 않는다.

## 4. 컨테이너 앱 생성

```sh
az containerapp create -n ccc-api -g ccc-beta-krc --environment ccc-beta-env \
  --image cccbetakrc0470.azurecr.io/ccc-community-cloud:0.9.0 \
  --registry-server cccbetakrc0470.azurecr.io --registry-identity system \
  --ingress external --target-port 8080 --min-replicas 0 --max-replicas 1 \
  --secrets <이름=값은 주입으로만> \
  --env-vars CCC_ORGANIZATION_ID=... CCC_STT_MODE=off CCC_LLM_MODE=off PII_KEY_VERSION=2
```

`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN` 은 절대 넣지
않는다. 런타임이 이 이름들을 보면 기동을 거부한다. 상세 계약은 `apps/community-cloud/RUN.md` 가 갖는다.

## 5. 기동 확인

- `/readyz` 200 (데이터베이스를 건드리지 않는 준비 확인)
- 서명된 host 로 보낸 `/api/v1/capabilities` 200, 다른 host 는 403
- 설정을 하나 빼고 띄우면 `installation_unavailable` 한 줄로 종료

## 6. 클라이언트 서빙과 실제 완주

`apps/client` 를 빌드해 정적으로 서빙하고 `/ccc-install-manifest.json` 과 `/ccc-bootstrap.json` 을 같은 origin
에서 제공한다. 그다음 실제 브라우저로 다음을 통과시킨다. 로그인과 2단계 인증(hosted Supabase Auth),
기관 초기 설정, D87 사업 확인, 당사자 등록, 일정, 인테이크, 상담 기록, 15초 페이지, 전체 리포트,
실무자 초대와 수락, 공개 요청 링크. 여기서 처음으로 hosted Auth·MFA(P1)와 신뢰 인증서 아래의 워커 등록(P2)이
증명된다.

## 7. 남는 것

Local Office 모드는 아직 앱이 없다. 세 모드 완주(P10)는 그 구현 뒤에야 닫힌다. Local Single은 Windows 실기에서
14단계를 통과했다.
