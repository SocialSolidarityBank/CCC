#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  configuredInstallTrust,
  hashCanonical,
  readStrictJsonDocument,
  requireSignedOwnerPreflight,
} from '../supabase/manifest-preflight.mjs';
import {
  createInstitution,
  inspectInstitution as inspectInstalledInstitution,
} from '../supabase/institution.mjs';
import {
  inspectFirstAdmin as inspectInstalledFirstAdmin,
  linkFirstAdmin as linkInstalledFirstAdmin,
} from '../supabase/first-admin.mjs';
import { withInstallerConnection } from '../supabase/installer-connection.mjs';
import { withInstallLock } from '../supabase/install-journal.mjs';
import { runSupabaseBootstrap } from '../supabase/bootstrap.mjs';
import { verifyCreatedInstallation } from './cloud.mjs';
import { assertSameApprovedStage } from './flow.mjs';
import { assertSafeOutput } from '../supabase/report.mjs';

const EMAIL = /^[^\s@;,'"\\]{1,64}@[A-Za-z0-9][A-Za-z0-9.-]{0,180}\.[A-Za-z]{2,24}$/u;
const NAME = /^[^\p{Cc}\p{Cf}]{1,120}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const AUTH_SUBJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MARKER = /^[A-Za-z0-9_-]{32,128}$/u;
const PHASES = ['approved', 'institution-ready', 'invite-submitted', 'invited', 'accepted', 'bound'];
const JOURNAL_KEYS = [
  'schemaVersion', 'requestSha256', 'emailSha256', 'nameSha256', 'approved', 'phase',
  'inviteTtlSeconds', 'markerSha256', 'submittedAt', 'sentAt', 'acceptedAt', 'boundAt',
  'expiresAt', 'authSubjectSha256', 'link',
];

const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha256 = value => createHash('sha256').update(value, 'utf8').digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const instant = value => typeof value === 'string' && !Number.isNaN(Date.parse(value));

function input(options) {
  if (!record(options) || !record(options.request) || !record(options.installation)
    || typeof options.journalPath !== 'string' || options.journalPath.length === 0) fail('FIRST_ADMIN_INPUT_INVALID');
  const email = typeof options.email === 'string' ? options.email.trim().toLowerCase() : '';
  const name = options.name === null || options.name === undefined ? null : String(options.name).trim();
  if (email.length > 254 || !EMAIL.test(email) || (name !== null && !NAME.test(name))) {
    fail('FIRST_ADMIN_INPUT_INVALID');
  }
  return { ...options, email, name };
}

function requiredServices(services) {
  const names = [
    'withLock', 'verifyInstallation', 'inspectFirstAdmin', 'inspectInstitution', 'createInstitution',
    'listAuthUsers', 'inviteAuthUser', 'inviteTtlSeconds', 'linkFirstAdmin', 'now', 'marker',
  ];
  if (!record(services) || names.some(name => typeof services[name] !== 'function')) {
    fail('FIRST_ADMIN_RUNTIME_UNAVAILABLE');
  }
  return services;
}

async function firstAdminJournalPath(value) {
  try {
    const parent = await realpath(dirname(resolve(value)));
    const info = await lstat(parent);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
      fail('FIRST_ADMIN_JOURNAL_INVALID');
    }
    return join(parent, `${basename(value)}.first-admin`);
  } catch (error) {
    if (error?.code === 'FIRST_ADMIN_JOURNAL_INVALID') throw error;
    fail('FIRST_ADMIN_JOURNAL_INVALID');
  }
}

function validJournalPhase(value) {
  const marker = HASH.test(value.markerSha256);
  const submitted = instant(value.submittedAt) && instant(value.expiresAt);
  const sent = instant(value.sentAt) && HASH.test(value.authSubjectSha256);
  const accepted = instant(value.acceptedAt);
  const bound = instant(value.boundAt) && exact(value.link, [
    'userIdSha256', 'emailSha256', 'authSubjectSha256',
  ]) && Object.values(value.link).every(item => HASH.test(item));
  if (['approved', 'institution-ready'].includes(value.phase)) {
    return value.markerSha256 === null && value.submittedAt === null && value.expiresAt === null
      && value.sentAt === null && value.authSubjectSha256 === null
      && value.acceptedAt === null && value.boundAt === null && value.link === null;
  }
  if (value.phase === 'invite-submitted') {
    return marker && submitted && value.sentAt === null && value.authSubjectSha256 === null
      && value.acceptedAt === null && value.boundAt === null && value.link === null;
  }
  if (value.phase === 'invited') {
    return marker && submitted && sent && value.acceptedAt === null
      && value.boundAt === null && value.link === null;
  }
  if (value.phase === 'accepted') {
    return marker && submitted && sent && accepted && value.boundAt === null && value.link === null;
  }
  return value.phase === 'bound' && marker && submitted && sent && accepted && bound;
}

