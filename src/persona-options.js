/** Persona AI settings are ephemeral turn guidance, not edits to V2 cards. */
export const PERSONA_FLAVORS=Object.freeze([
  {value:"natural",label:"Natural / In character",guide:"Follow the persona's established voice without a special emotional emphasis."},
  {value:"random",label:"Random flavor",guide:"Pick a different temporary mood for each turn."},
  {value:"shy",label:"Shy / Timid",guide:"Speak hesitantly and react with reserved or nervous gestures."},
  {value:"brave",label:"Brave / Confident",guide:"Stand your ground and speak or act with confidence."},
  {value:"innocent",label:"Innocent / Naive",guide:"Be sincere, trusting and curious, sometimes missing subtle implications."},
  {value:"playful",label:"Playful / Cheeky",guide:"Joke, tease lightly and respond with spirited curiosity."},
  {value:"curious",label:"Curious / Inquisitive",guide:"Ask meaningful questions and investigate something interesting."},
  {value:"stubborn",label:"Stubborn / Defiant",guide:"Push back and hold to a personal opinion."},
  {value:"nervous",label:"Nervous / Anxious",guide:"Show hesitation, uncertainty and emotional vulnerability."},
  {value:"sarcastic",label:"Sarcastic / Snarky",guide:"Respond with dry humor and pointed wit."},
  {value:"angry",label:"Angry / Confrontational",guide:"Show frustration and challenge what is happening."},
  {value:"protective",label:"Protective / Caring",guide:"Take initiative to comfort, help or defend someone."},
  {value:"mysterious",label:"Mysterious / Reserved",guide:"Keep some thoughts private and answer selectively."},
  {value:"seductive",label:"Seductive / Flirtatious",guide:"Be charming, alluring and flirtatious when the moment suits it."},
]);
export const PERSONA_DECISIONS=Object.freeze([
  {value:"conservative",label:"Conservative",guide:"Favor familiar reactions that closely fit existing behavior."},
  {value:"independent",label:"Independent",guide:"Make your own character-driven choices, including unexpected ones."},
  {value:"bold",label:"Bold",guide:"Take initiative and consider bolder, riskier choices."},
]);
export const PERSONA_DIRECTIONS=Object.freeze([
  {value:"surprise",label:"Surprise me",guide:"Choose an interesting response without forcing a particular direction."},
  {value:"emotional",label:"Emotional",guide:"Explore feelings or relationships through the next decision."},
  {value:"curious",label:"Curious",guide:"Ask a question or investigate a detail of the scene."},
  {value:"action",label:"Proactive",guide:"Do something concrete that advances the scene."},
  {value:"confront",label:"Confrontational",guide:"Challenge, disagree or push back where it fits the scene."},
]);
export const PERSONA_CREATIVITY=Object.freeze([
  {value:"low",label:"Low",guide:"Keep decisions grounded and relatively predictable.",temperature:0.55},
  {value:"medium",label:"Medium",guide:"Introduce some unexpected possibilities.",temperature:0.78},
  {value:"high",label:"High",guide:"Explore different approaches and imaginative decisions.",temperature:1.05},
  {value:"wild",label:"Wild",guide:"Try unusually imaginative decisions while respecting the scene.",temperature:1.25},
]);
const select=(options,value,defaultValue)=>
  typeof value==="string" && options.some(item=>item.value===value) ? value : defaultValue;

