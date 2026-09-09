# ADR-0048: Community Cloud 업무 API의 독립 실행 환경

- 상태: Accepted (2026-09-09 Q가 실행 권한의 분리 방향을 승인. 공급자 선정·배포·운영 검증 승인이 아님)
- 결정일: 2026-09-09
- 결정 번호: D89
- 관련: ADR-0041 D76/D78/D80/D82/D83, ADR-0044 D86, S2, S9, S11
- 부분 대체: Community Cloud 업무 API를 Supabase hosted Edge에서 실행한다는 전제, 업무 API host에서 Supabase project ref를 도출하는 S2의 주소 결합, 업무 시크릿을 Supabase Edge에 두는 S9/S11의 위치 조항
- 유지: 기관 소유 Supabase 서울 PostgreSQL/Auth/private Storage, 세 배포 모드, 공통 코어와 일곱 포트, 사용자 권한, MFA, 동의, 원음 삭제, 서명 설치 검증, Cloudflare의 정적 파일 전용 경계

## 배경

S11은 일반 업무 실행 환경에 Supabase 관리자 키가 존재하지 않고 StorageSigner만 그 키를 갖도록 요구한다. 그러나 Supabase 공식 문서는 hosted Edge Functions에 `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`, `SUPABASE_DB_URL`이 기본 제공된다고 명시한다. secret/service-role 키는 RLS를 우회한다.

공식 함수 설정과 Management API 스키마에서 함수별 기본 시크릿 제외 설정을 찾지 못했다. 이는 문서화된 지원 경로가 확인되지 않았다는 뜻이지 공급자가 미래에도 이를 지원할 수 없다는 뜻은 아니다. hosted Web Worker/Node vm API도 지원되지 않는다. 애플리케이션 코드에서 값을 읽지 않거나 `SecretStore`가 값을 숨기는 것은 실행 환경의 권한 격리가 아니다.

Q는 hosted Edge를 그대로 쓰면서 보안 경계를 완화하는 안 대신, 관리자 키가 없는 독립 업무 실행 환경을 선택했다.

## 결정

1. Community Cloud의 업무 API는 별도로 통제 가능한 실행 환경에 배치한다. Supabase 프로젝트에는 DB, Auth, private Storage를 유지한다. 별도 Supabase 프로젝트를 늘리는 결정이 아니다.
2. 업무 실행 환경에는 필요한 `ccc_api` DB 연결과 업무용 PII/AI 시크릿만 공급한다. Supabase service-role/secret 키, 관리자 DB 연결, Auth 관리자 자격, 전체 시크릿을 조회할 수 있는 운영 자격은 주입하지 않는다. 이름만 바꾸거나 초기화 후 지우는 방법으로 부재를 주장하지 않는다.
3. 업무 DB는 기존 제한된 `ccc_api`와 기관 컨텍스트를 사용한다. RLS, gateway 권한, MFA, 동의, 감사와 개인정보 관문을 그대로 유지한다. 코어를 새로 만들거나 별도 업무 API 구현을 복제하지 않는다.
4. StorageSigner의 좁은 원음 서명/삭제 권한과 업무 API는 분리한다. 업무 API가 일반 관리자 프록시를 호출하거나 임의 SQL/URL/bucket/action을 위임하는 우회 경로를 만들지 않는다. 원음 byte는 계속 private Storage와 허용된 client/Agent 사이에서만 이동한다.
5. signed manifest는 독립 업무 API의 정확한 HTTPS 주소와 기관 Supabase Auth origin/project ref를 함께 결합한다. `apiBase`의 host가 Supabase Auth host와 같아야 한다는 조건은 폐기한다. Supabase project ref는 Auth origin과 대조하고, API 주소는 서명된 설치 정보와 정확히 대조한다. 서명, 만료, 폐기키, sequence, installation ID, exact CORS/CSP, registry 검사는 완화하지 않는다. unsigned 기관 코드 입력으로 임의 API 주소를 조립하지 않는다.
6. 공급자 선택, 비용, 실행 환경의 서울 리전 증거, TLS/인증서, 실제 설치·배포는 별도 검토와 승인 대상이다. 현재 개발용 Mac이나 기존 서버를 자동으로 공용 업무 서버로 전환하지 않는다.