function validJournal(value) {
  return exact(value, JOURNAL_KEYS) && value.schemaVersion === 1
    && [value.requestSha256, value.emailSha256, value.nameSha256].every(item => HASH.test(item))
    && value.approved?.mode === 'community-cloud' && value.approved?.stageId === 'first-admin'
    && Number.isSafeInteger(value.inviteTtlSeconds)
    && value.inviteTtlSeconds >= 60 && value.inviteTtlSeconds <= 604800
    && PHASES.includes(value.phase)
    && validJournalPhase(value);
}

/**
 * The journal is one immutable record per phase at `<path>.<phase>`; the newest present
 * phase is current. Each record is published once with an exclusive link, so a late writer
 * from a lost lock session cannot replace a newer phase: its phase already exists.
 */
async function readJournalPhase(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 8192) {
      fail('FIRST_ADMIN_JOURNAL_INVALID');
    }
    const value = JSON.parse(await file.readFile('utf8'));
    if (!validJournal(value)) fail('FIRST_ADMIN_JOURNAL_INVALID');
    assertSameApprovedStage(value.approved, value.approved, value.approved);
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code === 'FIRST_ADMIN_JOURNAL_INVALID' || error?.code === 'STAGE_BINDING_INVALID') throw error;
    fail('FIRST_ADMIN_JOURNAL_INVALID');
  } finally {
    await file?.close().catch(() => fail('FIRST_ADMIN_JOURNAL_INVALID'));
  }
}

async function readJournal(path) {
  for (const phase of [...PHASES].reverse()) {
    const value = await readJournalPhase(`${path}.${phase}`);
    if (value === null) continue;
    if (value.phase !== phase) fail('FIRST_ADMIN_JOURNAL_INVALID');
    return value;
  }
  return null;
}

async function writeJournal(path, value) {
  if (!validJournal(value)) fail('FIRST_ADMIN_JOURNAL_INVALID');
  const target = `${path}.${value.phase}`;
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  let created = false;
  try {
    file = await open(temporary, 'wx', 0o600);
    created = true;
    await file.writeFile(JSON.stringify(value));
    await file.sync();
    await file.close();
    file = null;
    await link(temporary, target);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail(value.phase === 'approved' ? 'FIRST_ADMIN_RESUME_REQUIRED' : 'FIRST_ADMIN_STATE_INCONSISTENT');
    }
    fail('FIRST_ADMIN_JOURNAL_INVALID');
  } finally {
    await file?.close().catch(() => fail('FIRST_ADMIN_JOURNAL_INVALID'));
    if (created) await unlink(temporary).catch(() => {});
  }
}

/**
 * Durable single-submission fence for the one irreversible external effect. The advisory
 * lock dies with its database session, but a callback that lost its session can still reach
 * this point; the exclusive claim file stops it before the journal write and the send.
 */
