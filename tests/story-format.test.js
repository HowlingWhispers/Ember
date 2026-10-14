import test from "node:test";
import assert from "node:assert/strict";
import { segmentStoryText, storyCharacterHeading } from "../src/story-format.js";
import { cleanNarration } from "../src/engine.js";

test("Rainier's prose is separated into comfortable paragraphs with dialogue and stage metadata removed",()=>{
  const text=cleanNarration(
    "Rainier's face relaxes. He leans against his cane.\n  Emotion: neutral\n"
    +"The hall grows quiet as the door closes.\n  Emotion: tired\n"
    +'Rainier: "My apologies, I did not catch your name earlier." His voice is low.\n Emotion: thinking');
  assert.doesNotMatch(text,/Emotion:\s*(neutral|tired|thinking)/);
  const blocks=segmentStoryText(text);
  assert.equal(blocks.length,3);
  assert.equal(blocks[0].parts[0].kind,"narration");
  assert.equal(blocks[1].parts[0].kind,"narration");
  assert.equal(blocks[2].speaker,"Rainier");
  assert.deepEqual(blocks[2].parts.map(v=>v.kind),["dialogue","narration"]);
  assert.match(blocks[2].parts[0].text,/My apologies/);
});
test("inline quoted dialogue and action notation are distinct without discarding narrative prose",()=>{
  const [line]=segmentStoryText('"Come along," Rainier says, *tapping his cane*. "Quietly."');
  assert.deepEqual(line.parts.map(p=>p.kind),["dialogue","narration","action","narration","dialogue"]);
  assert.equal(line.parts.map(p=>p.text).join(""),'"Come along," Rainier says, *tapping his cane*. "Quietly."');
});
test("regular apostrophes, quoted initials, curly dialogue, and unmarked thoughts remain readable",()=>{
  const segments=segmentStoryText('It is Rainier\'s house, he thinks.\n“Who are you?” he asks.');
  assert.equal(segments.length,2);
  assert.deepEqual(segments[0].parts,[{kind:"narration",text:"It is Rainier's house, he thinks."}]);
  assert.deepEqual(segments[1].parts.map(p=>p.kind),["dialogue","narration"]);
});
test("untrusted markup is returned as literal text, not HTML",()=>{
  const blocks=segmentStoryText('<img src=x onerror=alert(1)> "Hello"');
  assert.equal(blocks[0].parts[0].text,"<img src=x onerror=alert(1)> ");
  assert.equal(blocks[0].parts[1].text,'"Hello"');
});
test("emotion in fictional dialogue is preserved, only standalone provider metadata is stripped",()=>{
  const text='She says, "Emotion: tired is what the chart reads."\\nEmotion: weary'.replace("\\n","\n");
  assert.equal(cleanNarration(text),'She says, "Emotion: tired is what the chart reads."');
  assert.equal(cleanNarration('The exhibit is titled Emotion: tired.'),'The exhibit is titled Emotion: tired.');
});
test("non-string or blank reader content produces no paragraphs",()=>{
  assert.deepEqual(segmentStoryText(undefined),[]);
  assert.deepEqual(segmentStoryText("  \n  "),[]);
});


test("speech, actions and thoughts meet readable contrast levels in both themes",async()=>{
  const {readFileSync}=await import("node:fs");
  const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
  const themes=[{match:css.match(/:root \{([\s\S]*?)\}/)[1],background:"#1c2530"},
    {match:css.match(/:root\[data-theme="daylight"\] \{([\s\S]*?)\}/)[1],background:"#faf4e6"}];
  const luminance=value=>{
    const rgb=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255)
      .map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4);
    return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
  };
  const contrast=(a,b)=>{
    const [l,h]=[luminance(a),luminance(b)].sort((a,b)=>a-b);
    return (h+0.05)/(l+0.05);
  };
  for(const {match,background} of themes){
    for(const role of ["dialogue","action","thought"]){
      const hex=match.match(new RegExp("--"+role+":\\s*(#[A-Fa-f0-9]{6})"))?.[1];
      assert.ok(hex,"Missing color for "+role);
      assert.ok(contrast(hex,background)>=4.5,role+" fails contrast against "+background);
    }
  }
  assert.match(css,/\.story-dialogue \{[^}]*font-weight:\s*650/);
  assert.match(css,/\.story-action \{[^}]*font-style:\s*italic/);
  assert.match(css,/\.story-paragraph \{[^}]*margin:/);
});


test("V2 card provides the turn heading; old saved title still resolves Rainier",()=>{
  const previous={title:"Story with Rainier",assetSetup:{characterId:"v2-rainier"}};
  assert.equal(storyCharacterHeading(previous),"Rainier");
  assert.equal(storyCharacterHeading(previous,"Count Rainier Vaugeois"),"Count Rainier Vaugeois");
  assert.equal(storyCharacterHeading(previous,"","Some other launch"),"Rainier");
  assert.equal(storyCharacterHeading({title:"Free Sandbox"}),"STORY");
  assert.equal(storyCharacterHeading({title:"Roleplay",assetSetup:null},"","Lady Eir"),"Lady Eir");
  assert.equal(storyCharacterHeading({title:"Story with Rainier"}),"STORY",
    "Do not invent main-character identity based on a generic unbound title");
});
test("primary speaker attribution is redundant under Rainier heading, but other speakers remain",()=>{
  const text='Rainier: "My apologies." His voice lowers.\nCosteau: "Very good, my lord."';
  const lines=segmentStoryText(text,{narratorName:"Rainier"});
  assert.equal(lines[0].speaker,null);
  assert.equal(lines[0].parts[0].text,'"My apologies."');
  assert.equal(lines[1].speaker,"Costeau");
  assert.equal(lines[1].parts[0].text,'"Very good, my lord."');
  assert.equal(segmentStoryText('RAINIER: "A moment."',{narratorName:"rainier"})[0].speaker,null);
  assert.equal(segmentStoryText('Rainier: "Hello."')[0].speaker,"Rainier");
});
