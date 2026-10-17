import test from "node:test";
import assert from "node:assert/strict";
import { importEmberAsset } from "../src/asset-import.js";
import { compileEmberContext } from "../src/context-compiler.js";
import { cleanPersonaDraft,personaTurnBlocker,normalizePersonaDraft,personaNameFromPrompt } from "../src/persona-turn.js";
import { PERSONA_TURN_LENGTH } from "../src/reply-length.js";
import { addPlayerTurn } from "../src/engine.js";

const v2 = (name,personality) => ({spec:"chara_card_v2",spec_version:"2.0",data:{
  name,description:name+" is a traveler.",personality,
  scenario:"At a city gate.",first_mes:"The guards look up.",mes_example:name+": I won't give up.",
}});
const asset=(id,name,personality) => ({
  id,...importEmberAsset(new TextEncoder().encode(JSON.stringify(v2(name,personality)))),
});
const persona=asset("player-v2","Arrax Shadowfang","Independent, wary, protective and stubborn.");
const npc=asset("npc-v2","Rainier Vaugeois","Proud and impatient.");
const base={
  id:"story-1",revision:7,assetSetup:{personaId:"player-v2",characterId:"npc-v2"},
  world:{day:1,minute:480},journal:[],
  storyMemory:"Rainier was insulted at dinner, but did not expel Arrax.",
  turns:[
    {source:"player",mode:"speech",text:'"What happened to the house?"'},
    {source:"provider",mode:"narrator",text:'Rainier folds his arms. "That is none of your business."'},
  ],
};
const bindings=[{id:"npc-v2",enabled:true}];

test("one persona AI turn uses the player V2, recent narration and independent decisions",()=>{
  const result=compileEmberContext({story:base,assets:[persona,npc],bindings,task:"persona"});
  assert.equal(result.task,"persona");
  assert.equal(result.personaId,"player-v2");
  assert.equal(result.characterId,"npc-v2");
  assert.match(result.prompt,/PLAYER PERSONA V2 \(PLAYER CONTROLLED\)/);
  assert.match(result.prompt,/Independent, wary, protective and stubborn/);
  assert.match(result.prompt,/Rainier folds his arms/);
  assert.match(result.prompt,/Rainier was insulted at dinner/);
  assert.match(result.prompt,/independent, character-driven choice/i);
  assert.match(result.prompt,/MOST RECENT NARRATOR/);
  assert.match(result.prompt,/do not repeat explanations/i);
  assert.match(result.prompt,/You may improvise the persona/);
  assert.match(result.prompt,/REQUIRED PERSPECTIVE:.*FIRST PERSON/);
  assert.match(result.prompt,/I, me, my, mine/);
  assert.match(result.prompt,/NEVER describe the PLAYER PERSONA as she\/her, he\/him, they\/them/);
  assert.match(result.prompt,/\*I look up at Heather, my ears twitching\.\*/);
  assert.match(result.prompt,/Third-person pronouns are allowed when clearly referring to OTHER characters/);
  assert.match(result.prompt,/Close every action/i);
  assert.equal(personaNameFromPrompt(result.prompt),"Arrax Shadowfang");
  assert.equal(PERSONA_TURN_LENGTH.maxWords,95);
  assert.match(result.prompt,/\nPLAYER:\n$/);
  assert.doesNotMatch(result.prompt,/\nNARRATOR:$/);
  assert.ok(result.historyTurnsIncluded >= 1);
});

test("persona AI starts from a character card's preview opening",()=>{
  const first={...base,turns:[{source:"preview",mode:"narrator",text:"The innkeeper smiles."}]};
  const result=compileEmberContext({story:first,assets:[persona,npc],bindings,task:"persona"});
  assert.match(result.prompt,/OPENING:\n/);
  assert.match(result.prompt,/innkeeper smiles/);
  assert.match(result.prompt,/\nPLAYER:\n$/);
});

test("persona AI requires selected V2 identity and a completed narrator or opening turn",()=>{
  assert.throws(()=>compileEmberContext({story:{...base,assetSetup:{characterId:"npc-v2"}},
    assets:[npc],bindings,task:"persona"}),/Choose a V2 player persona/);
  assert.throws(()=>compileEmberContext({story:base,assets:[npc],bindings,task:"persona"}),/missing from your library/);
  assert.throws(()=>compileEmberContext({story:{...base,turns:[{source:"player",mode:"action",text:"I open the door"}]},
    assets:[persona,npc],bindings,task:"persona"}),/Finish the narrator response/);
  assert.throws(()=>compileEmberContext({story:base,assets:[persona,npc],bindings,task:"other"}),/Unknown Ember generation task/);
  assert.equal(personaTurnBlocker({...base,assetSetup:{}}),"Choose a V2 player persona in My Persona first.");
  assert.match(personaTurnBlocker({...base,turns:[]}),/Finish the current narrator reply/);
  assert.equal(personaTurnBlocker(base),"");
});

test("existing narrator pipeline remains the default and needs a player turn",()=>{
  assert.throws(()=>compileEmberContext({story:base,assets:[persona,npc],bindings}),/latest turn must be from the player/);
  const story={...base,turns:[{source:"player",mode:"speech",text:"I refuse."}]};
  const result=compileEmberContext({story,assets:[persona,npc],bindings});
  assert.equal(result.task,"narration");
  assert.match(result.prompt,/\nNARRATOR:$/);
  assert.doesNotMatch(result.prompt,/REQUIRED PERSPECTIVE/);
});