async function claimInvitationSubmission(journalPath, markerSha256) {
  const claimPath = `${journalPath}.submission`;
  let file;
  try {
    file = await open(claimPath, 'wx', 0o600);
    await file.writeFile(JSON.stringify({ schemaVersion: 1, markerSha256 }));
    await file.sync();
    const directory = await open(dirname(claimPath), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    if (error?.code === 'EEXIST') fail('FIRST_ADMIN_INVITE_OUTCOME_UNKNOWN');
    fail('FIRST_ADMIN_JOURNAL_INVALID');
  } finally {
    await file?.close().catch(() => fail('FIRST_ADMIN_JOURNAL_INVALID'));
  }
}

function hashes(current) {
  return {
    requestSha256: sha256(JSON.stringify(current.request)),
    emailSha256: sha256(current.email),
    nameSha256: sha256(current.name ?? ''),
  };
}

async function installation(current, services) {
  const target = await services.verifyInstallation(current);
  if (!record(target) || target.productionReady !== true
    || !['projectRefSha256', 'runtimeManifestSha256', 'approvalSha256', 'stateFingerprint']
      .every(key => HASH.test(target[key]))) fail('HEALTH_FAILED');
  return target;
}

function markerUser(users, markerSha256) {
  if (!Array.isArray(users)) fail('PROVIDER_UNREADABLE');
  const matching = users.filter(user => record(user) && record(user.userMetadata)
    && typeof user.userMetadata.relayerFirstAdmin === 'string'
    && sha256(user.userMetadata.relayerFirstAdmin) === markerSha256);
  if (matching.length !== 1) {
    if (matching.length > 1) fail('FIRST_ADMIN_INVITEE_MISMATCH');
    return null;
  }
  return matching[0];
}

function assertInviteUser(
  user,
  current,
  markerSha256,
  expectedSubjectSha256 = null,
  submittedAt = null,
) {
  if (!record(user) || typeof user.id !== 'string' || !AUTH_SUBJECT.test(user.id)
    || typeof user.email !== 'string' || user.email.trim().toLowerCase() !== current.email
    || !record(user.userMetadata) || typeof user.userMetadata.relayerFirstAdmin !== 'string'
    || sha256(user.userMetadata.relayerFirstAdmin) !== markerSha256
    || (expectedSubjectSha256 !== null && sha256(user.id) !== expectedSubjectSha256)) {
    fail('FIRST_ADMIN_INVITEE_MISMATCH');
  }
  if (!instant(user.invitedAt)) fail('PROVIDER_UNREADABLE');
  if (submittedAt !== null && (!instant(submittedAt)
    || Date.parse(user.invitedAt) + 60_000 < Date.parse(submittedAt))) {
    fail('FIRST_ADMIN_INVITEE_MISMATCH');
  }
  for (const value of [user.confirmedAt, user.lastSignInAt]) {
    if (value !== null && (!instant(value) || Date.parse(value) < Date.parse(user.invitedAt))) {
      fail('FIRST_ADMIN_INVITEE_MISMATCH');
    }
  }
  return user;
}

function report(journal) {
  if (journal.phase === 'bound') {
    return {
      operation: 'first-admin', ready: true, status: 'bound', institutionReady: true,
      invitationSent: true, invitationAccepted: true, identityBound: true, mfa: 'optional',
      onboardingSttMode: 'off', onboardingLlmMode: 'off', ...journal.link,
    };
  }
  return {
    operation: 'first-admin', ready: false,
    status: journal.phase === 'accepted' ? 'accepted' : 'invited',
    institutionReady: true, invitationSent: journal.sentAt !== null,
    invitationAccepted: journal.acceptedAt !== null, identityBound: false,
    mfa: 'optional', onboardingSttMode: 'off', onboardingLlmMode: 'off', emailSha256: journal.emailSha256,
  };
}

async function assertJournalInput(current, journal) {
  const currentHashes = hashes(current);
  if (journal.requestSha256 !== currentHashes.requestSha256
    || journal.emailSha256 !== currentHashes.emailSha256
    || journal.nameSha256 !== currentHashes.nameSha256) fail('PLAN_STATE_CHANGED');
}

async function buildFirstAdminPlan(current, services, journalPath) {
  const target = await installation(current, services);
  const existing = await services.inspectFirstAdmin(current);
  if (existing?.state !== 'empty') fail('FIRST_ADMIN_EXISTS');
  const inviteTtlSeconds = await services.inviteTtlSeconds(current);
  if (!Number.isSafeInteger(inviteTtlSeconds)) fail('PROVIDER_UNREADABLE');
  const users = await services.listAuthUsers(current);
  if (!Array.isArray(users)) fail('PROVIDER_UNREADABLE');
  if (users.some(user => typeof user?.email === 'string'
    && user.email.trim().toLowerCase() === current.email)) fail('FIRST_ADMIN_EMAIL_TAKEN');
  const currentHashes = hashes(current);
  const binding = {
    mode: 'community-cloud', stageId: 'first-admin',
    targetSha256: await hashCanonical({
      requestSha256: currentHashes.requestSha256,
      journalPathSha256: sha256(journalPath),
      projectRefSha256: target.projectRefSha256,
      runtimeManifestSha256: target.runtimeManifestSha256,
      approvalSha256: target.approvalSha256,
    }),
    desiredSha256: await hashCanonical({
      emailSha256: currentHashes.emailSha256, nameSha256: currentHashes.nameSha256,
      effects: ['create-institution', 'send-one-invite', 'bind-first-admin'],
    }),
    observedSha256: await hashCanonical({
      stateFingerprint: target.stateFingerprint, firstAdmin: 'empty', invitee: 'absent',
      inviteTtlSeconds,
    }),
  };
  return {
    summary: {
      emailSha256: currentHashes.emailSha256,
      invitationCount: 1,
      createsInstitutionDefaults: true,
      createsAdministratorAfterAcceptance: true,
      mfa: 'optional',
      sttMode: 'off',
      llmMode: 'off',
      inviteTtlSeconds,
      externalTransfers: ['first-admin-email'],
    },
    binding,
  };
}

export async function planFirstAdmin(options, suppliedServices) {
  const current = input(options);
  const services = requiredServices(suppliedServices ?? await createDefaultFirstAdminServices(current));
  const journalPath = await firstAdminJournalPath(current.journalPath);
  return services.withLock(async () => {
    if (await readJournal(journalPath)) fail('FIRST_ADMIN_RESUME_REQUIRED');
    return buildFirstAdminPlan(current, services, journalPath);
  });
}

async function advanceInvitation(current, services, journalPath, initialJournal) {
  let journal = initialJournal;
  if (journal.phase === 'approved') {
    const institutionResult = await services.createInstitution(current);
    if (institutionResult?.ok !== true || institutionResult?.ready !== true
      || institutionResult.sttMode !== 'off' || institutionResult.llmMode !== 'off') {
      fail(institutionResult?.code ?? 'INSTITUTION_STATE_INCONSISTENT');
    }
    journal = { ...journal, phase: 'institution-ready' };
    await writeJournal(journalPath, journal);
  }
  if (journal.phase !== 'institution-ready') return journal;
  const institution = await services.inspectInstitution(current);
  if (institution?.state !== 'ready' || institution.sttMode !== 'off' || institution.llmMode !== 'off') {
    fail('INSTITUTION_STATE_INCONSISTENT');
  }

  const marker = services.marker();
  if (typeof marker !== 'string' || !MARKER.test(marker)) fail('FIRST_ADMIN_RUNTIME_UNAVAILABLE');
  const ttlSeconds = await services.inviteTtlSeconds(current);
  if (ttlSeconds !== journal.inviteTtlSeconds) fail('PLAN_STATE_CHANGED');
  const markerSha256 = sha256(marker);
  await claimInvitationSubmission(journalPath, markerSha256);
  const submittedAt = new Date(services.now()).toISOString();
  journal = {
    ...journal,
    phase: 'invite-submitted',
    markerSha256,
    submittedAt,
    expiresAt: new Date(Date.parse(submittedAt) + ttlSeconds * 1000).toISOString(),
  };
  await writeJournal(journalPath, journal);

  let invited = null;
  try {
    invited = await services.inviteAuthUser({ ...current, marker });
  } catch {}
  if (invited === null) invited = markerUser(await services.listAuthUsers(current), journal.markerSha256);
  if (invited === null) fail('FIRST_ADMIN_INVITE_OUTCOME_UNKNOWN');
  assertInviteUser(invited, current, journal.markerSha256, null, journal.submittedAt);
  journal = {
    ...journal,
    phase: 'invited',
    sentAt: invited.invitedAt,
    authSubjectSha256: sha256(invited.id),
  };
  await writeJournal(journalPath, journal);
  return journal;
}

export async function beginFirstAdmin(options, suppliedServices) {
  const current = input(options);
  const services = requiredServices(suppliedServices ?? await createDefaultFirstAdminServices(current));
  if (!record(current.approved)) fail('FIRST_ADMIN_APPROVAL_REQUIRED');
  const journalPath = await firstAdminJournalPath(current.journalPath);
  return services.withLock(async () => {
    const existingJournal = await readJournal(journalPath);
    if (existingJournal !== null) {
      await assertJournalInput(current, existingJournal);
      if (['approved', 'institution-ready'].includes(existingJournal.phase)) {
        const replanned = await buildFirstAdminPlan(current, services, journalPath);
        assertSameApprovedStage(current.approved, existingJournal.approved, replanned.binding);
        return report(await advanceInvitation(current, services, journalPath, existingJournal));
      }
      return resumeLocked(current, services, journalPath, existingJournal);
    }

    const planned = await buildFirstAdminPlan(current, services, journalPath);
    assertSameApprovedStage(current.approved, planned.binding, planned.binding);
    const journal = {
      schemaVersion: 1,
      ...hashes(current),
      approved: planned.binding,
      phase: 'approved',
      inviteTtlSeconds: planned.summary.inviteTtlSeconds,
      markerSha256: null,
      submittedAt: null,
      sentAt: null,
      acceptedAt: null,
      boundAt: null,
      expiresAt: null,
      authSubjectSha256: null,
      link: null,
    };
    await writeJournal(journalPath, journal);
    return report(await advanceInvitation(current, services, journalPath, journal));
  });
}

export async function resumeFirstAdmin(options, suppliedServices) {
  const current = input(options);
  const services = requiredServices(suppliedServices ?? await createDefaultFirstAdminServices(current));
  const journalPath = await firstAdminJournalPath(current.journalPath);
  return services.withLock(async () => {
    const journal = await readJournal(journalPath);
    if (journal === null) fail('FIRST_ADMIN_JOURNAL_MISSING');
    await assertJournalInput(current, journal);
    return resumeLocked(current, services, journalPath, journal);
  });
}

async function resumeLocked(current, services, journalPath, initialJournal) {
  let journal = initialJournal;
  await installation(current, services);

  const existing = await services.inspectFirstAdmin(current);
  const alreadyBound = journal.phase === 'bound';
  const mayReconcileLink = journal.phase === 'accepted' || alreadyBound;
  if (alreadyBound && existing?.state !== 'linked') fail('FIRST_ADMIN_STATE_INCONSISTENT');
  if (!alreadyBound) {
    const institution = await services.inspectInstitution(current);
    if (institution?.state !== 'ready' || institution.sttMode !== 'off' || institution.llmMode !== 'off') {
      fail('INSTITUTION_STATE_INCONSISTENT');
    }
  }
  if (existing?.state === 'linked' && !mayReconcileLink) fail('FIRST_ADMIN_EXISTS');
  if (!['empty', 'linked'].includes(existing?.state)) fail('FIRST_ADMIN_EXISTS');
  if (['approved', 'institution-ready'].includes(journal.phase)) fail('FIRST_ADMIN_INVITE_NOT_SUBMITTED');
  if (!alreadyBound && await services.inviteTtlSeconds(current) !== journal.inviteTtlSeconds) {
    fail('PLAN_STATE_CHANGED');
  }
  if (journal.markerSha256 === null || journal.expiresAt === null) fail('FIRST_ADMIN_STATE_INCONSISTENT');

  const users = await services.listAuthUsers(current);
  const user = markerUser(users, journal.markerSha256);
  if (user === null) {
    if (users.some(candidate => typeof candidate?.email === 'string'
      && candidate.email.trim().toLowerCase() === current.email)) fail('FIRST_ADMIN_INVITEE_MISMATCH');
    fail('FIRST_ADMIN_INVITE_OUTCOME_UNKNOWN');
  }
  assertInviteUser(user, current, journal.markerSha256, journal.authSubjectSha256, journal.submittedAt);
  if (journal.sentAt === null) {
    journal = {
      ...journal, phase: 'invited', sentAt: user.invitedAt, authSubjectSha256: sha256(user.id),
    };
    await writeJournal(journalPath, journal);
  }
  if (!instant(user.confirmedAt)) {
    if (services.now() >= Date.parse(journal.expiresAt)) fail('FIRST_ADMIN_INVITE_EXPIRED');
    return report(journal);
  }
  if (journal.acceptedAt === null) {
    journal = { ...journal, phase: 'accepted', acceptedAt: user.confirmedAt };
    await writeJournal(journalPath, journal);
  }
  if (!instant(user.lastSignInAt)) return report(journal);

  const linked = await services.linkFirstAdmin({
    authSubject: user.id,
    email: current.email,
    name: current.name,
  });
  if (linked?.ok !== true || linked?.ready !== true
    || !['userIdSha256', 'emailSha256', 'authSubjectSha256'].every(key => HASH.test(linked[key]))) {
    fail(linked?.code ?? 'FIRST_ADMIN_STATE_INCONSISTENT');
  }
  const linkResult = {
    userIdSha256: linked.userIdSha256,
    emailSha256: linked.emailSha256,
    authSubjectSha256: linked.authSubjectSha256,
  };
  if (alreadyBound) {
    if (JSON.stringify(linkResult) !== JSON.stringify(journal.link)) fail('FIRST_ADMIN_STATE_INCONSISTENT');
    return report(journal);
  }
  journal = {
    ...journal,
    phase: 'bound',
    boundAt: new Date(services.now()).toISOString(),
    link: linkResult,
  };
  await writeJournal(journalPath, journal);
  return report(journal);
}

function providerCredential(value) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 4096
    && !/[\u0000-\u0020\u007f]/u.test(value);
}

