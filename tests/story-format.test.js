import test from "node:test";
import assert from "node:assert/strict";
import { segmentStoryText } from "../src/story-format.js";
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
