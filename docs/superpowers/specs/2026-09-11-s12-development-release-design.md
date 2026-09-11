# S12 개발판 릴리스 설계 (S12-D1)

- 상태: Q 승인 결정 반영, 구현 대기
- 근거: `docs/specs/S12-install-release.md`, ADR-0041 D83, ADR-0042 D84, 2026-09-11 개발판 provider baseline 발급 기록
- 목표: Community Cloud 데이터베이스 설치를 막고 있는 마지막 관문을 개발 채널 범위에서 정확히 연다
- 범위 밖: 정식(formal) 릴리스, Windows 서명, 다섯 설치물 전체, update, 정식 rollback

## 1. 왜 필요한가

서명된 provider baseline이 발급되어 `plan`은 `ready:true`를 낸다. 그러나 `apply`는
`scripts/supabase/bootstrap.mjs:212`에서 `RELEASE_PREREQUISITES_MISSING`으로 멈춘다. 승인된 릴리스
출처, 오프라인 루트가 서명한 묶음, 검증된 백업 경로가 없기 때문이다. 이 세 가지를 개발 채널에서
실제로 갖추면 설치가 가능해지고, 정식 관문은 그대로 남는다.

## 2. Q 결정 4건 (2026-09-11)

| # | 결정 | 내용 |
|---|---|---|
| DR1 | 개발판 묶음 형태를 따로 정의 | `channel`이 `dev` 또는 `beta`면 실제로 존재하는 family만 담는다. `stable`은 다섯 family 요구를 그대로 유지한다 |
| DR2 | 배포 출처는 기존 Cloudflare 계정의 새 주소 | 이미 쓰는 계정에 릴리스 출처를 만든다. 새 사업자 계약은 없다 |
| DR3 | 개발판 최상위 키는 Infisical 보관 | baseline 키와 같은 경로를 쓰고 개발 전용임을 문서에 명시한다. 정식 단계에서 오프라인 키로 교체한다 |
| DR4 | 첫 설치는 백업 면제, 명시 | 비어 있음이 검증된 프로젝트의 첫 설치만 면제한다. 두 번째 설치와 모든 업데이트는 백업과 복원 확인을 요구한다 |

## 3. 개발판 묶음 형태 (DR1)

`ReleaseBundleV1`의 필드는 바꾸지 않는다. `entries` 개수 규칙만 채널로 가른다.

- `channel`이 `stable`이면 서로 다른 다섯 family row가 정확히 있어야 한다.
- `channel`이 `dev` 또는 `beta`이면 최소 한 개, 최대 다섯 개의 서로 다른 family row를 허용한다.
  없는 family를 빈 값이나 가짜 hash로 채우는 것은 금지한다. row가 없으면 그 family는 이 묶음으로
  설치할 수 없다.
- 어느 채널이든 `community-cloud-cli` row가 있으면 그 row의 `edgeComponentManifestSha256`는
  non-null이고 나머지 row는 null이다. `sequenceFloor`는 존재하는 모든 record의 tuple을 덮는다.
- `protocol.peers`는 이 묶음이 실제로 설치하는 peer만 담는다. 개발판 첫 슬라이스에서는
  `cloud-cli`와 `edge` 두 개다.

개발판 묶음으로 설치한 결과물은 `development` profile로만 기록하며 정식 제출물이 될 수 없다
(S12 §2.2 마지막 문단 유지).

## 4. 배포 출처 (DR2)

- 고정 출처는 기존 Cloudflare 계정에 두는 새 주소 하나다. 코드에는 `PINNED_RELEASE_ORIGIN`
  상수 하나로 박고 명령행이나 환경변수로 덮어쓰지 못하게 한다. 시험용 대체 출처는 테스트
  전용 주입 지점에서만 허용하고 제품 경로에는 두지 않는다.
- 출처는 다음 두 가지를 제공한다.
  - `/.well-known/ccc/release-bundle.json`: 현재 묶음과 floor
  - `artifactUrl`, `manifestUrl`이 가리키는 same-origin 파일
- 매 실행마다 TLS 체인과 호스트 이름을 확인하고 응답 `Date`를 신뢰 시각으로 쓴다. 값이 없거나
  검증에 실패하면 로컬 시계로 대체하지 않고 `TRUSTED_TIME_UNAVAILABLE`로 멈춘다.
- 기존 `ccc-preview` 배포와 주소를 공유하지 않는다. 릴리스 출처는 업무 화면과 분리한다.

## 5. 키 보관 (DR3)

- 오프라인 루트에 해당하는 개발판 키 이름은 `CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY`,
  릴리스 서명 키는 `CCC_RELEASE_SIGNING_PRIVATE_KEY`, 공개 신뢰 목록은
  `CCC_RELEASE_TRUST_STORE`다. 모두 RELAYER prod에 두고 설치기 프로세스에만 주입한다.
