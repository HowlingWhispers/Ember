import test from "node:test";
import assert from "node:assert/strict";
import { importEmberAsset } from "../src/asset-import.js";
import { compileEmberContext } from "../src/context-compiler.js";
import { createStory, addPlayerTurn, setStoryPersona, validateStory } from "../src/engine.js";
const bytes=card=>new TextEncoder().encode(JSON.stringify(card));
const card=(name,description,personality,extra={})=>({
  spec:"chara_card_v2",spec_version:"2.0",data:{
    name,description,personality,scenario:"At the Vaugeois Estate",
    first_mes:"{{char}} speaks this NPC greeting, not the player.",
    mes_example:'{{char}}: "Greetings."',
    ...extra,
  },
});
const imported=(v,id)=>({id,...importEmberAsset(bytes(v))});
const rainier=imported(card("Rainier Vaugeois","A courteous but impatient noble.","Proud, guarded."),"npc-01");
const player=imported(card("Eirvargr","A northern traveler with a scarred eye.","Observant and reserved.",{
  character_book:{name:"Persona memories",entries:[{uid:1,keys:["scarred"],content:"The wound is old.",enabled:true,constant:true}]}
}),"player-01");
const turns=[{source:"player",mode:"speech",text:'"Mi\'Lord," I reply with a scarred face.'}];
const bindings=[{id:rainier.id,enabled:true,greeting:0}];

test("imported V2 cards may independently represent an NPC and a player persona",()=>{
 const setup={characterId:rainier.id,personaId:player.id,openingIndex:0};
 const result=compileEmberContext({story:{assetSetup:setup,turns},assets:[rainier,player],bindings});
 assert.equal(result.characterId,rainier.id);
 assert.equal(result.personaId,player.id);
 assert.match(result.prompt,/PLAYER PERSONA V2 \(PLAYER CONTROLLED\)/);
 assert.match(result.prompt,/Eirvargr/);
 assert.match(result.prompt,/northern traveler/);
 assert.match(result.prompt,/Rainier Vaugeois/);
 assert.match(result.prompt,/courteous but impatient noble/);
 assert.match(result.prompt,/The wound is old/);
 assert.match(result.prompt,/Never write the player persona.s dialogue/);
 const playerSection=result.prompt.split("[PLAYER PERSONA V2 (PLAYER CONTROLLED): FICTION REFERENCE DATA]")[1].split("[END PLAYER PERSONA V2")[0];
 assert.doesNotMatch(playerSection,/NPC greeting, not the player/);
});
test("a player persona works in an empty sandbox without a selected NPC",()=>{
 const context=compileEmberContext({
   story:{assetSetup:{personaId:player.id},turns},
   assets:[player],bindings:[],
 });
 assert.equal(context.characterId,null);
 assert.equal(context.personaId,player.id);
 assert.match(context.prompt,/Eirvargr/);
 assert.doesNotMatch(context.prompt,/NPC greeting, not the player/);
});
test("persona and NPC roles cannot silently share the same V2 card",()=>{
 assert.throws(()=>compileEmberContext({
   story:{assetSetup:{characterId:player.id,personaId:player.id},turns},
   assets:[player],bindings:[{id:player.id,enabled:true}],
 }),/same card/);
 assert.throws(()=>compileEmberContext({
   story:{assetSetup:{personaId:player.id},turns},
   assets:[player],bindings:[{id:player.id,enabled:true}],
 }),/also attached as an NPC/);
});
test("missing V2 persona fails explicitly rather than running with the wrong player's identity",()=>{
 assert.throws(()=>compileEmberContext({
   story:{assetSetup:{characterId:rainier.id,personaId:"missing-persona"},turns},
   assets:[rainier],bindings,
 }),/missing from your library/);
});
test("persona selections are non-destructive, per-story and survive save validation",()=>{
 const story=addPlayerTurn(createStory(),"action","I approach the hall.");
 const withPersona=setStoryPersona(story,player.id);
 assert.equal(withPersona.assetSetup.personaId,player.id);
 assert.equal(withPersona.revision,story.revision+1);
 assert.deepEqual(withPersona.turns,story.turns);
 assert.equal(story.assetSetup,undefined);
 assert.equal(validateStory(withPersona).assetSetup.personaId,player.id);
 const without=setStoryPersona(withPersona,null);
 assert.equal(without.assetSetup.personaId,undefined);
 assert.deepEqual(without.turns,story.turns);
 assert.throws(()=>setStoryPersona({assetSetup:{characterId:player.id}},player.id),/cannot also/);
 assert.throws(()=>setStoryPersona(story,""),/valid V2 persona/);
});
test("Ember's library presents personas as selectable V2 cards without changing source formats",async()=>{
 const {readFileSync}=await import("node:fs");
 const lib=readFileSync(new URL("../src/library-ui.js",import.meta.url),"utf8");
 const app=readFileSync(new URL("../src/app.js",import.meta.url),"utf8");
 assert.match(lib,/data-tab="persona">My Persona/);
 assert.match(lib,/type==="persona" \? a.kind==="character"/);
 assert.match(lib,/data-action="select-persona"/);
 assert.match(lib,/data-action="clear-persona"/);
 assert.match(lib,/await onSelectPersona\(asset\)/);
 assert.match(app,/id="personaButton"/);
 assert.match(app,/data-menu-action="persona"/);
 assert.match(app,/function playerPersonaName\(/);
 assert.match(app,/generationStory\.assetSetup\?\.personaId/);
 assert.match(app,/setStoryPersona\(state,asset\?\.id\?\?null\)/);
});
