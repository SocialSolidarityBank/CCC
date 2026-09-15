// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_DOMAINS, type ConsentDisclosureSnapshot } from '@ccc/contracts/consent';
import { FirstAdminInviteScreen, ParticipantInviteScreen, ParticipantJoinScreen, StaffInviteScreen, StaffJoinScreen } from './invites';
import { InvitesApi, PublicJoinApi } from '../business/invites';
import { BusinessTransport, PublicTransport } from '../business/transport';
import { firstAdminInviteBootstrap, type CloudAuth, type InviteCompletionResult } from '../business/auth';
import { capabilities, installation, json } from '../business/test-support';
import type * as AuthModule from '../business/auth';
vi.mock('../business/auth',async(original)=>({...await original<typeof AuthModule>(),firstAdminInviteBootstrap:vi.fn(()=> 'entry')}));
const roots=new Set<{mounted:Root;container:HTMLElement}>();
afterEach(async()=>{for(const {mounted,container} of roots){await act(async()=>mounted.unmount());container.remove();}roots.clear();vi.unstubAllGlobals();vi.mocked(firstAdminInviteBootstrap).mockReturnValue('entry');});
async function renderScreen(screen:ComponentType,context:unknown={},entry='/auth/invite'){
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const container=document.createElement('div');document.body.append(container);const mounted=createRoot(container);roots.add({mounted,container});
 const router=createMemoryRouter([{element:createElement(()=>createElement(Outlet,{context})),children:[{path:'*',element:createElement(screen)}]}],{initialEntries:[entry]});
 await act(async()=>mounted.render(createElement(StrictMode,null,createElement(RouterProvider,{router}))));return{container,router};
}
function callbackAuth(){
 const completeFirstAdminInvite=vi.fn(async(_email:string,_code:string,_password:string):Promise<InviteCompletionResult>=>({status:'complete'}));
 const retryFirstAdminPassword=vi.fn(async(_password:string):Promise<InviteCompletionResult>=>({status:'complete'}));
 const cancelFirstAdminInvite=vi.fn(async()=>{});
 return{auth:{completeFirstAdminInvite,retryFirstAdminPassword,cancelFirstAdminInvite} as unknown as CloudAuth,completeFirstAdminInvite,retryFirstAdminPassword,cancelFirstAdminInvite};
}
function fill(container:HTMLElement,values:Record<string,string>):Promise<void>{
 const native=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
 return act(async()=>{for(const[id,value]of Object.entries(values)){const input=container.querySelector<HTMLInputElement>('#'+id)!;native.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));}});
}
const submit=(container:HTMLElement)=>act(async()=>{container.querySelector('form')!.requestSubmit();});
const click=(container:HTMLElement,label:string)=>act(async()=>{[...container.querySelectorAll('button')].find(button=>button.textContent?.includes(label))!.click();});
const entry=(container:HTMLElement,changes:Record<string,string>={})=>fill(container,{'first-admin-email':' OTP-Person@Example.Invalid ','first-admin-code':'739162','first-admin-password':'synthetic-passphrase','first-admin-password-confirm':'synthetic-passphrase',...changes});
const password=(container:HTMLElement)=>fill(container,{'first-admin-password':'fresh-password','first-admin-password-confirm':'fresh-password'});
describe('manual OTP invitation screen',()=>{
 it('renders four uncontrolled labeled inputs without an Auth call',async()=>{
  const h=callbackAuth(),{container}=await renderScreen(FirstAdminInviteScreen,h);
  expect(container.querySelectorAll('h1')).toHaveLength(1);expect(container.querySelectorAll('input')).toHaveLength(4);
  expect([...container.querySelectorAll<HTMLInputElement>('input')].every(input=>input.labels?.length===1&&!input.hasAttribute('value'))).toBe(true);
  expect(container.querySelector('input[name=code]')?.getAttribute('autocomplete')).toBe('one-time-code');
  expect(h.completeFirstAdminInvite).not.toHaveBeenCalled();expect(h.cancelFirstAdminInvite).not.toHaveBeenCalled();
 });
 it('rejects invalid bootstrap without a form or Auth call',async()=>{
  vi.mocked(firstAdminInviteBootstrap).mockReturnValue('invite_invalid');const h=callbackAuth(),{container}=await renderScreen(FirstAdminInviteScreen,h);
  expect(container.querySelector('form')).toBeNull();expect(container.querySelector('[role=alert]')).not.toBeNull();expect(h.completeFirstAdminInvite).not.toHaveBeenCalled();
 });
 it.each([{'first-admin-email':'bad@example'},{'first-admin-email':'a;b@example.invalid'},{'first-admin-code':'１２３４５６'},{'first-admin-code':'123 45'},{'first-admin-code':'12345'},{'first-admin-password':'short'},{'first-admin-password-confirm':'not-matching'}])('resets invalid or mismatched input without Auth',async(changes)=>{
  const h=callbackAuth(),{container}=await renderScreen(FirstAdminInviteScreen,h);await entry(container,changes);await submit(container);
  expect(h.completeFirstAdminInvite).not.toHaveBeenCalled();expect(container.querySelector('[role=alert]')).not.toBeNull();expect([...container.querySelectorAll<HTMLInputElement>('input')].every(input=>input.value==='')).toBe(true);
 });
 it('normalizes email and resets every field before the first Auth operation',async()=>{
  const h=callbackAuth(),{container,router}=await renderScreen(FirstAdminInviteScreen,h);const deferred=Promise.withResolvers<InviteCompletionResult>();let empty=false;
  h.completeFirstAdminInvite.mockImplementation(()=>{empty=[...container.querySelectorAll<HTMLInputElement>('input')].every(input=>input.value==='');return deferred.promise;});
  await entry(container);await submit(container);expect(empty).toBe(true);expect(h.completeFirstAdminInvite).toHaveBeenCalledWith('otp-person@example.invalid','739162','synthetic-passphrase');
  expect(container.querySelector('form')).toBeNull();await act(async()=>deferred.resolve({status:'complete'}));expect(router.state.location.pathname).toBe('/auth/invite');expect(container.querySelector('a')?.getAttribute('href')).toBe('/login');
 });
 it.each(['invite_invalid','provider_unavailable'] as const)('offers empty full entry for %s before verified session',async(code)=>{
  const h=callbackAuth();h.completeFirstAdminInvite.mockResolvedValue({status:'failure',code,retry:'entry'});const{container}=await renderScreen(FirstAdminInviteScreen,h);await entry(container);await submit(container);
  expect(container.querySelectorAll('input')).toHaveLength(4);expect([...container.querySelectorAll<HTMLInputElement>('input')].every(input=>input.value==='')).toBe(true);
 });
 it.each(['password_rejected','provider_unavailable'] as const)('retains only password fields for %s after verification',async(code)=>{
  const h=callbackAuth();h.completeFirstAdminInvite.mockResolvedValue({status:'failure',code,retry:'password'});const{container}=await renderScreen(FirstAdminInviteScreen,h);await entry(container);await submit(container);
  expect(container.querySelectorAll('input')).toHaveLength(2);expect(container.querySelector('input[name=email],input[name=code]')).toBeNull();await password(container);await submit(container);
  expect(h.completeFirstAdminInvite).toHaveBeenCalledTimes(1);expect(h.retryFirstAdminPassword).toHaveBeenCalledWith('fresh-password');expect(container.querySelector('form')).toBeNull();
 });
 it.each(['invite_invalid','invite_expired','invite_session_conflict','provider_unavailable'] as const)('shows terminal %s without a retry',async(code)=>{
  const h=callbackAuth();h.completeFirstAdminInvite.mockResolvedValue({status:'failure',code,retry:'none'});const{container}=await renderScreen(FirstAdminInviteScreen,h);await entry(container);await submit(container);
  expect(container.querySelector('form,button')).toBeNull();expect(container.querySelector('[role=alert]')).not.toBeNull();
 });
 it('keeps the legacy screen without network or forms',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const{container}=await renderScreen(StaffJoinScreen,{},'/staff/join');expect(container.querySelector('form,input,a,button')).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 });
});

