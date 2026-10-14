/**
 * Structure provider prose for the story reader without changing the saved text.
 * Paragraphs, quoted speech and *action notation* are interpreted as display
 * hints only. Untrusted V2 content is never inserted as HTML.
 */
const SPEAKER = /^([\p{L}][\p{L}\p{N}'’ .-]{0,69}):\s*(?=["“])/u;
const TOKEN = /"(?:\\.|[^"\\])*"|“[^”\n]*”|\*(?:\\.|[^*\\\n])+\*/gu;

export function segmentStoryText(value) {
  if (typeof value !== "string") return [];
  return value.replace(/\r\n?/g,"\n").trim().split(/\n+/u).map(raw => {
    const line = raw.trim();
    if (!line) return null;
    const matched = line.match(SPEAKER);
    const speaker = matched ? matched[1].trim() : null;
    const body = matched ? line.slice(matched[0].length) : line;
    const parts = [];
    let last = 0;
    for (const found of body.matchAll(TOKEN)) {
      const start = found.index;
      if (start > last) parts.push({kind:"narration",text:body.slice(last,start)});
      const token = found[0];
      parts.push({kind:token.startsWith("*")?"action":"dialogue",text:token});
      last = start + token.length;
    }
    if (last < body.length) parts.push({kind:"narration",text:body.slice(last)});
    return {speaker,parts:parts.length?parts:[{kind:"narration",text:body}]};
  }).filter(Boolean);
}
