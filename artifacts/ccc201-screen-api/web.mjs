import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const source = process.argv[2];
const output = process.argv[3];
const origin = 'http://127.0.0.1:43982';
const api = 'http://127.0.0.1:43981';
const { JSDOM } = createRequire(`${source}/apps/web/package.json`)('jsdom');
const fixture = await (await fetch(`${api}/__ccc201/fixture`)).json();
const rows = JSON.parse(readFileSync(`${source}/scripts/design/route-inventory.json`, 'utf8')).routes;
const results = [];
const cookies = {};
for (const [role, code] of [['counselor','ccc201-synthetic-counselor'],['admin','ccc201-synthetic-admin']]) {
  const response = await fetch(`${origin}/preview/unlock`, { method:'POST', redirect:'manual',
    headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({mode:role === 'admin' ? 'admin' : 'counselor',code}) });
  const cookie = response.headers.get('set-cookie');
  results.push({boundary:'actual-web-form-adapter',role,status:response.status,location:response.headers.get('location'),cookieIssued:cookie?.includes('ccc_preview=') ?? false,
    httpOnly:cookie?.includes('HttpOnly') ?? false});
  assert.equal(response.status,303);
  assert.ok(cookie?.includes('ccc_preview='));
  cookies[role] = cookie.split(';')[0];
}
const params = { ...fixture, programType:'financial_support_v1', userId:'admin@example.invalid', participantInviteToken:fixture.inviteToken, workerInviteToken:'0'.repeat(64) };
for (const row of rows) {
  let path = row.representativeUrl.replace(/\{\{([^}]+)\}\}/g,(_,key) => {assert.ok(params[key],key); return encodeURIComponent(params[key]);});
  const role = row.permission.actor === 'institution-admin' ? 'admin' : 'counselor';
  const publicEntry = row.routePattern === '/preview' || row.routePattern === '/preview/admin';
  const before = await (await fetch(`${api}/__ccc201/observations`)).json();
  const response = await fetch(`${origin}${path}`, {redirect:'manual',headers:publicEntry ? {} : {cookie:cookies[role]}});
  const html = await response.text();
  const after = await (await fetch(`${api}/__ccc201/observations`)).json();
  const renderErrorMarkers = [...html.matchAll(/.{0,80}(?:API response did not match the declared contract|data-dgst=|\\?"digest\\?").{0,180}/g)]
    .map(match => match[0].replace(/[0-9a-f]{64}/g, ':redacted')).slice(0, 8);
  const renderOutcome = response.status >= 500 ? 'http_error'
    : response.status !== 200 ? 'redirect_or_refusal'
      : renderErrorMarkers.some(marker => marker.includes('NEXT_HTTP_ERROR_FALLBACK')) ? 'stream_refusal'
        : renderErrorMarkers.length > 0 ? 'stream_error' : 'html_received';
  const parsed = new JSDOM(html, {url:`${origin}${path}`});
  const sidebar = parsed.window.document.querySelector('#app-sidebar.sidebar') !== null;
  if (row.permission.state === 'public') assert.equal(sidebar, false, row.routePattern);
  if (response.status === 200 && renderOutcome === 'html_received' && row.permission.state !== 'public') assert.equal(sidebar, true, row.routePattern);
  parsed.window.close();
  results.push({route:row.routePattern, role:publicEntry ? 'anonymous' : role, status:response.status,
    location:response.headers.get('location'), shell:/class="[^"]*app-shell/.test(html), sidebar, renderOutcome, renderErrorMarkers,
    renderedH1:[...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m=>m[1].replace(/<[^>]*>/g,'')),
    serverActionForms:[...html.matchAll(/name="\$ACTION_/g)].length,
    htmlSha256:createHash('sha256').update(html).digest('hex'),
    apiCalls:after.slice(before.length).map(({method,path,status,shape,requestCredentialPresence,error})=>({method,path,status,shape,requestCredentialPresence,error}))});
  console.log(JSON.stringify({route:row.routePattern,status:response.status,shell:results.at(-1).shell,apiCalls:results.at(-1).apiCalls.length}));
}
for (const path of ['/welcome','/kit','/join','/joinX']) {
  const response = await fetch(`${origin}${path}`, {redirect:'manual'});
  results.push({boundary:'preview-middleware-without-cookie',path,status:response.status,location:response.headers.get('location')});
}
writeFileSync(output,JSON.stringify({evidenceKind:'actual_next_http_render_and_worker_network',nextOrigin:origin,results,
  limitations:['No browser hydration or click success is inferred from HTTP-rendered HTML.','Unknown worker token exercises the public error branch, not successful worker signup.','Public join business credentials are inspected at the actual backend; production Access/Supabase login is not exercised.']},null,2)+'\n');
assert.equal(results.filter(r=>r.route).length,rows.length);
console.log('CCC201_WEB_HTTP_COLLECTION_COMPLETE');