async function providerJson(fetchImpl, url, init) {
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || response.redirected) fail('PROVIDER_UNREADABLE');
    const reader = response.body?.getReader();
    if (!reader) fail('PROVIDER_UNREADABLE');
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1_048_576) {
          await reader.cancel();
          fail('PROVIDER_UNREADABLE');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch (error) {
    if (error?.code === 'PROVIDER_UNREADABLE') throw error;
    fail('PROVIDER_UNREADABLE');
  }
}

function authUser(value) {
  if (!record(value) || typeof value.id !== 'string' || !AUTH_SUBJECT.test(value.id)
    || (value.email !== undefined && typeof value.email !== 'string')
    || !record(value.user_metadata)) fail('PROVIDER_UNREADABLE');
  const marker = value.user_metadata.relayerFirstAdmin;
  if (marker !== undefined && (typeof marker !== 'string' || !MARKER.test(marker))) {
    fail('PROVIDER_UNREADABLE');
  }
  return {
    id: value.id,
    email: value.email ?? '',
    invitedAt: value.invited_at ?? null,
    confirmedAt: value.confirmed_at ?? null,
    lastSignInAt: value.last_sign_in_at ?? null,
    userMetadata: { relayerFirstAdmin: marker ?? null },
  };
}

export function createSupabaseAuthAdmin({
  authOrigin,
  projectRef,
  serviceRoleKey,
  managementAccessToken,
  redirectTo,
  fetch: fetchImpl = globalThis.fetch,
}) {
  let origin;
  let callback;
  try {
    origin = new URL(authOrigin);
    callback = new URL(redirectTo);
  } catch {
    fail('FIRST_ADMIN_CALLBACK_UNAVAILABLE');
  }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash
    || origin.hostname !== `${projectRef}.supabase.co`
    || !/^[a-z]{20}$/u.test(projectRef)
    || !providerCredential(serviceRoleKey) || !providerCredential(managementAccessToken)
    || typeof fetchImpl !== 'function') fail('FIRST_ADMIN_RUNTIME_UNAVAILABLE');
  if (callback.protocol !== 'https:' || callback.pathname !== '/auth/invite'
    || callback.username || callback.password || callback.search || callback.hash) {
    fail('FIRST_ADMIN_CALLBACK_UNAVAILABLE');
  }
  const headers = {
    accept: 'application/json',
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };
  return {
    async listAuthUsers() {
      const value = await providerJson(
        fetchImpl,
        new URL('/auth/v1/admin/users?page=1&per_page=1000', origin),
        { method: 'GET', headers },
      );
      if (!record(value) || !Array.isArray(value.users)
        || value.users.length > 1000
        || (value.users.length === 1000 && Number(value.total ?? 1001) > 1000)) {
        fail('PROVIDER_UNREADABLE');
      }
      return value.users.map(authUser);
    },
    async inviteAuthUser({ email, marker }) {
      if (typeof email !== 'string' || !EMAIL.test(email) || typeof marker !== 'string' || !MARKER.test(marker)) {
        fail('FIRST_ADMIN_INPUT_INVALID');
      }
      const endpoint = new URL('/auth/v1/invite', origin);
      endpoint.searchParams.set('redirect_to', callback.href);
      const value = await providerJson(
        fetchImpl,
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, data: { relayerFirstAdmin: marker } }),
        },
      );
      return authUser(value);
    },
    async inviteTtlSeconds() {
      const value = await providerJson(
        fetchImpl,
        `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
        {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${managementAccessToken}`,
          },
        },
      );
      if (value?.disable_signup !== true) fail('FIRST_ADMIN_OPEN_SIGNUP_ENABLED');
      const seconds = Number(value.mailer_otp_exp);
      if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 604800) fail('PROVIDER_UNREADABLE');
      return seconds;
    },
  };
}

