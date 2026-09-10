# E7 Local Single Windows Proof Script v14
# Validates DPAPI native bindings, encrypted SQLite, and full service composition
# Run from the extracted bundle directory - sources are alongside this script

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
        [string]$Script,
        [string]$WorkingDirectory
    )
    $pinfo = New-Object System.Diagnostics.ProcessStartInfo
    $pinfo.FileName = 'node'
    $pinfo.Arguments = "--experimental-strip-types -e `"$Script`""
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

# -- Stage: validate -----------------------------------------------------------
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

# We run from extracted directory - sources are alongside this script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Verify source-bundle.json exists (manifest proves extraction integrity)
$manifest = Join-Path $scriptDir 'source-bundle.json'
if (-not (Test-Path $manifest)) {
    Write-Status @{ stage='validate'; status='FAIL'; reason='no-manifest'; expected=$manifest }
    exit 1
}

Write-Status @{ stage='validate'; status='OK'; nodeVersion=$nodeVersion; pnpmVersion=$pnpmVersion }
$completedStages += 'validate'

# -- Stage: setup --------------------------------------------------------------
Write-Status @{ stage='setup'; status='running' }

# Use the script directory as the working directory (sources extracted here)
$workDir = $scriptDir

# Verify key files exist before proceeding
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
    'apps/local-service/src/bind-validation.ts',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'source-bundle.json'
)

$missingFiles = @()
foreach ($file in $requiredFiles) {
    $fullPath = Join-Path $workDir $file
    if (-not (Test-Path $fullPath)) {
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{ stage='setup'; status='FAIL'; reason='missing-files'; files=($missingFiles -join ','); listing=$listing }
    exit 1
}

$files = Get-ChildItem -Path $workDir -Recurse -File | Measure-Object
$dirs = Get-ChildItem -Path $workDir -Recurse -Directory | Measure-Object

Write-Status @{ stage='setup'; status='OK'; workDir=$workDir; fileCount=$files.Count; dirCount=$dirs.Count }
$completedStages += 'setup'

# -- Stage: install ------------------------------------------------------------
Write-Status @{ stage='install'; status='running' }

$installResult = Invoke-CmdWithOutput -Command 'pnpm install --frozen-lockfile' -WorkingDirectory $workDir

if ($installResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{ 
        stage='install'; status='FAIL'; reason='pnpm-install-failed';
        exitCode=$installResult.ExitCode; stdout=$installResult.Stdout; stderr=$installResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='install'; status='OK' }
$completedStages += 'install'

# -- Stage: build-native -------------------------------------------------------
Write-Status @{ stage='build-native'; status='running' }

$buildNativeResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/secrets-dpapi build' -WorkingDirectory $workDir

if ($buildNativeResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{ 
        stage='build-native'; status='FAIL'; reason='native-build-failed';
        exitCode=$buildNativeResult.ExitCode; stdout=$buildNativeResult.Stdout; stderr=$buildNativeResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='build-native'; status='OK' }
$completedStages += 'build-native'

# -- Stage: dpapi-tests --------------------------------------------------------
Write-Status @{ stage='dpapi-tests'; status='running' }

$dpapiTestResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/secrets-dpapi test' -WorkingDirectory $workDir

if ($dpapiTestResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='dpapi-tests'; status='FAIL'; reason='tests-failed';
        exitCode=$dpapiTestResult.ExitCode; stdout=$dpapiTestResult.Stdout; stderr=$dpapiTestResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='dpapi-tests'; status='OK' }
$completedStages += 'dpapi-tests'

# -- Stage: dpapi-protect ------------------------------------------------------
Write-Status @{ stage='dpapi-protect'; status='running' }

$protectScript = @'
import { loadNative } from './adapters/secrets-dpapi/src/native.mjs';
const native = loadNative();
// loadNative() returns a binding object with protectData and unprotectData
if (!native || typeof native.protectData !== 'function') {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'loadNative-failed', native: native }));
    process.exit(1);
}

const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const entropy = new Uint8Array([9, 10, 11, 12]);
const encrypted = native.protectData(testData, entropy);
if (!encrypted || encrypted.length < testData.length) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'protect-failed' }));
    process.exit(1);
}

const decrypted = native.unprotectData(encrypted, entropy);
if (!decrypted || decrypted.length !== testData.length) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'unprotect-failed' }));
    process.exit(1);
}

for (let i = 0; i < testData.length; i++) {
    if (testData[i] !== decrypted[i]) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'data-mismatch', i }));
        process.exit(1);
    }
}

console.log(JSON.stringify({ status: 'OK', encryptedLength: encrypted.length }));
'@

$protectResult = Invoke-NodeWithOutput -Script $protectScript -WorkingDirectory $workDir

if ($protectResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{ 
        stage='dpapi-protect'; status='FAIL'; reason='dpapi-protect-script-failed';
        exitCode=$protectResult.ExitCode; stdout=$protectResult.Stdout; stderr=$protectResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='dpapi-protect'; status='OK' }
$completedStages += 'dpapi-protect'

# -- Stage: dpapi-store --------------------------------------------------------
Write-Status @{ stage='dpapi-store'; status='running' }

$storeScript = @'
import { loadNative } from './adapters/secrets-dpapi/src/native.mjs';
import { byteStore } from './adapters/secrets-dpapi/src/store.ts';

const native = loadNative();

// Create a store with no existing records
const store = byteStore(native, 'local-single', []);

// Test keys - must be valid names from the Name type
const keys = ['DB_MASTER_KEY', 'DB_HMAC_KEY', 'AUDIO_FILE_KEY'];
const originalValues = new Map();

// Protect some test data using proper VersionedSecretBytes interface
for (const name of keys) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    originalValues.set(name, new Uint8Array(bytes));

    // protect(name, secret: VersionedSecretBytes) returns DpapiRecord
    const record = store.protect(name, { bytes, version: 1 });
    if (!record || !record.encrypted || !record.nonce) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'protect-failed', key: name }));
        process.exit(1);
    }
}

// Export records for persistence simulation
const records = keys.map(name => store.protect(name, { bytes: originalValues.get(name), version: 1 }));
store.close();

// Create a new store with the protected records to read them back
const store2 = byteStore(native, 'local-single', records);
for (const name of keys) {
    const result = await store2.getBytesWithVersion(name);
    if (!result || result.bytes.length !== 32) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'get-failed', key: name }));
        process.exit(1);
    }

    // Verify the decrypted value matches the original
    const original = originalValues.get(name);
    let match = true;
    for (let i = 0; i < 32; i++) {
        if (result.bytes[i] !== original[i]) { match = false; break; }
    }
    if (!match) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'data-mismatch', key: name }));
        process.exit(1);
    }
    result.bytes.fill(0);
}
store2.close();

// Verify OFFICE_CA_KEY is rejected in local-single mode
const store3 = byteStore(native, 'local-single', []);
try {
    store3.protect('OFFICE_CA_KEY', { bytes: new Uint8Array(32), version: 1 });
    console.log(JSON.stringify({ status: 'FAIL', reason: 'should-reject-office-key' }));
    process.exit(1);
} catch (e) {
    // Expected - OFFICE_CA_KEY is not allowed in local-single mode
}
store3.close();

console.log(JSON.stringify({ status: 'OK', keysProtected: keys.length }));
'@

$storeResult = Invoke-NodeWithOutput -Script $storeScript -WorkingDirectory $workDir

if ($storeResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='dpapi-store'; status='FAIL'; reason='dpapi-store-script-failed';
        exitCode=$storeResult.ExitCode; stdout=$storeResult.Stdout; stderr=$storeResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='dpapi-store'; status='OK' }
$completedStages += 'dpapi-store'

# -- Stage: build-adapters -----------------------------------------------------
Write-Status @{ stage='build-adapters'; status='running' }

# db-sqlite has TypeScript parameter properties which require compilation
# (Node strip-only mode rejects parameter properties with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX)
$buildSqliteResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/db-sqlite build' -WorkingDirectory $workDir

if ($buildSqliteResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='build-adapters'; status='FAIL'; reason='db-sqlite-build-failed';
        exitCode=$buildSqliteResult.ExitCode; stdout=$buildSqliteResult.Stdout; stderr=$buildSqliteResult.Stderr
    }
    exit 1
}

# Build audio-file adapter for production parity
$buildAudioResult = Invoke-CmdWithOutput -Command 'pnpm --filter @ccc/audio-file build' -WorkingDirectory $workDir

if ($buildAudioResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='build-adapters'; status='FAIL'; reason='audio-file-build-failed';
        exitCode=$buildAudioResult.ExitCode; stdout=$buildAudioResult.Stdout; stderr=$buildAudioResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='build-adapters'; status='OK' }
$completedStages += 'build-adapters'

# -- Stage: encrypted-sqlite ---------------------------------------------------
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
    
    // Create a test table and insert data
    db.prepare('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)').run();
    db.prepare('INSERT INTO test (value) VALUES (?)').bind('hello').run();
    
    // Read it back
    const result = db.prepare('SELECT value FROM test WHERE id = 1').first();
    if (!result || result.value !== 'hello') {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'data-mismatch', result }));
        process.exit(1);
    }
    
    db.close();
    
    // Verify encrypted file cannot be read without key
    try {
        const db2 = openEncryptedSqlite({ filename: dbPath, key: new Uint8Array(32), fileMustExist: true });
        db2.prepare('SELECT * FROM test').all();
        db2.close();
        console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-key-should-fail' }));
        process.exit(1);
    } catch (e) {
        // Expected - wrong key should fail
    }
    
    console.log(JSON.stringify({ status: 'OK', dbPath }));
} finally {
    rmSync(testDir, { recursive: true, force: true });
}
'@

$sqliteResult = Invoke-NodeWithOutput -Script $sqliteScript -WorkingDirectory $workDir

if ($sqliteResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='encrypted-sqlite'; status='FAIL'; reason='sqlite-script-failed';
        exitCode=$sqliteResult.ExitCode; stdout=$sqliteResult.Stdout; stderr=$sqliteResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='encrypted-sqlite'; status='OK' }
$completedStages += 'encrypted-sqlite'

# -- Stage: audio-store --------------------------------------------------------
Write-Status @{ stage='audio-store'; status='running' }

$audioScript = @'
// createFileAudioStore(rootPath: string, fileKey: VersionedSecretBytes): Promise<AudioStore>
// Use compiled JavaScript from dist/ for production parity
import { createFileAudioStore } from './adapters/audio-file/dist/index.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const testDir = mkdtempSync(join(tmpdir(), 'e7-audio-'));

try {
    // Generate a file encryption key (32 bytes for AES-256)
    const fileKeyBytes = new Uint8Array(32);
    crypto.getRandomValues(fileKeyBytes);
    
    // Create the audio store with VersionedSecretBytes interface
    const store = await createFileAudioStore(testDir, { bytes: fileKeyBytes, version: 1 });
    
    // Create test audio data (simulated WAV file)
    const testAudio = new Uint8Array(1024);
    crypto.getRandomValues(testAudio);
    
    // Store audio with metadata
    const key = await store.store(testAudio, { sessionId: 'sess-001', recordedAt: new Date().toISOString() });
    if (!key || typeof key !== 'string') {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'store-failed', key }));
        process.exit(1);
    }
    
    // Retrieve it
    const retrieved = await store.get(key);
    if (!retrieved || retrieved.length !== testAudio.length) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'get-failed', retrievedLength: retrieved?.length }));
        process.exit(1);
    }
    
    // Verify data matches
    for (let i = 0; i < testAudio.length; i++) {
        if (testAudio[i] !== retrieved[i]) {
            console.log(JSON.stringify({ status: 'FAIL', reason: 'data-mismatch', i }));
            process.exit(1);
        }
    }
    
    // Delete and verify
    const evidence = await store.delete(key);
    if (!evidence || !evidence.sha256 || !evidence.deletedAt) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'delete-failed', evidence }));
        process.exit(1);
    }
    
    // Verify deleted
    const afterDelete = await store.get(key);
    if (afterDelete !== null) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'should-be-deleted' }));
        process.exit(1);
    }
    
    console.log(JSON.stringify({ status: 'OK', key, evidenceSha256: evidence.sha256 }));
} finally {
    rmSync(testDir, { recursive: true, force: true });
}
'@

$audioResult = Invoke-NodeWithOutput -Script $audioScript -WorkingDirectory $workDir

if ($audioResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='audio-store'; status='FAIL'; reason='audio-script-failed';
        exitCode=$audioResult.ExitCode; stdout=$audioResult.Stdout; stderr=$audioResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='audio-store'; status='OK' }
$completedStages += 'audio-store'

# -- Stage: scheduler ----------------------------------------------------------
Write-Status @{ stage='scheduler'; status='running' }

$schedulerScript = @'
import { createNodeScheduler } from './adapters/scheduler-node/src/index.ts';

// Create scheduler with test config
const scheduler = createNodeScheduler({
    onFailure: (failure) => {
        console.error('Scheduler failure:', failure);
    }
});

// Test scheduling a job
let jobRan = false;
const jobId = scheduler.schedule('test-job', 100, async () => {
    jobRan = true;
});

if (!jobId || typeof jobId !== 'string') {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'schedule-failed', jobId }));
    process.exit(1);
}

// Cancel before it runs
scheduler.cancel(jobId);

// Wait a bit and verify it didn't run
await new Promise(r => setTimeout(r, 200));

if (jobRan) {
    console.log(JSON.stringify({ status: 'FAIL', reason: 'cancelled-job-ran' }));
    process.exit(1);
}

// Stop scheduler
await scheduler.stop();

console.log(JSON.stringify({ status: 'OK', jobId }));
'@

$schedulerResult = Invoke-NodeWithOutput -Script $schedulerScript -WorkingDirectory $workDir

if ($schedulerResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='scheduler'; status='FAIL'; reason='scheduler-script-failed';
        exitCode=$schedulerResult.ExitCode; stdout=$schedulerResult.Stdout; stderr=$schedulerResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='scheduler'; status='OK' }
$completedStages += 'scheduler'

# -- Stage: identity -----------------------------------------------------------
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

// Test resolve with wrong bearer fails
try {
    await identity.resolve({ headers: { get: (name) => name === 'authorization' ? 'Bearer wrong-token' : null } });
    console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-bearer-should-fail' }));
    process.exit(1);
} catch (e) {
    // Expected
}

console.log(JSON.stringify({ status: 'OK', stableUserId: identity.stableUserId, bearerLength: identity.bearer.length }));
'@

$identityResult = Invoke-NodeWithOutput -Script $identityScript -WorkingDirectory $workDir

if ($identityResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='identity'; status='FAIL'; reason='identity-script-failed';
        exitCode=$identityResult.ExitCode; stdout=$identityResult.Stdout; stderr=$identityResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='identity'; status='OK' }
$completedStages += 'identity'

# -- Stage: bind-validation ----------------------------------------------------
Write-Status @{ stage='bind-validation'; status='running' }

$bindScript = @'
import { isRfc1918, validateBindAddress } from './apps/local-service/src/bind-validation.ts';

// Test RFC1918 detection
const rfc1918Tests = [
    { ip: '10.0.0.1', expected: true },
    { ip: '10.255.255.255', expected: true },
    { ip: '172.16.0.1', expected: true },
    { ip: '172.31.255.255', expected: true },
    { ip: '172.15.255.255', expected: false },
    { ip: '172.32.0.1', expected: false },
    { ip: '192.168.0.1', expected: true },
    { ip: '192.168.255.255', expected: true },
    { ip: '8.8.8.8', expected: false },
    { ip: '1.1.1.1', expected: false },
    { ip: '127.0.0.1', expected: false },
];

for (const test of rfc1918Tests) {
    const result = isRfc1918(test.ip);
    if (result !== test.expected) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'rfc1918-mismatch', ip: test.ip, expected: test.expected, got: result }));
        process.exit(1);
    }
}

// Test validateBindAddress
const validCases = [
    { host: '192.168.1.10', cidr: '192.168.1.0/24' },
    { host: '10.0.0.5', cidr: '10.0.0.0/8' },
    { host: '172.16.5.100', cidr: '172.16.0.0/12' },
];

for (const test of validCases) {
    try {
        validateBindAddress(test.host, test.cidr);
    } catch (e) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'valid-should-pass', host: test.host, cidr: test.cidr, error: e.message }));
        process.exit(1);
    }
}

// Test public IP rejection
try {
    validateBindAddress('8.8.8.8', '8.8.8.0/24');
    console.log(JSON.stringify({ status: 'FAIL', reason: 'public-ip-should-fail' }));
    process.exit(1);
} catch (e) {
    if (!e.message.includes('bind_address_not_private')) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-error', expected: 'bind_address_not_private', got: e.message }));
        process.exit(1);
    }
}

// Test host outside CIDR rejection
try {
    validateBindAddress('192.168.2.10', '192.168.1.0/24');
    console.log(JSON.stringify({ status: 'FAIL', reason: 'outside-cidr-should-fail' }));
    process.exit(1);
} catch (e) {
    if (!e.message.includes('host_outside_cidr')) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-error', expected: 'host_outside_cidr', got: e.message }));
        process.exit(1);
    }
}

// Test invalid CIDR rejection
try {
    validateBindAddress('192.168.1.10', 'invalid');
    console.log(JSON.stringify({ status: 'FAIL', reason: 'invalid-cidr-should-fail' }));
    process.exit(1);
} catch (e) {
    if (!e.message.includes('invalid_private_cidr')) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-error', expected: 'invalid_private_cidr', got: e.message }));
        process.exit(1);
    }
}

// Test CIDR prefix out of range
try {
    validateBindAddress('192.168.1.10', '192.168.1.0/31');
    console.log(JSON.stringify({ status: 'FAIL', reason: 'prefix-31-should-fail' }));
    process.exit(1);
} catch (e) {
    if (!e.message.includes('invalid_cidr_prefix')) {
        console.log(JSON.stringify({ status: 'FAIL', reason: 'wrong-error', expected: 'invalid_cidr_prefix', got: e.message }));
        process.exit(1);
    }
}

console.log(JSON.stringify({ status: 'OK', rfc1918Tests: rfc1918Tests.length, validCases: validCases.length }));
'@

$bindResult = Invoke-NodeWithOutput -Script $bindScript -WorkingDirectory $workDir

if ($bindResult.ExitCode -ne 0) {
    $listing = Get-DirListing $workDir
    Write-Status @{
        stage='bind-validation'; status='FAIL'; reason='bind-validation-script-failed';
        exitCode=$bindResult.ExitCode; stdout=$bindResult.Stdout; stderr=$bindResult.Stderr
    }
    exit 1
}

Write-Status @{ stage='bind-validation'; status='OK' }
$completedStages += 'bind-validation'

# -- Stage: cleanup ------------------------------------------------------------
Write-Status @{ stage='cleanup'; status='running' }

# Success - note that workDir is the extraction directory, not a temp dir
# The user should clean up the extracted directory manually if desired

Write-Status @{ stage='cleanup'; status='OK'; completedStages=($completedStages -join ',') }

exit 0
