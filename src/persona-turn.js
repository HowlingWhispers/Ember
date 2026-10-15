/** Persona AI drafts stay outside the story until the player accepts them. */
import { MAX_INPUT } from "./engine.js";

export function personaTurnBlocker(story) {
  if (!story) return "Open a story first.";
  if (!story.assetSetup?.personaId) return "Choose a V2 player persona in My Persona first.";
  const last=story.turns?.at(-1);
  if (!last || !["provider","preview"].includes(last.source))
    return "Finish the current narrator reply before requesting a Persona AI turn.";
  return "";
}

export function cleanPersonaDraft(raw) {
  if (typeof raw !== "string" || raw.length > 32000)
    throw new Error("Persona AI returned an invalid draft.");
  let text=raw.trim().replace(/^\`\`\`(?:text|markdown)?\s*\n?/i,"").replace(/\n?\`\`\`$/,"").trim();
  if (/^(?:NARRATOR|ASSISTANT|SYSTEM|OPENING|CHARACTER)\s*:/i.test(text))
    throw new Error("Persona AI wrote a narrator turn instead of a player turn. Regenerate it.");
  text=text.replace(/^(?:PLAYER|YOU)\s*:\s*/i,"");
  // Provider stop sequences may fail: never let a second speaker or turn leak into the draft.
  const nextRole=/^\s*(?:NARRATOR|ASSISTANT|SYSTEM|OPENING|CHARACTER|PLAYER|USER)\s*:/gim;
  const match=nextRole.exec(text);
  if (match) text=text.slice(0,match.index);
  text=text.trim();
  if (!text || text.length>MAX_INPUT)
    throw new Error("Persona AI draft must contain between 1 and 8,000 characters.");
  return text;
}