export async function createDefaultFirstAdminServices(options) {
  const current = input(options);
  const env = process.env;
  let target = null;
  let authAdmin = null;

  async function verifiedTarget() {
    if (target !== null) return target;
    const evidence = await verifyCreatedInstallation({
      request: current.request,
      journalPath: current.journalPath,
      installation: current.installation,
      env,
    });
    const installManifest = current.installation.installManifest ?? env.CCC_INSTALL_MANIFEST;
    const installApproval = current.installation.installApproval ?? env.CCC_INSTALL_APPROVAL;
    const authorization = await requireSignedOwnerPreflight({
      installManifest,
      installApproval,
      trust: configuredInstallTrust({
        organizationId: env.CCC_ORGANIZATION_ID,
        publicKeys: env.CCC_INSTALL_SIGNING_KEYS,
        revokedKeyIds: env.CCC_INSTALL_REVOKED_KEY_IDS,
      }),
      organizationId: env.CCC_ORGANIZATION_ID,
      projectRef: current.installation.projectRef,
    });
    const manifest = await readStrictJsonDocument(installManifest);
    if (await hashCanonical(manifest) !== evidence.runtimeManifestSha256
      || manifest.supabaseProjectRef !== authorization.projectRef
      || typeof manifest.supabaseAuthOrigin !== 'string') fail('OWNER_EVIDENCE_MISSING');
    const expectedAuthorizationSha256 = await hashCanonical({
      runtimeManifestSha256: evidence.runtimeManifestSha256,
      approvalSha256: evidence.approvalSha256,
    });
    const doctor = await runSupabaseBootstrap({
      operation: 'doctor',
      target: 'hosted',
      projectRef: current.installation.projectRef,
      installManifest,
      installApproval,
    }, { expectedAuthorizationSha256 });
    if (doctor?.productionReady !== true || !HASH.test(doctor.stateFingerprint)) fail('HEALTH_FAILED');
    authAdmin = createSupabaseAuthAdmin({
      authOrigin: manifest.supabaseAuthOrigin,
      projectRef: authorization.projectRef,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      managementAccessToken: env.SUPABASE_ACCESS_TOKEN,
      redirectTo: new URL('/auth/invite', manifest.clientOrigin).href,
    });
    target = {
      ...evidence,
      stateFingerprint: doctor.stateFingerprint,
      productionReady: true,
      authorization,
    };
    return target;
  }

  let held = null;

  /**
   * One installer connection and its session-scoped project advisory lock for the whole
   * command. The lock dies with the session, so an interrupted process never leaves a
   * stale lock, and the N02 installer and a second first-admin command are excluded alike.
   */
  async function withLock(run) {
    if (held !== null) fail('FIRST_ADMIN_IN_PROGRESS');
    const verified = await verifiedTarget();
    try {
      return await withInstallerConnection(
        verified.authorization,
        sql => withInstallLock(sql, verified.authorization.projectRefHash, async session => {
          held = session;
          try { return await run(); } finally { held = null; }
        }),
      );
    } catch (error) {
      if (error?.code === 'INSTALL_LOCK_BUSY') fail('FIRST_ADMIN_IN_PROGRESS');
      throw error;
    }
  }

  function session() {
    if (held === null) fail('FIRST_ADMIN_RUNTIME_UNAVAILABLE');
    return held;
  }

  async function admin() {
    await verifiedTarget();
    return authAdmin;
  }

  return {
    withLock,
    verifyInstallation: verifiedTarget,
    inspectFirstAdmin: identity => inspectInstalledFirstAdmin(session(), {
      orgId: target.authorization.institutionId,
      email: identity.email,
    }),
    inspectInstitution: () => inspectInstalledInstitution(session(), {
      orgId: target.authorization.institutionId,
    }),
    createInstitution: () => createInstitution(session(), {
      orgId: target.authorization.institutionId,
    }),
    listAuthUsers: async () => (await admin()).listAuthUsers(),
    inviteAuthUser: async identity => (await admin()).inviteAuthUser(identity),
    inviteTtlSeconds: async () => (await admin()).inviteTtlSeconds(),
    linkFirstAdmin: identity => linkInstalledFirstAdmin(session(), {
      orgId: target.authorization.institutionId,
      ...identity,
    }),
    now: Date.now,
    marker: createFirstAdminMarker,
  };
}

