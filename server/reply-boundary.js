/**
 * Save a complete, syntactically balanced reply within the word ceiling.
 * Never fabricate closing punctuation, speech, actions, or a second paid call.
 */
const countWords=value=>value.trim().match(/\S+/gu)?.length||0;
const COMPLETE=/[.!?]+(?:["”'’)\]]*)(?=\s|$)/gu;
const closesQuote=value=>/["”]$/u.test(value);

function balancedMarkers(value) {
  let quoted=false,curly=false,action=false;
  for(let i=0;i<value.length;i++){
    const ch=value[i];
    if(ch==="\\" && i+1<value.length){i++;continue;}
    if(ch==='"')quoted=!quoted;
    else if(ch==="“")curly=true;
    else if(ch==="”")curly=false;
    else if(ch==="*")action=!action;
  }
  return !quoted && !curly && !action;
}

export function boundCompletedReply(input,maxWords) {
  if(typeof input!=="string" || !Number.isInteger(maxWords) || maxWords<30 || maxWords>400)
    throw new Error("Invalid output boundary parameters.");
  const text=input.replace(/\r\n?/g,"\n").trim();
  if(!text)return {text:"",shortened:false};
  const withinBudget=countWords(text)<=maxWords;
  const endsCleanly=/(?:[.!?]+(?:["”'’)\]]*)|["”])$/u.test(text);
  if(withinBudget && endsCleanly && balancedMarkers(text))
    return {text,shortened:false};
  let best="";
  for(const match of text.matchAll(COMPLETE)){
    const end=match.index+match[0].length;
    const prefix=text.slice(0,end).trimEnd();
    if(countWords(prefix)>maxWords)break;
    if(balancedMarkers(prefix))best=prefix;
  }
  if(!best && withinBudget && closesQuote(text) && balancedMarkers(text))
    return {text,shortened:false};
  return {text:best,shortened:best!==text};
}
