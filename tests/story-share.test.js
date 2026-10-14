import test from "node:test";
import assert from "node:assert/strict";
import { exportSanitizedStory } from "../src/story-share.js";

const story={
  id:"confidential-story-uuid",
  title:"Story with Rainier",
  account:{email:"not-for-export@example.com",token:"secret-session-token"},
  providerSettings:{apiKey:"never-include-credential"},
  journal:[{text:"Hidden internal private note"}],
  assetSetup:{characterId:"rainier-v2"},
  turns:[
    {id:"private-opening",source:"preview",mode:"narrator",text:'The dinner is ending.\n\n"An evening to remember," Rainier says.'},
    {id:"private-player",source:"player",mode:"speech",text:'"Mi\'Lord"'},
    {id:"private-reply",source:"provider",mode:"narrator",text:'Emotion: tired\nRainier: "Come with me."\n\nHe opens the study door.\nCosteau: "Very good, my lord."'},
    {id:"private-player2",source:"player",mode:"action",text:'*I take off my gloves.*'},
    {id:"private-reply2",source:"provider",mode:"narrator",text:"The count looks at your frostbitten fingers."},
  ],
};
test("the clean transcript exports only readable fiction in story order",()=>{
  const before=structuredClone(story);
  const text=exportSanitizedStory(story,{characterName:"Rainier",personaName:"Eirvargr"});
  assert.equal(text,
    '# Story with Rainier\n\n'
    +'**PREVIEW OPENING**\n\nThe dinner is ending.\n\n"An evening to remember," Rainier says.\n\n'
    +'**Eirvargr**\n\n"Mi\'Lord"\n\n'
    +'**Rainier**\n\n"Come with me."\n\nHe opens the study door.\n\nCosteau: "Very good, my lord."\n\n'
    +'**Eirvargr**\n\n*I take off my gloves.*\n\n'
    +'**Rainier**\n\nThe count looks at your frostbitten fingers.');
  for(const secret of ["private-opening","private-player","private-reply","confidential-story-uuid",
      "not-for-export@example.com","never-include-credential","secret-session-token","Hidden internal private note"]){
    assert.ok(!text.includes(secret),"Private story/app metadata included: "+secret);
  }
  for(const control of ["📋","✎","✕","↻","Account & NovelAI","Copy reply","STORY MENU","[END TRANSCRIPT]"]){
    assert.ok(!text.includes(control),"Unexpected UI chrome or prompt marker: "+control);
  }
  assert.deepEqual(story,before,"The export must never mutate saved turns");
});
test("the story exporter has neutral role fallbacks and preserves narrative as written",()=>{
  const plain={title:"Free Sandbox",turns:[
    {source:"player",mode:"thought",text:"(I should leave.)"},
    {source:"provider",mode:"narrator",text:'He replies, "The count is waiting."'},
  ]};
  const text=exportSanitizedStory(plain);
  assert.match(text,/\*\*YOU\*\*\n\n\(I should leave\.\)/);
  assert.match(text,/\*\*STORY\*\*\n\nHe replies, "The count is waiting\."/);
});
test("generated metadata is excluded but spoken or narrative emotion content is retained",()=>{
  const text=exportSanitizedStory({title:"Test",assetSetup:{characterId:"x"},turns:[
    {source:"provider",mode:"narrator",text:
      'Emotion: neutral\nRainier: "Emotion: tired is what the chart says."\nThe museum shows Emotion: tired.'},
  ]},{characterName:"Rainier"});
  assert.match(text,/Emotion: tired is what the chart says/);
  assert.match(text,/The museum shows Emotion: tired/);
  assert.doesNotMatch(text,/Emotion: neutral/);
  assert.doesNotMatch(text,/Rainier: "Emotion/);
});
test("invalid or empty stories fail without a misleading success",()=>{
  assert.throws(()=>exportSanitizedStory(null),/No readable story/);
  assert.throws(()=>exportSanitizedStory({title:"No turns",turns:[]}),/no written turns/);
  assert.throws(()=>exportSanitizedStory({title:"No text",turns:[{source:"player",text:"  "}] }),/no written turns/);
});
test("untrusted title markup is escaped for Markdown headings without changing story prose",()=>{
  const text=exportSanitizedStory({title:"A *strange* [tale]",turns:[
    {source:"player",text:"I see *strange* things.",mode:"action"},
  ]});
  assert.ok(text.startsWith("# A \\*strange\\* \\[tale\\]"));
  assert.match(text,/I see \*strange\* things\./);
});