export const createFirstAdminMarker = () => randomBytes(32).toString('base64url');

const HELP = `relayer 최초 관리자 초대
사용법: node scripts/onboarding/first-admin.mjs [plan|invite|resume]
plan은 승인 뒤 설치, Auth와 기존 관리자 상태를 읽습니다.
invite는 상태 확인 승인과 발송 승인을 따로 받은 뒤 기관 기본값 생성과 이메일 한 건 발송을 시작합니다.
resume은 기존 승인 기록과 Auth 상태만 관찰하며 초대를 다시 보내지 않습니다.
입력: CCC_ONBOARDING_REQUEST, CCC_ONBOARDING_JOURNAL, CCC_ONBOARDING_INSTALLATION,
CCC_ONBOARDING_FIRST_ADMIN과 기존 S11 설치 자격입니다.
`;

function jsonInput(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16_384) {
    fail('FIRST_ADMIN_INPUT_INVALID');
  }
  try { return JSON.parse(value); } catch { fail('FIRST_ADMIN_INPUT_INVALID'); }
}

function cliOptions() {
  const identity = jsonInput(process.env.CCC_ONBOARDING_FIRST_ADMIN);
  if (!record(identity) || Object.keys(identity).some(key => !['email', 'name'].includes(key))
    || !Object.hasOwn(identity, 'email')) fail('FIRST_ADMIN_INPUT_INVALID');
  return input({
    request: jsonInput(process.env.CCC_ONBOARDING_REQUEST),
    installation: jsonInput(process.env.CCC_ONBOARDING_INSTALLATION),
    journalPath: process.env.CCC_ONBOARDING_JOURNAL,
    email: identity.email,
    name: identity.name,
  });
}