async function publicFixture() {
  const verified = await installation();
  const requests: Request[] = [];
  const token = 'participant-request-token';
  const disclosures: ConsentDisclosureSnapshot[] = CONSENT_DOMAINS.map((domain, index) => ({
    snapshotId: `disclosure-${index}`, scopeBinding: { orgId: 'org-1', programId: 'program-1', issuerId: 'user-1', supportCaseId: null },
    domain, fullKoreanCopy: '합성 고지문', provider: 'institution', providerLegalRecipient: '합성 기관', country: null,
    purpose: 'case_management', retentionProfile: 'default_temporary_d85', retentionDuration: 'default_temporary_d85',
    copyVersion: 'synthetic-v1', copyHash: 'a'.repeat(64), issuedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }));
  let revoked = false;
  const invite = () => ({ id: 'invite-1', email: 'staff@example.invalid', roles: ['practitioner'], status: revoked ? 'revoked' : 'issued',
    issuedAt: '2026-01-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z', usedAt: null, revokedAt: revoked ? '2026-09-14T00:00:00Z' : null });
  const manifest = capabilities();
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init); requests.push(request);
    const path = new URL(request.url).pathname.replace('/functions/v1/ccc', '');
    if (path === '/capabilities') return json({ ...manifest, features: { ...manifest.features, public_signup: true } }, 200,
      { 'X-CCC-Installation-Id': verified.manifest.installationId });
    if (path === '/staff-invites') return json({ invites: [invite()] });
    if (path === '/staff-invites/invite-1/revoke') { revoked = true; return json({ invite: invite() }); }
    if (path === '/invites/participant') return json({ token, expiresAt: '2027-01-01T00:00:00Z' });
    if (path === `/invites/participant/${token}`) return json({ status: 'issued', programId: 'program-1',
      programType: 'financial', orgName: '합성 기관', expiresAt: '2027-01-01T00:00:00Z' });
    if (path.endsWith('/consent/disclosures')) return json({ disclosures });
    if (path === '/signup/participant') return json({ beneficiaryId: 'beneficiary-1', supportCaseId: 'case-1' }, 201);
    return json({ error: 'not_found' }, 404);
  };
  const transport = new BusinessTransport(verified, () => 'business-session', fetcher);
  const enabled = await transport.initialize();
  const invites = new InvitesApi(transport);
  const publicJoin = new PublicJoinApi(new PublicTransport(verified, fetcher));
  return { requests, token, invites, publicJoin, enabled };
}

