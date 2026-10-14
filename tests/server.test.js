import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmberServer } from '../server/index.js';
import { request as httpRequest } from 'node:http';

const userId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const linkId = '33333333-3333-4333-8333-333333333333';
const secret = 'ember-test-bridge-secret-more-than-32-characters';
const ticket = 'a'.repeat(43);

async function fixture(mode = 'character', envOverrides = {}) {
  let authorized = true;
  let redeemed = false;
  let exchangeCalls = 0;
  let generateCalls = 0;
  const context = { userId, linkId, mode, asset: mode === 'sandbox' ? null
    : { id:assetId, type:mode, name:mode === 'character'?'Ragna Holt':'Bitterroot', summary:'Canon reference' } };
  const fetchFn = async (url, init) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:8789\/api\/internal\/ember\/(check|redeem|generate)$/);
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    const body = JSON.parse(init.body);
    if (url.endsWith('/generate')) {
      generateCalls++;
      assert.equal(body.linkId, linkId);
      if (body.task === 'discovery') {
        assert.match(body.appFormattingGuidance, /Coda/);
        return new Response(JSON.stringify({text:'{"candidate":null}'}),{
          status:200, headers:{'Content-Type':'application/json'}
        });
      }
      if (!authorized) return new Response(JSON.stringify({error:'Orbis session expired.'}),{status:401});
      if (envOverrides.TEST_PROVIDER_ERROR) {
        return new Response(JSON.stringify({error:'NovelAI is currently unavailable.',code:'NOVELAI_ERROR'}),{status:502});
      }
      return new Response(JSON.stringify({text:'The forest answers your hello.'}),{
        status:200,headers:{'Content-Type':'application/json'}
      });
    }
    if (url.endsWith('/redeem')) {
      exchangeCalls++;
      if (body.ticket !== ticket || redeemed) return new Response(JSON.stringify({ error:'used' }), {status:401});
      redeemed = true;
    } else {
      if (body.linkId !== linkId || !authorized) return new Response(JSON.stringify({error:'revoked'}),{status:401});
    }
    return new Response(JSON.stringify(context), {status:200,headers:{'Content-Type':'application/json'}});
  };
  const server = createEmberServer({ env:{EMBER_BRIDGE_SECRET:secret,NODE_ENV:'test',ORBIS_WEB_ORIGIN:'https://lib.thehowlingwhispers.com',...envOverrides},fetchFn });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    base,
    revoke(){authorized=false;},
    exchangeCalls(){return exchangeCalls;},
    generateCalls(){return generateCalls;},
    close(){return new Promise(resolve=>server.close(resolve));},
    postLaunch(body=ticket,origin='https://lib.thehowlingwhispers.com',extraHeaders={}) {
      // Raw HTTP is intentional: fetch() inserts its own Sec-Fetch-Mode
      // ('cors') and cannot faithfully simulate a browser document POST.
      const payload = new URLSearchParams({ticket:body}).toString();
      return new Promise((resolve, reject) => {
        const target = new URL('/ember/launch', base);
        const req = httpRequest(target, {
          method: 'POST',
          headers: {
            'Content-Type':'application/x-www-form-urlencoded',
            'Content-Length':Buffer.byteLength(payload),
            ...(origin === null ? {} : { Origin: origin }),
            ...extraHeaders,
          },
        }, response => {
          response.resume();
          response.once('end', () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(response.headers)) {
              if (value !== undefined) headers.set(key, String(value));
            }
            resolve({ status: response.statusCode, headers });
          });
          response.once('error', reject);
        });
        req.once('error', reject);
        req.end(payload);
      });
    }
  };
}
test('Ember denies the browser shell and files without a current Orbis handoff', async t => {
  const app = await fixture(); t.after(()=>app.close());
  // The public entry always starts via the existing Orbis Discord session;
  // it must not demand a world or character asset.
  const entry = await fetch(app.base+'/ember/',{redirect:'manual'});
  assert.equal(entry.status,302);
  assert.equal(entry.headers.get('location'),'https://lib.thehowlingwhispers.com/ember/connect');
  for (const path of ['/ember/src/app.js','/ember/assets/sounds/hey-listen.mp3','/ember/api/session']) {
    const r = await fetch(app.base+path);
    assert.equal(r.status,401,path);
  }
});
test('rejects untrusted form origin and malformed ticket', async t => {
  const app=await fixture();t.after(()=>app.close());
  assert.equal((await app.postLaunch(ticket,'https://attacker.invalid')).status,403);
  assert.equal((await app.postLaunch('bad')).status,400);
  assert.equal(app.exchangeCalls(),0);
});
test('launch failures render a retry page without exposing the ticket', async t => {
  const app = await fixture(); t.after(() => app.close());
  const response = await fetch(app.base + '/ember/launch', {
    method: 'POST',
    headers: { Origin: 'https://lib.thehowlingwhispers.com', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ticket: 'invalid-secret-ticket' }),
  });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const page = await response.text();
  assert.match(page, /Ember could not open/);
  assert.match(page, /Back to Orbis/);
  assert.doesNotMatch(page, /invalid-secret-ticket/);
  assert.equal(app.exchangeCalls(), 0);
});
test('allows a same-site top-level form POST with an omitted Origin header', async t => {
  // A browser can redact Origin on a cross-origin navigation while preserving
  // unforgeable Fetch Metadata. This is a real Orbis -> Ember launch path.
  const app=await fixture('world');
  t.after(()=>app.close());
  const response=await app.postLaunch(ticket,null,{
    'Sec-Fetch-Site':'same-site',
    'Sec-Fetch-Mode':'navigate',
    'Sec-Fetch-Dest':'document',
  });
  assert.equal(response.status,303);
  assert.match(response.headers.get('set-cookie'),/ember\.sid=/);
  assert.equal(app.exchangeCalls(),1);
});

