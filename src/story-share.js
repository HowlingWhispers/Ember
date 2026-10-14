/**
 * Export a shareable fiction-only transcript, not a backup.
 * Strict allowlist: title, turn source and turn prose only. Never export
 * session tokens, IDs, V2 card contents, provider settings or diagnostics.
 */
import { cleanNarration } from "./engine.js";
import { segmentStoryText, storyCharacterHeading } from "./story-format.js";

const MAX_COPY_CHARS = 4_000_000;
const singleLine = value => String(value ?? "").replace(/[\r\n\t]+/g," ").replace(/\s{2,}/g," ").trim().slice(0,160);
const heading = value => singleLine(value).replace(/([\\*_\x60[\]])/g,"\\$1");

function presentText(value,narratorName) {
  return segmentStoryText(value,{narratorName}).map(paragraph => {
    const text=paragraph.parts.map(part=>part.text).join("");
    return paragraph.speaker ? paragraph.speaker+": "+text : text;
  }).filter(Boolean).join("\n\n");
}

export function exportSanitizedStory(story,{characterName="",personaName=""}={}) {
  if(!story || typeof story!=="object" || !Array.isArray(story.turns))
    throw new Error("No readable story is available to copy.");
  const name=storyCharacterHeading(story,characterName);
  const player=singleLine(personaName)||"YOU";
  const lines=["# "+(heading(story.title)||"Ember Story")];
  let written=0;
  for(const turn of story.turns) {
    if(!turn || !["preview","provider","player"].includes(turn.source)
      || typeof turn.text!=="string" || !turn.text.trim()) continue;
    const label=turn.source==="preview" ? "PREVIEW OPENING"
      : turn.source==="player" ? player : name;
    const cleaned=turn.source==="provider" ? cleanNarration(turn.text) : turn.text;
    const body=presentText(cleaned,turn.source==="provider" ? name : "");
    if(!body) continue;
    const section="**"+heading(label)+"**\n\n"+body;
    if(written+section.length>MAX_COPY_CHARS)
      throw new Error("This transcript is too long for one clipboard copy. Use Save to file to preserve the full story.");
    lines.push(section);
    written+=section.length;
  }
  if(!written)throw new Error("This story has no written turns to copy.");
  return lines.join("\n\n");
}
