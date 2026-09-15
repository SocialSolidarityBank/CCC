#!/usr/bin/env bash
# regen-provider-baseline.sh — 정본 생산기 provider-baseline-generate.mjs 를
# 올바른 installationId 의 서명 문서로 호출한다. 생산기를 대신하지 않고 감싸기만 한다.
#
# 사용: scripts/install/regen-provider-baseline.sh <source-evidence.json> <out-dir>
#   out-dir 에 baseline.json 과 release-trust.json 을 쓴다(생산기가 pathMustNotExist 를 강제).
#
# /INSTALL 의 RELAYER_SUPABASE_PROJECT_REF 는 stale 하므로 CCC_SUPABASE_PROJECT_REF 를
# 서명된 manifest 가 들고 있는 ref 로 덮어 주입한다. 시크릿 값은 출력하지 않는다.
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <source-evidence.json> <out-dir>" >&2
  exit 64
fi
EVIDENCE="$1"
OUT_DIR="$2"
mkdir -p "$OUT_DIR"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="$REPO_ROOT/artifacts/install/current/install-manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "signed manifest not found: $MANIFEST" >&2
  exit 66
fi
PROJECT_REF="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).supabaseProjectRef)' "$MANIFEST")"

exec "$REPO_ROOT/scripts/install/stage-env.sh" env \
  CCC_SUPABASE_PROJECT_REF="$PROJECT_REF" \
  node "$REPO_ROOT/scripts/supabase/provider-baseline-generate.mjs" \
  --source-evidence "$EVIDENCE" \
  --release-trust-output "$OUT_DIR/release-trust.json" \
  --baseline-output "$OUT_DIR/baseline.json"
