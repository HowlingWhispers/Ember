/** Persona AI proposals are never committed until the player accepts them. */
import { MAX_INPUT } from "./engine.js";

export function personaTurnBlocker(story) {
  if (!story) return "Open a story first.";
  if (!story.assetSetup?.personaId) return "Choose a V2 player persona in My Persona first.";
  const last=story.turns?.at(-1);
  if (!last || !["provider","preview"].includes(last.source))
    return "Finish the current narrator reply before requesting a Persona AI turn.";
  return "";
}

/** Extract only the selected card's displayed name from the bounded fiction reference. */
export function personaNameFromPrompt(prompt) {
  if(typeof prompt!=="string")return "";
  const section=/\[PLAYER PERSONA V2 \(PLAYER CONTROLLED\): FICTION REFERENCE DATA\]([\s\S]*?)\[END PLAYER PERSONA V2 \(PLAYER CONTROLLED\)\]/u.exec(prompt)?.[1]||"";
  return /^\s{2}Name:\s*\n\s{4}([^\n]{1,120})/mu.exec(section)?.[1]?.trim()||"";
}

function lastCompleteBoundary(text) {
  let quote=false,curly=false,action=false,depth=0,last=0;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==="\\" && i+1<text.length){i++;continue;}
    if(c==='"')quote=!quote;
    else if(c==="“" && !quote)curly=true;
    else if(c==="”" && !quote)curly=false;
    else if(c==="*" && !quote && !curly)action=!action;
    else if(c==="(" && !quote && !curly)depth++;
    else if(c===")" && !quote && !curly)depth=Math.max(0,depth-1);
    if(!quote && !curly && !action && depth===0 && /[.!?*"”)]/u.test(c))
      last=i+1;
  }
  return {balanced:!quote&&!curly&&!action&&depth===0,boundary:last};
}

/** Return text and diagnostics so the preview can disclose any removed partial tail. */
export function normalizePersonaDraft(raw,{personaName=""}={}) {
  if (typeof raw!=="string" || raw.length>32000)
    throw new Error("Persona AI returned an invalid draft.");
  const original=raw.trim();
  let text=original.replace(/^\x60{3}(?:text|markdown)?\s*\n?/iu,"").replace(/\n?\x60{3}$/u,"").trim();
  if (/^(?:NARRATOR|ASSISTANT|SYSTEM|OPENING|CHARACTER)\s*:/iu.test(text))
    throw new Error("Persona AI wrote a narrator turn instead of a player turn. Regenerate it.");
  text=text.replace(/^(?:PLAYER|YOU)\s*:\s*/iu,"").trim();
  const name=typeof personaName==="string" ? personaName.trim().slice(0,120) : "";
  if(name){
    const [first,...rest]=text.split("\n");
    if(first.trim().replace(/:$/u,"").trim().toLocaleLowerCase()===name.toLocaleLowerCase())
      text=rest.join("\n").trim();
    else if(first.trim().slice(0,name.length+1).toLocaleLowerCase()===(name+":").toLocaleLowerCase())
      text=first.trim().slice(name.length+1).trim()+"\n"+rest.join("\n");
  }
  // Never allow the model to continue into another role or an instruction block.
  const role=/^\s*(?:NARRATOR|ASSISTANT|SYSTEM|OPENING|CHARACTER|PLAYER|USER)\s*:/gimu.exec(text);
  if(role)text=text.slice(0,role.index);
  text=text.trim();
  if(!text || text.length>MAX_INPUT)
    throw new Error("Persona AI draft must contain between 1 and 8,000 characters.");
  const completion=lastCompleteBoundary(text);
  let shortened=false;
  if(!completion.balanced || !completion.boundary || completion.boundary<text.length){
    if(!completion.boundary)
      throw new Error("Persona AI produced an unfinished turn. Regenerate it.");
    const repaired=text.slice(0,completion.boundary).trim();
    if(!repaired)
      throw new Error("Persona AI produced an unfinished turn. Regenerate it.");
    text=repaired;
    shortened=true;
  }
  return {text,shortened,removedHeading:original!==text && !shortened};
}
export function cleanPersonaDraft(raw,options={}) {
  return normalizePersonaDraft(raw,options).text;
}
