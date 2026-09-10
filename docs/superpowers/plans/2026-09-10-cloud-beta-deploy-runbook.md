# Community Cloud 베타 배포 실행 순서

## 현재 확인한 상태

Relayer Supabase 프로젝트는 이미 존재하며 서울 리전이다. 새 프로젝트를 만들거나 기존 사용자 값을
덮어쓰지 않는다. Aside의 해당 프로젝트 Connect 화면에서 IPv4 session pooler를 확인했고, 공식 CA를
지정한 인증서와 호스트 검증, 기존 설치 계정의 읽기 전용 `SELECT 1` 연결이 성공했다.
업무 행 조회와 DB 쓰기는 하지 않았다. 이 결과는 설치 계정의 연결 증거이며 `ccc_api` 기동 증거가 아니다.

Azure 로그인은 유지되고 있다. 앞서 만든 자원은 `ccc-beta-krc`, `cccbetakrc0470`, `ccc-beta-env`다.
기존 이미지 빌드 성공은 현재 통합 tip의 배포나 실제 인증 성공을 뜻하지 않는다.

## 시크릿과 연결 경계

- 정본은 `.infisical.json`의 RELAYER 프로젝트, 명시적 `--path /`다. 환경도 매번 지정한다.
- 인증은 기존 `hermes-bss` Universal Auth를 `opsvc`로 주입한다. 옛 source-scoped 자격은 쓰지 않는다.
- `SUPABASE_DB_PASSWORD`는 설치 계정 전용이다. 소유자 접속 문자열을 `CCC_DATABASE_URL`로 저장하지 않는다.
- `CCC_DATABASE_URL`은 설치기가 준비한 제한 역할 `ccc_api`의 업무 실행 연결에만 사용한다.
- 원본 프로젝트 항목과 사용자 값을 삭제하거나 회전하지 않는다. staging의 누락값을 prod에서 임의 복제하지 않는다.
- Supabase CA는 공식 대시보드가 제공한 공개 인증서만 사용한다. 앱별 신뢰 설정으로
  인증서 체인과 호스트 검증을 유지한다. 시스템 신뢰 저장소나 `rejectUnauthorized`를 바꾸지 않는다.

## 설치 전 관문

정본은 `docs/specs/S11-supabase-edge-template.md`다. 앞선 버전의 SQL 파일 일괄 실행 명령은 폐기한다.
서명된 설치 manifest, 소유 기관과 프로젝트 결합, 만료, 깨끗한 프로젝트 또는 일치하는 설치 journal을
먼저 확인해야 한다. 연결 성공이나 비어 보이는 화면만으로 마이그레이션을 실행하지 않는다.

Q가 승인한 설치 전용 승인서 계약의 구현 후 읽기 전용 명령은 다음과 같다.

```sh
node scripts/supabase/bootstrap.mjs plan --target hosted --install-manifest "$CCC_INSTALL_MANIFEST" --install-approval "$CCC_INSTALL_APPROVAL" --format json
```

이 명령은 주입된 `SUPABASE_ACCESS_TOKEN`과 `CCC_SUPABASE_PROJECT_REF`를 읽는다.
Q의 별도 승인으로 Aside에서 새 관리 인증을 연결했다. 설치 전용 CLI 프로필은 네이티브 자격 저장소만
사용하며 평문 토큰 파일 fallback은 차단했다. 설치 프로세스용 인증은 공식 CLI의 브라우저 교환 절차로
메모리에서 받아 자식 환경에만 주입한다. 기존 정본 토큰은 바꾸지 않았다.

이전 `9bbc553`의 관찰용 plan 실행은 exit 0, `readOnly:true`, `unchanged:true`, 서울 리전 확인,
DB/Auth/Storage 읽기 성공, 업무 테이블 0개를 보고했다. `productionReady`는 `false`였다.
이 결과는 서명된 기관 소유권 승인이나 설치 완료를 뜻하지 않는다.

2026-09-10 Q는 별도 비공개 설치 승인서를 선택했다. S2 공개 형식은 그대로 유지했다.
설치기 구현은 통합본에서 단위 계약 53건과 disposable PostgreSQL journal 계약 17건을 통과했다.
업무 런타임은 `CCC_INSTALL_SIGNING_PRIVATE_KEY`가 빈 값이어도 DB 초기화와 listen 전에 거부한다.
서명 키와 공개 manifest, 비공개 승인서는 RELAYER의 승인된 SecretStore에 보관하며 업무 컨테이너에는
개인키와 승인서를 주입하지 않는다.

2026-09-11 실제 서명된 read-only `plan`은 기관 ID `bss`, Relayer 프로젝트, 승인된 소유자,
서울 리전, 두 서명과 공개 manifest 전체 해시를 모두 확인했다. DB, Auth, Storage를 읽었고
전후 지문은 같았다. 업무 표와 행, Auth 사용자, Storage bucket은 모두 0건이었다. 다만 Supabase가
관리하는 기본 객체 101개와 grant 903개를 승인할 서명된 provider baseline이 없어서
`EXISTING_PROJECT_NOT_CLEAN`으로 중단했다. 이 중단까지 DB 쓰기는 0건이다. 값이 없는 증거는
`artifacts/beta-0.9/2026-09-11-signed-plan.json`에 있다.

## 구현 후 실행할 순서

1. S11 read-only plan에서 기관 소유권, 기존 자원, Auth, Storage, RLS, schema와 전후 지문을 확인한다.
2. 승인 manifest와 일치하는 durable journal을 먼저 만든 뒤, migration별 transaction과 checksum을 기록한다.
   이미 적용된 migration을 다시 실행하거나 같은 번호의 내용을 바꾸지 않는다.
3. `ccc_api`의 최소 권한과 실제 거부를 검증한다. 설치 자격과 업무 자격의 주입 프로세스를 분리한다.
4. 서명 개인키는 승인된 SecretStore가 관리한다. 임시로 만들었다가 버리는 키로 정식 설치 이력을 만들지 않는다.
5. Cloud 이미지에는 업무용 허용 이름만 주입한다. Supabase 관리자 비밀번호, secret/service-role 키,
   Management API 토큰을 전달하지 않는다. CA 신뢰와 `verify-full`을 유지한다.
6. 승인된 한국 중부 환경에서 이미지 읽기 권한, 최대 한 인스턴스, 예산 알림과 정확한 ingress/probe 설정을 확인한다.
   현재 통합 commit과 이미지 digest를 연결한 뒤 배포한다.
7. 실제 hosted Auth와 MFA, 업무 화면의 등록부터 DB 재조회까지, 권한 거부, 저장 충돌,
   미승인 초안 제외, 가림 실패 시 외부 호출 차단, 원음 삭제와 수기 경로를 검증한다.
8. 신뢰된 HTTPS origin에서 PWA 등록과 캐시 경계, 업데이트와 복원 경로를 별도로 확인한다.

## 완료 판정

테스트 통과, 이미지 빌드, 설치 계정 연결, 업무 API 기동, hosted 인증, 배포된 사용자 흐름을 구분한다.
Local Single의 기존 Windows 번들 통과는 어댑터와 identity 로직의 증거다. 실제 서비스와 클라이언트를
기동한 증거가 없으므로 Single 완료로 부르지 않는다. Local Office의 TLS, 실제 계정 저장소와 MFA,
전용 서비스 계정, 두 client와 복원 검증도 별도로 남는다. 전체 목표는 세 모드 모두이며 축소하지 않는다.
