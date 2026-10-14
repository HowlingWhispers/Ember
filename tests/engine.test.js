import test from "node:test";
import assert from "node:assert/strict";
import { createStory, addPlayerTurn, addNarratorTurn, replacePlayerTurn, replaceProviderTurn, removeProviderTurn, removeLatestProviderTurn, advanceTime, addJournalNote, validateStory, formatClock, wrapComposerSelection, exitComposerPair } from "../src/engine.js";
import { importStory, exportStory } from "../src/storage.js";

test("starts as an explicitly noncanonical concept preview", () => {
  const s = createStory();
  assert.equal(s.schema, 1);
  assert.equal(s.world.source, "preview");
  assert.equal(s.turns[0].source, "preview");
});
test("records freeform turns without inventing NovelAI output", () => {
  const s = createStory(); const n = addPlayerTurn(s, "action", "  I open the door.  ");
  assert.equal(n.turns.at(-1).text, "I open the door.");
  assert.equal(n.turns.at(-1).source, "player");
  assert.equal(n.turns.length, s.turns.length + 1);
  assert.equal(s.turns.length, 1);
});
test("allows speech and thought, not unknown modes", () => {
  const s = createStory();
  assert.equal(addPlayerTurn(s, "thought", "I wonder...").turns.at(-1).mode, "thought");
  assert.equal(addPlayerTurn(s, "speech", "Hello").turns.at(-1).mode, "speech");
  assert.throws(() => addPlayerTurn(s, "magic", "Hello"));
  assert.throws(() => addPlayerTurn(s, "action", "   "));
});
test("clock rolls forward without changing original state", () => {
  const s = createStory();
  const n = advanceTime(s, 1440);
  assert.equal(formatClock(n.world), "Day 2, 08:00");
  assert.equal(s.world.day, 1);
  assert.match(n.journal.at(-1).text, /preview clock only/);
});
test("rejects invalid wait, including negative and partial minutes", () => {
  for (const n of [-1, 0, 1.5, 1441, Number.NaN]) assert.throws(() => advanceTime(createStory(), n));
});
test("preserves notes and revision through backup roundtrip", () => {
  const s = addJournalNote(createStory(), "The story may begin.");
  const imported = importStory(exportStory(s));
  assert.equal(imported.journal.at(-1).text, "The story may begin.");
  assert.equal(imported.revision, s.revision);
});
test("rejects corrupted and unsupported backups", () => {
  const s = createStory(); s.schema = 9;
  assert.throws(() => importStory(JSON.stringify(s)));
  const invalid = createStory(); invalid.world.minute = -1;
  assert.throws(() => validateStory(invalid));
  assert.throws(() => importStory("{broken"));
});
test("rejects fabricated turn attribution and oversized input", () => {
  const s = createStory();
  assert.throws(() => addPlayerTurn(s, "action", "x".repeat(8001)));
  s.turns.push({ id: "bad", mode: "narrator", text: "fake", source: "player" });
  assert.throws(() => validateStory(s));
});

