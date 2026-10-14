import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuestVault, requireVaultConfig, GUEST_COOKIE_AGE } from "../server/guest-vault.js";

const key="9a".repeat(32);
async function fixture(t) {
 const dir=await mkdtemp(join(tmpdir(),"ember-guest-test-"));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const vault=await createGuestVault({directory:dir,encryptionKey:key});
 return {dir,vault};
}
test("guest identity is opaque, durable, and never saves raw session cookies",async t=>{
 const {dir,vault}=await fixture(t);
 const guest=await vault.create();
 assert.match(guest.token,/^[A-Za-z0-9_-]{43}$/);
 assert.match(guest.profileId,/^[0-9a-f-]{36}$/);
 assert.deepEqual(await vault.identify(guest.token),{profileId:guest.profileId,hasNovelAI:false,model:null});
 const data=await readFile(join(dir,(await readdir(dir))[0]),"utf8");
 assert.ok(!data.includes(guest.token));
 assert.ok(!data.includes("novelai-private"));
 const restarted=await createGuestVault({directory:dir,encryptionKey:key});
 assert.equal((await restarted.identify(guest.token)).profileId,guest.profileId);
 assert.equal(await restarted.identify("a".repeat(43)),null);
 assert.ok(GUEST_COOKIE_AGE>=30*24*3600);
});
test("provider key encryption survives restart, isolates guests, and never exposes it via identify",async t=>{
 const {dir,vault}=await fixture(t);
 const a=await vault.create(),b=await vault.create();
 const secret="novelai-private-key-example-dont-log";
 await vault.saveNovelAI(a.token,{model:"glm-4-6",apiKey:secret});
 assert.deepEqual(await vault.identify(a.token),{profileId:a.profileId,hasNovelAI:true,model:"glm-4-6"});
 assert.equal(await vault.getNovelAIForServer(b.token),null);
 const files=await readdir(dir);
 for(const file of files){
   const onDisk=await readFile(join(dir,file),"utf8");
   assert.ok(!onDisk.includes(secret));
   assert.ok(!onDisk.includes(a.token));
 }
 const restarted=await createGuestVault({directory:dir,encryptionKey:key});
 assert.deepEqual(await restarted.getNovelAIForServer(a.token),{model:"glm-4-6",apiKey:secret});
 await restarted.clearNovelAI(a.token);
 assert.equal(await restarted.getNovelAIForServer(a.token),null);
 assert.equal((await restarted.identify(a.token)).hasNovelAI,false);
});
test("invalid config and unsupported model fail closed",async t=>{
 const {vault}=await fixture(t);
 const g=await vault.create();
 assert.throws(()=>requireVaultConfig({directory:"relative",encryptionKey:key}),/absolute/);
 assert.throws(()=>requireVaultConfig({directory:"/tmp/ember-vault",encryptionKey:"short"}),/32-byte/);
 await assert.rejects(vault.saveNovelAI(g.token,{model:"unexpected",apiKey:"secure-credential"}),/Unsupported/);
 await assert.rejects(vault.saveNovelAI(g.token,{model:"xialong-v1",apiKey:"tiny"}),/Invalid/);
 assert.equal(await vault.identify("invalid"),null);
});
test("guest credential storage serializes concurrent writes to one profile",async t=>{
 const {vault}=await fixture(t);
 const g=await vault.create();
 await Promise.all([
   vault.saveNovelAI(g.token,{model:"xialong-v1",apiKey:"key-11111111111"}),
   vault.saveNovelAI(g.token,{model:"glm-4-6",apiKey:"key-22222222222"}),
 ]);
 const result=await vault.getNovelAIForServer(g.token);
 assert.equal(result.model,"glm-4-6");
 assert.equal(result.apiKey,"key-22222222222");
});
test("changing vault master key cannot decrypt saved provider secrets",async t=>{
 const {dir,vault}=await fixture(t);
 const g=await vault.create();
 await vault.saveNovelAI(g.token,{model:"xialong-v1",apiKey:"sufficiently-long-token"});
 const wrongKey=await createGuestVault({directory:dir,encryptionKey:"cd".repeat(32)});
 await assert.rejects(wrongKey.getNovelAIForServer(g.token));
});
