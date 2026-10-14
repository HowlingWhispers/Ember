import test from "node:test";
import assert from "node:assert/strict";
import { compileEmberContext, EMBER_CONTEXT_LIMIT } from "../src/context-compiler.js";
import { createStory, addPlayerTurn, setStoryMemory, validateStory } from "../src/engine.js";
import { exportStory, importStory } from "../src/storage.js";

const npc={
  id:"rainier-v2",kind:"character",fields:{
    name:"Rainier Vaugeois",description:"A proud noble who resents false deference. ".repeat(450),
    personality:"Impatient with dishonesty and protective of his family's name. ".repeat(90),
    scenario:"Rainier owns the Vaugeois Estate.",
    firstMessage:"Rainier dismisses the dinner guests and asks you to stay.",
    alternateGreetings:[],exampleMessages:'Rainier: "Speak plainly."',
    creatorNotes:"",characterBook:null,
  },
};
const persona={
  id:"eirvargr-v2",kind:"character",fields:{
    name:"Eirvargr",description:"A traveler who lived through a harsh winter. ".repeat(120),
    personality:"Stubborn, direct.",scenario:"A guest at Rainier's dinner.",
    exampleMessages:'Eirvargr: "I remember that house."',
  },
};
const bindings=[{id:npc.id,enabled:true,greeting:0}];
function makeStory(rounds=20,size=520){
  const turns=[{source:"preview",mode:"narrator",text:"The dinner ends at Vaugeois Estate."}];
  for(let i=0;i<rounds;i++){
    turns.push({source:"player",mode:"speech",text:i===0
      ? "My ancestral house was burned when Rainier built an orphanage."
      : "We are still discussing the orphanage and compensation; turn "+i});
    turns.push({source:"provider",mode:"narrator",text:"Rainier discusses the unresolved dispute. "+("x".repeat(size))+" End of turn "+i});
  }
  turns.push({source:"player",mode:"speech",text:"Did you look into the burned house yet?"});
  return {id:"story-123",turns,assetSetup:{characterId:npc.id,personaId:persona.id},
    storyMemory:"The 400-year-old ancestral home was burned without warning. Rainier is not yet known to have investigated it. No agreement or restitution has been made."};
}
test("a verbose V2 card cannot crowd dialogue out to only the last two generations",()=>{
  const story=makeStory();
  const p=compileEmberContext({story,assets:[npc,persona],bindings});
  assert.ok(p.chars<=EMBER_CONTEXT_LIMIT);
  assert.ok(p.historyTurnsIncluded>=8,"Recent turns squeezed out by card: "+p.historyTurnsIncluded);
  assert.ok(p.reservedHistoryChars>=8000);
  assert.ok(p.prompt.includes("Did you look into the burned house yet?"));
  assert.ok(p.prompt.includes("The 400-year-old ancestral home was burned without warning"));
  assert.ok(p.prompt.includes("Rainier Vaugeois"));
  assert.ok(p.prompt.includes("Eirvargr"));
  assert.equal(p.storyMemoryIncluded,true);
  assert.ok(p.historyTurnsOmitted>0);
  assert.ok(p.openingExcerptIncluded);
  assert.match(p.prompt,/The dinner ends at Vaugeois Estate/);
  assert.ok(p.warnings.some(x=>/older story turns/.test(x)));
});
test("context diagnostics report exact included and omitted turn counts without sending an AI request",()=>{
  const story=makeStory(3,100);
  const p=compileEmberContext({story:{...story,assetSetup:undefined},assets:[],bindings:[]});
  assert.equal(p.historyTurnsAvailable,story.turns.length);
  assert.equal(p.historyTurnsIncluded,story.turns.length);
  assert.equal(p.historyTurnsOmitted,0);
  assert.equal(p.oldestIncludedTurnIndex,0);
  assert.equal(p.openingExcerptIncluded,false);
  assert.equal(p.estimatedTokens,Math.ceil([...p.prompt].length/4));
});
test("pinned story memory survives local save/backup and can be updated without rewriting turns",()=>{
  let story=addPlayerTurn(createStory(),"speech","I discuss my lost home.");
  const base=structuredClone(story);
  story=setStoryMemory(story,"The house was destroyed without consent.");
  assert.equal(story.storyMemory,"The house was destroyed without consent.");
  assert.equal(story.revision,base.revision+1);
  assert.deepEqual(story.turns,base.turns);
  assert.deepEqual(importStory(exportStory(story)).storyMemory,story.storyMemory);
  assert.equal(validateStory(story).storyMemory,story.storyMemory);
  assert.throws(()=>setStoryMemory(story,"x".repeat(4001)),/at most 4,000/);
  assert.throws(()=>validateStory({...story,storyMemory:"x".repeat(4001)}),/Invalid story memory/);
  const clear=setStoryMemory(story," ");
  assert.equal(clear.storyMemory,"");
  assert.deepEqual(clear.turns,story.turns);
});
test("pinning memory never automatically invents a summary or copies journal notes",()=>{
  const s=makeStory(2,200);
  const result=compileEmberContext({
    story:{...s,storyMemory:"",journal:[{kind:"note",text:"SECRET JOURNAL NOTE ABOUT A FORGOTTEN CHARACTER"}]},
    assets:[npc,persona],bindings,
  });
  assert.equal(result.storyMemoryIncluded,false);
  assert.doesNotMatch(result.prompt,/SECRET JOURNAL NOTE/);
});
test("initial opening is not invented when a story has no preview turn",()=>{
  const s=makeStory(30,400);
  s.turns.shift();
  const p=compileEmberContext({story:s,assets:[npc],bindings,
    maxChars:EMBER_CONTEXT_LIMIT});
  assert.equal(p.openingExcerptIncluded,false);
});
test("UI provides memory editing, coverage and no-provider preview",async()=>{
  const {readFileSync}=await import("node:fs");
  const app=readFileSync(new URL("../src/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
  assert.match(app,/id="memoryButton"/);
  assert.match(app,/id="memoryMenuButton"/);
  assert.match(app,/data-menu-action="memory"/);
  assert.match(app,/id="storyMemoryInput" maxlength="4000"/);
  assert.match(app,/setStoryMemory\(state,\$\("#storyMemoryInput"\)\.value\)/);
  assert.match(app,/id="contextCoverage"/);
  assert.match(app,/compileGuestHistory\(recent\)/);
  assert.match(app,/recordContextCoverage\(compiled,generationStory\.id\)/);
  assert.match(app,/This does not use provider credits/);
  assert.match(css,/#storyMemoryInput \{/);
});
