# E7 Local Single Windows Proof Script
# Validates DPAPI native bindings, encrypted SQLite, and full service composition

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Status($props) {
    Write-Output (ConvertTo-Json $props -Compress)
}

function Invoke-CmdWithOutput {
    param (
        [string]$Command,
        [string]$WorkingDirectory
    )
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = 'cmd.exe'
    $pinfo.Arguments = "/c $Command 2>&1"
    $pinfo.WorkingDirectory = $WorkingDirectory
    $pinfo.RedirectStandardOutput = $true
    $pinfo.RedirectStandardError = $true
    $pinfo.UseShellExecute = $false
    $pinfo.CreateNoWindow = $true
    
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $pinfo
    [void]$p.Start()
    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    
    @{ ExitCode = $p.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

function Invoke-NodeWithOutput {
    param (
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = 'node'
    $pinfo.Arguments = "--experimental-strip-types $($ArgumentList -join ' ')"
    $pinfo.WorkingDirectory = $WorkingDirectory
    $pinfo.RedirectStandardOutput = $true
    $pinfo.RedirectStandardError = $true
    $pinfo.UseShellExecute = $false
    $pinfo.CreateNoWindow = $true
    
    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $pinfo
    [void]$p.Start()
    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
    
    @{ ExitCode = $p.ExitCode; Stdout = $stdout; Stderr = $stderr }
}

function Get-DirListing($path) {
    try { 
        (Get-ChildItem -Path $path -Recurse -ErrorAction SilentlyContinue | 
            Select-Object -First 100 | 
            ForEach-Object { $_.FullName.Replace($path, '.') }) -join "`n" 
    } catch { "Error listing directory: $_" }
}

$completedStages = @()

# ── Stage: validate ───────────────────────────────────────────────────────────
Write-Status @{ stage='validate'; status='running' }

# Require Windows
if ($env:OS -ne 'Windows_NT') {
    Write-Status @{ stage='validate'; status='FAIL'; reason='not-windows'; os=$env:OS }
    exit 1
}

# Require Node.js >= 23.6.0 (strip-types support)
$nodeVersion = (node --version 2>$null)
if (-not $nodeVersion) {
    Write-Status @{ stage='validate'; status='FAIL'; reason='no-node' }
    exit 1
}
$nodeVer = [version]($nodeVersion -replace '^v', '')
if ($nodeVer -lt [version]'23.6.0') {
    Write-Status @{ stage='validate'; status='FAIL'; reason='node-too-old'; version=$nodeVersion; required='>=23.6.0' }
    exit 1
}

# Check pnpm
$pnpmVersion = (pnpm --version 2>$null)
if (-not $pnpmVersion) {
    Write-Status @{ stage='validate'; status='FAIL'; reason='no-pnpm' }
    exit 1
}

# Require tar.gz bundle exists in same directory as script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bundle = Join-Path $scriptDir 'e7-local-service-v12.tar.gz'
if (-not (Test-Path $bundle)) {
    Write-Status @{ stage='validate'; status='FAIL'; reason='no-bundle'; expected=$bundle }
    exit 1
}

Write-Status @{ stage='validate'; status='OK'; nodeVersion=$nodeVersion; pnpmVersion=$pnpmVersion }
$completedStages += 'validate'

# ── Stage: setup ──────────────────────────────────────────────────────────────
Write-Status @{ stage='setup'; status='running' }

# Create temp directory with clean name (no spaces/special chars)
$tempDir = Join-Path $env:TEMP "e7proof_$(Get-Random)"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Extract bundle
$extractResult = Invoke-CmdWithOutput -Command "tar -xzf `"$bundle`"" -WorkingDirectory $tempDir

if ($extractResult.ExitCode -ne 0) {
    Write-Status @{ 
        stage='setup'; status='FAIL'; reason='extract-failed';
        exitCode=$extractResult.ExitCode; stdout=$extractResult.Stdout; stderr=$extractResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='setup'; status='OK'; tempDir=$tempDir }
$completedStages += 'setup'

# ── Stage: copy-source ────────────────────────────────────────────────────────
Write-Status @{ stage='copy-source'; status='running' }

$files = Get-ChildItem -Path $tempDir -Recurse -File | Measure-Object
$dirs = Get-ChildItem -Path $tempDir -Recurse -Directory | Measure-Object

Write-Status @{ stage='copy-source'; status='OK'; fileCount=$files.Count; dirCount=$dirs.Count }
$completedStages += 'copy-source'

# ── Stage: verify-copy ────────────────────────────────────────────────────────
Write-Status @{ stage='verify-copy'; status='running' }

# Verify key files exist
$requiredFiles = @(
    'packages/contracts/package.json',
    'adapters/secrets-dpapi/package.json',
    'adapters/secrets-dpapi/src/native.mjs',
    'adapters/secrets-dpapi/src/store.ts',
    'adapters/db-sqlite/package.json',
    'adapters/db-sqlite/src/index.ts',
    'adapters/audio-file/package.json',
    'adapters/audio-file/src/index.ts',
    'adapters/scheduler-node/package.json',
    'adapters/scheduler-node/src/index.ts',
    'apps/local-service/package.json',
    'apps/local-service/src/identity.ts',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml'
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    $fullPath = Join-Path $tempDir $file
    if (-not (Test-Path $fullPath)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ stage='verify-copy'; status='FAIL'; reason='missing-files'; files=($missingFiles -join ','); listing=$listing }
    exit 1
}

Write-Status @{ stage='verify-copy'; status='OK' }
$completedStages += 'verify-copy'

# ── Stage: install ────────────────────────────────────────────────────────────
Write-Status @{ stage='install'; status='running' }

$installResult = Invoke-CmdWithOutput -Command 'pnpm install --frozen-lockfile' -WorkingDirectory $tempDir

if ($installResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='install'; status='FAIL'; reason='install-failed';
        exitCode=$installResult.ExitCode; stdout=$installResult.Stdout; stderr=$installResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='install'; status='OK' }
$completedStages += 'install'

# ── Stage: build-native ───────────────────────────────────────────────────────
Write-Status @{ stage='build-native'; status='running' }

$buildResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/secrets-dpapi build:native' -WorkingDirectory $tempDir

if ($buildResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='build-native'; status='FAIL'; reason='build-native-failed';
        exitCode=$buildResult.ExitCode; stdout=$buildResult.Stdout; stderr=$buildResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

# Verify the .node binding was built
$bindingPath = Join-Path $tempDir 'adapters/secrets-dpapi/native/build/Release/ccc_dpapi.node'
if (-not (Test-Path $bindingPath)) {
    $listing = Get-DirListing (Join-Path $tempDir 'adapters/secrets-dpapi/native')
    Write-Status @{ stage='build-native'; status='FAIL'; reason='no-binding'; path=$bindingPath; listing=$listing }
    exit 1
}

Write-Status @{ stage='build-native'; status='OK' }
$completedStages += 'build-native'

# ── Stage: dpapi-tests ────────────────────────────────────────────────────────
Write-Status @{ stage='dpapi-tests'; status='running' }

$dpapiTestScript = @'
import { loadNative } from './adapters/secrets-dpapi/src/native.mjs';

// Test 1: loadNative() returns a binding with protectData and unprotectData
const native = loadNative();
if (typeof native.protectData !== 'function') {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'no-protectData' }));
    process.exit(1);
}
if (typeof native.unprotectData !== 'function') {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'no-unprotectData' }));
    process.exit(1);
}

// Test 2: Verify hardening version constants
if (typeof native.cccHardeningVersion !== 'number' || native.cccHardeningVersion < 1) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'bad-hardeningVersion', value: native.cccHardeningVersion }));
    process.exit(1);
}
if (typeof native.cccRecordStorageVersion !== 'number' || native.cccRecordStorageVersion < 1) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'bad-recordStorageVersion', value: native.cccRecordStorageVersion }));
    process.exit(1);
}

// Test 3: Round-trip test with DPAPI
const testData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
const entropy = new Uint8Array([0x01, 0x02, 0x03]);

const encrypted = native.protectData(testData, entropy);
if (!(encrypted instanceof Uint8Array) || encrypted.length === 0) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'protect-failed', type: typeof encrypted }));
    process.exit(1);
}

const decrypted = native.unprotectData(encrypted, entropy);
if (!(decrypted instanceof Uint8Array)) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'unprotect-failed', type: typeof decrypted }));
    process.exit(1);
}

// Verify round-trip
if (decrypted.length !== testData.length) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'length-mismatch', expected: testData.length, got: decrypted.length }));
    process.exit(1);
}
for (let i = 0; i < testData.length; i++) {
    if (decrypted[i] !== testData[i]) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'data-mismatch', index: i }));
        process.exit(1);
    }
}

// Test 4: Wrong entropy should fail to decrypt
try {
    const wrongEntropy = new Uint8Array([0x99, 0x98, 0x97]);
    native.unprotectData(encrypted, wrongEntropy);
    console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-entropy-accepted' }));
    process.exit(1);
} catch (e) {
    // Expected: decryption should fail with wrong entropy
}

console.log(JSON.stringify({ status: 'OK', hardeningVersion: native.cccHardeningVersion, recordStorageVersion: native.cccRecordStorageVersion }));
'@

$dpapiTestPath = Join-Path $tempDir '_dpapi_test.mjs'
Set-Content -LiteralPath $dpapiTestPath -Value $dpapiTestScript -Encoding UTF8

$dpapiResult = Invoke-NodeWithOutput -ArgumentList @($dpapiTestPath) -WorkingDirectory $tempDir
Remove-Item -LiteralPath $dpapiTestPath -Force -ErrorAction SilentlyContinue

if ($dpapiResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='dpapi-tests'; status='FAIL'; reason='tests-failed';
        exitCode=$dpapiResult.ExitCode; stdout=$dpapiResult.Stdout; stderr=$dpapiResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='dpapi-tests'; status='OK' }
$completedStages += 'dpapi-tests'

# ── Stage: dpapi-protect ──────────────────────────────────────────────────────
Write-Status @{ stage='dpapi-protect'; status='running' }

$protectScript = @'
import { loadNative } from './adapters/secrets-dpapi/src/native.mjs';

const native = loadNative();

// Test protectData with real CCC entropy pattern
// Production entropy uses: `CCC-DPAPI\0v1\0${name}\0${version}`
// Use Unicode escapes since Node strip-mode rejects \0 as octal in template literals
const name = 'DB_MASTER_KEY';
const version = 1;
const entropy = new TextEncoder().encode(`CCC-DPAPI\u0000v1\u0000${name}\u0000${version}`);

// Generate 32 random bytes for a key
const keyBytes = new Uint8Array(32);
crypto.getRandomValues(keyBytes);

// Protect
const encrypted = native.protectData(keyBytes, entropy);
if (!(encrypted instanceof Uint8Array) || encrypted.length < keyBytes.length) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'protect-failed', encLen: encrypted?.length }));
    process.exit(1);
}

// Unprotect
const decrypted = native.unprotectData(encrypted, entropy);
if (decrypted.length !== keyBytes.length) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'length-mismatch', expected: keyBytes.length, got: decrypted.length }));
    process.exit(1);
}

// Verify byte-by-byte
for (let i = 0; i < keyBytes.length; i++) {
    if (decrypted[i] !== keyBytes[i]) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'data-mismatch', index: i }));
        process.exit(1);
    }
}

// Wipe sensitive data
keyBytes.fill(0);
decrypted.fill(0);

console.log(JSON.stringify({ status: 'OK', encryptedLength: encrypted.length }));
'@

$protectScriptPath = Join-Path $tempDir '_protect.mjs'
Set-Content -LiteralPath $protectScriptPath -Value $protectScript -Encoding UTF8

$protectResult = Invoke-NodeWithOutput -ArgumentList @($protectScriptPath) -WorkingDirectory $tempDir
Remove-Item -LiteralPath $protectScriptPath -Force -ErrorAction SilentlyContinue

if ($protectResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='dpapi-protect'; status='FAIL'; reason='protect-script-failed';
        exitCode=$protectResult.ExitCode; stdout=$protectResult.Stdout; stderr=$protectResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='dpapi-protect'; status='OK' }
$completedStages += 'dpapi-protect'

# ── Stage: dpapi-store ────────────────────────────────────────────────────────
Write-Status @{ stage='dpapi-store'; status='running' }

$storeScript = @'
import { loadNative } from './adapters/secrets-dpapi/src/native.mjs';
import { byteStore } from './adapters/secrets-dpapi/src/store.ts';

const native = loadNative();

// Create a store in local-single mode
const store = byteStore(native, 'local-single', []);

// Test all valid key names
const keys = ['DB_MASTER_KEY', 'FILE_ENC_KEY', 'PII_ENC_KEY'];
const originalValues = new Map();

for (const name of keys) {
    // Generate random 32-byte key
    const keyBytes = new Uint8Array(32);
    crypto.getRandomValues(keyBytes);
    originalValues.set(name, new Uint8Array(keyBytes)); // Copy for comparison
    
    // Protect with version 1
    const record = store.protect(name, { bytes: keyBytes, version: 1 });
    
    // Verify record has expected shape
    if (!record.name || !record.ciphertext || typeof record.version !== 'number') {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'bad-record-shape', key: name, record }));
        process.exit(1);
    }
    
    // Wipe original
    keyBytes.fill(0);
}

// Close store
store.close();

// Create a new store with the protected records to read them back
const records = [];
for (const name of keys) {
    const keyBytes = new Uint8Array(32);
    crypto.getRandomValues(keyBytes);
    const tempStore = byteStore(native, 'local-single', []);
    records.push(tempStore.protect(name, { bytes: keyBytes, version: 1 }));
    keyBytes.fill(0);
    tempStore.close();
}

const store2 = byteStore(native, 'local-single', records);
for (const name of keys) {
    const result = await store2.getBytesWithVersion(name);
    if (!result || result.bytes.length !== 32) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'get-failed', key: name }));
        process.exit(1);
    }
    result.bytes.fill(0);
}
store2.close();

// Verify OFFICE_CA_KEY is rejected in local-single mode
const store3 = byteStore(native, 'local-single', []);
try {
    store3.protect('OFFICE_CA_KEY', { bytes: new Uint8Array(32), version: 1 });
    console.log(JSON.stringify({ status: 'FAIL', reason: 'office-key-accepted' }));
    process.exit(1);
} catch (e) {
    // Expected: OFFICE_CA_KEY not valid in local-single mode
}
store3.close();

console.log(JSON.stringify({ status: 'OK', keysProtected: keys.length }));
'@

$storeScriptPath = Join-Path $tempDir '_store.mjs'
Set-Content -LiteralPath $storeScriptPath -Value $storeScript -Encoding UTF8

$storeResult = Invoke-NodeWithOutput -ArgumentList @($storeScriptPath) -WorkingDirectory $tempDir
Remove-Item -LiteralPath $storeScriptPath -Force -ErrorAction SilentlyContinue

if ($storeResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='dpapi-store'; status='FAIL'; reason='store-script-failed';
        exitCode=$storeResult.ExitCode; stdout=$storeResult.Stdout; stderr=$storeResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='dpapi-store'; status='OK' }
$completedStages += 'dpapi-store'

# ── Stage: build-adapters ─────────────────────────────────────────────────────
# Build packages that need compilation for Node ESM:
# - contracts: has relative imports that need .js extensions in output
# - db-sqlite: has TypeScript parameter properties
# - audio-file: has relative imports that need .js extensions in output
Write-Status @{ stage='build-adapters'; status='running' }

$buildContractsResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/contracts build' -WorkingDirectory $tempDir

if ($buildContractsResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='build-adapters'; status='FAIL'; reason='contracts-build-failed';
        exitCode=$buildContractsResult.ExitCode; stdout=$buildContractsResult.Stdout; stderr=$buildContractsResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

# Patch contracts package.json to point exports to compiled dist/
$contractsPackageJson = Join-Path $tempDir 'packages/contracts/package.json'
$contractsJson = Get-Content -LiteralPath $contractsPackageJson -Raw | ConvertFrom-Json
$newExports = @{}
foreach ($key in $contractsJson.exports.PSObject.Properties.Name) {
    $value = $contractsJson.exports.$key
    # Transform ./src/X.ts to ./dist/X.js
    $newValue = $value -replace '^\.\/src\/(.*)\.ts$', './dist/$1.js'
    $newExports[$key] = $newValue
}
$contractsJson.exports = $newExports
$contractsJson | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $contractsPackageJson -Encoding UTF8

$buildSqliteResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/db-sqlite build' -WorkingDirectory $tempDir

if ($buildSqliteResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='build-adapters'; status='FAIL'; reason='db-sqlite-build-failed';
        exitCode=$buildSqliteResult.ExitCode; stdout=$buildSqliteResult.Stdout; stderr=$buildSqliteResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

$buildAudioResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/audio-file build' -WorkingDirectory $tempDir

if ($buildAudioResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='build-adapters'; status='FAIL'; reason='audio-file-build-failed';
        exitCode=$buildAudioResult.ExitCode; stdout=$buildAudioResult.Stdout; stderr=$buildAudioResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='build-adapters'; status='OK' }
$completedStages += 'build-adapters'

# ── Stage: encrypted-sqlite ───────────────────────────────────────────────────
Write-Status @{ stage='encrypted-sqlite'; status='running' }

$sqliteScript = @'
import { loadNative } from './adapters/secrets-dpapi/src/native.mjs';
import { byteStore } from './adapters/secrets-dpapi/src/store.ts';
// Use compiled JavaScript from dist/ to avoid parameter property syntax error
import { openEncryptedSqlite } from './adapters/db-sqlite/dist/index.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const native = loadNative();

// Generate a real 32-byte key via DPAPI
const keyBytes = new Uint8Array(32);
crypto.getRandomValues(keyBytes);
const store = byteStore(native, 'local-single', []);
const keyRecord = store.protect('DB_MASTER_KEY', { bytes: keyBytes, version: 1 });
store.close();

// Use the raw key for SQLite (in production this comes from the store)
const testDir = mkdtempSync(join(tmpdir(), 'e7-sqlite-'));
const dbPath = join(testDir, 'test.db');

try {
    const db = openEncryptedSqlite({ filename: dbPath, key: keyBytes });
    
    // Create a table and insert data
    await db.prepare('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)').run();
    const insertResult = await db.prepare('INSERT INTO test (value) VALUES (?)').bind('hello').run();
    
    // Database port contract: run() returns { results: [], success, meta: { changes?, last_row_id? } }
    if (!insertResult.success || insertResult.meta.changes !== 1) {
        console.log(JSON.stringify({ 
            status: 'FAIL', 
            reason: 'insert-meta-wrong',
            insertResult
        }));
        process.exit(1);
    }
    
    // Query back and verify
    const row = await db.prepare('SELECT value FROM test WHERE id = 1').first();
    if (!row || row.value !== 'hello') {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'select-failed', row }));
        process.exit(1);
    }
    
    // Close database
    db.close();
    
    // Wipe key
    keyBytes.fill(0);
    
    console.log(JSON.stringify({ status: 'OK', dbPath }));
} finally {
    // Cleanup
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
}
'@

$sqliteScriptPath = Join-Path $tempDir '_sqlite.mjs'
Set-Content -LiteralPath $sqliteScriptPath -Value $sqliteScript -Encoding UTF8

$sqliteResult = Invoke-NodeWithOutput -ArgumentList @($sqliteScriptPath) -WorkingDirectory $tempDir
Remove-Item -LiteralPath $sqliteScriptPath -Force -ErrorAction SilentlyContinue

if ($sqliteResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='encrypted-sqlite'; status='FAIL'; reason='sqlite-script-failed';
        exitCode=$sqliteResult.ExitCode; stdout=$sqliteResult.Stdout; stderr=$sqliteResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='encrypted-sqlite'; status='OK' }
$completedStages += 'encrypted-sqlite'

# ── Stage: audio-store ────────────────────────────────────────────────────────
Write-Status @{ stage='audio-store'; status='running' }

$audioScript = @'
// createFileAudioStore(rootPath: string, fileKey: VersionedSecretBytes): Promise<AudioStore>
// Use compiled JavaScript from dist/ for production parity
import { createFileAudioStore } from './adapters/audio-file/dist/index.js';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Test 1: Basic functionality with system temp
const testDir1 = mkdtempSync(join(tmpdir(), 'e7-audio-'));
const fileKeyBytes = new Uint8Array(32);
crypto.getRandomValues(fileKeyBytes);
const fileKey = { bytes: fileKeyBytes, version: 1 };

try {
    const store1 = await createFileAudioStore(testDir1, fileKey);
    
    // Verify store has the expected AudioStore interface methods
    const requiredMethods = ['createUploadTarget', 'createDownloadTarget', 'delete', 'put', 'get'];
    for (const method of requiredMethods) {
        if (typeof store1[method] !== 'function') {
            console.log(JSON.stringify({ status: 'FAIL', reason: `no-${method}` }));
            process.exit(1);
        }
    }
    
    // Test 2: Non-ASCII path (Unicode)
    const unicodeName = '\uD14C\uC2A4\uD2B8_\u30C6\u30B9\u30C8_\uD83D\uDD10';
    const unicodeSubdir = join(testDir1, unicodeName);
    mkdirSync(unicodeSubdir, { mode: 0o700 });
    
    const store2 = await createFileAudioStore(unicodeSubdir, fileKey);
    if (typeof store2.createUploadTarget !== 'function') {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'no-createUploadTarget-unicode' }));
        process.exit(1);
    }
    
    // Wipe key
    fileKeyBytes.fill(0);
    
    console.log(JSON.stringify({ status: 'OK', unicodePath: unicodeSubdir }));
} finally {
    try { rmSync(testDir1, { recursive: true, force: true }); } catch {}
}
'@

$audioScriptPath = Join-Path $tempDir '_audio.mjs'
Set-Content -LiteralPath $audioScriptPath -Value $audioScript -Encoding UTF8

$audioResult = Invoke-NodeWithOutput -ArgumentList @($audioScriptPath) -WorkingDirectory $tempDir
Remove-Item -LiteralPath $audioScriptPath -Force -ErrorAction SilentlyContinue

if ($audioResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='audio-store'; status='FAIL'; reason='audio-script-failed';
        exitCode=$audioResult.ExitCode; stdout=$audioResult.Stdout; stderr=$audioResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='audio-store'; status='OK' }
$completedStages += 'audio-store'

# ── Stage: scheduler ──────────────────────────────────────────────────────────
Write-Status @{ stage='scheduler'; status='running' }

$schedulerScript = @'
import { createNodeScheduler } from './adapters/scheduler-node/src/index.ts';

let runCount = 0;
let errorCount = 0;
const scheduler = createNodeScheduler(
    async (kind, nowIso) => { runCount++; return { kind, nowIso }; },
    (err) => { errorCount++; console.error('Scheduler error:', err); }
);

// Test 1: Verify interface exists
if (typeof scheduler.schedule !== 'function') {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'no-schedule' }));
    process.exit(1);
}
if (typeof scheduler.close !== 'function') {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'no-close' }));
    process.exit(1);
}

// Test 2: Schedule with a cron expression
await scheduler.schedule('pii_retention', '* * * * *');

// Test 3: Verify invalid job kind is rejected
try {
    await scheduler.schedule('invalid_job_kind', '* * * * *');
    console.log(JSON.stringify({ status: 'FAIL', reason: 'accepted-invalid-kind' }));
    process.exit(1);
} catch (e) {
    // Expected: unsupported_scheduled_job
}

// Test 4: Verify invalid cron is rejected  
try {
    await scheduler.schedule('pii_retention', 'not-a-cron');
    console.log(JSON.stringify({ status: 'FAIL', reason: 'accepted-invalid-cron' }));
    process.exit(1);
} catch (e) {
    // Expected: unsupported_cron_expression
}

scheduler.close();

console.log(JSON.stringify({ status: 'OK', hasInterface: true, errorCount }));
'@

$schedulerScriptPath = Join-Path $tempDir '_scheduler.mjs'
Set-Content -LiteralPath $schedulerScriptPath -Value $schedulerScript -Encoding UTF8

$schedulerResult = Invoke-NodeWithOutput -ArgumentList @($schedulerScriptPath) -WorkingDirectory $tempDir
Remove-Item -LiteralPath $schedulerScriptPath -Force -ErrorAction SilentlyContinue

if ($schedulerResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='scheduler'; status='FAIL'; reason='scheduler-script-failed';
        exitCode=$schedulerResult.ExitCode; stdout=$schedulerResult.Stdout; stderr=$schedulerResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='scheduler'; status='OK' }
$completedStages += 'scheduler'

# ── Stage: identity ───────────────────────────────────────────────────────────
Write-Status @{ stage='identity'; status='running' }

$identityScript = @'
import { createLocalSingleIdentity } from './apps/local-service/src/identity.ts';

const config = {
    interactiveUsername: 'TestWindowsUser',
    orgId: 'test-org',
    roles: ['institution-admin', 'worker'],
};

const identity = createLocalSingleIdentity(config);

// Check the bearer token exists (memory-only, generated fresh each time)
if (!identity.bearer || identity.bearer.length < 32) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'no-bearer' }));
    process.exit(1);
}

// Check stableUserId is derived (hashed from username, stable across restarts)
if (!identity.stableUserId || identity.stableUserId.length === 0) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'no-stableUserId' }));
    process.exit(1);
}

// Test resolve with correct bearer
const actor = await identity.resolve({ headers: { get: (name) => name === 'authorization' ? `Bearer ${identity.bearer}` : null } });
if (!actor || actor.userId !== identity.stableUserId) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'resolve-failed', actor, expected: identity.stableUserId }));
    process.exit(1);
}

// Test resolve with wrong bearer throws error
try {
    await identity.resolve({ headers: { get: (name) => name === 'authorization' ? 'Bearer wrong-token' : null } });
    console.log(JSON.stringify({ status: 'FAIL', reason: 'accepted-bad-bearer' }));
    process.exit(1);
} catch (e) {
    // Expected: ActorAuthenticationError
    if (!e.message.includes('invalid bearer')) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-error', message: e.message }));
        process.exit(1);
    }
}

// Clean up
identity.close();

console.log(JSON.stringify({ status: 'OK', hasBearer: true, stableUserId: identity.stableUserId }));
'@

$identityScriptPath = Join-Path $tempDir '_identity.mjs'
Set-Content -LiteralPath $identityScriptPath -Value $identityScript -Encoding UTF8

$identityResult = Invoke-NodeWithOutput -ArgumentList @($identityScriptPath) -WorkingDirectory $tempDir
Remove-Item -LiteralPath $identityScriptPath -Force -ErrorAction SilentlyContinue

if ($identityResult.ExitCode -ne 0) {
    $listing = Get-DirListing $tempDir
    Write-Status @{ 
        stage='identity'; status='FAIL'; reason='identity-script-failed';
        exitCode=$identityResult.ExitCode; stdout=$identityResult.Stdout; stderr=$identityResult.Stderr;
        tempDirListing=$listing; preservedTempDir=$tempDir
    }
    exit 1
}

Write-Status @{ stage='identity'; status='OK' }
$completedStages += 'identity'

# ── Stage: cleanup ────────────────────────────────────────────────────────────
Write-Status @{ stage='cleanup'; status='running' }

# Remove temp directory on success
Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue

Write-Status @{ stage='cleanup'; status='OK'; completedStages=($completedStages -join ',') }

exit 0
