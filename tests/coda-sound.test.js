import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SOUND, MAX_RINGTONE_BYTES, soundScope, normalizeSoundPreferences,
  readSoundPreferences, storeSoundPreferences, validateRingtoneFile,
} from "../src/coda-sound.js";

const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
test("uploaded Hey Listen clip is the default alert, with Coda original available", () => {
  assert.equal(DEFAULT_SOUND.mode, "hey-listen");
  assert.ok(DEFAULT_SOUND.volume > 0);
  assert.equal(normalizeSoundPreferences({mode:"coda"}).mode,"coda");
  assert.equal(normalizeSoundPreferences({mode:"hey-listen"}).mode,"hey-listen");
});
test("normalizes corrupt modes and clamps volume", () => {
  assert.deepEqual(normalizeSoundPreferences({ mode: "navi", volume: 200, customName: "x" }), {
    mode: "coda", volume: 1, customName: "x",
  });
  assert.equal(normalizeSoundPreferences({ mode: "silent", volume: -1 }).volume, 0);
  assert.equal(normalizeSoundPreferences({ mode: "custom", volume: Number.NaN }).volume, DEFAULT_SOUND.volume);
});
test("stores ringtone selections separately for Orbis accounts", () => {
  const map = new Map();
  const storage = { getItem: key => map.get(key) ?? null, setItem: (key,value) => map.set(key,value) };
  assert.equal(soundScope(alice),alice);
  assert.equal(soundScope("fake-user"), "local-preview");
  storeSoundPreferences(alice,{mode:"custom",volume:.32,customName:"ring.ogg"},storage);
  assert.equal(readSoundPreferences(alice,storage).mode,"custom");
  assert.equal(readSoundPreferences(alice,storage).customName,"ring.ogg");
  assert.equal(readSoundPreferences(bob,storage).mode,"hey-listen");
  assert.equal(map.size,1);
});
test("corrupted settings safely reset to defaults", () => {
  assert.deepEqual(readSoundPreferences(alice,{getItem:()=>"{broken"}),{...DEFAULT_SOUND});
});
test("validates format and size for locally provided ringtones",()=>{
  assert.equal(validateRingtoneFile({name:"My Hey Listen.ogg",type:"audio/ogg",size:128}).bytes,128);
  assert.equal(validateRingtoneFile({name:"ring.mp3",type:"audio/mpeg",size:1024}).name,"ring.mp3");
  assert.throws(()=>validateRingtoneFile({name:"a.exe",type:"audio/ogg",size:100}),/MP3/);
  assert.throws(()=>validateRingtoneFile({name:"ring.mp3",type:"text/html",size:100}),/MP3/);
  assert.throws(()=>validateRingtoneFile({name:"ring.wav",type:"audio/wav",size:MAX_RINGTONE_BYTES+1}),/2 MB/);
  assert.throws(()=>validateRingtoneFile({name:"ring.ogg",type:"audio/ogg",size:0}),/2 MB/);
});
