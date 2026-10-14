import test from "node:test";
import assert from "node:assert/strict";
import { generateNovelAI, EmberProviderError, NOVELAI_MODELS } from "../server/novelai.js";
const token="novelai-private-key-only-for-test";
const model="xialong-v1";
const prompt="EMBER / FREEFORM ROLEPLAY\nPLAYER: Hello\nNARRATOR:";
test("Ember provider adapter uses direct NovelAI endpoint with bounded prompt and secrets only in Authorization",async()=>{
 let called=0;
 const response=await generateNovelAI({token,model,prompt,fetchFn:async(url,options)=>{
   called++;
   assert.equal(url,"https://text.novelai.net/oa/v1/completions");
   assert.equal(options.headers.Authorization,"Bearer "+token);
   assert.equal(options.method,"POST");
   const payload=JSON.parse(options.body);
   assert.equal(payload.model,model);
   assert.equal(payload.prompt,prompt);
   assert.equal(payload.stream,false);
   assert.equal(payload.max_tokens,384);
   assert.ok(!options.body.includes(token));
   return new Response(JSON.stringify({choices:[{text:"NARRATOR: The lights flicker."}]}),{status:200});
 }});
 assert.equal(called,1);
 assert.deepEqual(response,{text:"The lights flicker.",model});
});
test("never sends requests without a usable provider key or supported model",async()=>{
 let called=false;
 const fetchFn=async()=>{called=true;throw Error("not permitted");};
 await assert.rejects(generateNovelAI({token:"short",model,prompt,fetchFn}),e=>e.code==="NOVELAI_NOT_CONFIGURED");
 await assert.rejects(generateNovelAI({token,model:"invalid",prompt,fetchFn}),e=>e.code==="NOVELAI_MODEL_UNSUPPORTED");
 await assert.rejects(generateNovelAI({token,model,prompt:"",fetchFn}),e=>e.code==="EMBER_INVALID_CONTEXT");
 await assert.rejects(generateNovelAI({token,model,prompt,maxTokens:90000,fetchFn}),e=>e.code==="EMBER_INVALID_SETTINGS");
 assert.equal(called,false);
 assert.ok(NOVELAI_MODELS.includes(model));
});
test("maps upstream rate limiting and authentication failures without echoing sensitive provider messages",async()=>{
 for (const [http,code] of [[429,"NOVELAI_BUSY"],[401,"NOVELAI_AUTH"],[403,"NOVELAI_AUTH"],[500,"NOVELAI_UPSTREAM"]]){
   await assert.rejects(generateNovelAI({token,model,prompt,fetchFn:async()=>new Response("secret token xyz", {status:http})}),
     error=>error instanceof EmberProviderError && error.code===code && !error.message.includes("secret"));
 }
});
test("invalid reply JSON, blank choices, and oversized answers fail closed",async()=>{
 for(const [raw,code] of [["not-json","NOVELAI_INVALID_RESPONSE"],[JSON.stringify({choices:[]}),"NOVELAI_EMPTY_REPLY"],
   [JSON.stringify({choices:[{text:"x".repeat(32001)}]}),"NOVELAI_OVERSIZED_REPLY"]]){
   await assert.rejects(generateNovelAI({token,model,prompt,fetchFn:async()=>new Response(raw,{status:200})}),
     error=>error.code===code);
 }
});
test("network failures are wrapped without leaking their exception contents",async()=>{
 await assert.rejects(generateNovelAI({token,model,prompt,fetchFn:async()=>{throw Error("secret network diagnostics");}}),
   error=>error.code==="NOVELAI_NETWORK" && !error.message.includes("secret"));
});