- 업무 런타임 금지 이름 목록에 위 세 이름을 추가한다. 값이 비어 있어도 존재 자체를 거부한다.
- 문서와 진단 출력은 이 키가 개발 전용이며 정식 오프라인 루트가 아님을 밝힌다. 정식 전환은
  별도 결정과 키 교체로 한다.
- 서명 형식은 S12 §3.1을 따른다. baseline 모듈의 표준 Base64 88자와 달리 릴리스 객체는
  unpadded base64url 86자다. 두 형식을 섞지 않는다.

## 6. 첫 설치 백업 면제 (DR4)

- 면제 조건은 세 가지를 모두 만족할 때다. D84 plan이 `ready`이고, 관찰된 업무 표, 행, Auth 사용자,
  버킷, Storage 객체, 공개 routine과 type, private 설치 표가 모두 0이며, 설치 journal이 없다.
- 면제 사실은 journal과 진단에 `backup: not_applicable`과 그 근거 수치로 남긴다. 조용히 건너뛰지
  않는다.
- 두 번째 설치, 재개, 업데이트, rollback은 면제 대상이 아니다. 이 경로들은 E6-7 백업 실행기가
  생기기 전까지 기존대로 막힌다.

## 7. 개발판 첫 슬라이스 범위

구현 순서와 각 항목이 닫는 S12 의무다.

1. `ReleaseManifestV1`과 `ReleaseBundleV1` 닫힌 스키마 파서와 검증기. 도메인 접두는
   `CCC-RELEASE-MANIFEST-V1\0`와 `CCC-RELEASE-BUNDLE-V1\0`, 서명은 unpadded base64url 86자.
   중복 키 거부 파서와 JCS 정규화는 기존 모듈을 재사용한다.
2. `ExpectedArtifactTuple`과 파일명 파서. 한 번만 percent-decode, 마지막 segment만, `.`과 `..`,
   재decode, query, fragment, 대소문자 변형 거부.
3. 릴리스 신뢰 목록. `next`, `active`, `retired`, `revoked` 상태를 갖되 첫 슬라이스는 설치기에
   내장한 초기 목록만 읽는다. `TrustStoreUpdateV1` 적용기는 이 슬라이스에서 구현하지 않으며
   문서에 보류로 남긴다.
4. 고정 출처 클라이언트. floor와 TLS `Date`를 받고 `max(기존 floor, 서명된 floor)`만 저장한다.
   설치기에 내장한 factory floor보다 낮은 원격 floor는 거부한다.
5. 묶음 빌더. CLI 산출물, 그 manifest, 서명된 묶음, floor를 만든다. 키는 주입으로만 받는다.
6. `EdgeComponentManifestV1` 생성과 CLI 산출물 내장. 배포는 staging에서 검증한 바이트로만 한다.
7. `apply` 실행기. `bootstrap.mjs:212`의 stub을 대체한다. 순서는 묶음, manifest, tuple, hash,
   Edge component, barrier 획득, journal `prepared`, 승격, health, `installed`와 receipt다.
   기존 `startInstallStep`과 `completeInstallStep`을 재사용하고 두 번째 journal을 만들지 않는다.
8. 수집 시점 redaction을 쓰는 `RedactedReportV1`과 `report --output`, 실제 ledger를 읽는 `doctor`.

## 8. 이 슬라이스가 덮지 않는 것

`update`, 정식 `rollback`, Authenticode와 PE 처리, Windows 설치물 세 종과 Agent, 여러 peer 협상,
채널 간 ledger의 완전한 형태, `.cccx` 백업과 복원 훈련, 정식 증거 묶음, S12 §8의 26개 fixture와
아홉 개 명령 이름, 그리고 새 경로가 실제로 내지 않는 진단 code는 그대로 남는다. 이 목록을
구현했다고 표기하지 않는다.

## 9. 완료 판정

- 개발판 묶음과 manifest를 실제로 만들고, 고정 출처에서 받아 검증한 뒤, 비어 있음이 확인된
  Relayer 프로젝트에 `apply`가 성공한다.
- 설치 후 `doctor`가 ledger와 receipt를 읽어 PASS를 내고, `report`가 비밀 없는 보고서를 쓴다.
- 서명 위조, 만료, 알 수 없는 키, 낮은 sequence, hash 불일치, Edge component 불일치, 시각 미확보
  각각에 대해 적용 0건이 실제 실행으로 증명된다.
- 첫 설치 백업 면제가 조건을 만족할 때만 적용되고, 조건이 깨지면 막힌다.