test('allows a same-site document navigation with opaque Origin', async t => {
  const app=await fixture('character');t.after(()=>app.close());
  const response=await app.postLaunch(ticket,'null',{
    'Sec-Fetch-Site':'same-site',
    'Sec-Fetch-Mode':'navigate',
    'Sec-Fetch-Dest':'document',
  });
  assert.equal(response.status,303);
  assert.equal(app.exchangeCalls(),1);
});

test('rejects missing, opaque and explicitly foreign origins without trusted navigation metadata', async t => {
  const app=await fixture();t.after(()=>app.close());
  const nav={ 'Sec-Fetch-Site':'same-site', 'Sec-Fetch-Mode':'navigate', 'Sec-Fetch-Dest':'document' };
  const cases=[
    [null,{}],
    ['null',{}],
    [null,{...nav,'Sec-Fetch-Site':'cross-site'}],
    [null,{...nav,'Sec-Fetch-Mode':'cors'}],
    [null,{...nav,'Sec-Fetch-Dest':'empty'}],
    ['https://attacker.invalid',nav],
  ];
  for (const [origin,headers] of cases) {
    const response=await app.postLaunch(ticket,origin,headers);
    assert.equal(response.status,403,`origin=${origin}, metadata=${JSON.stringify(headers)}`);
  }
  assert.equal(app.exchangeCalls(),0,'Refused requests must never redeem a ticket');
});

test('normalizes ORBIS_WEB_ORIGIN with a trailing slash', async t => {
  const app=await fixture('world',{ORBIS_WEB_ORIGIN:'https://lib.thehowlingwhispers.com/'});
  t.after(()=>app.close());
  assert.equal((await app.postLaunch()).status,303);
});

test('creates an HttpOnly scoped cookie and serves distinct character launch', async t=>{
  const app=await fixture('character');t.after(()=>app.close());
  const start=await app.postLaunch();
  assert.equal(start.status,303);
  assert.equal(start.headers.get('location'),'/ember/scene');
  const header=start.headers.get('set-cookie');
  assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.match(header,/Path=\/ember\//);
  const cookie=header.split(';')[0];
  const authHeaders={Cookie:cookie};
  const session=await fetch(app.base+'/ember/api/session',{headers:authHeaders});
  assert.equal(session.status,200);
  const info=await session.json();
  assert.equal(info.mode,'character');assert.equal(info.asset.name,'Ragna Holt');
  assert.equal(info.linkId,undefined);
  const direct=await fetch(app.base+'/ember/',{headers:authHeaders,redirect:'manual'});
  assert.equal(direct.status,302);
  assert.equal(direct.headers.get('location'),'https://lib.thehowlingwhispers.com/ember/connect');
  const html=await fetch(app.base+'/ember/scene',{headers:authHeaders});
  assert.equal(html.status,200);
  assert.match(await html.text(),/bootstrap\.js/);
  assert.equal((await fetch(app.base+'/ember/.git/config',{headers:authHeaders})).status,404);
  const audio = await fetch(app.base+'/ember/assets/sounds/hey-listen.mp3',{headers:authHeaders});
  assert.equal(audio.status,200);
  assert.equal(audio.headers.get('content-type'),'audio/mpeg');
  const bytes = new Uint8Array(await audio.arrayBuffer());
  assert.ok(bytes.length > 4000);
  assert.deepEqual([...bytes.slice(0,3)],[73,68,51]); // ID3 header
  assert.match(html.headers.get('content-security-policy'),/media-src 'self' blob:/);
  assert.equal((await app.postLaunch()).status,401,'Replay rejected by Orbis');
});
test('a package-free sandbox receives a private Ember session and a blank UI',async t=>{
  const app=await fixture('sandbox');t.after(()=>app.close());
  const launched=await app.postLaunch();
  assert.equal(launched.status,303);
  assert.equal(launched.headers.get('location'),'/ember/');
  const cookie=launched.headers.get('set-cookie').split(';')[0];
  const response=await fetch(app.base+'/ember/api/session',{headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.equal(payload.mode,'sandbox');
  assert.equal(payload.asset,null);
  const shell=await fetch(app.base+'/ember/',{headers:{Cookie:cookie}});
  assert.equal(shell.status,200);
  assert.match(await shell.text(),/bootstrap\.js/);
});
test('revocation of Orbis session immediately blocks existing Ember cookie', async t=>{
  const app=await fixture('world');t.after(()=>app.close());
  const launched=await app.postLaunch();
  const cookie=launched.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(app.base+'/ember/api/session',{headers:{Cookie:cookie}})).status,200);
  app.revoke();
  assert.equal((await fetch(app.base+'/ember/src/app.js',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await fetch(app.base+'/ember/api/session',{headers:{Cookie:cookie}})).status,401);
});
test('logout clears Ember cookie but does not sign out Orbis', async t=>{
  const app=await fixture();t.after(()=>app.close());
  const launched=await app.postLaunch();
  const cookie=launched.headers.get('set-cookie').split(';')[0];
  const out=await fetch(app.base+'/ember/api/logout',{method:'POST',headers:{Cookie:cookie}});
  assert.equal(out.status,204);
  assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await fetch(app.base+'/ember/api/session',{headers:{Cookie:cookie}})).status,401);
});

