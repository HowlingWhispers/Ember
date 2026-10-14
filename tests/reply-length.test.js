import test from "node:test";
import assert from "node:assert/strict";
import { boundCompletedReply } from "../server/reply-boundary.js";
import {generateNovelAI} from "../server/novelai.js";
import {DEFAULT_REPLY_LENGTH,REPLY_LENGTHS,replyLength,replyLengthOrDefault} from "../src/reply-length.js";
import {compileEmberContext} from "../src/context-compiler.js";
const token="novelai-test-credential-never-exposed",model="xialong-v1";
const prompt="EMBER / FREEFORM ROLEPLAY\nPLAYER: Hello\nNARRATOR:";

test("three independently enforced length presets default to a smaller normal reply",()=>{
 assert.equal(DEFAULT_REPLY_LENGTH,"normal");
 assert.equal(REPLY_LENGTHS.short.maxWords,80);
 assert.equal(REPLY_LENGTHS.normal.maxWords,135);
 assert.equal(REPLY_LENGTHS.long.maxWords,250);
 assert.ok(REPLY_LENGTHS.short.maxTokens<REPLY_LENGTHS.normal.maxTokens);
 assert.ok(REPLY_LENGTHS.normal.maxTokens<REPLY_LENGTHS.long.maxTokens);
 assert.equal(replyLengthOrDefault("broken"),"normal");
 assert.throws(()=>replyLength("unlimited"),/valid Ember reply length/);
});
test("sentence-aware clipping cuts an unfinished final thought rather than saving gibberish",()=>{
 const raw='Rainier turns toward the study. "Wait here," he says. He holds out his';
 const finished=boundCompletedReply(raw,135);
 assert.equal(finished.text,'Rainier turns toward the study. "Wait here," he says.');
 assert.equal(finished.shortened,true);
 assert.ok(!finished.text.endsWith("his"));
 assert.deepEqual(boundCompletedReply('Rainier asks, "Are you well?"',135),
   {text:'Rainier asks, "Are you well?"',shortened:false});
});
test("overlong output is strictly capped to a complete sentence",()=>{
 const sentences=Array.from({length:35},(_,i)=>'Rainier listens to the guest carefully in the quiet room number '+i+'.');
 const raw=sentences.join(" ");
 for(const key of ["short","normal","long"]){
   const maxWords=replyLength(key).maxWords;
   const {text,shortened}=boundCompletedReply(raw,maxWords);
   assert.equal(shortened,true);
   assert.ok(text.split(/\s+/u).length<=maxWords);
   assert.match(text,/\.$/);
   assert.ok(!text.endsWith(raw.slice(-30)));
 }
});
test("the adapter uses the selected token ceiling and does not issue a second paid request",async()=>{
 let calls=0;
 const raw=Array.from({length:40},(_,i)=>"Rainier watches the room carefully as he waits "+i+".").join(" ")+" He holds out his";
 const result=await generateNovelAI({
   token,model,prompt,maxTokens:240,maxWords:80,
   fetchFn:async(_url,options)=>{
     calls++;
     assert.equal(JSON.parse(options.body).max_tokens,240);
     return new Response(JSON.stringify({choices:[{text:raw,finish_reason:"length"}]}),{status:200});
   },
 });
 assert.equal(calls,1);
 assert.equal(result.shortened,true);
 assert.ok(result.text.split(/\s+/u).length<=80);
 assert.match(result.text,/\.$/);
});
test("no complete sentence is not silently saved as a completed AI reply",async()=>{
 await assert.rejects(generateNovelAI({token,model,prompt,maxWords:80,
   fetchFn:async()=>new Response(JSON.stringify({choices:[{text:"Rainier holds out his"}]}),{status:200}),
 }),error=>error.code==="NOVELAI_INCOMPLETE_REPLY");
});
test("the prompt explicitly requests a single brief complete turn and preserves the server prefix",()=>{
 const story={turns:[{source:"player",mode:"speech",text:'"Hello, Count."'}]};
 for(const [key,preset] of Object.entries(REPLY_LENGTHS)){
   const result=compileEmberContext({story,assets:[],bindings:[],generationLength:key});
   assert.ok(result.prompt.startsWith("EMBER / FREEFORM ROLEPLAY\n"));
   assert.ok(result.prompt.endsWith("\nNARRATOR:"));
   assert.ok(result.prompt.includes("never more than "+preset.maxWords+" words"));
   assert.match(result.prompt,/Finish a complete sentence before the output token allowance ends/);
 }
});
test("visible UI lets guests set and persist response size but does not claim legacy support",async()=>{
 const {readFileSync}=await import("node:fs");
 const app=readFileSync(new URL("../src/app.js",import.meta.url),"utf8");
 const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
 const storage=readFileSync(new URL("../src/storage.js",import.meta.url),"utf8");
 assert.match(app,/id="replyLengthSelect"/);
 assert.match(app,/value="short"/);
 assert.match(app,/value="normal"/);
 assert.match(app,/value="long"/);
 assert.match(app,/requestBody = \{prompt:compiled.prompt,length:generationLength\}/);
 assert.match(app,/setPreference\("replyLength",generationLength\)/);
 assert.match(storage,/replyLength: "hw:ember:reply-length:v1"/);
 assert.match(css,/\.reply-length-picker select \{[^}]*color: var\(--text\)/);
});
