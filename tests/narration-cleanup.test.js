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

test("normalizes single-quoted speech inside double-wrapped prose, retaining contractions", () => {
  const raw = `"She approaches. 'You don't look like you're from here,' she says. 'Name's Lyra,' she adds."`;
  assert.equal(cleanNarration(raw), `She approaches. "You don't look like you're from here," she says. "Name's Lyra," she adds.`);
});

test("leaves apostrophes and unwrapped intentional quotations alone", () => {
  assert.equal(cleanNarration("It's Lyra's spear."), "It's Lyra's spear.");
  assert.equal(cleanNarration("She says, 'Hello,' before leaving."), "She says, 'Hello,' before leaving.");
});

test("removes line-start NPC role labels copied from the transcript format", () => {
  const raw = 'The ground is soft with fallen needles.\nNPC (RELIC): "Ah, good. You\'re not another wandering spirit."';
  assert.equal(cleanNarration(raw), 'The ground is soft with fallen needles.\n"Ah, good. You\'re not another wandering spirit."');
  assert.equal(cleanNarration('NPC: "Stay back."'), '"Stay back."');
});

test("keeps NPC wording that is part of the fiction", () => {
  const prose = 'Lyra says, "NPC (RELIC): is that what they call you?"\nThe NPC registry lists six names.';
  assert.equal(cleanNarration(prose), prose);
});