test("AI drafts stay unsaved until accepted by the normal player-turn engine",()=>{
  const generated=cleanPersonaDraft('PLAYER:\n*I cross my arms.* "Explain yourself."');
  assert.equal(generated,'*I cross my arms.* "Explain yourself."');
  assert.equal(base.turns.length,2);
  const accepted=addPlayerTurn(base,"action",generated);
  assert.equal(base.turns.length,2);
  assert.equal(accepted.turns.length,3);
  assert.equal(accepted.turns.at(-1).source,"player");
  assert.equal(accepted.turns.at(-1).text,generated);
});

test("persona output cannot smuggle additional narrator or system turns",()=>{
  assert.equal(cleanPersonaDraft('PLAYER: *I leave.*\nNARRATOR: The world ends.'),"*I leave.*");
  assert.equal(cleanPersonaDraft('YOU: "No."'),'"No."');
  assert.throws(()=>cleanPersonaDraft("NARRATOR: The queen leaves."),/narrator turn/);
  assert.throws(()=>cleanPersonaDraft("PLAYER:\nNARRATOR: Not my turn."),/between 1 and 8,000/);
  assert.throws(()=>cleanPersonaDraft("x".repeat(8001)),/between 1 and 8,000/);
  assert.throws(()=>cleanPersonaDraft("x".repeat(32001)),/invalid draft/);
});

test("Luna at the ranger station: preview strips heading and unfinished private thought",()=>{
  const raw=[
    "Luna",
    "*Luna's ears twitch nervously and she wrings her hands, her tail tucking between her legs.*",
    '"My name’s Luna... I didn’t mean to cause trouble."',
    '*Her ears perk up hopefully.* "You’re not gonna eat me, are you?"',
    "(She seems nice.",
  ].join("\n");
  const result=normalizePersonaDraft(raw,{personaName:"Luna"});
  assert.equal(result.shortened,true);
  assert.ok(result.text.startsWith("*Luna's ears"));
  assert.ok(result.text.endsWith('are you?"'));
  assert.doesNotMatch(result.text,/^Luna\s*$/mu);
  assert.doesNotMatch(result.text,/She seems nice/);
});

test("persona turn reacts to last Heather question and earlier Luna explanation remains visible",()=>{
  const story={...base,turns:[
    {source:"preview",mode:"narrator",text:'Heather calls Luna a troublemaker.'},
    {source:"player",mode:"speech",text:'"I didn’t mean to pee on the floor. Those boys kept hogging the restroom."'},
    {source:"provider",mode:"narrator",text:'Heather unlocks the cell and asks gently, "What’s your name, sweetheart?"'},
  ]};
  const p=compileEmberContext({story,assets:[persona,npc],bindings,task:"persona"}).prompt;
  assert.ok(p.indexOf("Those boys kept hogging")<p.indexOf("What’s your name"));
  assert.match(p,/React to the MOST RECENT NARRATOR turn/);
  assert.match(p,/player's explicit suggestion calls for a particular reply or silence/);
  assert.match(p,/do not repeat explanations, introductions/);
  assert.match(p,/Never start with the persona name on its own line/);
});

test("single-turn cleanup keeps fully closed speech and actions and rejects missing endings",()=>{
  assert.equal(cleanPersonaDraft('Luna\n*I glance away.* "My name is Luna."', {personaName:"Luna"}),
    '*I glance away.* "My name is Luna."');
  assert.equal(cleanPersonaDraft('Luna: *I nod.* "Yes."', {personaName:"Luna"}),
    '*I nod.* "Yes."');
  assert.equal(cleanPersonaDraft('PLAYER:\n"I don’t know."\nNARRATOR: Heather speaks.'),'"I don’t know."');
  assert.equal(normalizePersonaDraft('"I understand." (I think',{}).text,'"I understand."');
  assert.throws(()=>cleanPersonaDraft('*I whisper an unfinished line'),/unfinished turn/);
  assert.equal(cleanPersonaDraft('\x60\x60\x60text\n*I nod.*\n\x60\x60\x60'),'*I nod.*');
});

test("Persona AI uses first-person viewpoint without changing references to other characters",()=>{
  const luna=asset("luna-v2","Luna","Shy but willing to speak up for herself.");
  const heather=asset("heather-v2","Heather","Protective ranger.");
  const story={...base,assetSetup:{personaId:"luna-v2",characterId:"heather-v2"},turns:[
    {source:"player",mode:"speech",text:'"I didn\u0027t mean to cause trouble."'},
    {source:"provider",mode:"narrator",text:'Heather unlocks the cell. "What\u0027s your name?"'},
  ]};
  const compiled=compileEmberContext({story,assets:[luna,heather],
    bindings:[{id:"heather-v2",enabled:true}],task:"persona"});
  assert.match(compiled.prompt,/FIRST PERSON for the entire turn/);
  assert.match(compiled.prompt,/This rule is the same for every persona/);
  assert.match(compiled.prompt,/Do not imitate their perspective/);
  assert.match(compiled.prompt,/Example: \*I look up at Heather, my ears twitching\.\* "I'm Luna," \*I say quietly\.\*/);
  // Third-person pronouns for NPCs are still valid. Do not blanket-replace "she".
  const good='*I look at Heather as she steps away.* "I\u0027m Luna," *I say.*';
  assert.equal(cleanPersonaDraft(good,{personaName:"Luna"}),good);
});
