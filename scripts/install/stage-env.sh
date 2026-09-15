#!/usr/bin/env bash
# stage-env.sh — Infisical 시크릿을 설치기가 읽는 이름으로 주입하고 곧바로 exec 한다.
#
# 사용: scripts/install/stage-env.sh <command> [args...]
#   예: scripts/install/stage-env.sh node scripts/supabase/bootstrap.mjs plan --target hosted
#
# 규칙:
#   - 시크릿 값을 출력하거나 파일에 쓰지 않는다. 주입 후 곧바로 exec 한다.
#   - 매핑 정본은 artifacts/orchestration/secret-consumer-map.json 의 nameMapping 이다.
#   - /current 가 이 설치의 정본 세트다. /install 의 RELAYER_* 는 stale 하므로
#     /current 에 같은 이름이 있는 항목은 CCC_* 주입값이 이긴다.
#   - /install+/api 와 /current 를 한 번에 주입하면 CCC_PROVIDER_BASELINE(534,074바이트)이
#     두 번 env 에 올라 ARG_MAX 초과로 exec 에 실패한다. 그래서 /install+/api 를 먼저
#     주입하고 RELAYER_PROVIDER_BASELINE 만 비운 뒤 /current 를 안쪽에서 다시 주입한다.
#   - CCC_PROVIDER_BASELINE 은 env 로 넣을 수 있지만(실측 exec 성공),
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

# 재서명 절차가 쓸 문서 경로. 안쪽 bash 에서 $0 가 'bash' 이므로 루트는 여기서 넘긴다.
export CCC_STAGE_REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE_OUT="$CCC_STAGE_REPO_ROOT/artifacts/install/current"
STAGE_SELF="$CCC_STAGE_REPO_ROOT/scripts/install/stage-env.sh"

# --- 안쪽 단계: /current 가 주입된 상태에서 이름 정리·파일 우선·exec ---
if [ "${1:-}" = "--stage-inner" ]; then
  shift

  # /current 에 없는 이름만 RELAYER_ 에서 옮긴다. 이미 있는 CCC_* 는 /current 값을 지킨다.
  pair() {
    if [ -n "${!1:-}" ] && [ -z "${!2:-}" ]; then export "$2=${!1}"; fi
    unset "$1" 2>/dev/null || true
  }

  pair RELAYER_SUPABASE_PROJECT_REF       CCC_SUPABASE_PROJECT_REF
  pair RELAYER_INSTALL_REVOKED_KEY_IDS    CCC_INSTALL_REVOKED_KEY_IDS
  pair RELAYER_SUPABASE_ACCESS_TOKEN      SUPABASE_ACCESS_TOKEN
  pair RELAYER_SCHEDULER_SECRET           SCHEDULER_SECRET
  pair RELAYER_SUPABASE_SECRET_KEY        SUPABASE_SERVICE_ROLE_KEY
  pair RELAYER_API_DATABASE_PASSWORD      CCC_API_DATABASE_PASSWORD

  # /current 에 정본이 있는 RELAYER_ 잔여물은 버린다(/install 값은 stale 하다).
  unset RELAYER_ORGANIZATION_ID RELAYER_INSTALL_MANIFEST RELAYER_INSTALL_APPROVAL \
        RELAYER_INSTALL_SIGNING_KEYS RELAYER_BETA_RELEASE_TRUST \
        RELAYER_BETA_TRUST_ROOT_KEYS RELAYER_BETA_REVOKED_ROOT_KEY_IDS \
        RELAYER_INSTALL_DATABASE_URL RELAYER_RELEASE_TRUST_STORE \
        RELAYER_INSTALL_SIGNING_PRIVATE_KEY RELAYER_BETA_ROOT_SIGNING_PRIVATE_KEY \
        RELAYER_BETA_RELEASE_SIGNING_PRIVATE_KEY RELAYER_RELEASE_ROOT_SIGNING_PRIVATE_KEY \
        RELAYER_RELEASE_SIGNING_PRIVATE_KEY RELAYER_PII_ENC_KEY

  # 서명 개인키는 각 생산 절차에만 필요한 이름으로 남긴다.
  # 그 외 명령(설치기·런타임)에는 금지 바인딩이므로 버린다.
  case " $* " in
    *sign-install-documents.mjs*)
      unset CCC_BETA_ROOT_SIGNING_PRIVATE_KEY CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY \
            CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY CCC_RELEASE_SIGNING_PRIVATE_KEY ;;
    *provider-baseline-generate.mjs*|*regen-baseline-capture.mjs*)
      unset CCC_INSTALL_SIGNING_PRIVATE_KEY CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY \
            CCC_RELEASE_SIGNING_PRIVATE_KEY
      # 로컬에 재서명 문서가 있으면 Infisical 의 JSON 본문보다 파일 경로가 이긴다.
      # (readStrictJsonDocument 가 파일 경로를 받는다: manifest-preflight.mjs:113-137)
      if [ -f "$STAGE_OUT/install-manifest.json" ]; then
        CCC_INSTALL_MANIFEST="$STAGE_OUT/install-manifest.json"
      fi
      if [ -f "$STAGE_OUT/install-approval.json" ]; then
        CCC_INSTALL_APPROVAL="$STAGE_OUT/install-approval.json"
      fi ;;
    *)
      unset CCC_INSTALL_SIGNING_PRIVATE_KEY CCC_BETA_ROOT_SIGNING_PRIVATE_KEY \
            CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY \
            CCC_RELEASE_SIGNING_PRIVATE_KEY
      # 로컬에 재서명 문서가 있으면 Infisical 의 JSON 본문보다 파일 경로가 이긴다.
      if [ -f "$STAGE_OUT/install-manifest.json" ]; then
        CCC_INSTALL_MANIFEST="$STAGE_OUT/install-manifest.json"
      fi
      if [ -f "$STAGE_OUT/install-approval.json" ]; then
        CCC_INSTALL_APPROVAL="$STAGE_OUT/install-approval.json"
      fi ;;
  esac

  # 운영자가 baseline 을 파일로 준비한 경우에만 경로로 대체한다.
  if [ -n "${CCC_PROVIDER_BASELINE_FILE:-}" ]; then
    CCC_PROVIDER_BASELINE="$CCC_PROVIDER_BASELINE_FILE"
  fi

  exec "$@"
fi

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <command> [args...]" >&2
  exit 64
fi

case " $* " in
  *sign-install-documents.mjs*)
    # 서명은 /current 정본만 필요하다. RELAYER_ 매핑 없이 곧바로 안쪽 단계로 간다.
    exec infisical run --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENV" \
      --path=/current -- bash "$STAGE_SELF" --stage-inner "$@" ;;
  *)
    # /install+/api 를 먼저 주입하고 baseline 만 비운 뒤 /current 를 안쪽에서 다시 주입한다.
    exec infisical run --projectId="$INFISICAL_PROJECT_ID" --env="$INFISICAL_ENV" \
      --path=/install --path=/api -- bash -c '
        unset RELAYER_PROVIDER_BASELINE
        exec infisical run --projectId="$1" --env="$2" --path=/current \
          -- bash "$3" --stage-inner "${@:4}"
      ' bash "$INFISICAL_PROJECT_ID" "$INFISICAL_ENV" "$STAGE_SELF" "$@" ;;
esac
