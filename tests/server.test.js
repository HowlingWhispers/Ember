import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmberServer } from '../server/index.js';

const userId = '11111111-1111-4111-8111-111111111111';
const assetId = '22222222-2222-4222-8222-222222222222';
const linkId = '33333333-3333-4333-8333-333333333333';
const secret = 'ember-test-bridge-secret-more-than-32-characters';
const ticket = 'a'.repeat(43);

async function fixture(mode = 'character') {
  let authorized = true;
  let redeemed = false;
  let exchangeCalls = 0;
  const context = { userId, linkId, mode, asset: { id:assetId, type:mode, name:mode === 'character'?'Ragna Holt':'Bitterroot', summary:'Canon reference' } };
  const fetchFn = async (url, init) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:8789\/api\/internal\/ember\/(check|redeem)$/);
    assert.equal(init.headers.Authorization, `Bearer ${secret}`);
    const body = JSON.parse(init.body);
    if (url.endsWith('/redeem')) {
      exchangeCalls++;
      if (body.ticket !== ticket || redeemed) return new Response(JSON.stringify({ error:'used' }), {status:401});
      redeemed = true;
    } else {
      if (body.linkId !== linkId || !authorized) return new Response(JSON.stringify({error:'revoked'}),{status:401});
    }
    return new Response(JSON.stringify(context), {status:200,headers:{'Content-Type':'application/json'}});
  };
  const server = createEmberServer({ env:{EMBER_BRIDGE_SECRET:secret,NODE_ENV:'test',ORBIS_WEB_ORIGIN:'https://lib.thehowlingwhispers.com'},fetchFn });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    base,
    revoke(){authorized=false;},
    exchangeCalls(){return exchangeCalls;},
    close(){return new Promise(resolve=>server.close(resolve));},
    postLaunch(body=ticket,origin='https://lib.thehowlingwhispers.com') {
      return fetch(`${base}/ember/launch`,{
        method:'POST',redirect:'manual',
        headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({ticket:body}).toString(),
      });
    }
  };
}
test('Ember denies the browser shell and files without a current Orbis handoff', async t => {
  const app = await fixture(); t.after(()=>app.close());
  for (const path of ['/ember/','/ember/src/app.js','/ember/api/session']) {
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
test('creates an HttpOnly scoped cookie and serves distinct character launch', async t=>{
  const app=await fixture('character');t.after(()=>app.close());
  const start=await app.postLaunch();
  assert.equal(start.status,303);
  assert.equal(start.headers.get('location'),'/ember/');
  const header=start.headers.get('set-cookie');
  assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Lax/);assert.match(header,/Path=\/ember\//);
  const cookie=header.split(';')[0];
  const authHeaders={Cookie:cookie};
  const session=await fetch(app.base+'/ember/api/session',{headers:authHeaders});
  assert.equal(session.status,200);
  const info=await session.json();
  assert.equal(info.mode,'character');assert.equal(info.asset.name,'Ragna Holt');
  assert.equal(info.linkId,undefined);
  const html=await fetch(app.base+'/ember/',{headers:authHeaders});
  assert.equal(html.status,200);
  assert.match(await html.text(),/bootstrap\.js/);
  assert.equal((await fetch(app.base+'/ember/.git/config',{headers:authHeaders})).status,404);
  assert.equal((await app.postLaunch()).status,401,'Replay rejected by Orbis');
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