function print(value, destination = process.stdout) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  assertSafeOutput(text);
  destination.write(text);
}

function credentialSummary(options) {
  const current = input(options);
  return {
    operation: 'first-admin-inspection',
    emailSha256: sha256(current.email),
    readOnly: true,
    credentialUse: ['signed-install-owner', 'installer-database', 'supabase-auth-admin'],
    providerWrites: 0,
  };
}

async function confirmPhrase(phrase) {
  print(`요약을 승인하려면 '${phrase}'을 입력하세요. 다른 입력이나 종료는 취소합니다.\n`);
  const input = createInterface({
    input: process.stdin,
    output: new Writable({ write(_chunk, _encoding, done) { done(); } }),
    terminal: process.stdin.isTTY === true,
    historySize: 0,
  });
  const interrupt = () => input.close();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  input.once('SIGINT', interrupt);
  try {
    return await new Promise(resolve => {
      input.once('close', () => resolve(false));
      input.question('', answer => {
        resolve(answer.trim() === phrase);
        input.close();
      });
    });
  } finally {
    input.close();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

async function main() {
  const [operation = 'plan', ...extra] = process.argv.slice(2);
  if (operation === '--help' && extra.length === 0) {
    print(HELP);
    return;
  }
  if (extra.length > 0 || !['plan', 'invite', 'resume'].includes(operation)) {
    fail('FIRST_ADMIN_INPUT_INVALID');
  }
  const options = cliOptions();
  const journalPath = await firstAdminJournalPath(options.journalPath);
  const journal = await readJournal(journalPath);
  let result;
  if (operation === 'resume') {
    result = await resumeFirstAdmin(options);
  } else if (journal !== null) {
    if (operation !== 'invite') fail('FIRST_ADMIN_RESUME_REQUIRED');
    result = await beginFirstAdmin({ ...options, approved: journal.approved });
  } else {
    print(credentialSummary(options));
    if (!await confirmPhrase('이대로 확인')) fail('FIRST_ADMIN_CREDENTIAL_USE_CANCELLED');
    const planned = await planFirstAdmin(options);
    if (operation === 'plan') {
      result = planned;
    } else {
      print(planned);
      if (!await confirmPhrase('이대로 초대')) fail('FIRST_ADMIN_INVITATION_CANCELLED');
      result = await beginFirstAdmin({ ...options, approved: planned.binding });
    }
  }
  print(result);
  if (result?.ready === false) process.exitCode = 6;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
      ? error.code : 'FIRST_ADMIN_RUNTIME_UNAVAILABLE';
    print({ error: { code } }, process.stderr);
    process.exitCode = 1;
  }
}
