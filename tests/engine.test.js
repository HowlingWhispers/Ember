import test from "node:test";
import assert from "node:assert/strict";
import { createStory, addPlayerTurn, advanceTime, addJournalNote, validateStory, formatClock } from "../src/engine.js";
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
