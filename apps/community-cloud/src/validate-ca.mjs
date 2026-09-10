import process from 'node:process';
import { assertApplicationCaBinding } from './application-ca.mjs';

// Validate before Node/Deno loads extra roots, so malformed files cannot produce
// startup warnings containing deployment paths. No credentials or network calls.
try {
  const path = process.env.CCC_DATABASE_CA_FILE;
  assertApplicationCaBinding({ CCC_DATABASE_CA_FILE: path, NODE_EXTRA_CA_CERTS: path, DENO_CERT: path });
} catch {
  process.exitCode = 1;
}
