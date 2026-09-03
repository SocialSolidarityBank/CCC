# E10-2 공급망과 시크릿 검사 Implementation Plan

**Goal:** `pnpm release:verify`를 단일 릴리스 관문으로 만들어 CycloneDX SBOM, 의존성·모델 라이선스 allowlist, NOTICE, gitleaks secret scan, 승인된 fixture/manifest PII scan을 빠짐없이 실행한다.

## Scope and ownership

- `scripts/release/verify.mjs`가 모든 검사를 fail-closed로 오케스트레이션한다. pnpm 11의 내장 `pnpm sbom`이나 gitleaks가 없으면 성공으로 우회하지 않고 설치 안내와 함께 실패한다.
- `supply-chain/license-allowlist.json`은 일반 허용 SPDX 식별자의 명시적 SSOT다. pnpm SBOM이 lockfile-only 모드에서 license를 싣지 않는 경우 `pnpm licenses list --json`의 설치 metadata로 이름·버전을 보강하고, `cross-platform-license-evidence.json`의 exact name/version/source를 두 번째 증거로 사용하되 inventory/evidence 실패와 Unknown/비 SPDX 값은 거부한다. OR expression은 허용 대안 중 하나가 충족될 때만 통과한다.
- `supply-chain/model-license-manifest.json`은 현재 pipeline이 참조하는 모델별 이름·버전·SPDX license·출처를 기록한다. 모델이 추가되면 출처 없는 항목과 allowlist 밖 license를 거부하며, 빈 manifest도 실패한다.
- `supply-chain/conditional-license-obligations.json`은 LGPL libvips를 global allowlist에 넣지 않고, lockfile의 현재 `@img/sharp-libvips-*@1.2.4`에만 별도 파일·교체 가능성·역분석 제한 금지·고지/본문 보존 의무를 적용한다. 정식 artifact 모드에는 E10-3/E10-6 증거가 필요하며, E5-7/E10-1 Python SBOM은 유효한 CycloneDX 문서가 추가될 때까지 최종 artifact를 막는다.
- gitleaks는 기존 `.gitleaks.toml`을 그대로 사용하고, checksum 검증한 단일 CI 바이너리로 git tracked source와 승인된 fixture/manifest 파일을 `--redact` 검사한다. PII 정적 검사는 별도로 승인된 fixture/model/license manifest 경로에만 적용한다.
## Root and CI contract

- root `package.json`의 `release:verify`가 `node scripts/release/verify.mjs`를 호출한다.
- pnpm 11의 내장 `pnpm sbom`이 pnpm-lock.yaml에서 CycloneDX 1.7 SBOM을 생성한다. 별도 SBOM npm generator는 추가하지 않는다. CI verify job은 기존 gitleaks 설치와 함께 release command를 실행한다.
- 생성 SBOM은 임시 디렉터리에 두고 커밋하지 않는다. `--sbom`/`CCC_SBOM_FILE`을 주면 현재 lockfile에서 새 SBOM을 다시 생성해 component 집합·purl·integrity를 묶은 뒤 외부 파일을 검증한다.

## Verification evidence

- 집중 테스트 파일은 pass, 미표기 dependency, 승인 fixture의 PII, gitleaks secret 결과를 각각 검사한다.
- 릴리스 실행의 성공 출력에는 dependency/model/fixture·manifest/tracked file 검사 수를 표시하며, 실패 출력에는 값 자체를 표시하지 않는다.
