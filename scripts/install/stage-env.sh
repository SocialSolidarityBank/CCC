#!/usr/bin/env bash
# stage-env.sh — Infisical RELAYER_* 시크릿을 설치기가 읽는 이름으로 주입하고 곧바로 exec 한다.
#
# 사용: scripts/install/stage-env.sh <command> [args...]
#   예: scripts/install/stage-env.sh node scripts/supabase/bootstrap.mjs plan --target hosted
#
# 규칙:
#   - 시크릿 값을 출력하거나 파일에 쓰지 않는다. 주입 후 곧바로 exec 한다.
#   - 매핑 정본은 artifacts/orchestration/secret-consumer-map.json 의 nameMapping 이다.
#   - 루트 폴더(/)는 주입 자체가 ARG_MAX 초과로 exec 에 실패하므로 /install + /api 만 쓴다.
#   - CCC_PROVIDER_BASELINE 은 534,074 바이트라서 env 로는 넣을 수 있지만(실측 exec 성공),
#     운영자가 파일로 준비한 경우 CCC_PROVIDER_BASELINE_FILE=<경로> 를 넘기면
#     readStrictJsonDocument 가 파일 경로를 받으므로 그 경로로 대체한다.
#     이 스크립트는 값을 파일에 쓰지 않는다. 파일 준비는 운영자 몫이다.
set -eu

INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-78d6f149-5ef7-43f2-b20c-4c89c3dc473c}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"

if [ -z "${INFISICAL_UNIVERSAL_AUTH_CLIENT_ID:-}" ] && [ -f "$HOME/.config/infisical-agent/credentials" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$HOME/.config/infisical-agent/credentials"
  set +a
fi

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

# 재서명 절차가 쓸 문서 경로. 안쪽 bash 에서 $0 가 'bash' 이므로 루트는 여기서 넘긴다.
export CCC_STAGE_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

exec infisical run --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENV" \
  --path=/install --path=/api -- bash -c '
set -eu

# RELAYER_<원래이름> 을 코드가 읽는 이름으로 옮기고 원본을 지운다.
# 대응표: artifacts/orchestration/secret-consumer-map.json nameMapping
pair() { export "$2=${!1:?stage-env: missing $1}"; unset "$1"; }

pair RELAYER_ORGANIZATION_ID            CCC_ORGANIZATION_ID
pair RELAYER_SUPABASE_PROJECT_REF       CCC_SUPABASE_PROJECT_REF
pair RELAYER_INSTALL_MANIFEST           CCC_INSTALL_MANIFEST
pair RELAYER_INSTALL_APPROVAL           CCC_INSTALL_APPROVAL
pair RELAYER_INSTALL_SIGNING_KEYS       CCC_INSTALL_SIGNING_KEYS
pair RELAYER_INSTALL_REVOKED_KEY_IDS    CCC_INSTALL_REVOKED_KEY_IDS
pair RELAYER_BETA_RELEASE_TRUST         CCC_BETA_RELEASE_TRUST
pair RELAYER_PROVIDER_BASELINE          CCC_PROVIDER_BASELINE
pair RELAYER_BETA_TRUST_ROOT_KEYS       CCC_BETA_TRUST_ROOT_KEYS
pair RELAYER_BETA_REVOKED_ROOT_KEY_IDS  CCC_BETA_REVOKED_ROOT_KEY_IDS
pair RELAYER_SUPABASE_ACCESS_TOKEN      SUPABASE_ACCESS_TOKEN
pair RELAYER_INSTALL_DATABASE_URL       CCC_INSTALL_DATABASE_URL
pair RELAYER_RELEASE_TRUST_STORE        CCC_RELEASE_TRUST_STORE
pair RELAYER_SCHEDULER_SECRET           SCHEDULER_SECRET
pair RELAYER_SUPABASE_SECRET_KEY        SUPABASE_SERVICE_ROLE_KEY
pair RELAYER_API_DATABASE_PASSWORD      CCC_API_DATABASE_PASSWORD

# 설치기가 읽지 않는 주입 잔여물(미사용 이름)은 자식 env 에서 제거한다.
unset RELAYER_RELEASE_ROOT_SIGNING_PRIVATE_KEY RELAYER_RELEASE_SIGNING_PRIVATE_KEY \
      RELAYER_PII_ENC_KEY

# 서명 개인키는 각 생산 절차에만 필요한 이름으로 넘긴다.
# 그 외 명령(설치기·런타임)에는 금지 바인딩이므로 버린다.
case " $* " in
  *sign-install-documents.mjs*)
    pair RELAYER_INSTALL_SIGNING_PRIVATE_KEY CCC_INSTALL_SIGNING_PRIVATE_KEY
    unset RELAYER_BETA_ROOT_SIGNING_PRIVATE_KEY RELAYER_BETA_RELEASE_SIGNING_PRIVATE_KEY ;;
  *provider-baseline-generate.mjs*)
    pair RELAYER_BETA_ROOT_SIGNING_PRIVATE_KEY CCC_BETA_ROOT_SIGNING_PRIVATE_KEY
    pair RELAYER_BETA_RELEASE_SIGNING_PRIVATE_KEY CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY
    unset RELAYER_INSTALL_SIGNING_PRIVATE_KEY
    # 로컬에 재서명 문서가 있으면 Infisical 의 JSON 본문보다 파일 경로가 이긴다.
    # CCC_INSTALL_MANIFEST → install-manifest.json, CCC_INSTALL_APPROVAL → install-approval.json
    # (readStrictJsonDocument 가 파일 경로를 받는다: manifest-preflight.mjs:113-137)
    if [ -f "$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-manifest.json" ]; then
      CCC_INSTALL_MANIFEST="$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-manifest.json"
    fi
    if [ -f "$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-approval.json" ]; then
      CCC_INSTALL_APPROVAL="$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-approval.json"
    fi ;;
  *)
    unset RELAYER_INSTALL_SIGNING_PRIVATE_KEY \
          RELAYER_BETA_ROOT_SIGNING_PRIVATE_KEY RELAYER_BETA_RELEASE_SIGNING_PRIVATE_KEY
    # 로컬에 재서명 문서가 있으면 Infisical 의 JSON 본문보다 파일 경로가 이긴다.
    # CCC_INSTALL_MANIFEST → install-manifest.json, CCC_INSTALL_APPROVAL → install-approval.json
    # (readStrictJsonDocument 가 파일 경로를 받는다: manifest-preflight.mjs:113-137)
    if [ -f "$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-manifest.json" ]; then
      CCC_INSTALL_MANIFEST="$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-manifest.json"
    fi
    if [ -f "$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-approval.json" ]; then
      CCC_INSTALL_APPROVAL="$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/install-approval.json"
    fi
    # 재생산된 trust·baseline 도 파일이 있으면 Infisical 본문보다 파일 경로가 이긴다.
    if [ -f "$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/release-trust.json" ]; then
      CCC_BETA_RELEASE_TRUST="$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/release-trust.json"
    fi
    if [ -f "$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/provider-baseline.json" ]; then
      CCC_PROVIDER_BASELINE="$CCC_STAGE_REPO_ROOT/artifacts/install/wtbdqy/provider-baseline.json"
    fi ;;
esac

# 운영자가 baseline 을 파일로 준비한 경우에만 경로로 대체한다.
if [ -n "${CCC_PROVIDER_BASELINE_FILE:-}" ]; then
  CCC_PROVIDER_BASELINE="$CCC_PROVIDER_BASELINE_FILE"
fi

exec "$@"
' bash "$@"