export const DEFAULT_PERSONA_OPTIONS=Object.freeze({
  decision:"independent",creativity:"high",direction:"surprise",
  flavor:"natural",avoidRepeats:true,
});
export function normalizePersonaOptions(value={}) {
  const v=value && typeof value==="object" && !Array.isArray(value) ? value : {};
  return {
    decision:select(PERSONA_DECISIONS,v.decision,DEFAULT_PERSONA_OPTIONS.decision),
    creativity:select(PERSONA_CREATIVITY,v.creativity,DEFAULT_PERSONA_OPTIONS.creativity),
    direction:select(PERSONA_DIRECTIONS,v.direction,DEFAULT_PERSONA_OPTIONS.direction),
    flavor:select(PERSONA_FLAVORS,v.flavor,DEFAULT_PERSONA_OPTIONS.flavor),
    avoidRepeats:typeof v.avoidRepeats==="boolean"?v.avoidRepeats:true,
  };
}
export function resolvePersonaFlavor(flavor,last="",random=Math.random) {
  if(flavor!=="random")return select(PERSONA_FLAVORS,flavor,"natural");
  const choices=PERSONA_FLAVORS.filter(x=>x.value!=="random" && x.value!=="natural"
    && x.value!==last);
  const roll=Number(random());
  const index=Number.isFinite(roll) ? Math.min(choices.length-1,Math.max(0,Math.floor(roll*choices.length))) : 0;
  return choices[index]?.value||"playful";
}
const description=(collection,value)=>collection.find(item=>item.value===value)?.guide||"";
const asReference=(name,content)=>"["+name+": FICTION REFERENCE DATA]\n"
  +content.replace(/\r\n?/g,"\n").split("\n").map(line=>"  "+line).join("\n")
  +"\n[END "+name+"]";
export function personaTurnGuidance(options={},{
  effectiveFlavor="",mode="fresh",previousDraft="",rejectedDrafts=[],
}={}) {
  const config=normalizePersonaOptions(options);
  const flavor=select(PERSONA_FLAVORS,effectiveFlavor||config.flavor,"natural")==="random"
    ?"natural":select(PERSONA_FLAVORS,effectiveFlavor||config.flavor,"natural");
  const lines=[
    "[PERSONA TURN OPTIONS]",
    "Decision style: "+config.decision+". "+description(PERSONA_DECISIONS,config.decision),
    "Creativity: "+config.creativity+". "+description(PERSONA_CREATIVITY,config.creativity),
    "Turn direction: "+config.direction+". "+description(PERSONA_DIRECTIONS,config.direction),
    "Turn flavor: "+flavor+". "+description(PERSONA_FLAVORS,flavor),
    "Flavor is a temporary mood, NOT a permanent personality change. Keep the persona's identity and first-person I/me/my viewpoint.",
  ];
  if(mode==="rewrite" && typeof previousDraft==="string" && previousDraft.trim()){
    lines.push("REWRITE MODE: Keep the central decision and intent of the prior draft, but change its wording, pacing and gestures. Do not simply copy the same text.");
    lines.push(asReference("EARLIER PLAYER DRAFT TO REWRITE",previousDraft.trim().slice(0,500)));
  } else if(mode==="different"){
    lines.push("DIFFERENT APPROACH MODE: Make a materially different PLAYER decision or reaction. Do NOT merely paraphrase the previous reply. Choose a new action, question, boundary, intention or emotional response.");
    if(config.avoidRepeats && Array.isArray(rejectedDrafts)){
      const recent=rejectedDrafts.filter(x=>typeof x==="string" && x.trim()).slice(-4);
      if(recent.length){
        lines.push("These proposed turns were rejected. Avoid repeating their underlying choices, not just their exact words:");
        for(const [i,raw] of recent.entries())
          lines.push(asReference("REJECTED PLAYER DRAFT "+(i+1),raw.trim().slice(0,420)));
      }
    }
  }
  lines.push("[END PERSONA TURN OPTIONS]");
  return lines.join("\n");
}
/** Keep a bounded in-memory list only for this scene; never persist rejected drafts. */
export function rememberRejectedDrafts(history=[],draft="",limit=4) {
  if(typeof draft!=="string" || !draft.trim())return Array.isArray(history)?history.slice(-limit):[];
  const previous=Array.isArray(history)?history.filter(x=>typeof x==="string"):[];
  return [...previous,draft.trim().slice(0,420)].slice(-limit);
}