test("initial local save is written and can be reloaded", async () => {
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); }
  };
  try {
    const { loadStory, persistStory } = await import("../src/storage.js");
    const first = loadStory();
    assert.equal(first.error, "");
    assert.equal(values.size, 1);
    const updated = addPlayerTurn(first.state, "speech", "Hello");
    persistStory(updated);
    assert.equal(loadStory().state.turns.at(-1).text, "Hello");
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("narration attaches only to the player turn that requested it", () => {
  const base=createStory();
  const awaiting=addPlayerTurn(base,'speech','Hello');
  const id=awaiting.turns.at(-1).id;
  const completed=addNarratorTurn(awaiting,id,'Hello to you.');
  assert.equal(completed.turns.at(-1).text,'Hello to you.');
  assert.equal(completed.turns.at(-1).source,'provider');
  assert.equal(completed.turns.at(-1).mode,'narrator');
  assert.equal(awaiting.turns.at(-1).source,'player');
  assert.throws(()=>addNarratorTurn(completed,id,'Double response'),/no longer matches/);
  assert.throws(()=>addNarratorTurn(awaiting,'other','Wrong turn'),/no longer matches/);
  assert.throws(()=>addNarratorTurn(awaiting,id,'   '),/Invalid narration/);
});

test("text size, layout density and theme are stored under separate keys", async () => {
  const map = new Map();
  globalThis.localStorage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  const { getPreference, setPreference } = await import("../src/storage.js");
  setPreference("font", "22");
  setPreference("density", "comfortable");
  setPreference("theme", "daylight");
  assert.equal(getPreference("font", "20"), "22");
  assert.equal(getPreference("density", "compact"), "comfortable");
  assert.equal(getPreference("theme", "lamplight"), "daylight");
  setPreference("unknown", "x");
  assert.equal(getPreference("unknown", "fallback"), "fallback");
  assert.equal(map.size, 3);
});

test("Ember macros insert or wrap freeform text at the caret", () => {
  assert.deepEqual(wrapComposerSelection("Hello", 0, 5, "speech"), {text:'"Hello"',start:1,end:6});
  assert.deepEqual(wrapComposerSelection("", 0, 0, "action"), {text:"**",start:1,end:1});
  assert.deepEqual(wrapComposerSelection("I wonder", 0, 8, "thought"), {text:"(I wonder)",start:1,end:9});
  assert.equal(wrapComposerSelection("Hi",0,2,"other"),null);
});
test("Enter exits enclosing pairs anywhere without modifying authored text", () => {
  assert.deepEqual(exitComposerPair('"Hello"',3),{text:'"Hello" ',caret:8});
  assert.deepEqual(exitComposerPair("*I wave*",3),{text:"*I wave* ",caret:9});
  assert.deepEqual(exitComposerPair("(I think)",4),{text:"(I think) ",caret:10});
  assert.deepEqual(exitComposerPair('"Hello" next',3),{text:'"Hello" next',caret:8});
  assert.deepEqual(exitComposerPair('Say "(Hi)"',6),{text:'Say "(Hi) "',caret:10});
  assert.equal(exitComposerPair('Plain message',4),null);
  assert.equal(exitComposerPair('"Unclosed',4),null);
});


test("copy/edit toolbar model changes only requested provider reply and retains stable ID",()=>{
  const awaiting=addPlayerTurn(createStory(),"speech",'"Mi Lord"');
  const written=addNarratorTurn(awaiting,awaiting.turns.at(-1).id,
    'Rainier: "A moment, please."');
  const reply=written.turns.at(-1);
  const edited=replaceProviderTurn(written,reply.id,'Rainier: "Come with me."');
  assert.equal(edited.turns.at(-1).text,'Rainier: "Come with me."');
  assert.equal(edited.turns.at(-1).id,reply.id);
  assert.equal(edited.turns[0].id,awaiting.turns[0].id);
  assert.equal(edited.revision,written.revision+1);
  assert.equal(written.turns.at(-1).text,'Rainier: "A moment, please."');
  assert.throws(()=>replaceProviderTurn(written,"missing",'text'),/not found/);
  assert.throws(()=>replaceProviderTurn(written,reply.id,'  '),/must contain/);
  assert.throws(()=>replaceProviderTurn(written,reply.id,'x'.repeat(32001)),/must contain/);
  assert.deepEqual(validateStory(edited).turns.at(-1),edited.turns.at(-1));
});
test("latest reply can be deleted without deleting the player input or older story",()=>{
  const a=addPlayerTurn(createStory(),"speech","First");
  const b=addNarratorTurn(a,a.turns.at(-1).id,"First response");
  const c=addPlayerTurn(b,"speech","Second");
  const d=addNarratorTurn(c,c.turns.at(-1).id,"Second response");
  const cut=removeLatestProviderTurn(d,d.turns.at(-1).id);
  assert.equal(cut.turns.at(-1).text,"Second");
  assert.equal(cut.turns.at(-1).source,"player");
  assert.equal(cut.turns.at(-2).text,"First response");
  assert.equal(cut.revision,d.revision+1);
  assert.equal(d.turns.at(-1).text,"Second response");
  assert.throws(()=>removeLatestProviderTurn(d,b.turns.at(-1).id),/Only the latest/);
  assert.throws(()=>removeLatestProviderTurn(c,c.turns.at(-1).id),/Only the latest/);
  const regen=addNarratorTurn(cut,cut.turns.at(-1).id,"Replacement");
  assert.equal(regen.turns.at(-1).text,"Replacement");
});


test("sent player messages can be edited without losing their turn ID, mode, or later replies",()=>{
  const first=addPlayerTurn(createStory(),"speech",'"Mi Lord"');
  const firstTurn=first.turns.at(-1);
  const withReply=addNarratorTurn(first,firstTurn.id,'Rainier smiles.');
  const after=addPlayerTurn(withReply,"action","I look at the door.");
  const updated=replacePlayerTurn(after,firstTurn.id,'"Mi\'Lord"');
  assert.equal(updated.turns[1].text,'"Mi\'Lord"');
  assert.equal(updated.turns[1].mode,"speech");
  assert.equal(updated.turns[1].id,firstTurn.id);
  assert.deepEqual(updated.turns.slice(2),after.turns.slice(2));
  assert.equal(updated.revision,after.revision+1);
  assert.equal(after.turns[1].text,'"Mi Lord"');
  assert.deepEqual(validateStory(updated).turns,updated.turns);
});
test("player message editing validates ownership and the 8,000-character input limit",()=>{
  const player=addPlayerTurn(createStory(),"thought","I wonder...");
  const id=player.turns.at(-1).id;
  const reply=addNarratorTurn(player,id,"An answer comes.");
  assert.throws(()=>replacePlayerTurn(reply,reply.turns.at(-1).id,"No"),/not found/);
  assert.throws(()=>replacePlayerTurn(reply,"not-a-player-id","No"),/not found/);
  assert.throws(()=>replacePlayerTurn(reply,id,"  "),/1 and 8,000/);
  assert.throws(()=>replacePlayerTurn(reply,id,"x".repeat(8001)),/1 and 8,000/);
  assert.throws(()=>replacePlayerTurn(reply,id,null),/1 and 8,000/);
  const changed=replacePlayerTurn(reply,id,"  I understand.  ");
  assert.equal(changed.turns.at(-2).text,"I understand.");
  assert.equal(changed.turns.at(-2).mode,"thought");
});


test("deleting an older generation removes that turn and all later story turns",()=>{
  const first=addPlayerTurn(createStory(),"speech",'"Mi Lord"');
  const withFirst=addNarratorTurn(first,first.turns.at(-1).id,"Rainier offers a drink.");
  const firstReply=withFirst.turns.at(-1);
  const second=addPlayerTurn(withFirst,"action","I mention the house.");
  const withSecond=addNarratorTurn(second,second.turns.at(-1).id,"Rainier recalls the burned house.");
  const secondReply=withSecond.turns.at(-1);
  const third=addPlayerTurn(withSecond,"speech","Who was responsible?");
  const withThird=addNarratorTurn(third,third.turns.at(-1).id,"Rainier begins investigating.");
  const thirdReply=withThird.turns.at(-1);

  const withoutFirst=removeProviderTurn(withThird,firstReply.id);
  assert.deepEqual(withoutFirst.turns,withThird.turns.slice(0,2),
    "Opening and triggering player message survive, all future turns disappear");
  assert.equal(withoutFirst.turns.at(-1).text,'"Mi Lord"');
  assert.equal(withoutFirst.revision,withThird.revision+1);
  assert.deepEqual(withThird.turns.at(-1),thirdReply,"The original saved story is not mutated");
  assert.deepEqual(validateStory(withoutFirst).turns,withoutFirst.turns);
  assert.deepEqual(importStory(exportStory(withoutFirst)).turns,withoutFirst.turns,
    "Truncation must persist through local backup and reload");

  const withoutMiddle=removeProviderTurn(withThird,secondReply.id);
  assert.deepEqual(withoutMiddle.turns,withThird.turns.slice(0,4));
  assert.equal(withoutMiddle.turns.at(-1).text,"I mention the house.");
  assert.ok(withoutMiddle.turns.some(t=>t.id===firstReply.id));
  assert.ok(!withoutMiddle.turns.some(t=>t.id===secondReply.id));
  assert.ok(!withoutMiddle.turns.some(t=>t.id===thirdReply.id));

  const withoutLatest=removeProviderTurn(withThird,thirdReply.id);
  assert.deepEqual(withoutLatest.turns,withThird.turns.slice(0,-1));
  assert.equal(withoutLatest.turns.at(-1).source,"player");
  assert.equal(withoutLatest.turns.at(-1).text,"Who was responsible?");
  const continued=addNarratorTurn(withoutMiddle,withoutMiddle.turns.at(-1).id,
    "Rainier answers differently.");
  assert.equal(continued.turns.at(-1).text,"Rainier answers differently.");
  assert.deepEqual(continued.turns.slice(0,-1),withoutMiddle.turns);
});

test("arbitrary reply deletion refuses player turns and unknown IDs",()=>{
  const s=addPlayerTurn(createStory(),"action","Open the door.");
  const id=s.turns.at(-1).id;
  assert.throws(()=>removeProviderTurn(s,id),/not found/);
  assert.throws(()=>removeProviderTurn(s,"missing"),/not found/);
  assert.throws(()=>removeProviderTurn(s,""),/not found/);
  assert.throws(()=>removeProviderTurn(null,"missing"),/not found/);
});
