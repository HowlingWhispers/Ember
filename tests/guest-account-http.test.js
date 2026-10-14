import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmberServer } from "../server/index.js";

const origin="https://thehowlingwhispers.com";
const json={"Content-Type":"application/json","Origin":origin,"X-Ember-Request":"guest-settings"};
const generation={"Content-Type":"application/json","Origin":origin,"X-Ember-Request":"generation"};
const prompt="EMBER / FREEFORM ROLEPLAY\nCHARACTER CARD V2: Heather\n[RECENT STORY TRANSCRIPT]\nPLAYER: hello\n[END TRANSCRIPT]\nNARRATOR:";
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),"ember-account-http-"));
  const calls=[];
  const fetchFn=async(url,opts)=>{
    calls.push({url,opts});
    assert.equal(url,"https://text.novelai.net/oa/v1/completions","Guest must never call Orbis");
    return new Response(JSON.stringify({choices:[{text:"NARRATOR: Heather raises an eyebrow."}]}),{status:200});
  };
  const server=createEmberServer({
    env:{
      NODE_ENV:"production",
      EMBER_GUEST_ENABLED:"1",
      EMBER_GUEST_DATA_DIR:directory,
      EMBER_GUEST_ENCRYPTION_KEY:"9f".repeat(32),
      EMBER_WEB_ORIGIN:origin,
    },
    fetchFn,
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{force:true,recursive:true});});
  async function enter(){
    const entry=await fetch(base+"/ember/account");
    assert.equal(entry.status,200);
    const cookie=entry.headers.get("set-cookie").split(";")[0];
    return {cookie,entry};
  }
  async function call(cookie,path,method="GET",body,headers={}){
    return fetch(base+path,{method,headers:{Cookie:cookie,...headers},
      ...(body?{body:JSON.stringify(body)}:{})});
  }
  return {base,directory,calls,enter,call};
}
test("temporary account area creates a secure guest cookie without an Orbis call",async t=>{
 const app=await fixture(t);
 const {cookie,entry}=await app.enter();
 assert.match(cookie,/^ember\.guest=[A-Za-z0-9_-]{43}$/);
 assert.match(entry.headers.get("set-cookie"),/HttpOnly/);
 assert.match(entry.headers.get("set-cookie"),/Secure/);
 assert.match(entry.headers.get("set-cookie"),/SameSite=Lax/);
 assert.match(await entry.text(),/Your Ember account/);
 const session=await app.call(cookie,"/ember/api/guest/session");
 assert.equal(session.status,200);
 const data=await session.json();
 assert.equal(data.identity,"guest");
 assert.equal(data.mode,"sandbox");
 assert.equal(data.asset,null);
 assert.match(data.userId,/^[0-9a-f-]{36}$/);
 const root=await app.call(cookie,"/ember/");
 assert.equal(root.status,200);
 assert.match(await root.text(),/bootstrap\.js/);
 for(const path of ["/ember/src/app.js","/ember/src/account.js","/ember/src/account.css","/ember/src/context-compiler.js"]){
   assert.equal((await app.call(cookie,path)).status,200,path);
 }
 assert.equal(app.calls.length,0);
});
test("guest secrets remain server-side, isolated per profile, and protected from CSRF",async t=>{
 const app=await fixture(t);
 const {cookie:a}=await app.enter();
 const {cookie:b}=await app.enter();
 assert.notEqual(a,b);
 assert.equal((await app.call(a,"/ember/api/guest/provider")).status,200);
 const secret="this-is-a-test-only-secret-key";
 const settings={model:"xialong-v1",apiKey:secret};
 const csrf=await app.call(a,"/ember/api/guest/provider","PUT",settings,
   {...json,Origin:"https://attacker.example"});
 assert.equal(csrf.status,403);
 assert.equal((await app.call(a,"/ember/api/guest/provider","PUT",settings,json)).status,200);
 const status=await (await app.call(a,"/ember/api/guest/provider")).json();
 assert.deepEqual(status,{configured:true,model:"xialong-v1"});
 assert.equal((await (await app.call(b,"/ember/api/guest/provider")).json()).configured,false);
 const files=await readdir(app.directory);
 for(const file of files){
   const value=await readFile(join(app.directory,file),"utf8");
   assert.ok(!value.includes(secret),"Credential leaked in guest data file");
 }
 assert.equal((await app.call(b,"/ember/api/guest/generate","POST",{prompt},generation)).status,409);
 const succeeded=await app.call(a,"/ember/api/guest/generate","POST",{prompt},generation);
 assert.equal(succeeded.status,200);
 assert.deepEqual(await succeeded.json(),{text:"Heather raises an eyebrow."});
 assert.equal(app.calls.length,1);
 assert.equal(app.calls[0].opts.headers.Authorization,"Bearer "+secret);
 assert.ok(!app.calls[0].opts.body.includes(secret));
});
test("guest endpoints deny unauthenticated cookies, foreign origin and paid-request repetition",async t=>{
 const app=await fixture(t);
 const {cookie}=await app.enter();
 const invalid="ember.guest="+"z".repeat(43);
 assert.equal((await app.call(invalid,"/ember/api/guest/session")).status,401);
 assert.equal((await app.call(invalid,"/ember/src/app.js")).status,401);
 assert.equal((await app.call(cookie,"/ember/scene")).status,401,"Legacy scenes require real Orbis login");
 assert.equal((await app.call(cookie,"/ember/api/session")).status,401,"Guest cannot impersonate Orbis");
 assert.equal((await app.call(cookie,"/ember/api/guest/provider","PUT",{model:"xialong-v1",apiKey:"testlongcredential"},
   {...json,Origin:"https://evil.invalid"})).status,403);
 assert.equal((await app.call(cookie,"/ember/api/guest/provider","PUT",{model:"xialong-v1",apiKey:"testlongcredential"},json)).status,200);
 assert.equal((await app.call(cookie,"/ember/api/guest/generate","POST",{prompt},
   {...generation,Origin:"https://evil.invalid"})).status,403);
 assert.equal((await app.call(cookie,"/ember/api/guest/generate","POST",{prompt:"invalid"},generation)).status,400);
 assert.equal((await app.call(cookie,"/ember/api/guest/generate","POST",{prompt},generation)).status,200);
 assert.equal((await app.call(cookie,"/ember/api/guest/generate","POST",{prompt},generation)).status,429);
 assert.equal(app.calls.length,1);
});
test("guest key removal is explicit and does not destroy the guest identity",async t=>{
 const app=await fixture(t);
 const {cookie}=await app.enter();
 assert.equal((await app.call(cookie,"/ember/api/guest/provider","PUT",
   {model:"xialong-v1",apiKey:"test-key-only-12345"},json)).status,200);
 const original=(await (await app.call(cookie,"/ember/api/guest/session")).json()).userId;
 assert.equal((await app.call(cookie,"/ember/api/guest/provider","DELETE",{confirm:false},json)).status,400);
 assert.equal((await app.call(cookie,"/ember/api/guest/provider","DELETE",{confirm:true},json)).status,200);
 assert.equal((await (await app.call(cookie,"/ember/api/guest/session")).json()).userId,original);
 assert.equal((await (await app.call(cookie,"/ember/api/guest/provider")).json()).configured,false);
});


test("guest generation strictly validates and forwards length presets to the provider",async t=>{
 const app=await fixture(t);
 for(const [length,expectedTokens] of [["short",240],["normal",384],["long",680]]){
   const {cookie}=await app.enter();
   assert.equal((await app.call(cookie,"/ember/api/guest/provider","PUT",
     {model:"xialong-v1",apiKey:"test-only-credential-length-"+length},json)).status,200);
   const invalid=await app.call(cookie,"/ember/api/guest/generate","POST",
     {prompt,length:"unlimited"},generation);
   assert.equal(invalid.status,400);
   const oversized=await app.call(cookie,"/ember/api/guest/generate","POST",
     {prompt,length,maxTokens:2048},generation);
   assert.equal(oversized.status,400,"Client must never choose arbitrary token ceilings");
   const response=await app.call(cookie,"/ember/api/guest/generate","POST",{prompt,length},generation);
   assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{text:"Heather raises an eyebrow."});
   assert.equal(JSON.parse(app.calls.at(-1).opts.body).max_tokens,expectedTokens);
 }
 assert.equal(app.calls.length,3);
});
