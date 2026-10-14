/**
 * Retain only complete prose when NovelAI ignores the requested word budget
 * or hits its generation token limit. One provider request, no auto-continue.
 * Never fabricate an ending or insert text into the player's saved story.
 */
const countWords=value=>value.trim().match(/\S+/gu)?.length||0;
const COMPLETE=/[.!?]+(?:["”'’)\]]*)(?=\s|$)/gu;
const closesQuote=value=>/(?:["”])$/u.test(value);

export function boundCompletedReply(input,maxWords) {
  if(typeof input!=="string" || !Number.isInteger(maxWords) || maxWords<30 || maxWords>400)
    throw new Error("Invalid output boundary parameters.");
  const text=input.replace(/\r\n?/g,"\n").trim();
  if(!text)return {text:"",shortened:false};
  const withinBudget=countWords(text)<=maxWords;
  const endsCleanly=/(?:[.!?]+(?:["”'’)\]]*)|["”])$/u.test(text);
  if(withinBudget && endsCleanly)return {text,shortened:false};
  let best="";
  for(const match of text.matchAll(COMPLETE)){
    const end=match.index+match[0].length;
    const prefix=text.slice(0,end).trimEnd();
    if(countWords(prefix)>maxWords)break;
    // Prefer not to end midway through quotes/actions. A candidate ending in
    // dialogue punctuation is fine; keep it when no enclosing quote remains.
    best=prefix;
  }
  if(!best && withinBudget && closesQuote(text))return {text,shortened:false};
  return {text:best,shortened:best!==text};
}
