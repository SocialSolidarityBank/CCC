#!/bin/sh

fail() {
  printf '%s\n' 'installation_unavailable' >&2
  exit 1
}

[ "$#" -gt 0 ] || fail

if [ "${CCC_DATABASE_CA_FILE+x}" = x ]; then
  case "$CCC_DATABASE_CA_FILE" in
    *[![:space:]]*) ;;
    *) fail ;;
  esac
  [ -f "$CCC_DATABASE_CA_FILE" ] && [ -r "$CCC_DATABASE_CA_FILE" ] || fail
  base=$(CDPATH= cd "$(dirname "$0")" 2>/dev/null && pwd) || fail
  # Public CA parsing happens before extra trust is loaded by the application.
  # Clear inherited extra-root paths only in this validation subprocess.
  case "$1" in
    deno|*/deno)
      (unset NODE_EXTRA_CA_CERTS DENO_CERT
       "$1" run --no-config --no-lock --no-remote --allow-env=CCC_DATABASE_CA_FILE --allow-read "$base/src/validate-ca.mjs") 2>/dev/null || fail
      ;;
    node|*/node)
      (unset NODE_EXTRA_CA_CERTS DENO_CERT
       "$1" "$base/src/validate-ca.mjs") 2>/dev/null || fail
      ;;
    *) fail ;;
  esac
  export NODE_EXTRA_CA_CERTS="$CCC_DATABASE_CA_FILE"
  export DENO_CERT="$CCC_DATABASE_CA_FILE"
fi

exec "$@"
