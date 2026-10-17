import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../src/app.js",import.meta.url),"utf8");

test("opening AI Turn displays settings without generating or spending a request",()=>{
  const elements=new Map();
  const $=id=>{
    if(!elements.has(id))elements.set(id,{value:"",textContent:""});
    return elements.get(id);
  };
  let opened=0,rendered=0;
  const sandbox={isGuest:true,state:{},personaBusy:false,narrationBusy:false,
    personaTurnBlocker:()=>"",personaPreview:{text:"old"},$,
    toast:()=>assert.fail("unexpected blocker"),openDialog:()=>opened++,
    renderNarrationState:()=>rendered++,
    generatePersonaDraft:()=>assert.fail("opening must not generate"),
    fetch:()=>assert.fail("opening must not request a provider")};
  const fn=source.slice(source.indexOf("function openPersonaTurn()"),source.indexOf('$("#personaAIButton").addEventListener("click",openPersonaTurn);'));
  vm.runInNewContext(fn+"\nopenPersonaTurn();",sandbox);
  assert.equal(opened,1);
  assert.equal(rendered,1);
  assert.equal(sandbox.personaPreview,null);
  assert.match($("#personaDraftNotice").textContent,/click Generate turn/);
  assert.match(source,/personaAIButton"\).addEventListener\("click",openPersonaTurn\)/);
  assert.match(source,/personaGenerate"\).addEventListener\("click",\(\)=>void generatePersonaDraft\(\)\)/);
});

test("Generate captures the live AI Turn controls before sending the provider request",()=>{
  const save=source.indexOf("function savePersonaOptions()");
  const generate=source.indexOf('async function generatePersonaDraft(mode="fresh")');
  assert.ok(save>=0 && generate>save);
  assert.match(source.slice(save,generate),/return personaOptions;/);
  assert.match(source.slice(generate,source.indexOf("function openPersonaTurn()",generate)),
    /const options=savePersonaOptions\(\);/);
  assert.match(source,/Sent: .*options\.decision/);
});

test("AI Turn suggestion is readable in Lamplight and Daylight",()=>{
  const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(css,/#personaSuggestion\s*\{[^}]*background:\s*var\(--paper-warm\);[^}]*color:\s*var\(--text\);/);
  assert.match(css,/:root\[data-theme="daylight"\] #personaSuggestion\s*\{[^}]*color-scheme:\s*light;/);
  assert.match(css,/#personaSuggestion::placeholder\s*\{[^}]*color:\s*var\(--muted\);/);
});

test("suggestion is present only once inside the AI Turn dialog",()=>{
  assert.equal((source.match(/id="personaSuggestion"/g)||[]).length,1);
  const dialogStart=source.indexOf('<dialog id="personaDialog"');
  const field=source.indexOf('id="personaSuggestion"');
  assert.ok(dialogStart>=0 && field>dialogStart);
  assert.ok(field<source.indexOf("</dialog>",dialogStart));
});