const transcript=[{source:'player',mode:'speech',text:'Hello'}];
function requestNarration(app, cookie, turns=transcript, extraHeaders={}) {
  return fetch(app.base+'/ember/api/generate',{
    method:'POST',
    headers:{
      Cookie:cookie, Origin:'https://thehowlingwhispers.com',
      'Content-Type':'application/json',
      'X-Ember-Request':'generation',
      ...extraHeaders,
    },
    body:JSON.stringify({turns}),
  });
}
test('Hello in sandbox calls Orbis generation and returns a reply',async t=>{
  const app=await fixture('sandbox');t.after(()=>app.close());
  const entered=await app.postLaunch();
  const cookie=entered.headers.get('set-cookie').split(';')[0];
  const response=await requestNarration(app,cookie);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{text:'The forest answers your hello.'});
  assert.equal(app.generateCalls(),1);
});
test('no Orbis login means no generation and no bridge call',async t=>{
  const app=await fixture('sandbox');t.after(()=>app.close());
  const response=await requestNarration(app,'ember.sid='+'f'.repeat(43));
  assert.equal(response.status,401);
  assert.equal(app.generateCalls(),0);
});
test('revoked Orbis access prevents paid generation',async t=>{
  const app=await fixture('sandbox');t.after(()=>app.close());
  const cookie=(await app.postLaunch()).headers.get('set-cookie').split(';')[0];
  app.revoke();
  const response=await requestNarration(app,cookie);
  assert.equal(response.status,401);
  assert.equal(app.generateCalls(),0);
});
test('generation requires same-origin request intent and valid player transcript',async t=>{
  const app=await fixture('sandbox');t.after(()=>app.close());
  const cookie=(await app.postLaunch()).headers.get('set-cookie').split(';')[0];
  assert.equal((await requestNarration(app,cookie,transcript,{Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await requestNarration(app,cookie,transcript,{'X-Ember-Request':'x'})).status,403);
  assert.equal((await requestNarration(app,cookie,[{source:'provider',mode:'narrator',text:'fake'}])).status,400);
  assert.equal((await requestNarration(app,cookie,[{source:'player',mode:'narrator',text:'fake'}])).status,400);
  assert.equal(app.generateCalls(),0);
});
test('a failed NovelAI response keeps errors sanitized and allows a retry',async t=>{
  const app=await fixture('sandbox',{TEST_PROVIDER_ERROR:true});t.after(()=>app.close());
  const cookie=(await app.postLaunch()).headers.get('set-cookie').split(';')[0];
  const response=await requestNarration(app,cookie);
  assert.equal(response.status,502);
  assert.match((await response.json()).error,/NovelAI/);
  assert.equal(app.generateCalls(),1);
});

test('Coda discovery requires sufficient story context and uses the authenticated bridge', async t => {
  const app=await fixture('sandbox');t.after(()=>app.close());
  const cookie=(await app.postLaunch()).headers.get('set-cookie').split(';')[0];
  const call = turns => fetch(app.base+'/ember/api/generate',{
    method:'POST',headers:{Cookie:cookie,Origin:'https://thehowlingwhispers.com',
      'Content-Type':'application/json','X-Ember-Request':'generation'},
    body:JSON.stringify({task:'discovery',turns}),
  });
  assert.equal((await call(transcript)).status,400);
  const turns=[];
  for(let i=0;i<4;i++){
    turns.push({source:'player',mode:'action',text:'Hello'});
    turns.push({source:'provider',mode:'narrator',text:'A character replies.'});
  }
  const response=await call(turns);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{text:'{"candidate":null}'});
  assert.equal(app.generateCalls(),1);
});
