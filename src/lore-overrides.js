/** Per-story lorebook switches. Never change an imported original. */
export const MAX_ENTRY_OVERRIDES=512;
export function normalizeEntryOverrides(overrides,entryIds) {
  if(overrides==null)return {};
  if(!overrides || typeof overrides!=="object" || Array.isArray(overrides))
    throw new Error("Invalid lorebook entry overrides.");
  const ids=new Set(entryIds.map(String));
  if(Object.keys(overrides).length>MAX_ENTRY_OVERRIDES)
    throw new Error("Too many lorebook entry overrides.");
  const result=Object.create(null);
  for(const [id,value] of Object.entries(overrides)){
    if(!ids.has(id))continue; // The source file could have been updated.
    if(!value || typeof value!=="object" || Array.isArray(value))
      throw new Error("Invalid lorebook entry setting.");
    const change={};
    if(Object.hasOwn(value,"enabled")){
      if(typeof value.enabled!=="boolean")throw new Error("Invalid lorebook enabled switch.");
      change.enabled=value.enabled;
    }
    if(Object.hasOwn(value,"constant")){
      if(typeof value.constant!=="boolean")throw new Error("Invalid lorebook always-active switch.");
      change.constant=value.constant;
    }
    if(Object.hasOwn(value,"keys")){
      if(!Array.isArray(value.keys) || value.keys.length>128 ||
        value.keys.some(key=>typeof key!=="string"||key.length>120))
        throw new Error("Invalid lorebook keywords.");
      change.keys=[...new Set(value.keys.map(x=>x.trim()).filter(Boolean))];
    }
    if(Object.keys(change).length)result[id]=change;
  }
  return result;
}
export function applyLoreOverrides(bookInfo) {
  const book=bookInfo?.fields||bookInfo;
  if(!book || !Array.isArray(book.entries))return bookInfo;
  const changes=bookInfo?.entryOverrides||{};
  const original=bookInfo?.original?.entries;
  const source=original && typeof original==="object" ? Object.values(original) : [];
  const entries=book.entries.map((e,i)=>{
    const change=changes[String(e.sourceId)]||{};
    // Fix previously imported books too: original disable:true takes precedence
    // over conflicting enabled:true. Do not mutate stored assets.
    const importedDisabled=source[i]?.disable===true;
    const enabled=typeof change.enabled==="boolean" ? change.enabled
      : importedDisabled ? false : e.enabled;
    return {...e,enabled,constant:typeof change.constant==="boolean"?change.constant:e.constant,
      keys:Array.isArray(change.keys)?[...change.keys]:e.keys};
  });
  return {...bookInfo,fields:{...book,entries}};
}
export function overrideForEntry(bookInfo,entry) {
  const changes=bookInfo?.entryOverrides||{};
  const modified=applyLoreOverrides(bookInfo).fields.entries.find(x=>String(x.sourceId)===String(entry.sourceId));
  return {effective:modified||entry,overridden:changes[String(entry.sourceId)]||null};
}
export function isLoreMode(entry) {
  // A keywordless, constant rule functions like a mode. Names are only a
  // presentation aid; every entry remains individually controllable.
  return entry.keys.length===0 || /\b(mode|override|varies|instinct|pacing|style)\b/iu.test(entry.name);
}
