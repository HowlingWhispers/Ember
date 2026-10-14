import test from "node:test";
import assert from "node:assert/strict";
import { parseCodaCandidate, emptyDiscovery, loadDiscovery, saveDiscovery, shouldDiscover } from "../src/coda-discovery.js";

test("Coda reads a compact character draft without accepting malformed data", () => {
  const candidate = {name:"Uncle Rowan",role:"guardian",established:"He answered the greeting.",suggestions:"A patient manner."};
  assert.deepEqual(parseCodaCandidate("CODA RESULT: "+JSON.stringify({candidate})),candidate);
  assert.equal(parseCodaCandidate('{"candidate":null}'),null);
  assert.equal(parseCodaCandidate('{"candidate":{"name":"","role":"guardian"}}'),null);
  assert.equal(parseCodaCandidate("not a JSON object"),null);
});
test("Coda waits for story context and never repeats every turn", () => {
  const turns = [];
  for(let i=0;i<4;i++) {
    turns.push({source:"player",mode:"action",text:"Hello"});
    turns.push({source:"provider",mode:"narrator",text:"A man replies."});
  }
  assert.equal(shouldDiscover(turns,emptyDiscovery()),true);
  assert.equal(shouldDiscover(turns.slice(0,6),emptyDiscovery()),false);
  assert.equal(shouldDiscover(turns,{...emptyDiscovery(),lastChecked:4}),false);
  assert.equal(shouldDiscover(turns,{...emptyDiscovery(),pending:{name:"Someone"}}),false);
  assert.equal(shouldDiscover(turns.slice(0,7),emptyDiscovery()),false);
});
test("Coda suggestions and approved profiles are isolated per story and user", () => {
  const map = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  try {
    const saved = {pending:{name:"Rowan",role:"friend",established:"Spoke once.",suggestions:"Quiet."},
      profiles:[{name:"Mara",role:"neighbor",established:"Lives nearby.",suggestions:""}],lastChecked:4};
    saveDiscovery("user1","story1",saved);
    assert.deepEqual(loadDiscovery("user1","story1"),saved);
    assert.deepEqual(loadDiscovery("user1","story2"),emptyDiscovery());
    assert.deepEqual(loadDiscovery("user2","story1"),emptyDiscovery());
  } finally {
    if(previous===undefined) delete globalThis.localStorage;
    else globalThis.localStorage=previous;
  }
});
