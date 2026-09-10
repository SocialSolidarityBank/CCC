const NAMES = new Set(['Error', 'AssertionError', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError']);
const CODES = new Set([
  'ERR_ASSERTION', 'ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT', 'ERR_UNKNOWN_FILE_EXTENSION',
  'ERR_DLOPEN_FAILED', 'ERR_INVALID_ARG_TYPE', 'ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE',
  'EADDRINUSE', 'EADDRNOTAVAIL', 'ECONNREFUSED', 'ECONNRESET', 'ENOENT', 'EACCES', 'EPERM', 'ABORT_ERR',
  'invalid_shape', 'unknown_key', 'key_revoked', 'signature_mismatch', 'expired', 'sequence_replay',
  'wrong_installation', 'mode_fields', 'auth_origin', 'project_ref_mismatch', 'publishable_key', 'endpoint',
  'platform_unsupported', 'secret_access_denied', 'secret_invalid', 'installation_invalid',
  'single_identity_already_exists', 'recovery_restore_blocked', 'recovery_kit_invalid', 'recovery_kit_integrity_failed',
  'tls_identity_invalid', 'bind_address_not_private', 'invalid_private_cidr', 'invalid_cidr_prefix',
  'invalid_address', 'host_outside_cidr', 'private_interface_required', 'server_bind_failed',
  'local_shutdown_incomplete', 'transport_failed', 'response_invalid', 'request_timeout',
]);

export function scenarioDiagnostics(error) {
  if (error === null || typeof error !== 'object') return { name: 'Error' };
  const result = { name: NAMES.has(error.name) ? error.name : 'Error' };
  const code = CODES.has(error.code) ? error.code : CODES.has(error.message) ? error.message : undefined;
  if (code !== undefined) result.code = code;
  const isStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599;
  if (error.code === 'ERR_ASSERTION' && isStatus(error.expected) && isStatus(error.actual)) {
    result.expectedStatus = error.expected;
    result.actualStatus = error.actual;
  }
  return result;
}