## 승인에 포함되지 않은 것

- 실제 외부 서비스 생성, 결제, 인증서 변경, 운영 시크릿 조회/이동, 배포와 운영 DB 변경
- 최초 기관 관리자 Auth 계정의 생성/초대 방법 및 S2의 이후 직원 초대에 필요한 별도 Auth 관리자 권한 경계
- S11의 기관/소유자 설치 승인 정보와 S2 공개 signed manifest 사이의 입력 계약 누락을 임의 필드로 메우는 것
- STT/AI 제품 활성화, 실패한 개인정보 가림의 통과 처리, 기존 미완 기능의 제외

첫 관리자와 직원 초대의 권한 경계는 후속 결정 전까지 미완료다. 이를 StorageSigner에 Auth 관리자 기능을 얹는 방식으로 해결하지 않는다. 기존 canonical 신원 연결은 `users.auth_subject`이며 문서의 다른 표기를 이유로 새 컬럼을 만들지 않는다.

## 구현 순서와 소유

- 총괄: 이 결정과 S2/S9/S11/PRD/실행 계획의 참조를 기록하고 파일별 구현 슬롯을 배정한다.
- BACKEND: 진행 중인 기존 통합 검증을 마쳐 별도 체크포인트로 보존한다. 그 결과는 독립 배포 환경 검증이 아니다. 다음 슬롯에서 공통 manifest/runtime 계약과 독립 업무 진입을 조정한다.
- FRONTEND: 검증된 BACKEND 계약을 소비하고 exact API 주소, Auth, 설치 ID와 capability 검증을 유지한다. 먼저 가져온 후보의 Supabase-host 결합을 새 계약으로 오인하지 않는다.
- 설치 담당: 공급자·실행 환경이 결정된 뒤 read-only 사전 점검, 자격 주입, 배포, 백업·복원·rollback을 기존 E6 티켓에서 구현한다. 별도 제품이나 포트를 만들지 않는다.

## 완료 증거

실제 업무 실행 환경과 그 실행 신원의 권한을 확인해 관리자 자격이 없음을 증명한다. 고정 변수명 몇 개가 없다는 확인만으로 끝내지 않고, 배포 시크릿 공급 정책과 실행 신원의 다른 자격 조회 권한까지 검사한다. 출력은 고정 이름별 존재 여부/권한 판정만 허용하고 값은 출력하지 않는다. `ccc_api`의 권한은 S11 §2.5, 필요한 업무 시크릿의 목록과 소유는 S9를 따른다. 키를 공급했다는 사실은 AI 활성화 승인이 아니다. 제한된 DB 연결의 RLS/rollback, 실제 Supabase Auth/MFA, signed API 주소·잘못된 설치 거부, CORS/CSP, 원음 업로드·삭제 증거와 전체 사용자 여정을 검증한다. 합성 Auth/JWKS나 로컬 HTTP 성공을 hosted 검증으로 보고하지 않는다.

## 검토한 대안

- Supabase hosted Edge 유지와 신뢰 경계 완화: 추가 실행 서비스를 줄이지만 업무 함수가 관리자 자격에도 접근할 수 있다는 위험을 받아들여야 하므로 Q가 선택하지 않았다.
- Supabase 프로젝트 분리나 Storage RLS만 변경: 일부 피해 범위를 줄일 수 있지만 업무 프로젝트의 Edge는 여전히 자기 관리자 키를 받으므로 이 결정의 키 부재 조건을 해결하지 않는다.
- 환경변수 삭제, 이름 변경, typed SecretStore 필터: 실행 권한 격리가 아니므로 채택하지 않는다.

## 외부 근거

2026-09-09 공개 문서로 확인했다. 실제 사용자 프로젝트에는 접근하지 않았다.

- [Supabase Edge 기본 시크릿](https://supabase.com/docs/guides/functions/secrets)
- [함수별 설정](https://supabase.com/docs/guides/functions/function-configuration)
- [Hosted 실행 한계](https://supabase.com/docs/guides/functions/limits)
- [공식 Management API 스키마](https://raw.githubusercontent.com/supabase/supabase/master/apps/docs/spec/api_v1_openapi.json)
- [Edge Runtime의 main/user 환경 경계](https://github.com/supabase/edge-runtime/blob/main/README.md)
