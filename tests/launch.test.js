import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryFromLaunch, addPlayerTurn, validateStory } from '../src/engine.js';
import { configureStoryScope, loadStory, persistStory, exportStory, importStory } from '../src/storage.js';
const uid = '11111111-1111-4111-8111-111111111111';
const aid = '22222222-2222-4222-8222-222222222222';
const bid = '33333333-3333-4333-8333-333333333333';
const launch = (mode, id=aid, userId=uid) => ({
  userId, mode, asset:{id,type:mode,name:mode==='world'?'Bitterroot':'Ragna Holt',summary:'Lore'}
});
test('sandbox starts truly blank and has no packaged world or NPC', () => {
  const sandbox = createStoryFromLaunch({userId:uid,mode:'sandbox',asset:null});
  assert.equal(sandbox.title,'Free Sandbox');
  assert.equal(sandbox.launch.assetId,null);
  assert.equal(sandbox.turns.length,0);
  assert.equal(sandbox.world.location,'Not established');
  assert.equal(validateStory(sandbox).launch.mode,'sandbox');
});

test('character and world launches seed different freeform modes', ()=>{
  const character = createStoryFromLaunch(launch('character'));
  const world = createStoryFromLaunch(launch('world'));
  assert.equal(character.launch.mode,'character');
  assert.equal(world.launch.mode,'world');
  assert.equal(character.world.location,'One-on-one roleplay');
  assert.equal(world.world.location,'Starting place not selected');
  assert.equal(character.turns[0].source,'preview');
  assert.equal(world.turns[0].source,'preview');
});
test('local stories are isolated by authenticated Orbis user, asset and mode',()=>{
  const map=new Map();
  globalThis.localStorage={
    getItem:k=>map.get(k)??null,
    setItem:(k,v)=>map.set(k,v),
    removeItem:k=>map.delete(k)
  };
  configureStoryScope(launch('character'));
  const char=addPlayerTurn(loadStory().state,'speech','Hello!');
  persistStory(char);
  configureStoryScope(launch('world'));
  const world=loadStory().state;
  assert.equal(world.turns.length,1);
  assert.equal(world.launch.mode,'world');
  configureStoryScope(launch('character',bid));
  assert.equal(loadStory().state.turns.length,1);
  configureStoryScope(launch('character',aid, bid));
  assert.equal(loadStory().state.turns.length,1);
  configureStoryScope(launch('character'));
  assert.equal(loadStory().state.turns.at(-1).text,'Hello!');
  assert.throws(()=>importStory(JSON.stringify(world)),/different Orbis account or launch/);
  assert.equal(importStory(exportStory(char)).turns.at(-1).text,'Hello!');
  assert.equal(validateStory(world).launch.mode,'world');
  const sandboxContext={userId:uid,mode:'sandbox',asset:null};
  configureStoryScope(sandboxContext);
  const sandbox=loadStory().state;
  assert.equal(sandbox.turns.length,0);
  assert.equal(sandbox.launch.mode,'sandbox');
  persistStory(addPlayerTurn(sandbox,'action','I begin.'));
  configureStoryScope(launch('world'));
  assert.equal(loadStory().state.launch.mode,'world');
  configureStoryScope(sandboxContext);
  assert.equal(loadStory().state.turns.at(-1).text,'I begin.');
  assert.throws(()=>importStory(JSON.stringify(world)),/different Orbis account or launch/);
});
