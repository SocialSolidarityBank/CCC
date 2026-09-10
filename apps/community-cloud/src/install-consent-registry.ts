/**
 * Build: pnpm --filter @ccc/community-cloud build
 * Run: CCC_INSTALL_DATABASE_URL='postgresql://…' node apps/community-cloud/dist/install-consent-registry.js --input ./consent-registry.json
 * CCC_INSTALL_DATABASE_URL must identify a trusted install role, never the ccc_api request role.
 */
import { open } from 'node:fs/promises';
import type { InstallConsentProviderRegistryInput } from '@ccc/contracts/consent';
import { installConsentProviderRegistry } from '@ccc/core/gateway';
import { createPostgresDatabase } from '@ccc/db-postgres';

const MAX_INPUT_BYTES = 64 * 1024;

function fail(code: string, exitCode: number): void {
  console.error(code);
  process.exitCode = exitCode;
}

async function readInput(path: string): Promise<InstallConsentProviderRegistryInput> {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = await file.read(buffer, length, buffer.length - length);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length === 0 || length > MAX_INPUT_BYTES) throw new Error('input_invalid');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))) as InstallConsentProviderRegistryInput;
  } finally {
    await file.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--input' || args[1]!.length === 0) {
    fail('consent_registry_arguments_invalid', 2);
    return;
  }

  const connectionString = process.env.CCC_INSTALL_DATABASE_URL;
  if (connectionString === undefined || connectionString.trim().length === 0) {
    fail('consent_registry_database_url_missing', 2);
    return;
  }

  let input: InstallConsentProviderRegistryInput;
  try {
    input = await readInput(args[1]!);
  } catch {
    fail('consent_registry_input_invalid', 2);
    return;
  }

  try {
    const database = createPostgresDatabase({ connectionString, maxConnections: 1, ssl: 'verify-full' });
    const result = await (async () => {
      try {
        return await installConsentProviderRegistry(database, input);
      } finally {
        await database.close();
      }
    })();
    console.log(JSON.stringify({
      approvedAt: result.approvedAt,
      snapshotCount: result.snapshotIds.length,
      replayed: result.replayed,
    }));
  } catch {
    fail('consent_registry_install_failed', 1);
  }
}

await main().catch(() => fail('consent_registry_install_failed', 1));
