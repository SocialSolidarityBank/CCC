#!/usr/bin/env bash
# 프로토타입 서버 기동. 시크릿은 stdout에 찍지 않고 환경변수로만 주입한다.
set -euo pipefail
cd "$(dirname "$0")"

# OpenAI: Infisical ggbss prod /
INFISICAL_TOKEN="$(OP_BIOMETRIC_UNLOCK_ENABLED=false opsvc item get 'Infisical · account@ggbss.or.kr' \
  --vault BSS --fields label=ggbss_project_access_token --reveal)"
export INFISICAL_TOKEN

# Azure Speech: 구독의 ccc-stt-koreacentral 리소스 키 (az CLI 세션 사용)
export AZURE_SPEECH_KEY="$(az cognitiveservices account keys list \
  -n ccc-stt-koreacentral -g ccc-stt --query key1 -o tsv)"

export GOOGLE_APPLICATION_CREDENTIALS="$HOME/developer/projects/bss/bss-google-console/secrets/oauth2service.json"
export GOOGLE_WORKSPACE_SUBJECT="seongqkim@ggbss.or.kr"
export PROTOTYPE_SHEET_ID="1DiEr-VX9QgJok7294CWKX8WQ2IVnxIRbOqpRb4IUhbE"
export PROTOTYPE_ADMIN_ID="${PROTOTYPE_ADMIN_ID:-admin}"
export PROTOTYPE_ADMIN_PW="${PROTOTYPE_ADMIN_PW:-admin-test-2026}"
export PROTOTYPE_STAFF_ID="${PROTOTYPE_STAFF_ID:-staff}"
export PROTOTYPE_STAFF_PW="${PROTOTYPE_STAFF_PW:-staff-test-2026}"

exec infisical run --env=prod --path=/ --silent -- \
  .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8792
