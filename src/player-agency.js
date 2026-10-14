/**
 * Conservative local heuristic for possible AI control of a player.
 * Flags, never silently rewrites or automatically pays for another generation.
 */
const verb="nod|reply|respond|say|tell|agree|accept|refuse|choose|decide|stand|sit|walk|turn|follow|take|grab|reach|kiss|smile|laugh|run|leave|enter|open|close|give|hand|speak|ask|think|remember|promise|shake|step|move|write|draw|attack|fight|pick|swear";
const past="said|asked|answered|replied|agreed|nodded|decided|accepted|refused|stood|walked|turned|followed|took|smiled|laughed|left|spoke|promised|thought";
const third="nods|replies|responds|says|tells|agrees|accepts|refuses|chooses|decides|stands|sits|walks|turns|follows|takes|grabs|reaches|kisses|smiles|laughs|runs|leaves|enters|opens|closes|gives|hands|speaks|asks|thinks|remembers|promises|shakes|steps|moves|writes|draws|attacks|fights|picks|swears";
const prefix="(?:^|[.!?]\\s+|\\n\\s*|\\*\\s*)";
const playerAction=new RegExp(prefix+"you\\s+(?:"+verb+"|"+past+")\\b","imu");
const escapeRegExp=value=>value.replace(/[.*+?^$()|[\]{}\\]/g,"\\$&");
export function detectPlayerAgency(text,{personaName=""}={}) {
  if(typeof text!=="string" || !text.trim())return {suspected:false};
  const narrative=text.replace(/“[^”\n]*”|"(?:\\.|[^"\\\n])*"/gu," ");
  if(playerAction.test(narrative))
    return {suspected:true,reason:"The narrator may be deciding the player's actions or dialogue."};
  const name=typeof personaName==="string" ? personaName.trim().slice(0,120) : "";
  if(name && !["you","player"].includes(name.toLocaleLowerCase())){
    const named=new RegExp("(?:^|[.!?]\\s+|\\n\\s*)"+escapeRegExp(name)+"\\s+(?:"+third+")\\b","imu");
    if(named.test(narrative))
      return {suspected:true,reason:"The narrator may be acting on behalf of the selected player persona."};
  }
  return {suspected:false};
}
