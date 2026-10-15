import test from "node:test";
import assert from "node:assert/strict";
import {parseStandaloneLorebook} from "../src/asset-import.js";
import {applyLoreOverrides,normalizeEntryOverrides,isLoreMode} from "../src/lore-overrides.js";
import {activateLorebooks,checkLoreEntry} from "../src/lore-engine.js";
import {compileEmberContext} from "../src/context-compiler.js";

const bookJSON=()=>({
  name:"Modes and Knowledge",
  scan_depth:4,token_budget:3200,recursive_scanning:false,
  entries:{
    "1":{uid:1,name:"[⚙️] Example Mode",comment:"Example Mode",
      key:[],constant:true,enabled:true,disable:true,
      content:"Mode instructions, initially disabled."},
    "2":{uid:2,name:"G-spot sex",key:["G-spot sex"],constant:false,
      enabled:true,disable:false,content:"Keyword data."},
    "3":{uid:3,name:"Everything Varies",key:[],constant:true,
      enabled:true,disable:false,content:"Variations enabled."},
  },
});
const imported=()=>{
  const original=bookJSON();
  return {id:"book-x",kind:"lorebook",fields:parseStandaloneLorebook(original).fields,original};
};

test("SillyTavern disable:true overrides contradictory enabled:true",()=>{
  const book=imported();
  assert.equal(book.fields.entries[0].enabled,false);
  assert.equal(book.fields.entries[1].enabled,true);
  assert.equal(book.fields.entries[2].enabled,true);
  assert.equal(isLoreMode(book.fields.entries[0]),true);
  assert.equal(isLoreMode(book.fields.entries[2]),true);
});

test("mode toggles apply per story without modifying source and work with stale imports",()=>{
  const book=imported();
  // Simulate a lorebook imported before the disable flag fix.
  book.fields.entries[0].enabled=true;
  const before=JSON.stringify(book);
  const fallback=applyLoreOverrides(book);
  assert.equal(fallback.fields.entries[0].enabled,false);
  const enabled=applyLoreOverrides({...book,entryOverrides:{"1":{enabled:true}}});
  assert.equal(enabled.fields.entries[0].enabled,true);
  assert.equal(book.original.entries["1"].disable,true);
  const off=applyLoreOverrides({...book,entryOverrides:{"3":{enabled:false}}});
  assert.equal(off.fields.entries[2].enabled,false);
  assert.equal(JSON.stringify(book),before);
});

test("per-story keyword edits and always-active overrides reach lore activation",()=>{
  const source=imported();
  const overrides={"1":{enabled:true,constant:true},"2":{keys:["unusual-term"],constant:false}};
  const configured={...source,entryOverrides:overrides};
  const outcome=activateLorebooks([configured],[{text:"The unusual-term was mentioned."}]);
  assert.ok(outcome.entries.some(e=>e.entryId==="1"));
  assert.ok(outcome.entries.some(e=>e.entryId==="2"));
  const unchanged=activateLorebooks([source],[{text:"The unusual-term was mentioned."}]);
  assert.ok(!unchanged.entries.some(e=>e.entryId==="1"));
  assert.ok(!unchanged.entries.some(e=>e.entryId==="2"));
});

test("hyphenated lore trigger matches without Unicode regex errors",()=>{
  const book=imported();
  assert.doesNotThrow(()=>activateLorebooks([book],[{text:"G-spot sex is a literal keyword."}]));
  const outcome=activateLorebooks([book],[{text:"Discussion of G-spot sex."}]);
  assert.ok(outcome.entries.some(e=>e.entryId==="2"));
  assert.equal(checkLoreEntry(book.fields.entries[1],["This is not relevant."],book.fields).active,false);
  // Unicode flag must also accept other regex punctuation literally.
  assert.doesNotThrow(()=>checkLoreEntry({...book.fields.entries[1],keys:["A/B","many-words","(parenthetical)"]},
    ["many-words are literal"],book.fields));
});

test("unknown and invalid overrides never corrupt lorebook state",()=>{
  const ids=["1","2","3"];
  assert.deepEqual({...normalizeEntryOverrides({"unknown":{enabled:true}},ids)},{});
  assert.throws(()=>normalizeEntryOverrides({"1":{enabled:"yes"}},ids),/enabled switch/);
  assert.throws(()=>normalizeEntryOverrides({"1":{keys:["x".repeat(121)]}},ids),/keywords/);
  assert.deepEqual({...normalizeEntryOverrides({"1":{enabled:false,constant:true,keys:["A","A","B"]}},ids)},
    {"1":{enabled:false,constant:true,keys:["A","B"]}});
});

test("only enabled per-story lore reaches the narrator context",()=>{
  const asset=imported();
  const story={id:"story",revision:1,
    assetSetup:{},
    turns:[{source:"player",mode:"action",text:"I step into the room."}]};
  const base={story,assets:[asset]};
  const off=compileEmberContext({...base,bindings:[{id:"book-x",enabled:true}]});
  assert.doesNotMatch(off.prompt,/Mode instructions, initially disabled/);
  const on=compileEmberContext({...base,bindings:[{
    id:"book-x",enabled:true,entryOverrides:{"1":{enabled:true}},
  }]});
  assert.match(on.prompt,/Mode instructions, initially disabled/);
  const stillOff=compileEmberContext({...base,bindings:[{id:"book-x",enabled:false,
    entryOverrides:{"1":{enabled:true}}}]});
  assert.doesNotMatch(stillOff.prompt,/Mode instructions, initially disabled/);
});
