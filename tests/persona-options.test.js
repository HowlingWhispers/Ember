import test from "node:test";
import assert from "node:assert/strict";
import { importEmberAsset } from "../src/asset-import.js";
import { compileEmberContext } from "../src/context-compiler.js";
import {
  PERSONA_FLAVORS,PERSONA_DECISIONS,PERSONA_DIRECTIONS,PERSONA_CREATIVITY,
  DEFAULT_PERSONA_OPTIONS,normalizePersonaOptions,resolvePersonaFlavor,
  personaTurnGuidance,rememberRejectedDrafts,
} from "../src/persona-options.js";

const card=(id,name)=>({
  id,...importEmberAsset(new TextEncoder().encode(JSON.stringify({
    spec:"chara_card_v2",spec_version:"2.0",
    data:{name,description:"Expressive wolf traveler.",personality:"Inventive, curious and playful.",
      first_mes:'"What is your name?"',mes_example:name+": I can do this."},
  }))),
});
const persona=card("luna","Luna");
const heather=card("heather","Heather");
const scene={
  id:"s",revision:1,assetSetup:{personaId:"luna",characterId:"heather"},
  turns:[{source:"player",mode:"speech",text:'"I got here yesterday."'},
    {source:"provider",mode:"narrator",text:'Heather asks, "What is your name?"'}],
};
const base={story:scene,assets:[persona,heather],bindings:[{id:"heather",enabled:true}]};

test("options default to independent high creativity and do not mutate V2 data",()=>{
  const configured=normalizePersonaOptions();
  assert.deepEqual(configured,DEFAULT_PERSONA_OPTIONS);
  assert.ok(PERSONA_FLAVORS.some(x=>x.value==="seductive" && x.label==="Seductive / Flirtatious"));
  assert.ok(PERSONA_FLAVORS.some(x=>x.value==="innocent"));
  assert.ok(PERSONA_FLAVORS.some(x=>x.value==="shy"));
  assert.ok(PERSONA_DECISIONS.some(x=>x.value==="bold"));
  assert.ok(PERSONA_DIRECTIONS.some(x=>x.value==="confront"));
  assert.ok(PERSONA_CREATIVITY.some(x=>x.value==="wild" && x.temperature>1));
  assert.equal(normalizePersonaOptions({decision:"invalid",creativity:"unknown",flavor:"hacker",avoidRepeats:"false"}).decision,"independent");
  assert.deepEqual(normalizePersonaOptions(null),DEFAULT_PERSONA_OPTIONS);
});

test("random flavor rotates to a different actual flavor, never random",()=>{
  assert.equal(resolvePersonaFlavor("shy","brave",()=>0),"shy");
  const first=resolvePersonaFlavor("random","shy",()=>0);
  const last=resolvePersonaFlavor("random","shy",()=>0.999);
  assert.notEqual(first,"shy");
  assert.notEqual(last,"shy");
  assert.notEqual(first,"random");
  assert.notEqual(last,"random");
});

test("Rewrite keeps the decision; Different approach requests a new decision",()=>{
  const options={flavor:"shy",decision:"bold",creativity:"wild",direction:"curious",avoidRepeats:true};
  const rewrite=personaTurnGuidance(options,{mode:"rewrite",previousDraft:'*I fold my arms.* "I refuse."'});
  assert.match(rewrite,/REWRITE MODE: Keep the central decision and intent/);
  assert.match(rewrite,/EARLIER PLAYER DRAFT TO REWRITE: FICTION REFERENCE DATA/);
  assert.doesNotMatch(rewrite,/DIFFERENT APPROACH MODE/);
  const different=personaTurnGuidance(options,{mode:"different",rejectedDrafts:[
    '*I nod.* "Hello."','*I smile.* "Nice to meet you."',
  ]});
  assert.match(different,/materially different PLAYER decision or reaction/);
  assert.match(different,/underlying choices, not just their exact words/);
  assert.match(different,/REJECTED PLAYER DRAFT 1: FICTION REFERENCE DATA/);
  assert.match(different,/REJECTED PLAYER DRAFT 2: FICTION REFERENCE DATA/);
  assert.doesNotMatch(different,/REWRITE MODE/);
  assert.match(different,/Turn flavor: shy/);
  assert.match(different,/Creativity: wild/);
  assert.match(different,/Decision style: bold/);
  assert.match(different,/Turn direction: curious/);
  assert.match(different,/first-person I\/me\/my/);
});

