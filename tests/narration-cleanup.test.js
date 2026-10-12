import test from "node:test";
import assert from "node:assert/strict";
import { cleanNarration, createStory, addPlayerTurn, addNarratorTurn } from "../src/engine.js";

test("removes provider narrator continuation headers without modifying fiction", () => {
  const original = '"A soft wind carries distant laughter.\nNARRATOR (CONT): "She studies the stranger."\nNARRATOR (CONT): "Name\'s Lyra," she says."';
  assert.equal(cleanNarration(original), 'A soft wind carries distant laughter.\n"She studies the stranger."\n"Name\'s Lyra," she says.');
});

test("preserves natural speech and narrator names used in prose", () => {
  const prose = 'Lyra says, "NARRATOR (CONT): are you serious?"\n"Stay here," she adds.';
  assert.equal(cleanNarration(prose), prose);
});

test("persisted provider narration has no scaffolding", () => {
  const story = addPlayerTurn(createStory(), "action", "Look around");
  const next = addNarratorTurn(story, story.turns.at(-1).id, 'NARRATOR (CONT): The leaves rustle.');
  assert.equal(next.turns.at(-1).text, "The leaves rustle.");
});