describe('fail-closed staff and unchanged participant requests', () => {
  it('keeps staff list and revoke without any creation form or raw issued link', async () => {
    const h = await publicFixture();
    const { container } = await renderScreen(StaffInviteScreen, { invites: h.invites, auth: { signOut: vi.fn() } }, '/staff-invites');
    expect(container.querySelector('form, input, a')).toBeNull();
    await click(container, '취소');
    expect(container.querySelector('button')).toBeNull();
    expect(h.requests.filter((request) => request.method === 'POST').map((request) => new URL(request.url).pathname))
      .toEqual(['/functions/v1/ccc/staff-invites/invite-1/revoke']);
  });

  it('preserves participant link issuance, fragment lookup, six disclosures and completion without public bearer', async () => {
    const h = await publicFixture();
    const issuing = await renderScreen(ParticipantInviteScreen, {
      invites: h.invites, capabilities: h.enabled, auth: { signOut: vi.fn() },
      participants: { programOptions: async () => [{ id: 'program-1', displayName: '합성 사업', admissionState: 'ready' }] },
    }, '/participants/invite');
    await act(async () => {
      const select = issuing.container.querySelector<HTMLSelectElement>('select')!;
      select.value = 'program-1'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submit(issuing.container);
    expect(issuing.container.textContent?.includes(`/join#t=${h.token}`)).toBe(true);
    const before = h.requests.length;
    const joining = await renderScreen(ParticipantJoinScreen, { publicJoin: h.publicJoin }, `/join#t=${h.token}`);
    expect(joining.router.state.location.hash).toBe('');
    expect(joining.container.querySelectorAll('input[type="radio"]').length).toBe(12);
    await fill(joining.container, { 'join-name': '합성 당사자' });
    await click(joining.container, '모두 동의'); await submit(joining.container);
    expect(joining.container.querySelector('form')).toBeNull();
    const publicRequests = h.requests.slice(before);
    expect(publicRequests.map((request) => new URL(request.url).pathname)).toEqual([
      `/functions/v1/ccc/invites/participant/${h.token}`,
      `/functions/v1/ccc/invites/participant/${h.token}/consent/disclosures`, '/functions/v1/ccc/signup/participant',
    ]);
    expect(publicRequests.every((request) => !request.headers.has('authorization'))).toBe(true);
    const completion = await publicRequests.at(-1)!.clone().json();
    expect(completion.consentEvents.map((event: { domain: string }) => event.domain).sort()).toEqual([...CONSENT_DOMAINS].sort());
    expect(completion.name).toBe('합성 당사자');
  });
});