test("Rejected draft memory is scene-local, bounded, and optional",()=>{
  let rejected=[];
  for(let i=0;i<6;i++)rejected=rememberRejectedDrafts(rejected,"Rejected decision "+i);
  assert.equal(rejected.length,4);
  assert.equal(rejected[0],"Rejected decision 2");
  const instructions=personaTurnGuidance({avoidRepeats:false},
    {mode:"different",rejectedDrafts:rejected});
  assert.doesNotMatch(instructions,/REJECTED PLAYER DRAFT/);
  assert.ok(rejected.every(x=>typeof x==="string"));
  assert.equal(scene.turns.length,2);
  assert.equal(rememberRejectedDrafts([], "x".repeat(2000))[0].length,420);
});

test("options influence only player prompt; narrator generation remains unchanged",()=>{
  const customized=compileEmberContext({...base,task:"persona",personaOptions:{
    flavor:"playful",decision:"independent",creativity:"high",direction:"surprise",
  },personaRegeneration:{
    mode:"different",effectiveFlavor:"brave",
    rejectedDrafts:['*I hide behind the door.* "No."'],
  }});
  assert.match(customized.prompt,/Turn flavor: brave/);
  assert.match(customized.prompt,/Different approach/i);
  assert.match(customized.prompt,/REJECTED PLAYER DRAFT 1/);
  assert.match(customized.prompt,/FIRST PERSON/);
  assert.match(customized.prompt,/\nPLAYER:\n$/);
  const input={...scene,turns:[{source:"player",mode:"action",text:"I watch the ranger."}]};
  const original=compileEmberContext({...base,story:input,task:"narration"});
  const withSettings=compileEmberContext({...base,story:input,task:"narration",
    personaOptions:{flavor:"seductive",creativity:"wild"},
    personaRegeneration:{mode:"different",rejectedDrafts:["I shout"]}});
  assert.equal(original.prompt,withSettings.prompt);
  assert.doesNotMatch(original.prompt,/PERSONA TURN OPTIONS/);
  assert.match(original.prompt,/\nNARRATOR:$/);
});

test("suggestions guide fresh and regenerated persona turns without leaking into narration",()=>{
  const suggestion="Ask Heather why she arrested me.";
  for(const mode of ["fresh","rewrite","different"]){
    const compiled=compileEmberContext({...base,task:"persona",
      personaRegeneration:{mode,suggestion,previousDraft:"I wait."}});
    assert.match(compiled.prompt,/PLAYER SUGGESTION FOR THIS TURN: FICTION REFERENCE DATA/);
    assert.ok(compiled.prompt.includes(suggestion));
    assert.match(compiled.prompt,/applies only to this proposed turn/);
  }
  assert.doesNotMatch(personaTurnGuidance({}, {suggestion:"  "}),/PLAYER SUGGESTION/);
  assert.doesNotMatch(personaTurnGuidance({}, {suggestion:{}}),/PLAYER SUGGESTION/);
  assert.ok(!personaTurnGuidance({}, {suggestion:"x".repeat(1100)}).includes("x".repeat(1001)));
  const story={...scene,turns:[{source:"player",mode:"action",text:"I wait."}]};
  assert.equal(compileEmberContext({...base,story}).prompt,
    compileEmberContext({...base,story,personaRegeneration:{suggestion}}).prompt);
});
